import { config, hasAI, hasFootball, isDemo } from '../config.mjs';
import { log } from './log.mjs';
import { currentSeason, fetchHistory, fetchInjuries, matchTeamName } from './football.mjs';
import { buildRatings, buildScoringRates } from './ratings.mjs';
import { expectedGoals, scoreMatrix } from './model.mjs';
import { deriveMarkets, describeSelection, modelProbFor } from './markets.mjs';
import { confidenceScore, devig, expectedValue, stakeFor } from './value.mjs';
import { combineContext, dataQuality, injuryImpact, restImpact } from './context.mjs';
import { fetchTeamNews } from './news.mjs';
import { assessContext } from './ai.mjs';
import {
  buildCaveats, buildNarrative, goalsDistribution, headToHead,
  likelyScorelines, teamForm, venueSplit, winCondition,
} from './insight.mjs';
import { clamp, round } from './math.mjs';

/**
 * O pipeline de analise, do lote de cotacoes ate a lista de apostas.
 *
 * Vive separado dos pontos de entrada porque tanto a execucao real
 * (run.mjs) como a geracao de historico demo (seed.mjs) tem de passar
 * exatamente pelas mesmas regras — se divergirem, o historico deixa de
 * dizer alguma coisa sobre o comportamento real do modelo.
 */

