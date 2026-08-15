import { $, esc, fmtPct, render } from './util.js';
import { emptyState } from './ui.js';
import { state } from './state.js';

/**
 * Prestacao do modelo.
 *
 * A pergunta que importa nao e "quanto se ganhava" — a app nao gere
 * dinheiro. E "estas probabilidades sao de confianca?". A calibracao
 * responde a isso: quando o modelo diz 60%, acontece mesmo ~60% das vezes?
 */
export function renderModel() {
  const host = $('#model-body');
  const meta = $('#model-meta');
  const acc = state.accuracy;
  const stats = state.stats;

  if (!acc && !stats?.calibration?.length) {
    meta.textContent = 'Sem dados suficientes';
    render(host, emptyState({
      icon: 'chart',
      title: 'Ainda nao ha como julgar o modelo',
      text: 'Estes numeros aparecem depois de os primeiros jogos analisados terminarem.',
    }));
    return;
  }

  meta.textContent = acc ? `${acc.n} jogos avaliados` : 'analise em curso';

  render(host, [
    acc ? accuracySection(acc) : '',
    calibrationSection(stats?.calibration),
    marketSection(stats?.byMarket),
    honesty(),
  ].join(''));
}

/* ── Acerto do resultado previsto ───────────────────────────────────── */

function accuracySection(a) {
  const delta = a.rate - a.homeBaseline;
  const BAND = { claro: 'Previsao clara', ligeiro: 'Ligeiro favorito', aberto: 'Jogo em aberto' };
  const bands = Object.entries(a.byStrength ?? {});

  return `
  <section class="card">
    <h2 class="card__title">Acerto do resultado previsto</h2>
    <p class="card__sub">
      Em quantos jogos o resultado que o modelo apontou como mais provavel se confirmou.
    </p>

    <div class="tiles" style="margin-bottom:16px">
      <div class="tile">
        <span class="tile__label">O modelo</span>
        <span class="tile__value">${Math.round(a.rate * 100)}%</span>
        <span class="tile__hint">${a.hits} de ${a.n} jogos</span>
      </div>
      <div class="tile">
        <span class="tile__label">Palpite simples</span>
        <span class="tile__value" style="color:var(--text-dim)">${Math.round(a.homeBaseline * 100)}%</span>
        <span class="tile__hint">apostar sempre na casa</span>
      </div>
    </div>

    <p class="detail__note" style="margin-top:0">
      ${delta > 0.02
    ? `O modelo esta <strong>${Math.round(delta * 100)} pontos percentuais</strong> acima de um palpite sem analise nenhuma.`
    : delta < -0.02
      ? `O modelo esta <strong>${Math.round(-delta * 100)} pontos</strong> abaixo de um palpite sem analise. Nesta amostra nao esta a acrescentar nada.`
      : 'O modelo esta ao nivel de um palpite sem analise nenhuma nesta amostra.'}
    </p>

    ${bands.length ? `
      <h4 class="detail__subtitle">Por forca da previsao</h4>
      <div class="bars">
        ${bands.map(([band, d]) => `
          <div>
            <div class="bar__head">
              <span class="bar__name">${esc(BAND[band] ?? band)}</span>
              <span class="bar__meta">${Math.round(d.rate * 100)}% · ${d.n} jogos</span>
            </div>
            <div class="bar__track">
              <span class="bar__fill" style="width:${d.rate * 100}%"></span>
            </div>
          </div>`).join('')}
      </div>
      <p class="detail__note">
        Se o acerto sobe quando o modelo diz estar confiante, e sinal de que a
        confianca dele quer dizer alguma coisa. Se fosse igual em todas as bandas,
        a confianca seria decorativa.
      </p>` : ''}
  </section>`;
}

/* ── Calibracao ─────────────────────────────────────────────────────── */

function calibrationSection(bands = []) {
  if (!bands?.length) return '';

  const rows = bands.map((b) => {
    const actual = Math.round(b.actual * 100);
    const predicted = Math.round(b.predicted * 100);

    return `
      <div>
        <div class="bar__head">
          <span class="bar__name">${esc(b.band)}%</span>
          <span class="bar__meta">real ${actual}% · previsto ${predicted}% · ${b.n} casos</span>
        </div>
        <div class="bar__track" role="img"
             aria-label="Banda ${esc(b.band)} por cento: previsto ${predicted}, real ${actual}.">
          <span class="bar__fill" style="width:${actual}%"></span>
          <span style="position:absolute;inset-block:-2px;inset-inline-start:calc(${predicted}% - 1px);
                       width:2px;background:var(--text);border-radius:1px"></span>
        </div>
      </div>`;
  }).join('');

  return `
  <section class="card">
    <h2 class="card__title">Calibracao</h2>
    <p class="card__sub">
      Barra = o que aconteceu mesmo. Marca = o que o modelo tinha previsto.
      Quanto mais perto uma da outra, mais fiaveis sao as percentagens que ves em cada jogo.
    </p>
    <div class="bars">${rows}</div>
  </section>`;
}

/* ── Por mercado ────────────────────────────────────────────────────── */

function marketSection(byMarket) {
  const entries = Object.entries(byMarket ?? {}).filter(([, g]) => g.n >= 5);
  if (entries.length === 0) return '';

  const NAMES = {
    h2h: 'Resultado final',
    totals: 'Total de golos',
    btts: 'Ambas marcam',
    dnb: 'Empate anula',
    double_chance: 'Dupla hipotese',
  };

  return `
  <section class="card">
    <h2 class="card__title">Onde o modelo se sai melhor</h2>
    <p class="card__sub">
      Taxa de acerto por tipo de mercado, nas selecoes em que o modelo discordou do preco.
    </p>
    <div class="bars">
      ${entries.sort((a, b) => b[1].hitRate - a[1].hitRate).map(([key, g]) => `
        <div>
          <div class="bar__head">
            <span class="bar__name">${esc(NAMES[key] ?? key)}</span>
            <span class="bar__meta">${esc(fmtPct(g.hitRate, 0))} · ${g.n} casos</span>
          </div>
          <div class="bar__track">
            <span class="bar__fill" style="width:${g.hitRate * 100}%"></span>
          </div>
        </div>`).join('')}
    </div>
  </section>`;
}

function honesty() {
  return `
  <p class="legal">
    <strong>Como ler isto.</strong>
    Todas as previsoes sao gravadas antes do jogo comecar e o resultado e colado por
    cima depois — nao ha forma de reescrever o registo. Ainda assim, algumas centenas
    de jogos e uma amostra pequena: uma boa fase pode ser sorte e uma ma fase pode ser
    azar. Um modelo bem calibrado nao acerta sempre, acerta na proporcao que anuncia.
  </p>`;
}
