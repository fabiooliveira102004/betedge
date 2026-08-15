import { clamp } from './math.mjs';

/**
 * Traduz sinais fora do relvado em multiplicadores de golos esperados.
 * Devolve sempre um objeto com `attack`, `defence` e a lista de factores
 * que os produziram, para que a app possa mostrar o porque de cada aposta.
 */

// Quanto pesa a ausencia de um jogador, por posicao. Um avancado tira
// sobretudo ataque; um guarda-redes titular tira sobretudo defesa.
const POSITION_IMPACT = {
  Attacker: { attack: 0.055, defence: 0.008 },
  Midfielder: { attack: 0.032, defence: 0.022 },
  Defender: { attack: 0.010, defence: 0.045 },
  Goalkeeper: { attack: 0.004, defence: 0.055 },
};

const DEFAULT_IMPACT = { attack: 0.022, defence: 0.022 };

export function injuryImpact(injuries = []) {
  let attackLoss = 0;
  let defenceLoss = 0;
  const named = [];

  for (const inj of injuries) {
    const impact = POSITION_IMPACT[inj.position] ?? DEFAULT_IMPACT;

    // "Questionable" nao e "Missing Fixture": um jogador em duvida ainda
    // pode jogar, por isso conta a meio.
    const certainty = /question|doubt|duvida/i.test(inj.type ?? inj.reason ?? '') ? 0.5 : 1;

    attackLoss += impact.attack * certainty;
    defenceLoss += impact.defence * certainty;
    named.push(`${inj.player}${inj.position ? ` (${inj.position})` : ''}`);
  }

  // Um plantel tem substitutos. Mesmo com meia equipa de fora, o impacto
  // real satura muito antes de zerar o ataque.
  attackLoss = clamp(attackLoss, 0, 0.22);
  defenceLoss = clamp(defenceLoss, 0, 0.22);

  return {
    attack: 1 - attackLoss,
    defence: 1 + defenceLoss, // defesa pior => adversario marca mais
    count: injuries.length,
    players: named.slice(0, 6),
  };
}

/** Jogar com menos de 4 dias de descanso custa rendimento. */
export function restImpact(daysSinceLastMatch) {
  if (!Number.isFinite(daysSinceLastMatch)) return { attack: 1, defence: 1, note: null };
  if (daysSinceLastMatch >= 5) return { attack: 1, defence: 1, note: null };

  const fatigue = clamp((5 - daysSinceLastMatch) * 0.018, 0, 0.07);
  return {
    attack: 1 - fatigue,
    defence: 1 + fatigue * 0.7,
    note: `apenas ${daysSinceLastMatch} dias de descanso`,
  };
}

/**
 * Junta todos os multiplicadores de uma equipa num so, e guarda a lista de
 * factores legivel para mostrar na app.
 */
export function combineContext(parts) {
  let attack = 1;
  let defence = 1;
  const factors = [];

  for (const [label, part] of Object.entries(parts)) {
    if (!part) continue;
    attack *= part.attack ?? 1;
    defence *= part.defence ?? 1;

    const attackPct = Math.round(((part.attack ?? 1) - 1) * 1000) / 10;
    const defencePct = Math.round(((part.defence ?? 1) - 1) * 1000) / 10;
    if (attackPct === 0 && defencePct === 0) continue;

    factors.push({
      type: label,
      attackPct,
      defencePct,
      detail: part.note ?? part.summary ?? (part.players?.length
        ? `${part.count} ausencias: ${part.players.join(', ')}`
        : null),
    });
  }

  return {
    attack: clamp(attack, 0.72, 1.25),
    defence: clamp(defence, 0.78, 1.30),
    factors,
  };
}

/** Sinal 0-1 de quanta informacao real sustentou a analise deste jogo. */
export function dataQuality({ hasHistory, hasInjuries, hasNews, hasAI, sampleMatches }) {
  let score = 0;
  if (hasHistory) score += 0.35;
  if (sampleMatches >= 10) score += 0.15;
  if (hasInjuries) score += 0.2;
  if (hasNews) score += 0.15;
  if (hasAI) score += 0.15;
  return clamp(score, 0, 1);
}
