import { config } from '../config.mjs';
import { describeSelection, modelProbFor } from './markets.mjs';
import { devig, expectedValue } from './value.mjs';
import { round } from './math.mjs';

/**
 * O jogo, com tudo o que se sabe sobre ele.
 *
 * A primeira versao da app publicava so as apostas em que havia vantagem.
 * Isso responde a pergunta errada: quem abre a app quer perceber os jogos
 * que vem ai e ver a opiniao do modelo sobre cada opcao — incluindo as que
 * nao vale a pena apostar, porque saber que uma odd esta *cara* e tao util
 * como saber que esta barata.
 *
 * Por isso cada jogo traz o quadro completo de mercados, como uma casa de
 * apostas mostra, mas com a probabilidade do modelo ao lado de cada preco.
 */

const MARKET_ORDER = [
  { key: 'h2h', label: 'Resultado final', hint: 'Quem ganha o jogo no tempo regulamentar.' },
  { key: 'totals', label: 'Total de golos', hint: 'Golos das duas equipas somados.' },
  { key: 'btts', label: 'Ambas marcam', hint: 'As duas equipas marcam pelo menos um golo.' },
];

export function buildMatch(fixture) {
  const markets = buildMarkets(fixture);
  const valueCount = markets.reduce(
    (n, m) => n + m.selections.filter((s) => s.isValue).length,
    0,
  );

  return {
    id: fixture.id,
    league: fixture.league,
    home: fixture.home,
    away: fixture.away,
    kickoff: fixture.kickoff,
    demo: Boolean(fixture.demo),

    verdict: buildVerdict(fixture),
    lambdas: {
      home: round(fixture.lambdas.home, 2),
      away: round(fixture.lambdas.away, 2),
    },

    markets,
    valueCount,

    analysis: {
      scorelines: fixture.scorelines ?? [],
      goalsDistribution: fixture.goalsDistribution ?? [],
      teams: fixture.teamProfiles ?? null,
      h2h: fixture.h2h ?? null,
      news: fixture.news ?? null,
      context: {
        home: fixture.context?.home?.factors ?? [],
        away: fixture.context?.away?.factors ?? [],
      },
      ai: fixture.aiAssessment
        ? {
          home: fixture.aiAssessment.home.summary,
          away: fixture.aiAssessment.away.summary,
          signals: fixture.aiAssessment.keySignals,
        }
        : null,
      dataQuality: round(fixture.quality ?? 0, 2),
      sampleMatches: fixture.sampleMatches ?? 0,
    },
  };
}

/**
 * A opiniao do modelo sobre o jogo, antes de olhar para qualquer mercado.
 * E a primeira coisa que a app mostra: o que o algoritmo acha que vai
 * acontecer e com que certeza.
 */
function buildVerdict(fixture) {
  const { home, draw, away } = fixture.markets.h2h;
  const options = [
    { outcome: 'home', label: `${fixture.home} vence`, p: home },
    { outcome: 'draw', label: 'Empate', p: draw },
    { outcome: 'away', label: `${fixture.away} vence`, p: away },
  ].sort((a, b) => b.p - a.p);

  const top = options[0];
  const gap = top.p - options[1].p;

  // Um favorito a 38% contra 35% nao e um favorito — e um jogo em aberto.
  // A app tem de dizer isso em vez de fingir uma previsao.
  const strength = top.p >= 0.55 && gap >= 0.2 ? 'claro'
    : gap >= 0.1 ? 'ligeiro'
      : 'aberto';

  const likely = fixture.scorelines?.[0];

  return {
    outcome: top.outcome,
    label: top.label,
    probability: round(top.p, 4),
    runnerUp: { label: options[1].label, probability: round(options[1].p, 4) },
    strength,
    likelyScore: likely?.score ?? null,
    likelyScoreProb: likely ? round(likely.p, 4) : null,
    confidence: round(fixture.quality ?? 0, 3),
    summary: verdictSummary(fixture, top, strength),
  };
}

function verdictSummary(fixture, top, strength) {
  const total = fixture.lambdas.home + fixture.lambdas.away;
  const goalsNote = total >= 3.1 ? 'Espera-se um jogo com golos'
    : total <= 2.2 ? 'Espera-se um jogo fechado'
      : 'Espera-se um jogo equilibrado em golos';

  if (strength === 'aberto') {
    return `Jogo em aberto: nenhum resultado se destaca. ${goalsNote} `
      + `(${total.toFixed(1)} no total).`;
  }

  const pct = Math.round(top.p * 100);
  return `${top.label} e o resultado mais provavel, com ${pct}%. `
    + `${goalsNote} (${total.toFixed(1)} no total).`;
}

/**
 * Quadro de mercados completo. Cada selecao traz o preco da Betclic, a
 * probabilidade que esse preco implica, o preco justo sem a margem, e o
 * que o modelo calcula — para que a comparacao seja visivel linha a linha.
 */
function buildMarkets(fixture) {
  const groups = new Map();
  for (const offer of fixture.offers) {
    if (!groups.has(offer.groupKey)) {
      groups.set(offer.groupKey, { market: offer.market, line: offer.line, group: offer.group });
    }
  }

  const out = [];

  for (const meta of MARKET_ORDER) {
    for (const [groupKey, { market, line, group }] of groups) {
      if (market !== meta.key) continue;

      const { probs, overround } = devig(group.map((g) => g.odds));

      const selections = group.map((g, i) => {
        const modelProb = modelProbFor(fixture.markets, { market, selection: g.selection, line });
        const fairProb = probs[i];
        const edge = modelProb == null ? null : modelProb - fairProb;
        const ev = modelProb == null ? null : expectedValue(modelProb, g.odds);

        return {
          selection: g.selection,
          label: describeSelection({
            market, selection: g.selection, line, home: fixture.home, away: fixture.away,
          }),
          odds: g.odds,
          impliedProb: round(1 / g.odds, 4),
          fairProb: round(fairProb, 4),
          modelProb: modelProb == null ? null : round(modelProb, 4),
          edge: edge == null ? null : round(edge, 4),
          ev: ev == null ? null : round(ev, 4),
          // No quadro, "valor" significa apenas que o modelo considera a
          // odd generosa para o risco. A janela estreita de odds que o
          // motor usava para *publicar apostas* nao se aplica aqui: marcar
          // +4% e deixar +15% sem etiqueta, so porque a odd passa de 6.00,
          // lia-se como um erro. Fora deste intervalo as odds sao tao
          // extremas que a estimativa deixa de ter significado.
          isValue: edge != null && edge >= config.betting.minEdge
            && g.odds >= 1.30 && g.odds <= 12,
        };
      });

      out.push({
        key: groupKey,
        market,
        line: line ?? null,
        label: line != null ? `${meta.label} ${line}` : meta.label,
        hint: meta.hint,
        overround: round(overround, 4),
        selections,
      });
    }
  }

  // Linhas de golos por ordem crescente, para o quadro nao saltar.
  return out.sort((a, b) => {
    const order = MARKET_ORDER.findIndex((m) => m.key === a.market)
      - MARKET_ORDER.findIndex((m) => m.key === b.market);
    if (order !== 0) return order;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}
