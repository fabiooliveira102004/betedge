#!/usr/bin/env node
import {
  config, hasAI, hasFootball, hasOdds, hasSupabase, isDemo,
} from './config.mjs';
import { log } from './lib/log.mjs';
import { fetchBetclicOdds } from './lib/odds.mjs';
import { demoOdds } from './lib/demo.mjs';
import {
  analyseFixture, attachBaseModel, attachContext, attachNews,
  evaluateFixture, groupFixtures, loadLeagueData,
} from './lib/pipeline.mjs';
import { buildMatch } from './lib/match.mjs';
import { dataProvenance } from './lib/pipeline.mjs';
import { readJson, writeJson } from './lib/store.mjs';
import { upsert } from './lib/supabase.mjs';
import { slimPick } from './lib/slim.mjs';
import { round } from './lib/math.mjs';

/**
 * BetEdge — execucao de analise.
 *
 * Recolhe as cotacoes da Betclic, modela cada jogo, compara a probabilidade
 * do modelo com a probabilidade justa do mercado e publica as apostas em que
 * ha vantagem. Corre no GitHub Actions e escreve para data/*.json e Supabase.
 */
async function main() {
  const startedAt = new Date();
  log.step('Recolha de cotacoes');

  const { offers, history: demoHistory } = isDemo()
    ? demoOdds(startedAt)
    : await fetchBetclicOdds();

  if (offers.length === 0) {
    log.error('Nenhuma cotacao recolhida. Nada a analisar.');
    await writeMeta({ startedAt, fixtures: 0, picks: 0, error: 'sem cotacoes' });
    return;
  }

  const fixtures = groupFixtures(offers, startedAt);
  log.info(`${offers.length} cotacoes em ${fixtures.length} jogos dentro da janela de ${config.horizonDays} dias`);

  log.step('Historico e ratings');
  const leagues = await loadLeagueData(fixtures, demoHistory);

  log.step('Modelo base');
  for (const fixture of fixtures) attachBaseModel(fixture, leagues);

  log.step('Contexto');
  await attachNews(fixtures);
  await attachContext(fixtures);

  log.step('Analise dos jogos');
  for (const fixture of fixtures) analyseFixture(fixture);
  const matches = fixtures.map(buildMatch);
  log.info(`${matches.length} jogos analisados, `
    + `${matches.reduce((n, m) => n + m.valueCount, 0)} selecoes com vantagem`);

  log.step('Avaliacao de valor');
  const picks = fixtures.flatMap(evaluateFixture);
  picks.sort((a, b) => b.score - a.score);
  const selected = picks.slice(0, config.betting.maxPicksPerDay);

  log.info(`${picks.length} apostas com valor; ${selected.length} selecionadas`);
  for (const p of selected) {
    log.info(`  ${p.home} vs ${p.away} — ${p.description} @ ${p.odds} `
      + `(modelo ${(p.modelProb * 100).toFixed(1)}%, vantagem ${(p.edge * 100).toFixed(1)}%, `
      + `stake ${(p.stake * 100).toFixed(2)}% da banca)`);
  }

  const problemas = validate(matches);
  if (problemas.length) {
    log.error(`${problemas.length} jogos com dados incompletos — nao vao ser publicados:`);
    for (const p of problemas.slice(0, 5)) log.error(`  ${p}`);
  }

  log.step('Gravacao');
  await persist({
    fixtures,
    matches: matches.filter((m) => !problemas.some((p) => p.startsWith(m.id))),
    picks: selected,
    startedAt,
  });
  log.info('Concluido.');
}

