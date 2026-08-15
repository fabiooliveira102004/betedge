import { esc, fmtKickoff, fmtMoney, fmtOdds, fmtPct, fmtSigned } from './util.js';

/**
 * O cartao de aposta — o componente central da app.
 *
 * A mesma marcacao serve as apostas por jogar e as ja liquidadas: muda o
 * rodape (botao de registar vs resultado) e a cor da barra lateral. Manter
 * um so componente garante que o historico mostra exatamente a mesma
 * informacao que estava visivel antes do jogo.
 */

const MARKET_LABEL = {
  h2h: 'Resultado final',
  totals: 'Total de golos',
  btts: 'Ambas marcam',
  dnb: 'Empate anula',
  double_chance: 'Dupla hipotese',
};

const RESULT_LABEL = {
  win: 'Ganhou',
  loss: 'Perdeu',
  push: 'Anulada',
  void: 'Anulada',
};

export function pickCard(pick, { bankroll = 100, tracked = false } = {}) {
  const settled = Boolean(pick.settled && pick.result);
  const stakeMoney = (pick.stake ?? 0) * bankroll;

  return `
<article class="pick" data-pick-id="${esc(pick.id)}"${settled ? ` data-result="${esc(pick.result)}"` : ''}>
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

  <div class="pick__metrics">
    <div class="metric">
      <span class="metric__label">Vantagem</span>
      <span class="metric__value metric__value--edge">${esc(fmtSigned(pick.edge))}</span>
    </div>
    <div class="metric">
      <span class="metric__label">Prob. modelo</span>
      <span class="metric__value">${esc(fmtPct(pick.modelProb, 0))}</span>
    </div>
    <div class="metric">
      <span class="metric__label">Confianca</span>
      ${confidenceBar(pick.confidence)}
    </div>
  </div>

  ${whySection(pick)}

  <div class="pick__foot">
    ${settled ? settledFoot(pick) : openFoot(pick, stakeMoney, tracked)}
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

function openFoot(pick, stakeMoney, tracked) {
  return `
    <span class="result-tag result-tag--open">Por jogar</span>
    <span class="score">Sugestao ${esc(fmtMoney(stakeMoney))}</span>
    <button type="button" class="btn btn--ghost btn--sm" style="margin-inline-start:auto"
            data-action="track" data-pick-id="${esc(pick.id)}"${tracked ? ' disabled' : ''}>
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

/**
 * O painel "porque esta aposta". E o que separa uma app de analise de uma
 * lista de palpites: mostra os golos esperados, os factores de contexto que
 * os moveram e o que a leitura de noticias encontrou.
 */
function whySection(pick) {
  const rows = [];

  if (pick.lambdas) {
    rows.push(`
      <div class="why__row">
        ${icon('target')}
        <span style="flex:1">
          Golos esperados
          <span class="xg">
            <span class="xg__row"><span>${esc(pick.home)}</span><b>${pick.lambdas.home.toFixed(2)}</b></span>
            <span class="xg__row"><span>${esc(pick.away)}</span><b>${pick.lambdas.away.toFixed(2)}</b></span>
          </span>
        </span>
      </div>`);
  }

  rows.push(`
    <div class="why__row">
      ${icon('scale')}
      <span>
        A Betclic implica <strong>${esc(fmtPct(pick.impliedProb, 0))}</strong>;
        sem a margem da casa, o preco justo e <strong>${esc(fmtPct(pick.fairProb, 0))}</strong>.
        O modelo diz <strong>${esc(fmtPct(pick.modelProb, 0))}</strong>.
      </span>
    </div>`);

  for (const [side, label] of [['home', pick.home], ['away', pick.away]]) {
    for (const factor of pick.factors?.[side] ?? []) {
      if (!factor.detail) continue;
      rows.push(`
        <div class="why__row">
          ${icon(factor.type === 'lesoes' ? 'cross' : factor.type === 'descanso' ? 'clock' : 'news')}
          <span><strong>${esc(label)}</strong> — ${esc(factor.detail)}</span>
        </div>`);
    }
  }

  if (pick.aiSummary) {
    const notes = [pick.aiSummary.home, pick.aiSummary.away]
      .filter((s) => s && !/sem sinais relevantes/i.test(s));
    for (const note of notes) {
      rows.push(`<p class="why__note">${esc(note)}</p>`);
    }
    for (const signal of pick.aiSummary.signals ?? []) {
      rows.push(`<div class="why__row">${icon('news')}<span>${esc(signal)}</span></div>`);
    }
  }

  if (rows.length === 0) return '';

  const panelId = `why-${cssId(pick.id)}`;
  return `
  <div class="why">
    <button type="button" class="why__toggle" aria-expanded="false" aria-controls="${panelId}">
      Porque esta aposta
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="why__panel" id="${panelId}" hidden>${rows.join('')}</div>
  </div>`;
}

function icon(name) {
  const paths = {
    target: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    scale: '<path d="M12 4v16M5 8h14M7 8l-3 6h6zM17 8l-3 6h6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    cross: '<path d="M12 3v18M3 12h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    news: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 9h7M7 13h10M7 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  return `<svg class="why__icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.news}</svg>`;
}

/** Os ids das apostas trazem ":" e ".", que nao servem como id de HTML. */
const cssId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
