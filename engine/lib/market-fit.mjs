import { deriveMarkets } from './markets.mjs';
import { scoreMatrix } from './model.mjs';
import { devig } from './value.mjs';
import { clamp } from './math.mjs';

/**
 * Golos esperados deduzidos do proprio mercado.
 *
 * Sem historico de jogos — que e o que acontece quando ha chave de cotacoes
 * mas nao de resultados — o modelo nao sabe nada sobre nenhuma equipa e
 * atribui a mesma forca a todas. O resultado sao previsoes identicas para
 * jogos completamente diferentes: Arsenal-Coventry e Benfica-Nacional sairiam
 * ambos 42/29/29. Pior do que inutil, porque parece analise.
 *
 * A alternativa honesta e ler o mercado ao contrario: dadas as
 * probabilidades que as odds implicam (ja sem margem), procuram-se os golos
 * esperados que, passados pelo modelo Dixon-Coles, as reproduzem. A partir
 * dai a app tem numeros coerentes por jogo e todos os mercados derivam de
 * uma matriz so — mas as probabilidades sao, por construcao, as do mercado.
 *
 * Isso e dito na app. Nao ha vantagem nenhuma a anunciar quando o modelo
 * esta apenas a repetir o preco.
 */

export function fitFromMarket(offers) {
  const target = marketTargets(offers);
  if (!target) return null;

  // Total e supremacia sao a parametrizacao natural: a supremacia controla
  // a diferenca entre casa e fora, o total controla os golos e o empate.
  let best = { total: 2.7, supremacy: 0.2, error: Infinity };

  best = search(target, best, { totalFrom: 1.6, totalTo: 4.6, supFrom: -2.4, supTo: 2.4, step: 0.2 });
  best = search(target, best, {
    totalFrom: best.total - 0.25,
    totalTo: best.total + 0.25,
    supFrom: best.supremacy - 0.25,
    supTo: best.supremacy + 0.25,
    step: 0.025,
  });

  return {
    home: clamp((best.total + best.supremacy) / 2, 0.18, 5),
    away: clamp((best.total - best.supremacy) / 2, 0.15, 5),
    error: best.error,
  };
}

function search(target, best, { totalFrom, totalTo, supFrom, supTo, step }) {
  let out = best;

  for (let total = Math.max(0.8, totalFrom); total <= totalTo; total += step) {
    for (let sup = supFrom; sup <= supTo; sup += step) {
      const home = (total + sup) / 2;
      const away = (total - sup) / 2;
      if (home < 0.15 || away < 0.12) continue;

      const error = fitError(target, home, away);
      if (error < out.error) out = { total, supremacy: sup, error };
    }
  }

  return out;
}

function fitError(target, home, away) {
  const markets = deriveMarkets(scoreMatrix(home, away));

  let error = 0;
  error += (markets.h2h.home - target.home) ** 2;
  error += (markets.h2h.draw - target.draw) ** 2;
  error += (markets.h2h.away - target.away) ** 2;

  // A linha de golos, quando existe, fixa o total muito melhor do que o
  // 1X2 sozinho — sem ela varios totais explicam o mesmo 1X2.
  if (target.over != null) {
    const line = markets.totals[String(target.line)];
    if (line) error += 2 * (line.over - target.over) ** 2;
  }

  return error;
}

/** Probabilidades do mercado, ja sem a margem da casa. */
function marketTargets(offers) {
  const groups = new Map();
  for (const offer of offers) {
    if (!groups.has(offer.groupKey)) groups.set(offer.groupKey, offer);
  }

  const h2hOffer = [...groups.values()].find((o) => o.market === 'h2h');
  if (!h2hOffer) return null;

  const legs = h2hOffer.group;
  const { probs } = devig(legs.map((l) => l.consensusOdds ?? l.odds));
  const byName = Object.fromEntries(legs.map((l, i) => [l.selection, probs[i]]));
  if (byName.home == null || byName.away == null) return null;

  const target = {
    home: byName.home,
    draw: byName.draw ?? 0,
    away: byName.away,
    over: null,
    line: null,
  };

  // Prefere a linha 2.5, que e a mais cotada e a mais informativa.
  const totals = [...groups.values()].filter((o) => o.market === 'totals');
  const preferred = totals.find((o) => o.line === 2.5) ?? totals[0];
  if (preferred) {
    const { probs: tp } = devig(preferred.group.map((l) => l.consensusOdds ?? l.odds));
    const overIndex = preferred.group.findIndex((l) => l.selection === 'over');
    if (overIndex >= 0) {
      target.over = tp[overIndex];
      target.line = preferred.line;
    }
  }

  return target;
}