async function persist({ fixtures, matches, picks, startedAt }) {
  const previous = await readJson('picks.json', { picks: [] });
  const history = await readJson('history.json', { picks: [] });

  // Dados de exemplo nunca podem substituir analise real.
  //
  // Correr o motor sem chaves — para experimentar ou para gerar dados de
  // demonstracao — produzia jogos inventados que iam por cima da ultima
  // analise verdadeira. Basta acontecer uma vez, num commit distraido, para
  // a app passar a mostrar jogos que nao existem sem ninguem perceber
  // porque.
  if (isDemo()) {
    const publicado = await readJson('meta.json', null);
    if (publicado && publicado.demo === false) {
      log.error('Ja existe analise real publicada. O modo de exemplo nao a substitui.');
      log.error(`(gerada em ${publicado.generatedAt}; usa DEMO_OVERWRITE=1 se e mesmo isso que queres)`);
      if (process.env.DEMO_OVERWRITE !== '1') return;
    }
  }

  // Apostas publicadas antes que ja nao aparecem nesta execucao passam para
  // o historico, onde ficam a espera de liquidacao. Nunca desaparecem: o
  // registo tem de incluir as que correram mal.
  const stillActive = new Set(picks.map((p) => p.id));
  const retired = (previous.picks ?? []).filter((p) => !stillActive.has(p.id)).map(slimPick);
  const mergedHistory = dedupeById([...(history.picks ?? []), ...retired]);

  const clean = picks.map(({ score, ...p }) => p);

  await writeJson('matches.json', {
    generatedAt: startedAt.toISOString(),
    demo: isDemo(),
    count: matches.length,
    matches,
  });

  await writeJson('picks.json', {
    generatedAt: startedAt.toISOString(),
    demo: isDemo(),
    count: clean.length,
    picks: clean,
  });

  await writeJson('history.json', {
    updatedAt: startedAt.toISOString(),
    count: mergedHistory.length,
    picks: mergedHistory,
  });

  await writeMeta({ startedAt, fixtures: fixtures.length, picks: clean.length });

  if (hasSupabase()) {
    await upsert('fixtures', fixtures.map((f) => ({
      id: f.id,
      league: f.league,
      home_team: f.home,
      away_team: f.away,
      kickoff: f.kickoff,
      status: 'scheduled',
      lambda_home: round(f.lambdas.home, 3),
      lambda_away: round(f.lambdas.away, 3),
      updated_at: new Date().toISOString(),
    })));

    await upsert('picks', clean.map(toRow));
  }
}

export function toRow(p) {
  return {
    id: p.id,
    fixture_id: p.fixtureId,
    league: p.league,
    home_team: p.home,
    away_team: p.away,
    kickoff: p.kickoff,
    market: p.market,
    selection: p.selection,
    line: p.line,
    description: p.description,
    odds: p.odds,
    bookmaker: p.bookmaker,
    model_prob: p.modelProb,
    fair_prob: p.fairProb,
    edge: p.edge,
    ev: p.ev,
    stake: p.stake,
    confidence: p.confidence,
    factors: p.factors,
    ai_summary: p.aiSummary,
    is_demo: p.demo,
    generated_at: p.generatedAt,
    settled: Boolean(p.settled),
    result: p.result ?? null,
    final_score: p.finalScore ?? null,
    pnl_units: p.pnlUnits ?? null,
    settled_at: p.settledAt ?? null,
  };
}

async function writeMeta({ startedAt, fixtures, picks, error = null }) {
  await writeJson('meta.json', {
    app: 'BetEdge',
    generatedAt: startedAt.toISOString(),
    demo: isDemo(),
    sources: {
      odds: hasOdds() ? 'the-odds-api (betclic)' : 'demo',
      football: hasFootball() ? 'api-football' : null,
      news: 'google-news-rss',
      ai: hasAI() ? config.ai.model : null,
      database: hasSupabase() ? 'supabase' : null,
    },
    criteria: {
      minEdge: config.betting.minEdge,
      minOdds: config.betting.minOdds,
      maxOdds: config.betting.maxOdds,
      minConfidence: config.betting.minConfidence,
      kellyFraction: config.betting.kellyFraction,
      maxStakePct: config.betting.maxStakePct,
    },
    // O que sustentou esta analise. A app mostra-o para que ninguem tome
    // uma previsao assente em dados de ha duas epocas por analise fresca.
    dataUsed: {
      ownMatches: dataProvenance.ownMatches,
      externalMatches: dataProvenance.externalMatches,
      externalSeasons: [...dataProvenance.externalSeasons].sort(),
      injuriesAvailable: dataProvenance.injuryTeams > 0,
    },
    fixturesAnalysed: fixtures,
    picksPublished: picks,
    error,
  });
}

/**
 * Um jogo sem preco numa selecao rebenta o ecra de analise no telemovel.
 * Ja aconteceu: o modo de demonstracao trazia o campo, os dados reais nao,
 * e so se percebeu com a app publicada. Mais vale publicar menos jogos do
 * que publicar um que nao abre.
 */
function validate(matches) {
  const problemas = [];

  for (const match of matches) {
    if (!match.verdict || !match.lambdas) {
      problemas.push(`${match.id} (${match.home} vs ${match.away}): sem veredicto`);
      continue;
    }
    for (const market of match.markets ?? []) {
      for (const sel of market.selections) {
        if (typeof sel.odds !== 'number' || !Number.isFinite(sel.odds)) {
          problemas.push(`${match.id} (${match.home} vs ${match.away}): `
            + `${market.key}/${sel.selection} sem preco`);
        }
      }
    }
  }

  return problemas;
}

function dedupeById(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.id, row);
  return [...map.values()];
}

main().catch((err) => {
  log.error(err.stack ?? err.message);
  process.exitCode = 1;
});
