#!/usr/bin/env node
import {
  config, hasAI, hasFootball, hasOdds, hasSupabase, isDemo,
} from './config.mjs';
import { log } from './lib/log.mjs';
import { fetchBetclicOdds } from './lib/odds.mjs';
import { demoOdds } from './lib/demo.mjs';
import {
  attachBaseModel, attachContext, evaluateFixture, groupFixtures, loadLeagueData,
} from './lib/pipeline.mjs';
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
  await attachContext(fixtures);

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

  log.step('Gravacao');
  await persist({ fixtures, picks: selected, startedAt });
  log.info('Concluido.');
}

async function persist({ fixtures, picks, startedAt }) {
  const previous = await readJson('picks.json', { picks: [] });
  const history = await readJson('history.json', { picks: [] });

  // Apostas publicadas antes que ja nao aparecem nesta execucao passam para
  // o historico, onde ficam a espera de liquidacao. Nunca desaparecem: o
  // registo tem de incluir as que correram mal.
  const stillActive = new Set(picks.map((p) => p.id));
  const retired = (previous.picks ?? []).filter((p) => !stillActive.has(p.id)).map(slimPick);
  const mergedHistory = dedupeById([...(history.picks ?? []), ...retired]);

  const clean = picks.map(({ score, ...p }) => p);

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
      news: hasAI() ? 'google-news-rss' : null,
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
    fixturesAnalysed: fixtures,
    picksPublished: picks,
    error,
  });
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
