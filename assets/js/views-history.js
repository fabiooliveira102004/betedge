import { $, esc, fmtDayHeading, groupBy, render } from './util.js';
import { emptyState } from './ui.js';
import { pickCard } from './components.js';
import { APP } from './config.js';
import { bankroll, state, visibleHistory } from './state.js';

/**
 * Historico de apostas liquidadas, agrupado por dia.
 *
 * Mostra tudo — ganhas e perdidas — porque um registo que so mostra
 * acertos nao e um registo. As apostas sao gravadas antes do jogo pelo
 * motor, por isso nada aqui pode ser reescrito depois de saber o resultado.
 */
export function renderHistory() {
  const host = $('#history-list');
  const meta = $('#history-meta');
  const more = $('#history-more');

  const list = visibleHistory();
  const settled = state.history.filter((p) => p.settled);

  meta.textContent = settled.length === 0
    ? 'Ainda sem apostas liquidadas'
    : `${settled.length} apostas liquidadas`
      + (state.history.length > settled.length
        ? ` · ${state.history.length - settled.length} a aguardar resultado`
        : '');

  if (list.length === 0) {
    more.hidden = true;
    render(host, emptyState({
      icon: 'clock',
      title: state.history.length === 0 ? 'Historico vazio' : 'Nada neste filtro',
      text: state.history.length === 0
        ? 'Assim que as primeiras apostas forem jogadas, o resultado de cada uma aparece aqui.'
        : 'Experimenta outro filtro para ver as restantes apostas.',
    }));
    return;
  }

  const shown = Math.max(state.historyShown || APP.historyPageSize, APP.historyPageSize);
  const page = list.slice(0, shown);
  const money = bankroll();

  const byDay = groupBy(page, (p) => p.kickoff.slice(0, 10));

  const html = [...byDay.entries()].map(([day, picks]) => {
    const dayPnl = picks.reduce((sum, p) => sum + (p.pnlUnits ?? 0), 0);
    const tone = dayPnl > 0 ? 'pos' : dayPnl < 0 ? 'neg' : 'flat';

    return `
      <p class="day-label">
        ${esc(fmtDayHeading(day))}
        <span class="pnl pnl--${tone}" style="float:inline-end">
          ${dayPnl >= 0 ? '+' : ''}${(dayPnl * 100).toFixed(2)}%
        </span>
      </p>
      ${picks.map((pick) => pickCard(pick, { bankroll: money })).join('')}`;
  }).join('');

  render(host, html);
  more.hidden = page.length >= list.length;
}
