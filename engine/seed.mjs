#!/usr/bin/env node
import { log } from './lib/log.mjs';
import { demoOdds } from './lib/demo.mjs';
import {
  attachBaseModel, evaluateFixture, groupFixtures, loadLeagueData,
} from './lib/pipeline.mjs';
import { profitUnits, settleBet } from './lib/value.mjs';
import { computeStats, simulateScore } from './lib/stats.mjs';
import { writeJson } from './lib/store.mjs';
import { slimPick } from './lib/slim.mjs';
import { config } from './config.mjs';
import { round } from './lib/math.mjs';

/**
 * BetEdge — gerador de historico de demonstracao.
 *
 * Rebobina o relogio e corre o pipeline real, dia a dia, como se a app
 * estivesse a funcionar ha semanas. As apostas saem das mesmas regras que
 * a producao usa, por isso o historico mostra o comportamento verdadeiro do
 * modelo — incluindo as maus dias — em vez de numeros inventados.
 *
 * Uso: node seed.mjs [dias]
 */
const DAYS = Number(process.argv[2]) || 45;

async function main() {
  log.step(`Historico simulado dos ultimos ${DAYS} dias`);

  const today = new Date();
  const collected = new Map();

  for (let daysAgo = DAYS; daysAgo >= 1; daysAgo--) {
    const asOf = new Date(today.getTime() - daysAgo * 86400000);

    const { offers, history } = demoOdds(asOf);
    const fixtures = groupFixtures(offers, asOf);
    if (fixtures.length === 0) continue;

    const leagues = await loadLeagueData(fixtures, history);
    for (const fixture of fixtures) attachBaseModel(fixture, leagues);

    const picks = fixtures
      .flatMap(evaluateFixture)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.betting.maxPicksPerDay);

    for (const { score, ...pick } of picks) {
      // So contam jogos que ja se disputaram a data de hoje.
      if (new Date(pick.kickoff) >= today) continue;
      if (collected.has(pick.id)) continue;
      pick.generatedAt = asOf.toISOString();
      collected.set(pick.id, slimPick(pick));
    }
  }

  const picks = [...collected.values()];
  log.info(`${picks.length} apostas geradas`);

  for (const pick of picks) {
    const { homeGoals, awayGoals } = simulateScore(pick.fixtureId, pick.lambdas);
    pick.settled = true;
    pick.result = settleBet(pick, homeGoals, awayGoals);
    pick.finalScore = `${homeGoals}-${awayGoals}`;
    pick.settledAt = new Date(new Date(pick.kickoff).getTime() + 2 * 3600000).toISOString();
    pick.pnlUnits = round(profitUnits(pick.result, pick.stake, pick.odds), 5);
  }

  picks.sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  await writeJson('history.json', {
    updatedAt: today.toISOString(),
    demo: true,
    count: picks.length,
    picks,
  });

  const stats = computeStats(picks);
  await writeJson('stats.json', { updatedAt: today.toISOString(), demo: true, ...stats });

  log.info(`Balanco: ${stats.overall.wins}V-${stats.overall.losses}D-${stats.overall.pushes}A`);
  log.info(`Acerto ${(stats.overall.hitRate * 100).toFixed(1)}%, ROI ${(stats.overall.roi * 100).toFixed(2)}%, `
    + `lucro ${(stats.overall.profit * 100).toFixed(2)}% da banca`);
}

main().catch((err) => {
  log.error(err.stack ?? err.message);
  process.exitCode = 1;
});
