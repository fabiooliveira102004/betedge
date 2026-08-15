/**
 * Deriva probabilidades de mercado a partir da matriz de resultados exatos.
 * Uma unica matriz alimenta todos os mercados, por isso as probabilidades
 * sao internamente coerentes (ao contrario de modelar cada mercado a parte).
 */
export function deriveMarkets(matrix) {
  const n = matrix.length;
  let home = 0; let draw = 0; let away = 0;
  let bttsYes = 0;
  const totalGoals = new Map();

  for (let h = 0; h < n; h++) {
    for (let a = 0; a < n; a++) {
      const p = matrix[h][a];
      if (p <= 0) continue;

      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;

      if (h > 0 && a > 0) bttsYes += p;

      const g = h + a;
      totalGoals.set(g, (totalGoals.get(g) ?? 0) + p);
    }
  }

  const overUnder = (line) => {
    let over = 0;
    for (const [goals, p] of totalGoals) {
      if (goals > line) over += p;
    }
    return { over, under: 1 - over };
  };

  const ou15 = overUnder(1.5);
  const ou25 = overUnder(2.5);
  const ou35 = overUnder(3.5);

  return {
    h2h: { home, draw, away },
    // Empate anula aposta: renormalizado sobre os casos em que ha vencedor.
    dnb: {
      home: home / (home + away || 1),
      away: away / (home + away || 1),
    },
    doubleChance: {
      homeOrDraw: home + draw,
      awayOrDraw: away + draw,
      homeOrAway: home + away,
    },
    btts: { yes: bttsYes, no: 1 - bttsYes },
    totals: {
      1.5: ou15,
      2.5: ou25,
      3.5: ou35,
    },
  };
}

/**
 * Traduz uma selecao de mercado (como vem da casa de apostas) para a
 * probabilidade correspondente do modelo. Devolve null quando o mercado
 * nao e suportado, para que o jogo seja ignorado em vez de adivinhado.
 */
export function modelProbFor(markets, { market, selection, line }) {
  switch (market) {
    case 'h2h':
      return markets.h2h[selection] ?? null;
    case 'totals': {
      const key = String(line);
      const entry = markets.totals[key];
      if (!entry) return null;
      return selection === 'over' ? entry.over : entry.under;
    }
    case 'btts':
      return markets.btts[selection] ?? null;
    case 'dnb':
      return markets.dnb[selection] ?? null;
    case 'double_chance':
      return markets.doubleChance[selection] ?? null;
    default:
      return null;
  }
}

export const MARKET_LABELS = {
  h2h: { home: 'Vitoria casa', draw: 'Empate', away: 'Vitoria fora' },
  totals: { over: 'Mais de', under: 'Menos de' },
  btts: { yes: 'Ambas marcam: Sim', no: 'Ambas marcam: Nao' },
  dnb: { home: 'Casa (empate anula)', away: 'Fora (empate anula)' },
  double_chance: {
    homeOrDraw: 'Casa ou empate',
    awayOrDraw: 'Fora ou empate',
    homeOrAway: 'Casa ou fora',
  },
};

export function describeSelection({ market, selection, line, home, away }) {
  if (market === 'h2h') {
    if (selection === 'home') return `${home} vence`;
    if (selection === 'away') return `${away} vence`;
    return 'Empate';
  }
  if (market === 'totals') {
    return `${selection === 'over' ? 'Mais' : 'Menos'} de ${line} golos`;
  }
  if (market === 'dnb') {
    return `${selection === 'home' ? home : away} (empate anula)`;
  }
  if (market === 'double_chance') {
    if (selection === 'homeOrDraw') return `${home} ou empate`;
    if (selection === 'awayOrDraw') return `${away} ou empate`;
    return 'Casa ou fora';
  }
  return MARKET_LABELS[market]?.[selection] ?? `${market} ${selection}`;
}
