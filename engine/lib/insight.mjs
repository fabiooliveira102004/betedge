import { round } from './math.mjs';

/**
 * Tudo o que uma aposta precisa de mostrar para se justificar.
 *
 * O modelo produz uma probabilidade; isto produz o *porque*. A pesquisa
 * sobre servicos de apostas e clara num ponto: o que separa uma analise
 * util de um palpite nao sao mais numeros, e a cadeia de raciocinio
 * explicada — que dados entraram, o que produziram, e onde e que isso
 * discorda do preco da casa.
 *
 * Nada aqui e gerado por IA. Sao os mesmos numeros que o modelo usou,
 * traduzidos para portugues, o que significa que a explicacao nunca pode
 * contradizer a aposta.
 */

/* ── Forma recente ──────────────────────────────────────────────────── */

/**
 * Ultimos N jogos de uma equipa: resultado, adversario e golos.
 * Serve para o utilizador ver por si se a equipa esta bem ou mal, em vez
 * de aceitar a palavra do modelo.
 */
export function teamForm(team, history, { limit = 6, before = null } = {}) {
  const cutoff = before ? new Date(before) : null;

  const matches = history
    .filter((m) => (m.home === team || m.away === team)
      && Number.isFinite(m.homeGoals)
      && (!cutoff || new Date(m.kickoff) < cutoff))
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, limit);

  const games = matches.map((m) => {
    const atHome = m.home === team;
    const scored = atHome ? m.homeGoals : m.awayGoals;
    const conceded = atHome ? m.awayGoals : m.homeGoals;
    return {
      opponent: atHome ? m.away : m.home,
      atHome,
      scored,
      conceded,
      result: scored > conceded ? 'W' : scored === conceded ? 'D' : 'L',
      date: m.kickoff,
    };
  });

  const wins = games.filter((g) => g.result === 'W').length;
  const draws = games.filter((g) => g.result === 'D').length;
  const losses = games.filter((g) => g.result === 'L').length;

  return {
    games,
    played: games.length,
    wins,
    draws,
    losses,
    scoredAvg: games.length ? round(games.reduce((s, g) => s + g.scored, 0) / games.length, 2) : null,
    concededAvg: games.length ? round(games.reduce((s, g) => s + g.conceded, 0) / games.length, 2) : null,
    // Sequencia de resultados, do mais antigo para o mais recente, para
    // que se leia da esquerda para a direita como uma linha do tempo.
    streak: games.map((g) => g.result).reverse().join(''),
  };
}

/** Medias em casa e fora separadas: um "2,1 golos por jogo" global esconde
 *  equipas que marcam tudo em casa e nada fora. */
export function venueSplit(team, history, { before = null } = {}) {
  const cutoff = before ? new Date(before) : null;
  const relevant = history.filter((m) => Number.isFinite(m.homeGoals)
    && (!cutoff || new Date(m.kickoff) < cutoff));

  const side = (atHome) => {
    const games = relevant.filter((m) => (atHome ? m.home : m.away) === team);
    if (games.length === 0) return null;
    const scored = games.reduce((s, m) => s + (atHome ? m.homeGoals : m.awayGoals), 0);
    const conceded = games.reduce((s, m) => s + (atHome ? m.awayGoals : m.homeGoals), 0);
    return {
      played: games.length,
      scoredAvg: round(scored / games.length, 2),
      concededAvg: round(conceded / games.length, 2),
    };
  };

  return { home: side(true), away: side(false) };
}

/* ── Confrontos diretos ─────────────────────────────────────────────── */

export function headToHead(home, away, history, { limit = 5, before = null } = {}) {
  const cutoff = before ? new Date(before) : null;

  const meetings = history
    .filter((m) => Number.isFinite(m.homeGoals)
      && ((m.home === home && m.away === away) || (m.home === away && m.away === home))
      && (!cutoff || new Date(m.kickoff) < cutoff))
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, limit);

  if (meetings.length === 0) return null;

  const games = meetings.map((m) => ({
    date: m.kickoff,
    home: m.home,
    away: m.away,
    score: `${m.homeGoals}-${m.awayGoals}`,
    totalGoals: m.homeGoals + m.awayGoals,
    bothScored: m.homeGoals > 0 && m.awayGoals > 0,
  }));

  return {
    games,
    played: games.length,
    avgGoals: round(games.reduce((s, g) => s + g.totalGoals, 0) / games.length, 2),
    bothScoredCount: games.filter((g) => g.bothScored).length,
  };
}

