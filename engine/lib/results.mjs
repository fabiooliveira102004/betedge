import { round } from './math.mjs';

/**
 * Jogos ja disputados, com o resultado real ao lado do que o modelo tinha
 * previsto.
 *
 * E o unico sitio onde se pode julgar o algoritmo com honestidade: a
 * previsao foi publicada antes do apito e o resultado e colado por cima
 * depois, sem hipotese de a reescrever. Ver os jogos em que falhou vale
 * tanto como ver aqueles em que acertou.
 */

const MAX_RESULTS = 250;

/** Versao compacta de um jogo terminado. O quadro completo de mercados nao
 *  vem para o arquivo: seriam megabytes ao fim de algumas semanas. */
export function toResult(match, score) {
  const outcome = score.homeGoals > score.awayGoals ? 'home'
    : score.homeGoals === score.awayGoals ? 'draw' : 'away';

  const h2hMarket = match.markets?.find((m) => m.market === 'h2h');
  const totals = match.markets?.find((m) => m.market === 'totals' && m.line === 2.5);

  return {
    id: match.id,
    league: match.league,
    home: match.home,
    away: match.away,
    kickoff: match.kickoff,
    demo: Boolean(match.demo),

    score: { home: score.homeGoals, away: score.awayGoals },
    outcome,
    totalGoals: score.homeGoals + score.awayGoals,
    bothScored: score.homeGoals > 0 && score.awayGoals > 0,

    verdict: match.verdict,
    // O veredicto acertou? Guardado explicitamente para nao ser preciso
    // reinterpretar a previsao mais tarde.
    verdictHit: match.verdict?.outcome === outcome,
    lambdas: match.lambdas,

    // Preco de cada resultado antes do jogo, para se poder ver quanto pagava
    // aquilo que aconteceu.
    odds: h2hMarket
      ? Object.fromEntries(h2hMarket.selections.map((s) => [s.selection, s.odds]))
      : null,
    modelProbs: h2hMarket
      ? Object.fromEntries(h2hMarket.selections.map((s) => [s.selection, s.modelProb]))
      : null,
    over25: totals
      ? {
        odds: totals.selections.find((s) => s.selection === 'over')?.odds ?? null,
        modelProb: totals.selections.find((s) => s.selection === 'over')?.modelProb ?? null,
        hit: score.homeGoals + score.awayGoals > 2.5,
      }
      : null,

    valueSelections: (match.markets ?? [])
      .flatMap((m) => m.selections.filter((s) => s.isValue).map((s) => ({
        label: s.label, odds: s.odds, modelProb: s.modelProb, edge: s.edge, market: m.market, selection: s.selection, line: m.line,
      }))),

    settledAt: new Date().toISOString(),
  };
}

export function mergeResults(existing, incoming) {
  const map = new Map(existing.map((r) => [r.id, r]));
  for (const r of incoming) map.set(r.id, r);

  return [...map.values()]
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, MAX_RESULTS);
}

/** Quantas vezes o resultado mais provavel do modelo se confirmou. */
export function verdictAccuracy(results) {
  const judged = results.filter((r) => r.verdict?.outcome);
  if (judged.length === 0) return null;

  const byStrength = {};
  for (const band of ['claro', 'ligeiro', 'aberto']) {
    const inBand = judged.filter((r) => r.verdict.strength === band);
    if (inBand.length === 0) continue;
    byStrength[band] = {
      n: inBand.length,
      hits: inBand.filter((r) => r.verdictHit).length,
      rate: round(inBand.filter((r) => r.verdictHit).length / inBand.length, 4),
    };
  }

  return {
    n: judged.length,
    hits: judged.filter((r) => r.verdictHit).length,
    rate: round(judged.filter((r) => r.verdictHit).length / judged.length, 4),
    // Baseline: acertar sempre "casa vence" e o que um palpite sem modelo
    // daria. Se o modelo nao bater isto, nao esta a acrescentar nada.
    homeBaseline: round(judged.filter((r) => r.outcome === 'home').length / judged.length, 4),
    byStrength,
  };
}
