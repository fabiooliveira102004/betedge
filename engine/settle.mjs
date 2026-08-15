#!/usr/bin/env node
import { config, hasSupabase, isDemo } from './config.mjs';
import { log } from './lib/log.mjs';
import { fetchScores } from './lib/odds.mjs';
import { profitUnits, settleBet } from './lib/value.mjs';
import { readJson, writeJson } from './lib/store.mjs';
import { patch, upsert } from './lib/supabase.mjs';
import { computeStats, simulateScore } from './lib/stats.mjs';
import { round } from './lib/math.mjs';

/**
 * BetEdge — liquidacao.
 *
 * Verifica o resultado real de cada aposta publicada e regista se bateu.
 * E este passo que da credibilidade a app: as apostas ficam gravadas antes
 * do jogo e o resultado e colado por cima, sem hipotese de reescrever o
 * historico depois de saber o desfecho.
 */
const MAX_HISTORY = 750;

async function main() {
  const now = new Date();

  const current = await readJson('picks.json', { picks: [] });
  const history = await readJson('history.json', { picks: [] });

  const all = dedupeById([...(history.picks ?? []), ...(current.picks ?? [])]);
  const pending = all.filter((p) => !p.settled && new Date(p.kickoff) < now);

  log.info(`${all.length} apostas registadas, ${pending.length} a aguardar resultado`);

  const results = isDemo()
    ? new Map(pending.map((p) => [p.fixtureId, simulateScore(p.fixtureId, p.lambdas)]))
    : await realResults(pending);

  let settled = 0;
  for (const pick of pending) {
    const score = results.get(pick.fixtureId);
    if (!score) continue;

    const outcome = settleBet(pick, score.homeGoals, score.awayGoals);
    pick.settled = true;
    pick.result = outcome;
    pick.finalScore = `${score.homeGoals}-${score.awayGoals}`;
    pick.settledAt = new Date().toISOString();
    pick.pnlUnits = round(profitUnits(outcome, pick.stake, pick.odds), 5);
    settled += 1;

    log.info(`  ${pick.home} ${pick.finalScore} ${pick.away} — ${pick.description}: `
      + `${outcome.toUpperCase()} (${pick.pnlUnits >= 0 ? '+' : ''}${(pick.pnlUnits * 100).toFixed(2)}% da banca)`);
  }

  log.info(`${settled} apostas liquidadas`);

  // Jogos ja disputados saem da lista ativa e ficam so no historico.
  const stillUpcoming = (current.picks ?? []).filter((p) => new Date(p.kickoff) >= now);
  const archived = all
    .filter((p) => new Date(p.kickoff) < now)
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  await writeJson('picks.json', { ...current, count: stillUpcoming.length, picks: stillUpcoming });

  // O ficheiro JSON e descarregado inteiro pelo telemovel, por isso guarda
  // so uma janela recente. O registo completo vive no Supabase.
  const recent = archived.slice(0, MAX_HISTORY);
  await writeJson('history.json', {
    updatedAt: now.toISOString(),
    count: recent.length,
    totalRecorded: archived.length,
    picks: recent,
  });

  const stats = computeStats(archived);
  await writeJson('stats.json', { updatedAt: now.toISOString(), ...stats });

  log.info(`Balanco: ${stats.overall.wins}V-${stats.overall.losses}D-${stats.overall.pushes}A, `
    + `acerto ${(stats.overall.hitRate * 100).toFixed(1)}%, `
    + `ROI ${(stats.overall.roi * 100).toFixed(2)}%`);

  if (hasSupabase()) {
    for (const pick of pending.filter((p) => p.settled)) {
      await patch('picks', `id=eq.${encodeURIComponent(pick.id)}`, {
        settled: true,
        result: pick.result,
        final_score: pick.finalScore,
        pnl_units: pick.pnlUnits,
        settled_at: pick.settledAt,
      });
    }
    await upsert('stats_snapshots', [{
      id: now.toISOString().slice(0, 10),
      captured_at: now.toISOString(),
      payload: stats,
    }]);
  }
}

async function realResults(pending) {
  const results = new Map();
  if (pending.length === 0) return results;

  const leagueNames = new Set(pending.map((p) => p.league));
  const keys = config.leagues.filter((l) => leagueNames.has(l.name)).map((l) => l.key);

  for (const key of keys) {
    try {
      for (const s of await fetchScores(key, 3)) results.set(s.id, s);
    } catch (err) {
      log.warn(`Resultados indisponiveis para ${key}: ${err.message}`);
    }
  }

  return results;
}

function dedupeById(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.id, { ...map.get(row.id), ...row });
  return [...map.values()];
}

main().catch((err) => {
  log.error(err.stack ?? err.message);
  process.exitCode = 1;
});