/* ── Leitura da matriz de resultados ────────────────────────────────── */

/** Os resultados exatos mais provaveis. Um "73% de mais de 2.5" fica muito
 *  mais concreto ao lado de "2-1 (9%), 2-2 (7%), 3-1 (6%)". */
export function likelyScorelines(matrix, limit = 5) {
  const all = [];
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix.length; a++) {
      if (matrix[h][a] > 0.005) all.push({ score: `${h}-${a}`, home: h, away: a, p: matrix[h][a] });
    }
  }
  return all
    .sort((x, y) => y.p - x.p)
    .slice(0, limit)
    .map((s) => ({ ...s, p: round(s.p, 4) }));
}

/** Distribuicao do total de golos, para desenhar como histograma. */
export function goalsDistribution(matrix, maxTotal = 6) {
  const buckets = new Array(maxTotal + 1).fill(0);
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix.length; a++) {
      const total = h + a;
      buckets[Math.min(total, maxTotal)] += matrix[h][a];
    }
  }
  return buckets.map((p, goals) => ({
    goals,
    // O ultimo balde acumula "ou mais", senao a cauda desaparece.
    label: goals === maxTotal ? `${goals}+` : String(goals),
    p: round(p, 4),
  }));
}

/* ── O que tem de acontecer ─────────────────────────────────────────── */

/**
 * A condicao de vitoria em portugues corrente. Sem isto o utilizador tem
 * de saber de cor o que significa "empate anula" ou "mais de 2.5".
 */
export function winCondition({ market, selection, line }, home, away) {
  switch (market) {
    case 'h2h':
      if (selection === 'home') {
        return {
          wins: `${home} vence o jogo no tempo regulamentar.`,
          loses: `${away} vence ou o jogo acaba empatado.`,
        };
      }
      if (selection === 'away') {
        return {
          wins: `${away} vence o jogo no tempo regulamentar.`,
          loses: `${home} vence ou o jogo acaba empatado.`,
        };
      }
      return {
        wins: 'O jogo acaba empatado no tempo regulamentar.',
        loses: 'Qualquer uma das equipas vence.',
      };

    case 'totals': {
      const min = Math.ceil(line);
      if (selection === 'over') {
        return {
          wins: `O jogo tem ${min} ou mais golos no total, marque quem marcar.`,
          loses: `O jogo tem ${min - 1} ou menos golos.`,
        };
      }
      return {
        wins: `O jogo tem ${min - 1} ou menos golos no total.`,
        loses: `O jogo tem ${min} ou mais golos.`,
      };
    }

    case 'btts':
      return selection === 'yes'
        ? {
          wins: 'As duas equipas marcam pelo menos um golo.',
          loses: 'Pelo menos uma das equipas nao marca.',
        }
        : {
          wins: 'Pelo menos uma das equipas termina sem marcar.',
          loses: 'As duas equipas marcam.',
        };

    case 'dnb': {
      const pick = selection === 'home' ? home : away;
      const other = selection === 'home' ? away : home;
      return {
        wins: `${pick} vence.`,
        loses: `${other} vence. Se o jogo empatar, recebes a stake de volta.`,
      };
    }

    case 'double_chance': {
      const map = {
        homeOrDraw: { wins: `${home} vence ou o jogo empata.`, loses: `${away} vence.` },
        awayOrDraw: { wins: `${away} vence ou o jogo empata.`, loses: `${home} vence.` },
        homeOrAway: { wins: 'Uma das equipas vence.', loses: 'O jogo acaba empatado.' },
      };
      return map[selection] ?? { wins: '—', loses: '—' };
    }

    default:
      return { wins: '—', loses: '—' };
  }
}

/* ── A narrativa ────────────────────────────────────────────────────── */

/**
 * A explicacao em texto corrido: dos dados de entrada ate a vantagem.
 *
 * Cada frase corresponde a um passo real do modelo, pela mesma ordem em
 * que aconteceu. Se o modelo mudar, isto muda com ele.
 */
