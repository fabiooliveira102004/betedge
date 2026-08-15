import { $, esc, fmtAgo, fmtDayHeading, fmtPct, groupBy, render } from './util.js';
import { emptyState, skeletons } from './ui.js';
import { state, visibleMatches } from './state.js';

/**
 * A vista principal: os jogos que vem ai.
 *
 * Agrupados por dia, como um calendario — e nao por "qualidade da aposta",
 * porque a pergunta que se faz ao abrir a app e "o que se joga hoje", nao
 * "onde e que ha valor". O valor e uma etiqueta no cartao, nao o criterio
 * de ordenacao.
 */
export function renderMatches() {
  renderFilters();

  const host = $('#matches-list');
  const meta = $('#matches-meta');

  if (state.loading) {
    host.setAttribute('aria-busy', 'true');
    render(host, skeletons(4));
    meta.textContent = 'A carregar jogos…';
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

  const list = visibleMatches();
  const withValue = state.matches.filter((m) => m.valueCount > 0).length;

  meta.textContent = state.matches.length === 0
    ? 'Sem jogos analisados'
    : `${list.length} ${list.length === 1 ? 'jogo' : 'jogos'}`
      + (withValue ? ` · ${withValue} com odds em desacordo com o modelo` : '')
      + (state.meta?.generatedAt ? ` · ${fmtAgo(state.meta.generatedAt)}` : '');

  if (list.length === 0) {
    render(host, emptyState({
      icon: 'clock',
      title: state.matches.length === 0 ? 'Nenhum jogo na janela de analise' : 'Nada neste filtro',
      text: state.matches.length === 0
        ? 'O motor analisa os jogos dos proximos dias. Volta mais tarde ou atualiza.'
        : 'Experimenta outra liga, ou desliga o filtro de valor.',
    }));
    return;
  }

  const byDay = groupBy(list, (m) => m.kickoff.slice(0, 10));

  render(host, demoNotice() + [...byDay.entries()].map(([day, matches]) => `
    <p class="day-label">${esc(fmtDayHeading(day))}</p>
    ${matches.map(matchCard).join('')}
  `).join(''));
}

/**
 * O cartao do jogo. Mostra o que o modelo acha que vai acontecer e com que
 * probabilidade — nao uma aposta. Se houver odds que o modelo considera
 * mal calibradas, isso e uma etiqueta, nao o assunto principal.
 */
function matchCard(match) {
  const v = match.verdict;
  const time = new Date(match.kickoff).toLocaleTimeString('pt-PT', {
    hour: '2-digit', minute: '2-digit',
  });

  return `
<article class="match" data-strength="${esc(v.strength)}">
  <button type="button" class="match__open" data-action="open-match" data-match-id="${esc(match.id)}"
          aria-label="Analise de ${esc(match.home)} contra ${esc(match.away)}">
    <div class="match__top">
      <span class="match__league">${esc(match.league)}</span>
      <span class="match__time num">${esc(time)}</span>
    </div>

    <div class="match__teams">
      <span class="match__team">${esc(match.home)}</span>
      <span class="match__xg num">${match.lambdas.home.toFixed(1)} – ${match.lambdas.away.toFixed(1)}</span>
      <span class="match__team match__team--away">${esc(match.away)}</span>
    </div>

    <div class="match__verdict">
      <span class="match__verdict-label">
        ${v.strength === 'aberto' ? 'Jogo em aberto' : esc(v.label)}
      </span>
      <span class="match__verdict-prob num">${esc(fmtPct(v.probability, 0))}</span>
    </div>

    <div class="probbar" aria-hidden="true">
      <span class="probbar__seg probbar__seg--home" style="width:${probOf(match, 'home') * 100}%"></span>
      <span class="probbar__seg probbar__seg--draw" style="width:${probOf(match, 'draw') * 100}%"></span>
      <span class="probbar__seg probbar__seg--away" style="width:${probOf(match, 'away') * 100}%"></span>
    </div>

    <!-- A barra da a proporcao de relance; a legenda da o valor exato e
         garante que a informacao nao depende so da cor. -->
    <div class="problegend">
      <span><i class="dot dot--home"></i>Casa <b class="num">${esc(fmtPct(probOf(match, 'home'), 0))}</b></span>
      <span><i class="dot dot--draw"></i>Empate <b class="num">${esc(fmtPct(probOf(match, 'draw'), 0))}</b></span>
      <span><i class="dot dot--away"></i>Fora <b class="num">${esc(fmtPct(probOf(match, 'away'), 0))}</b></span>
    </div>

    <div class="match__foot">
      <span class="match__hint">
        Resultado mais provavel <strong class="num">${esc(v.likelyScore ?? '—')}</strong>
      </span>
      ${match.valueCount > 0 ? `
        <span class="tag tag--value">
          ${match.valueCount} ${match.valueCount === 1 ? 'odd generosa' : 'odds generosas'}
        </span>` : ''}
    </div>
  </button>
</article>`;
}

function probOf(match, selection) {
  const h2h = match.markets?.find((m) => m.market === 'h2h');
  return h2h?.selections.find((s) => s.selection === selection)?.modelProb ?? 0;
}

function renderFilters() {
  const host = $('#league-filters');
  if (!host) return;

  const leagues = [...new Set(state.matches.map((m) => m.league))].sort();
  if (leagues.length < 2) {
    host.innerHTML = '';
    return;
  }

  const chip = (value, label) => `
    <button type="button" class="chip" data-league="${esc(value)}"
            aria-pressed="${state.league === value}">${esc(label)}</button>`;

  render(host, [chip('all', 'Todas as ligas'), ...leagues.map((l) => chip(l, l))].join(''));

  const valueChip = $('#value-filter');
  if (valueChip) valueChip.setAttribute('aria-pressed', String(state.onlyValue));
}

/**
 * Sem chave de cotacoes o motor inventa jogos. Usam nomes de clubes reais,
 * por isso o aviso tem de dizer exatamente o que esta errado.
 */
function demoNotice() {
  if (!state.meta?.demo) return '';
  return `
  <details class="notice">
    <summary class="notice__summary">
      <strong>Estes jogos nao sao reais</strong> — toca para saber porque
    </summary>
    <p class="notice__text">
      Os emparelhamentos, as datas e as odds foram gerados para veres a app a funcionar.
      Nenhum destes jogos esta no calendario. A analise e que e verdadeira: o modelo,
      os calculos e os textos sao os mesmos que vais ver com dados a serio.
    </p>
    <p class="notice__text">
      Para passar a jogos reais, cria uma chave gratuita em <strong>the-odds-api.com</strong>
      e adiciona-a ao repositorio como <code>ODDS_API_KEY</code>.
    </p>
  </details>`;
}
