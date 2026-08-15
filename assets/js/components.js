import { esc, fmtKickoff, fmtMoney, fmtOdds, fmtPct, fmtSigned } from './util.js';

/**
 * Cartao de aposta para as listas.
 *
 * O cartao responde a tres perguntas e para: que jogo, que aposta, quanto
 * vale. O *porque* — que e a razao de a app existir — vive na vista de
 * analise, a um toque de distancia. Tentar meter tudo no cartao foi o erro
 * da primeira versao: uma parede de percentagens sem contexto nao explica
 * nada a quem esta a decidir se aposta ou nao.
 */

export const MARKET_LABEL = {
  h2h: 'Resultado final',
  totals: 'Total de golos',
  btts: 'Ambas marcam',
  dnb: 'Empate anula',
  double_chance: 'Dupla hipotese',
};

const RESULT_LABEL = {
  win: 'Ganhou', loss: 'Perdeu', push: 'Anulada', void: 'Anulada',
};

export function pickCard(pick, { bankroll = 100, tracked = false } = {}) {
  const settled = Boolean(pick.settled && pick.result);
  const stakeMoney = (pick.stake ?? 0) * bankroll;
  const returnMoney = stakeMoney * pick.odds;

  return `
<article class="pick" data-pick-id="${esc(pick.id)}"${settled ? ` data-result="${esc(pick.result)}"` : ''}>
  <button type="button" class="pick__open" data-action="open-detail" data-pick-id="${esc(pick.id)}"
          aria-label="Ver analise completa de ${esc(pick.description)} em ${esc(pick.home)} contra ${esc(pick.away)}">
    <div class="pick__top">
      <span class="pick__league">${esc(pick.league)}</span>
      <span class="pick__time num">${esc(fmtKickoff(pick.kickoff))}</span>
    </div>

    <h3 class="pick__teams">
      ${esc(pick.home)}<span class="pick__vs" aria-label="contra">vs</span>${esc(pick.away)}
    </h3>

    <div class="pick__bet">
      <div class="pick__selection">
        ${esc(pick.description)}
        <span class="pick__market">${esc(MARKET_LABEL[pick.market] ?? pick.market)}</span>
      </div>
      <div class="odds">
        <span class="odds__value">${esc(fmtOdds(pick.odds))}</span>
        <span class="odds__book">${esc(pick.bookmaker ?? 'betclic')}</span>
      </div>
    </div>

    ${pick.winCondition ? `
      <p class="pick__plain">
        <strong>Ganhas se</strong> ${esc(lower(pick.winCondition.wins))}
      </p>` : ''}

    <div class="pick__metrics">
      <div class="metric">
        <span class="metric__label">Probabilidade</span>
        <span class="metric__value">${esc(fmtPct(pick.modelProb, 0))}</span>
      </div>
      <div class="metric">
        <span class="metric__label">Vantagem</span>
        <span class="metric__value metric__value--edge">${esc(fmtSigned(pick.edge))}</span>
      </div>
      <div class="metric">
        <span class="metric__label">Confianca</span>
        ${confidenceBar(pick.confidence)}
      </div>
    </div>
  </button>

  <div class="pick__foot">
    ${settled ? settledFoot(pick) : openFoot(pick, stakeMoney, returnMoney, tracked)}
  </div>
</article>`;
}

function confidenceBar(confidence = 0) {
  const filled = Math.max(1, Math.round(confidence * 5));
  const label = confidence >= 0.75 ? 'alta' : confidence >= 0.55 ? 'media' : 'baixa';
  const segments = Array.from(
    { length: 5 },
    (_, i) => `<span class="conf__seg${i < filled ? ' is-on' : ''}"></span>`,
  ).join('');
  return `<span class="conf" role="img" aria-label="Confianca ${label}, ${filled} de 5">${segments}</span>`;
}

function openFoot(pick, stakeMoney, returnMoney, tracked) {
  return `
    <span class="pick__stake">
      Apostar <strong class="num">${esc(fmtMoney(stakeMoney))}</strong>
      <span class="pick__arrow" aria-hidden="true">→</span>
      recebes <strong class="num">${esc(fmtMoney(returnMoney))}</strong>
    </span>
    <button type="button" class="btn btn--ghost btn--sm" data-action="track"
            data-pick-id="${esc(pick.id)}"${tracked ? ' disabled' : ''}>
      ${tracked ? 'Registada' : 'Registar'}
    </button>`;
}

function settledFoot(pick) {
  const pnl = pick.pnlUnits ?? 0;
  const tone = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  return `
    <span class="result-tag result-tag--${esc(pick.result)}">${esc(RESULT_LABEL[pick.result] ?? pick.result)}</span>
    ${pick.finalScore ? `<span class="score">${esc(pick.finalScore)}</span>` : ''}
    <span class="pnl pnl--${tone}">${pnl >= 0 ? '+' : ''}${(pnl * 100).toFixed(2)}%</span>`;
}

const lower = (s = '') => (s ? s[0].toLowerCase() + s.slice(1) : s);