export function buildNarrative({
  home, away, market, selection, line,
  lambdas, modelProb, fairProb, impliedProb, odds,
  formHome, formAway, splitHome, splitAway, h2h,
  contextFactors, aiSummary,
}) {
  const paragraphs = [];
  const totalGoals = lambdas.home + lambdas.away;

  // 1. De onde vieram os golos esperados.
  const evidence = [];
  if (splitHome?.home?.played >= 3) {
    evidence.push(
      `Em casa, o ${home} marca ${fmt(splitHome.home.scoredAvg)} e sofre `
      + `${fmt(splitHome.home.concededAvg)} golos por jogo (${splitHome.home.played} jogos)`,
    );
  } else if (formHome?.scoredAvg != null) {
    evidence.push(`O ${home} marca ${fmt(formHome.scoredAvg)} golos por jogo na forma recente`);
  }

  if (splitAway?.away?.played >= 3) {
    evidence.push(
      `fora, o ${away} marca ${fmt(splitAway.away.scoredAvg)} e sofre `
      + `${fmt(splitAway.away.concededAvg)} (${splitAway.away.played} jogos)`,
    );
  } else if (formAway?.scoredAvg != null) {
    evidence.push(`o ${away} marca ${fmt(formAway.scoredAvg)}`);
  }

  if (evidence.length) {
    paragraphs.push(`${evidence.join('; ')}.`);
  }

  // 2. O que o modelo faz com isso.
  paragraphs.push(
    `Cruzando o ataque de cada equipa com a defesa da outra, ajustando a forca `
    + `relativa e a vantagem de jogar em casa, o modelo espera `
    + `${fmt(lambdas.home)} golos do ${home} e ${fmt(lambdas.away)} do ${away} — `
    + `${fmt(totalGoals)} no total.`,
  );

  // 3. Contexto, quando ha.
  const notes = (contextFactors ?? []).filter((f) => f.detail).map((f) => f.detail);
  if (notes.length) {
    paragraphs.push(`Isto ja conta com ${notes.join('; ')}.`);
  }
  if (aiSummary) {
    const extra = [aiSummary.home, aiSummary.away]
      .filter((s) => s && !/sem sinais relevantes/i.test(s));
    if (extra.length) paragraphs.push(extra.join(' '));
  }

  // 4. Historico direto, quando existe e diz alguma coisa.
  if (h2h?.played >= 3) {
    if (market === 'totals') {
      paragraphs.push(
        `Nos ultimos ${h2h.played} confrontos entre as duas equipas houve `
        + `${fmt(h2h.avgGoals)} golos por jogo em media.`,
      );
    } else if (market === 'btts') {
      paragraphs.push(
        `Nos ultimos ${h2h.played} confrontos, as duas equipas marcaram em `
        + `${h2h.bothScoredCount}.`,
      );
    }
  }

  // 5. A vantagem: o passo que justifica a aposta existir.
  const edgePoints = Math.round((modelProb - fairProb) * 1000) / 10;
  paragraphs.push(
    `Daqui sai ${pct(modelProb)} de probabilidade para esta aposta. `
    + `A Betclic paga ${odds.toFixed(2)}, que implica ${pct(impliedProb)}; `
    + `retirada a margem da casa, o preco justo do mercado e ${pct(fairProb)}. `
    + `A diferenca de ${edgePoints} pontos percentuais e a vantagem — `
    + `e a razao pela qual esta aposta aparece e as outras nao.`,
  );

  return paragraphs;
}

/**
 * O aviso honesto. A pesquisa sobre este tipo de servico e unanime: quem
 * so mostra o lado bom nao e de confianca. Cada aposta diz o que pode
 * correr mal e com que frequencia.
 */
export function buildCaveats({ modelProb, confidence, sampleMatches, hasHistory, odds }) {
  const out = [];

  const lossPct = Math.round((1 - modelProb) * 100);
  out.push(
    `Mesmo estando o modelo certo, esta aposta perde ${lossPct} vezes em cada 100. `
    + `A vantagem so se nota ao fim de muitas apostas.`,
  );

  if (!hasHistory) {
    out.push('Sem historico de jogos disponivel para estas equipas: o modelo assenta quase so nas odds.');
  } else if (sampleMatches < 8) {
    out.push(
      `Amostra curta: ${sampleMatches} jogos para a equipa com menos dados. `
      + 'Estimativas com poucos jogos sao instaveis.',
    );
  }

  if (confidence < 0.5) {
    out.push('Confianca baixa — faltam dados ou o mercado tem margem alta. Considera reduzir a stake.');
  }

  if (odds >= 4) {
    out.push(`A odd de ${odds.toFixed(2)} significa que este resultado e pouco frequente: espera longas series sem acertar.`);
  }

  return out;
}

const fmt = (n) => (n == null ? '—' : Number(n).toFixed(2).replace('.', ','));
const pct = (p) => `${Math.round(p * 100)}%`;
