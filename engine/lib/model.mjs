import { config } from '../config.mjs';
import { clamp, poissonPmf, shrink } from './math.mjs';

/**
 * Golos esperados para cada equipa, combinando tres sinais:
 *   1. taxas de ataque/defesa observadas (quantos golos marcam e sofrem)
 *   2. diferenca de Elo (forca geral, mais estavel em amostras pequenas)
 *   3. ajustes de contexto (lesoes, descanso, motivacao, noticias)
 */
export function expectedGoals({ home, away, rates, ratings, context }) {
  const { homeAdvantage, eloWeight, eloGoalsPer100 } = config.model;

  const rh = rates.forTeam(home);
  const ra = rates.forTeam(away);

  const atkH = shrink(rh.atk, rh.matches);
  const defH = shrink(rh.def, rh.matches);
  const atkA = shrink(ra.atk, ra.matches);
  const defA = shrink(ra.def, ra.matches);

  // Base pelas taxas de golos.
  let lambdaHome = rates.leagueAvgHome * atkH * defA;
  let lambdaAway = rates.leagueAvgAway * atkA * defH;

  // Reconcilia a supremacia com o que o Elo diz. Mantemos o total de golos
  // vindo das taxas e so redistribuimos a diferenca entre as duas equipas —
  // o Elo diz quem e melhor, nao quantos golos se marcam.
  const eloDiff = ratings.get(home) - ratings.get(away);
  const eloSupremacy = (eloDiff / 100) * eloGoalsPer100 + homeAdvantage;
  const rateSupremacy = lambdaHome - lambdaAway;
  const blended = eloWeight * eloSupremacy + (1 - eloWeight) * rateSupremacy;

  const total = lambdaHome + lambdaAway;
  lambdaHome = (total + blended) / 2;
  lambdaAway = (total - blended) / 2;

  // Ajustes de contexto: multiplicam o ataque de uma equipa e a defesa da
  // outra, porque uma defesa desfalcada aumenta os golos do adversario.
  const ctxH = context?.home ?? { attack: 1, defence: 1 };
  const ctxA = context?.away ?? { attack: 1, defence: 1 };
  lambdaHome *= ctxH.attack * ctxA.defence;
  lambdaAway *= ctxA.attack * ctxH.defence;

  // Um lambda demasiado baixo produz probabilidades absurdas de 0-0.
  return {
    home: clamp(lambdaHome, 0.18, 5.0),
    away: clamp(lambdaAway, 0.15, 5.0),
  };
}

/**
 * Matriz de resultados exatos com a correcao de Dixon-Coles, que corrige a
 * dependencia entre os golos das duas equipas nos resultados baixos.
 */
export function scoreMatrix(lambdaHome, lambdaAway) {
  const { rho, maxGoals } = config.model;
  const matrix = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway)
        * tau(h, a, lambdaHome, lambdaAway, rho);
      matrix[h][a] = Math.max(p, 0);
      total += matrix[h][a];
    }
  }

  // Renormaliza: tau e o corte em maxGoals fazem a massa deixar de somar 1.
  if (total > 0) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) matrix[h][a] /= total;
    }
  }

  return matrix;
}

function tau(h, a, lh, la, rho) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}