/** Agrupa cotacoes soltas em jogos, dentro da janela temporal util. */
export function groupFixtures(offers, now, horizonDays = config.horizonDays) {
  const horizonEnd = new Date(now.getTime() + horizonDays * 86400000);
  const byId = new Map();

  for (const offer of offers) {
    const kickoff = new Date(offer.fixture.kickoff);
    // Jogos ja comecados nao servem, e para la do horizonte as cotacoes
    // ainda mudam demasiado para valer a pena analisar.
    if (kickoff <= now || kickoff > horizonEnd) continue;

    if (!byId.has(offer.fixture.id)) {
      byId.set(offer.fixture.id, { ...offer.fixture, offers: [] });
    }
    byId.get(offer.fixture.id).offers.push(offer);
  }

  return [...byId.values()].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

export async function loadLeagueData(fixtures, demoHistory) {
  const leagues = new Map();
  const names = [...new Set(fixtures.map((f) => f.league))];

  for (const name of names) {
    const meta = config.leagues.find((l) => l.name === name);

    let history = [];
    let injuries = new Map();

    if (isDemo()) {
      // Cada liga tem de ter o seu proprio pool de ratings: misturar
      // Premier League com Liga Portugal daria um Elo sem significado.
      history = (demoHistory ?? []).filter((m) => m.league === name);
    } else if (hasFootball() && meta?.apiFootballId) {
      history = await fetchHistory(meta.apiFootballId, currentSeason());
      injuries = await fetchInjuries(meta.apiFootballId, currentSeason());
      log.info(`${name}: ${history.length} jogos de historico, ${injuries.size} equipas com ausencias`);
    } else {
      log.warn(`${name}: sem historico (API_FOOTBALL_KEY nao configurada) — modelo assenta so nas odds`);
    }

    const teamIndex = new Map();
    for (const m of history) {
      teamIndex.set(m.home, true);
      teamIndex.set(m.away, true);
    }

    leagues.set(name, {
      history,
      injuries,
      teamIndex,
      ratings: buildRatings(history),
      rates: buildScoringRates(history),
      lastMatch: lastMatchDates(history),
    });
  }

  return leagues;
}

function lastMatchDates(history) {
  const map = new Map();
  for (const m of history) {
    const d = new Date(m.kickoff);
    for (const team of [m.home, m.away]) {
      if (!map.has(team) || map.get(team) < d) map.set(team, d);
    }
  }
  return map;
}

export function attachBaseModel(fixture, leagues) {
  const league = leagues.get(fixture.league);

  // Os nomes das equipas diferem entre as duas APIs; resolvemos uma vez e
  // guardamos o nome canonico no jogo.
  const resolve = (name) => (league.teamIndex.size
    ? matchTeamName(name, league.teamIndex) ?? name
    : name);

  fixture.homeKey = resolve(fixture.home);
  fixture.awayKey = resolve(fixture.away);

  const rh = league.rates.forTeam(fixture.homeKey);
  const ra = league.rates.forTeam(fixture.awayKey);
  fixture.sampleMatches = Math.min(rh.matches, ra.matches);

  fixture.injuries = {
    home: league.injuries.get(matchTeamName(fixture.home, league.injuries) ?? fixture.homeKey) ?? [],
    away: league.injuries.get(matchTeamName(fixture.away, league.injuries) ?? fixture.awayKey) ?? [],
  };

  const kickoff = new Date(fixture.kickoff);
  const restDays = (team) => {
    const last = league.lastMatch.get(team);
    return last ? (kickoff - last) / 86400000 : NaN;
  };

  // Guardados para que a camada de IA possa recombinar o contexto sem
  // recalcular lesoes e descanso (e sem os perder pelo caminho).
  fixture.leagueRef = league;
  fixture.baseParts = {
    home: {
      lesoes: injuryImpact(fixture.injuries.home),
      descanso: restImpact(restDays(fixture.homeKey)),
    },
    away: {
      lesoes: injuryImpact(fixture.injuries.away),
      descanso: restImpact(restDays(fixture.awayKey)),
    },
  };

  fixture.context = {
    home: combineContext(fixture.baseParts.home),
    away: combineContext(fixture.baseParts.away),
  };

  fixture.lambdas = expectedGoals({
    home: fixture.homeKey,
    away: fixture.awayKey,
    rates: league.rates,
    ratings: league.ratings,
    context: fixture.context,
  });

  fixture.hasHistory = league.history.length > 0;

  // Evidencia que o utilizador pode conferir por si. Cortada na data do
  // jogo: usar resultados posteriores tornaria a analise impossivel de
  // reproduzir e inflacionaria o historico.
  const asOf = { before: fixture.kickoff };
  fixture.form = {
    home: teamForm(fixture.homeKey, league.history, asOf),
    away: teamForm(fixture.awayKey, league.history, asOf),
  };
  fixture.split = {
    home: venueSplit(fixture.homeKey, league.history, asOf),
    away: venueSplit(fixture.awayKey, league.history, asOf),
  };
  fixture.h2h = headToHead(fixture.homeKey, fixture.awayKey, league.history, asOf);
  fixture.elo = {
    home: Math.round(league.ratings.get(fixture.homeKey)),
    away: Math.round(league.ratings.get(fixture.awayKey)),
  };
}

/**
 * Titulos de noticias sobre cada equipa.
 *
 * Corre sempre, mesmo sem chave de IA: o RSS do Google News nao precisa de
 * autenticacao, e os titulos em bruto ja sao informacao util para quem esta
 * a analisar o jogo. A IA, quando existe, interpreta-os; quando nao existe,
 * o utilizador le-os por si.
 */
export async function attachNews(fixtures) {
  const batch = fixtures.slice(0, config.ai.maxFixtures);
  log.info(`A recolher noticias para ${batch.length} jogos...`);

  await mapLimited(batch, 6, async (fixture) => {
    const [homeNews, awayNews] = await Promise.all([
      fetchTeamNews(fixture.home),
      fetchTeamNews(fixture.away),
    ]);
    fixture.news = { home: homeNews, away: awayNews };
  });

  const withNews = batch.filter((f) => (f.news?.home?.length ?? 0) + (f.news?.away?.length ?? 0) > 0);
  log.info(`${withNews.length} jogos com noticias recolhidas`);
}

export async function attachContext(fixtures) {
  if (!hasAI()) {
    log.info('Camada de IA desligada — o contexto fica pelos titulos de noticias em bruto');
    return;
  }

  // So os jogos mais proximos vao a IA, para limitar o custo por execucao.
  const batch = fixtures.slice(0, config.ai.maxFixtures);

  const assessments = await assessContext(batch.map((f) => ({
    fixtureId: f.id,
    league: f.league,
    home: f.home,
    away: f.away,
    kickoff: f.kickoff,
    lambdaHome: f.lambdas.home,
    lambdaAway: f.lambdas.away,
    injuries: f.injuries,
    news: f.news,
  })));

  for (const fixture of batch) {
    const a = assessments.get(fixture.id);
    if (!a) continue;

    fixture.aiAssessment = a;
    fixture.context = {
      home: combineContext({
        ...fixture.baseParts.home,
        contexto: { attack: a.home.attack, defence: a.home.defence, note: a.home.summary },
      }),
      away: combineContext({
        ...fixture.baseParts.away,
        contexto: { attack: a.away.attack, defence: a.away.defence, note: a.away.summary },
      }),
    };

    // Os lambdas tem de ser recalculados de raiz: o contexto entra como
    // multiplicador dentro de expectedGoals, nao por cima do resultado.
    fixture.lambdas = expectedGoals({
      home: fixture.homeKey,
      away: fixture.awayKey,
      rates: fixture.leagueRef.rates,
      ratings: fixture.leagueRef.ratings,
      context: fixture.context,
    });
  }
}

/**
 * Tudo o que se calcula a partir da matriz de resultados, uma vez por jogo.
 * Corre antes de qualquer avaliacao de mercado, porque tanto o quadro de
 * mercados como as apostas de valor assentam nos mesmos numeros.
 */
export function analyseFixture(fixture) {
  const matrix = scoreMatrix(fixture.lambdas.home, fixture.lambdas.away);
  fixture.markets = deriveMarkets(matrix);
  fixture.scorelines = likelyScorelines(matrix);
  fixture.goalsDistribution = goalsDistribution(matrix);

  fixture.quality = dataQuality({
    hasHistory: fixture.hasHistory,
    hasInjuries: (fixture.injuries.home.length + fixture.injuries.away.length) > 0
      || fixture.hasHistory,
    hasNews: (fixture.news?.home?.length ?? 0) + (fixture.news?.away?.length ?? 0) > 0,
    hasAI: Boolean(fixture.aiAssessment),
    sampleMatches: fixture.sampleMatches ?? 0,
  });

  fixture.teamProfiles = {
    home: {
      name: fixture.home,
      elo: fixture.elo?.home ?? null,
      form: fixture.form?.home ?? null,
      split: fixture.split?.home ?? null,
      absences: fixture.injuries.home.slice(0, 8),
    },
    away: {
      name: fixture.away,
      elo: fixture.elo?.away ?? null,
      form: fixture.form?.away ?? null,
      split: fixture.split?.away ?? null,
      absences: fixture.injuries.away.slice(0, 8),
    },
  };

  return fixture;
}

export function evaluateFixture(fixture) {
  const markets = fixture.markets;
  const scorelines = fixture.scorelines;
  const goalsDist = fixture.goalsDistribution;
  const quality = fixture.quality;

  // Um grupo = todas as selecoes do mesmo mercado. A margem so pode ser
  // removida sobre o grupo completo.
  const groups = new Map();
  for (const offer of fixture.offers) {
    if (!groups.has(offer.groupKey)) groups.set(offer.groupKey, offer.group);
  }

  const fairByGroup = new Map();
  for (const [key, group] of groups) {
    const { probs, overround } = devig(group.map((g) => g.odds));
    fairByGroup.set(key, { probs, overround, group });
  }

  const out = [];
  const seen = new Set();

  for (const offer of fixture.offers) {
    const dedupe = `${offer.groupKey}|${offer.selection}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const { odds, market, selection, line } = offer;
    if (odds < config.betting.minOdds || odds > config.betting.maxOdds) continue;

    const modelProb = modelProbFor(markets, { market, selection, line });
    if (modelProb == null) continue;

    const fair = fairByGroup.get(offer.groupKey);
    const idx = fair.group.findIndex((g) => g.selection === selection);
    const fairProb = idx >= 0 ? fair.probs[idx] : 1 / odds;

    const edge = modelProb - fairProb;
    if (edge < config.betting.minEdge) continue;

    const ev = expectedValue(modelProb, odds);
    if (ev <= 0) continue;

    let confidence = confidenceScore({
      edge,
      dataQuality: quality,
      sampleMatches: fixture.sampleMatches ?? 0,
      overround: fair.overround,
      modelProb,
    });
    confidence = clamp(confidence + (fixture.aiAssessment?.confidenceModifier ?? 0), 0, 1);
    if (confidence < config.betting.minConfidence) continue;

    // A stake sai do Kelly fracionado, mas escalada pela confianca: uma
    // vantagem em que confiamos pouco recebe menos dinheiro.
    const stake = stakeFor(modelProb, odds) * (0.5 + 0.5 * confidence);

    out.push({
      id: `${fixture.id}:${market}:${selection}${line != null ? `:${line}` : ''}`,
      fixtureId: fixture.id,
      league: fixture.league,
      home: fixture.home,
      away: fixture.away,
      kickoff: fixture.kickoff,
      market,
      selection,
      line: line ?? null,
      description: describeSelection({
        market, selection, line, home: fixture.home, away: fixture.away,
      }),
      odds,
      bookmaker: config.bookmaker,
      modelProb: round(modelProb),
      fairProb: round(fairProb),
      impliedProb: round(1 / odds),
      edge: round(edge),
      ev: round(ev),
      stake: round(stake, 5),
      confidence: round(confidence, 3),
      overround: round(fair.overround, 4),
      lambdas: { home: round(fixture.lambdas.home, 3), away: round(fixture.lambdas.away, 3) },
      factors: {
        home: fixture.context.home.factors,
        away: fixture.context.away.factors,
      },
      aiSummary: fixture.aiAssessment
        ? {
          home: fixture.aiAssessment.home.summary,
          away: fixture.aiAssessment.away.summary,
          signals: fixture.aiAssessment.keySignals,
        }
        : null,

      // --- A analise que justifica a aposta -----------------------------
      // So viaja nas apostas ativas. Ao arquivar e retirada (ver slimPick
      // em run.mjs), senao o historico crescia para megabytes e o
      // telemovel tinha de o descarregar inteiro.
      winCondition: winCondition({ market, selection, line }, fixture.home, fixture.away),
      narrative: buildNarrative({
        home: fixture.home,
        away: fixture.away,
        market,
        selection,
        line,
        lambdas: fixture.lambdas,
        modelProb,
        fairProb,
        impliedProb: 1 / odds,
        odds,
        formHome: fixture.form?.home,
        formAway: fixture.form?.away,
        splitHome: fixture.split?.home,
        splitAway: fixture.split?.away,
        h2h: fixture.h2h,
        contextFactors: [
          ...(fixture.context.home.factors ?? []),
          ...(fixture.context.away.factors ?? []),
        ],
        aiSummary: fixture.aiAssessment,
      }),
      caveats: buildCaveats({
        modelProb,
        confidence,
        sampleMatches: fixture.sampleMatches ?? 0,
        hasHistory: fixture.hasHistory,
        odds,
      }),
      scorelines,
      goalsDistribution: goalsDist,
      h2h: fixture.h2h,
      teams: fixture.teamProfiles,

      demo: Boolean(fixture.demo),
      generatedAt: new Date().toISOString(),
      settled: false,
      result: null,
      pnlUnits: null,
      // Ordenacao interna: vantagem ponderada pela confianca. Uma vantagem
      // de 12% em que confiamos a 40% vale menos do que 6% a 85%.
      score: edge * confidence,
    });
  }

  return out;
}

export async function mapLimited(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      await fn(queue.shift());
    }
  });
  await Promise.all(workers);
}
