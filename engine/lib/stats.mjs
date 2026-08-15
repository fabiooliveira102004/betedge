import { round } from './math.mjs';
import { scoreMatrix } from './model.mjs';

/**
 * Estatisticas do historico de apostas.
 *
 * Tudo aqui e calculado a partir de apostas ja liquidadas, com o resultado
 * real. A calibracao e a parte mais importante: mostra se quando o modelo
 * diz 60% acontece mesmo ~60% das vezes, que e a unica forma honesta de
 * saber se as probabilidades valem alguma coisa.
 */
export function computeStats(picks) {
  const settled = picks.filter((p) => p.settled && p.result);

  const bucket = () => ({ n: 0, wins: 0, losses: 0, pushes: 0, staked: 0, profit: 0 });
  const add = (b, p) => {
    b.n += 1;
    if (p.result === 'win') b.wins += 1;
    else if (p.result === 'loss') b.losses += 1;
    else b.pushes += 1;
    b.staked += p.stake ?? 0;
    b.profit += p.pnlUnits ?? 0;
  };
  const finish = (b) => ({
    ...b,
    hitRate: b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0,
    roi: b.staked > 0 ? b.profit / b.staked : 0,
    staked: round(b.staked, 5),
    profit: round(b.profit, 5),
  });

  const overall = bucket();
  const byMarket = new Map();
  const byLeague = new Map();
  const byMonth = new Map();
  const byConfidence = new Map();

  const group = (map, key) => {
    if (!map.has(key)) map.set(key, bucket());
    return map.get(key);
  };

  const chronological = [...settled].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  const equity = [];
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const p of chronological) {
    add(overall, p);
    add(group(byMarket, p.market), p);
    add(group(byLeague, p.league), p);
    add(group(byMonth, p.kickoff.slice(0, 7)), p);
    add(group(byConfidence, confidenceBand(p.confidence)), p);

    running += p.pnlUnits ?? 0;
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, running - peak);
    equity.push({ date: p.kickoff.slice(0, 10), cumulative: round(running, 5) });
  }

  // Sequencia atual de vitorias ou derrotas (empates nao a interrompem).
  let streak = 0;
  let streakType = null;
  for (let i = chronological.length - 1; i >= 0; i--) {
    const r = chronological[i].result;
    if (r === 'push') continue;
    if (streakType === null) { streakType = r; streak = 1; continue; }
    if (r === streakType) streak += 1;
    else break;
  }

  const calibration = [];
  for (let lo = 0; lo < 100; lo += 10) {
    const inBand = settled.filter(
      (p) => p.modelProb * 100 >= lo && p.modelProb * 100 < lo + 10 && p.result !== 'push',
    );
    if (inBand.length === 0) continue;
    calibration.push({
      band: `${lo}-${lo + 10}`,
      predicted: round(inBand.reduce((s, p) => s + p.modelProb, 0) / inBand.length, 4),
      actual: round(inBand.filter((p) => p.result === 'win').length / inBand.length, 4),
      n: inBand.length,
    });
  }

  const asObject = (map) => Object.fromEntries(
    [...map.entries()].map(([k, v]) => [k, finish(v)]),
  );

  return {
    overall: {
      ...finish(overall),
      maxDrawdown: round(maxDrawdown, 5),
      avgOdds: settled.length
        ? round(settled.reduce((s, p) => s + p.odds, 0) / settled.length, 3)
        : 0,
      avgEdge: settled.length
        ? round(settled.reduce((s, p) => s + (p.edge ?? 0), 0) / settled.length, 4)
        : 0,
    },
    pending: picks.filter((p) => !p.settled).length,
    streak: { type: streakType, length: streak },
    byMarket: asObject(byMarket),
    byLeague: asObject(byLeague),
    byMonth: asObject(byMonth),
    byConfidence: asObject(byConfidence),
    calibration,
    equity,
  };
}

function confidenceBand(c) {
  if (c == null) return 'desconhecida';
  if (c >= 0.75) return 'alta';
  if (c >= 0.55) return 'media';
  return 'baixa';
}

/**
 * Resultado simulado a partir dos golos esperados que o proprio modelo
 * previu. Usado apenas em modo demo — o historico fica coerente com as
 * previsoes em vez de fingir que o modelo acertou sempre.
 */
export function simulateScore(fixtureId, lambdas) {
  const matrix = scoreMatrix(lambdas?.home ?? 1.4, lambdas?.away ?? 1.2);
  // Determinista a partir do id: reexecutar nao muda resultados ja gravados.
  let r = (hash(fixtureId) % 1000000) / 1000000;

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix.length; a++) {
      r -= matrix[h][a];
      if (r <= 0) return { homeGoals: h, awayGoals: a };
    }
  }
  return { homeGoals: 1, awayGoals: 1 };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
