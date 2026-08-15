import { $, esc, fmtAgo, fmtMoney, render } from './util.js';
import { emptyState, skeletons } from './ui.js';
import { pickCard } from './components.js';
import { bankroll, state, trackedPickIds, visiblePicks } from './state.js';

/** Vista principal: as apostas com valor ainda por jogar. */
export function renderPicks() {
  renderLeagueFilters();
  renderBankrollStrip();

  const host = $('#picks-list');
  const meta = $('#picks-meta');

  if (state.loading) {
    host.setAttribute('aria-busy', 'true');
    render(host, skeletons(3));
    meta.textContent = 'A carregar analises…';
    return;
  }

  host.setAttribute('aria-busy', 'false');

  if (state.error) {
    render(host, emptyState({
      icon: 'inbox',
      title: 'Nao foi possivel carregar',
      text: state.error,
      action: { id: 'reload', label: 'Tentar de novo' },
    }));
    meta.textContent = 'Erro';
    return;
  }

  const list = visiblePicks();
  const total = state.picks.length;

  meta.textContent = total === 0
    ? 'Sem apostas publicadas'
    : `${list.length} de ${total} ${total === 1 ? 'aposta' : 'apostas'}`
      + (state.meta?.generatedAt ? ` · atualizado ${fmtAgo(state.meta.generatedAt)}` : '');

  if (list.length === 0) {
    render(host, total === 0
      ? emptyState({
        icon: 'clock',
        title: 'Nada com valor neste momento',
        text: 'O motor so publica apostas quando encontra vantagem real sobre o preco da Betclic. '
            + 'Voltamos a analisar de seis em seis horas.',
      })
      : emptyState({
        icon: 'inbox',
        title: 'Nenhuma aposta passa os teus filtros',
        text: 'Ha apostas publicadas, mas nenhuma cumpre os limites que definiste na tua conta.',
        action: { id: 'open-filters', label: 'Rever filtros' },
      }));
    return;
  }

  const tracked = trackedPickIds();
  const money = bankroll();

  render(host, demoNotice() + list
    .map((pick) => pickCard(pick, { bankroll: money, tracked: tracked.has(pick.id) }))
    .join(''));
}

/**
 * Sem chave de cotacoes o motor inventa jogos para a app ter o que mostrar.
 * Esses jogos usam nomes de clubes reais, o que os torna faceis de confundir
 * com o calendario verdadeiro — por isso o aviso e explicito sobre o que
 * esta errado (as datas e os emparelhamentos) e sobre como corrigir.
 */
function demoNotice() {
  if (!state.meta?.demo) return '';
  return `
  <aside class="notice">
    <h2 class="notice__title">Estes jogos nao sao reais</h2>
    <p class="notice__text">
      Os emparelhamentos, as datas e as odds foram gerados para veres a app a funcionar.
      Nenhum destes jogos esta no calendario, e nenhuma destas odds esta na Betclic.
      A analise e que e a verdadeira: o modelo, os calculos e as explicacoes sao os mesmos
      que vais ver com dados a serio.
    </p>
    <p class="notice__text">
      Para passar a jogos reais, cria uma chave gratuita em
      <strong>the-odds-api.com</strong> e adiciona-a ao repositorio como
      <code>ODDS_API_KEY</code>. Na execucao seguinte este aviso desaparece sozinho.
    </p>
  </aside>`;
}

function renderLeagueFilters() {
  const host = $('#league-filters');
  if (!host) return;

  const leagues = [...new Set(state.picks.map((p) => p.league))].sort();

  // Sem apostas de varias ligas o filtro nao faz nada — escondemo-lo em vez
  // de mostrar um controlo inutil.
  if (leagues.length < 2) {
    host.innerHTML = '';
    return;
  }

  const chip = (value, label) => `
    <button type="button" class="chip" data-league="${esc(value)}"
            aria-pressed="${state.league === value}">${esc(label)}</button>`;

  render(host, [chip('all', 'Todas as ligas'), ...leagues.map((l) => chip(l, l))].join(''));
}

function renderBankrollStrip() {
  const strip = $('#bankroll-strip');
  if (!strip) return;

  const hasPicks = state.picks.length > 0;
  strip.hidden = !hasPicks;
  if (!hasPicks) return;

  $('#bankroll-value').textContent = fmtMoney(bankroll());
}
