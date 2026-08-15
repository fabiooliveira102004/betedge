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
}

export async function attachContext(fixtures) {
  if (!hasAI()) {
    log.info('Camada de IA desligada — apostas assentam so no modelo e nas lesoes');
    return;
  }

  // So os jogos mais proximos vao a IA: sao os que ainda dao para apostar e
  // limitam o custo por execucao.
  const batch = fixtures.slice(0, config.ai.maxFixtures);

  log.info(`A recolher noticias para ${batch.length} jogos...`);
  await mapLimited(batch, 6, async (fixture) => {
    const [homeNews, awayNews] = await Promise.all([
      fetchTeamNews(fixture.home),
      fetchTeamNews(fixture.away),
    ]);
    fixture.news = { home: homeNews, away: awayNews };
  });

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

export function evaluateFixture(fixture) {
  const matrix = scoreMatrix(fixture.lambdas.home, fixture.lambdas.away);
  const markets = deriveMarkets(matrix);
  fixture.markets = markets;

  const quality = dataQuality({
    hasHistory: fixture.hasHistory,
    hasInjuries: (fixture.injuries.home.length + fixture.injuries.away.length) > 0
      || fixture.hasHistory,
    hasNews: Boolean(fixture.news),
    hasAI: Boolean(fixture.aiAssessment),
    sampleMatches: fixture.sampleMatches ?? 0,
  });

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
