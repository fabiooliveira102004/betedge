import { config } from '../config.mjs';
import { clamp, sum } from './math.mjs';

/**
 * Remove a margem da casa de um conjunto de odds do mesmo mercado.
 *
 * A soma de 1/odd de um mercado da sempre mais de 1 — essa sobra e a margem.
 * Reparti-la proporcionalmente e simples mas enviesa os favoritos; o metodo
 * de Shin modela a margem como protecao contra apostadores informados e
 * distribui-a de forma mais realista.
 */
export function devig(odds, method = config.betting.devigMethod) {
  const q = odds.map((o) => 1 / o);
  const booksum = sum(q);
  if (booksum <= 1) return { probs: q, overround: booksum - 1, method: 'nenhum' };

  if (method === 'proportional' || odds.length < 2) {
    return { probs: q.map((x) => x / booksum), overround: booksum - 1, method: 'proporcional' };
  }

  const probs = shin(q, booksum);
  return { probs, overround: booksum - 1, method: 'shin' };
}

function shin(q, booksum) {
  const pAt = (z) => q.map((qi) => {
    const inner = z * z + 4 * (1 - z) * (qi * qi) / booksum;
    return (Math.sqrt(Math.max(inner, 0)) - z) / (2 * (1 - z));
  });

  // z e a fracao de apostadores informados. Bisseccao em [0, 1): a soma das
  // probabilidades e monotona decrescente em z, por isso converge sempre.
  let lo = 0;
  let hi = 0.9;
  let probs = pAt(lo);

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    probs = pAt(mid);
    const total = sum(probs);
    if (Math.abs(total - 1) < 1e-9) break;
    if (total > 1) lo = mid;
    else hi = mid;
  }

  const total = sum(probs);
  return total > 0 ? probs.map((p) => p / total) : q.map((x) => x / booksum);
}

/** Valor esperado por unidade apostada. */
export function expectedValue(modelProb, decimalOdds) {
  return modelProb * (decimalOdds - 1) - (1 - modelProb);
}

/** Fracao de Kelly da banca. Negativa significa que nao ha aposta. */
export function kellyFraction(modelProb, decimalOdds) {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  return (modelProb * decimalOdds - 1) / b;
}

export function stakeFor(modelProb, decimalOdds) {
  const { kellyFraction: frac, maxStakePct } = config.betting;
  const full = kellyFraction(modelProb, decimalOdds);
  if (full <= 0) return 0;
  return clamp(full * frac, 0, maxStakePct);
}

/**
 * Confianca 0-1. Nao e a probabilidade de ganhar — e quanto confiamos na
 * estimativa. Uma vantagem enorme costuma significar que faltam dados ao
 * modelo, nao que o mercado esta errado, por isso e penalizada.
 */
export function confidenceScore({ edge, dataQuality, sampleMatches, overround, modelProb }) {
  // Amostra: satura por volta dos 20 jogos por equipa.
  const sample = clamp(sampleMatches / 20, 0, 1);

  // Vantagem: o ponto doce e 4-12%. Acima de 20% desconfiamos.
  const e = Math.abs(edge);
  const edgeScore = e < 0.02 ? e / 0.02 * 0.5
    : e <= 0.12 ? 1
      : clamp(1 - (e - 0.12) / 0.15, 0.15, 1);

  // Mercados com margem alta escondem pior o preco justo.
  const marginScore = clamp(1 - overround / 0.12, 0.3, 1);

  // Probabilidades extremas sao mal estimadas por modelos de Poisson.
  const extremity = modelProb < 0.12 || modelProb > 0.9 ? 0.6 : 1;

  const score = 0.30 * sample
    + 0.30 * edgeScore
    + 0.20 * clamp(dataQuality, 0, 1)
    + 0.12 * marginScore
    + 0.08 * extremity;

  return clamp(score, 0, 1);
}

/** Regista se a aposta acertou, dado o resultado final. */
export function settleBet({ market, selection, line }, homeGoals, awayGoals) {
  const total = homeGoals + awayGoals;

  switch (market) {
    case 'h2h': {
      const winner = homeGoals > awayGoals ? 'home' : homeGoals === awayGoals ? 'draw' : 'away';
      return selection === winner ? 'win' : 'loss';
    }
    case 'dnb': {
      if (homeGoals === awayGoals) return 'push';
      const winner = homeGoals > awayGoals ? 'home' : 'away';
      return selection === winner ? 'win' : 'loss';
    }
    case 'totals': {
      if (total === line) return 'push';
      const isOver = total > line;
      return (selection === 'over') === isOver ? 'win' : 'loss';
    }
    case 'btts': {
      const both = homeGoals > 0 && awayGoals > 0;
      return (selection === 'yes') === both ? 'win' : 'loss';
    }
    case 'double_chance': {
      const winner = homeGoals > awayGoals ? 'home' : homeGoals === awayGoals ? 'draw' : 'away';
      const covered = {
        homeOrDraw: ['home', 'draw'],
        awayOrDraw: ['away', 'draw'],
        homeOrAway: ['home', 'away'],
      }[selection] ?? [];
      return covered.includes(winner) ? 'win' : 'loss';
    }
    default:
      return 'void';
  }
}

/** Lucro em unidades de banca, dado o resultado e a stake. */
export function profitUnits(result, stake, odds) {
  if (result === 'win') return stake * (odds - 1);
  if (result === 'loss') return -stake;
  return 0; // push / void devolvem a stake
}
