import { $, esc, fmtDayHeading, fmtPct, groupBy, render } from './util.js';
import { emptyState } from './ui.js';
import { APP } from './config.js';
import { state, visibleResults } from './state.js';

/**
 * Jogos ja disputados, com o resultado real ao lado da previsao.
 *
 * A previsao foi publicada antes do apito e nao pode ser reescrita depois.
 * Os jogos em que o modelo falhou aparecem exatamente como os outros — um
 * registo que so mostra acertos nao serve para julgar nada.
 */
export function renderResults() {
  const host = $('#results-list');
  const meta = $('#results-meta');
  const more = $('#results-more');

  const list = visibleResults();
  const acc = state.accuracy;

  meta.textContent = state.results.length === 0
    ? 'Ainda sem jogos disputados'
    : `${state.results.length} jogos`
      + (acc ? ` · previsao certa em ${Math.round(acc.rate * 100)}%` : '');

  if (list.length === 0) {
    more.hidden = true;
    render(host, emptyState({
      icon: 'clock',
      title: 'Sem resultados ainda',
      text: 'Assim que os primeiros jogos analisados terminarem, aparecem aqui com o resultado real.',
    }));
    return;
  }

  const shown = Math.max(state.resultsShown || APP.historyPageSize, APP.historyPageSize);
  const page = list.slice(0, shown);
  const byDay = groupBy(page, (r) => r.kickoff.slice(0, 10));

  render(host, accuracyCard() + [...byDay.entries()].map(([day, matches]) => `
    <p class="day-label">${esc(fmtDayHeading(day))}</p>
    ${matches.map(resultCard).join('')}
  `).join(''));

  more.hidden = page.length >= list.length;
}

/**
 * O quadro de acerto. A comparacao com o baseline e o que torna o numero
 * legivel: acertar 50% dos jogos nao diz nada se apostar sempre na equipa
 * da casa tambem acerta 50%.
 */
function accuracyCard() {
  const a = state.accuracy;
  if (!a) return '';

  const delta = a.rate - a.homeBaseline;
  const bands = Object.entries(a.byStrength ?? {});

  const BAND_LABEL = {
    claro: 'Previsao clara',
    ligeiro: 'Ligeiro favorito',
    aberto: 'Jogo em aberto',
  };

  return `
  <section class="card" style="margin-bottom:6px">
    <h2 class="card__title">Quantas vezes o modelo acerta</h2>
    <p class="card__sub">
      Percentagem de jogos em que o resultado mais provavel se confirmou, em ${a.n} jogos.
    </p>

    <div class="tiles" style="margin-bottom:14px">
      <div class="tile">
        <span class="tile__label">Acerto do modelo</span>
        <span class="tile__value">${Math.round(a.rate * 100)}%</span>
      </div>
      <div class="tile">
        <span class="tile__label">Palpite simples</span>
        <span class="tile__value" style="color:var(--text-dim)">${Math.round(a.homeBaseline * 100)}%</span>
        <span class="tile__hint">apostar sempre na equipa da casa</span>
      </div>
    </div>

    <p class="detail__note" style="margin-top:0">
      ${delta > 0.02
    ? `O modelo esta <strong>${Math.round(delta * 100)} pontos</strong> acima do palpite simples.`
    : delta < -0.02
      ? `O modelo esta <strong>${Math.round(-delta * 100)} pontos</strong> abaixo do palpite simples — nesta amostra nao esta a acrescentar valor.`
      : 'O modelo esta ao nivel do palpite simples nesta amostra.'}
    </p>

    ${bands.length ? `
      <h4 class="detail__subtitle">Por forca da previsao</h4>
      <div class="bars">
        ${bands.map(([band, d]) => `
          <div>
            <div class="bar__head">
              <span class="bar__name">${esc(BAND_LABEL[band] ?? band)}</span>
              <span class="bar__meta">${Math.round(d.rate * 100)}% de ${d.n} jogos</span>
            </div>
            <div class="bar__track">
              <span class="bar__fill" style="width:${d.rate * 100}%"></span>
            </div>
          </div>`).join('')}
      </div>
      <p class="detail__note">
        Quanto mais confiante a previsao, mais vezes acerta — e o sinal de que a
        confianca do modelo significa alguma coisa.
      </p>` : ''}
  </section>`;
}

function resultCard(r) {
  const v = r.verdict;
  const time = new Date(r.kickoff).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  return `
<article class="match match--result" data-hit="${r.verdictHit ? 'yes' : 'no'}">
  <button type="button" class="match__open" data-action="open-match" data-match-id="${esc(r.id)}"
          aria-label="Analise de ${esc(r.home)} contra ${esc(r.away)}, terminado ${r.score.home} a ${r.score.away}">
    <div class="match__top">
      <span class="match__league">${esc(r.league)}</span>
      <span class="match__time num">${esc(time)}</span>
    </div>

    <div class="match__teams">
      <span class="match__team">${esc(r.home)}</span>
      <span class="match__score num">${r.score.home} – ${r.score.away}</span>
      <span class="match__team match__team--away">${esc(r.away)}</span>
    </div>

    <div class="match__foot">
      <span class="match__hint">
        Previa <strong>${esc(v?.label ?? '—')}</strong>
        ${v ? `<span class="num">${esc(fmtPct(v.probability, 0))}</span>` : ''}
      </span>
      <span class="tag ${r.verdictHit ? 'tag--hit' : 'tag--miss'}">
        ${r.verdictHit ? 'acertou' : 'falhou'}
      </span>
    </div>
  </button>
</article>`;
}
