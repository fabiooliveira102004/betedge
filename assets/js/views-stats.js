import { $, esc, fmtPct, fmtSigned, render } from './util.js';
import { emptyState } from './ui.js';
import { state } from './state.js';

/**
 * Desempenho do modelo.
 *
 * Tres perguntas, por ordem de importancia:
 *   1. Isto esta a dar lucro?           -> ROI e curva de banca
 *   2. As probabilidades sao honestas?  -> calibracao
 *   3. Onde e que funciona melhor?      -> repartição por mercado e liga
 *
 * A calibracao e a mais reveladora: acertar 55% das apostas nao diz nada
 * sem saber a que odds; um modelo bem calibrado ganha ~60% das vezes que
 * diz 60%, e e isso que o grafico mostra.
 */
export function renderStats() {
  const host = $('#stats-body');
  const meta = $('#stats-meta');
  const s = state.stats;

  if (!s || (s.overall?.n ?? 0) === 0) {
    meta.textContent = 'Sem dados suficientes';
    render(host, emptyState({
      icon: 'chart',
      title: 'Ainda nao ha desempenho para mostrar',
      text: 'As estatisticas aparecem depois das primeiras apostas serem liquidadas.',
    }));
    return;
  }

  const o = s.overall;
  meta.textContent = `${o.n} apostas liquidadas`
    + (state.stats.updatedAt ? ` · ${o.wins}V-${o.losses}D` : '');

  render(host, [
    kpiTiles(o, s),
    equityCard(s.equity),
    calibrationCard(s.calibration),
    breakdownCard('Por mercado', s.byMarket, MARKET_NAMES),
    breakdownCard('Por liga', s.byLeague),
    breakdownCard('Por confianca', s.byConfidence, CONFIDENCE_NAMES),
    disclaimer(),
  ].join(''));
}

const MARKET_NAMES = {
  h2h: 'Resultado final',
  totals: 'Total de golos',
  btts: 'Ambas marcam',
  dnb: 'Empate anula',
  double_chance: 'Dupla hipotese',
};

const CONFIDENCE_NAMES = { alta: 'Confianca alta', media: 'Confianca media', baixa: 'Confianca baixa' };

/* ── Indicadores ────────────────────────────────────────────────────── */

function kpiTiles(o, s) {
  const roiTone = o.roi > 0 ? 'var(--win)' : o.roi < 0 ? 'var(--loss)' : 'var(--text)';
  const streakLabel = s.streak?.type === 'win' ? 'vitorias seguidas'
    : s.streak?.type === 'loss' ? 'derrotas seguidas' : 'sem sequencia';

  return `
  <div class="tiles">
    <div class="tile">
      <span class="tile__label">Retorno (ROI)</span>
      <span class="tile__value" style="color:${roiTone}">${esc(fmtSigned(o.roi, 1))}</span>
      <!-- O volume acumulado passa a banca varias vezes ao fim de centenas
           de apostas; em percentagem ("1203%") isso lia-se como um erro. -->
      <span class="tile__hint">volume de ${(o.staked ?? 0).toFixed(1)}x a banca</span>
    </div>
    <div class="tile">
      <span class="tile__label">Lucro</span>
      <span class="tile__value" style="color:${roiTone}">${esc(fmtSigned(o.profit, 1))}</span>
      <span class="tile__hint">da banca inicial</span>
    </div>
    <div class="tile">
      <span class="tile__label">Taxa de acerto</span>
      <span class="tile__value">${esc(fmtPct(o.hitRate, 0))}</span>
      <span class="tile__hint">${o.wins}V · ${o.losses}D${o.pushes ? ` · ${o.pushes}A` : ''}</span>
    </div>
    <div class="tile">
      <span class="tile__label">Odd media</span>
      <span class="tile__value">${(o.avgOdds ?? 0).toFixed(2)}</span>
      <span class="tile__hint">vantagem media ${esc(fmtPct(o.avgEdge ?? 0, 1))}</span>
    </div>
    <div class="tile">
      <span class="tile__label">Queda maxima</span>
      <span class="tile__value" style="color:var(--loss)">${esc(fmtPct(o.maxDrawdown ?? 0, 1))}</span>
      <span class="tile__hint">pior recuo desde um pico</span>
    </div>
    <div class="tile">
      <span class="tile__label">Sequencia</span>
      <span class="tile__value">${s.streak?.length ?? 0}</span>
      <span class="tile__hint">${esc(streakLabel)}</span>
    </div>
  </div>`;
}

/* ── Curva de banca ─────────────────────────────────────────────────── */

function equityCard(equity = []) {
  if (equity.length < 2) return '';

  const W = 320;
  const H = 96;
  const PAD = 4;

  const values = equity.map((p) => p.cumulative);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = (max - min) || 1;

  const x = (i) => PAD + (i / (equity.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`;
  const zeroY = y(0).toFixed(1);

  const last = values[values.length - 1];
  const tone = last >= 0 ? 'var(--win)' : 'var(--loss)';

  return `
  <figure class="card" style="margin:0">
    <figcaption>
      <h2 class="card__title">Evolucao da banca</h2>
      <p class="card__sub">
        Lucro acumulado ao longo de ${equity.length} apostas, em percentagem da banca.
      </p>
    </figcaption>

    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="none"
         aria-label="Curva de lucro acumulado: termina em ${fmtSigned(last, 1)} da banca.">
      <defs>
        <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${tone}" stop-opacity=".22"/>
          <stop offset="100%" stop-color="${tone}" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <!-- Linha do zero: separa lucro de prejuizo, recessiva. -->
      <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}"
            stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="3 3"/>

      <path d="${area}" fill="url(#eq-fill)"/>
      <path d="${line}" fill="none" stroke="${tone}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.5"
              fill="${tone}" stroke="var(--surface)" stroke-width="2"/>
    </svg>

    <div class="row-between" style="margin-top:10px">
      <span class="bar__meta">inicio 0%</span>
      <span class="pnl pnl--${last >= 0 ? 'pos' : 'neg'}">${esc(fmtSigned(last, 1))}</span>
    </div>
  </figure>`;
}

/* ── Calibracao ─────────────────────────────────────────────────────── */

function calibrationCard(bands = []) {
  if (bands.length === 0) return '';

  const rows = bands.map((b) => {
    const actual = Math.round(b.actual * 100);
    const predicted = Math.round(b.predicted * 100);
    const gap = actual - predicted;

    return `
      <div>
        <div class="bar__head">
          <span class="bar__name">${esc(b.band)}%</span>
          <span class="bar__meta">
            real ${actual}% · previsto ${predicted}% · ${b.n} ${b.n === 1 ? 'aposta' : 'apostas'}
          </span>
        </div>
        <div class="bar__track" role="img"
             aria-label="Banda ${esc(b.band)} por cento: previsto ${predicted} por cento, real ${actual} por cento.">
          <span class="bar__fill" style="width:${actual}%"></span>
          <!-- Marca do previsto: a barra e o resultado real, a marca e a
               referencia que o modelo prometeu. -->
          <span style="position:absolute;inset-block:-2px;inset-inline-start:calc(${predicted}% - 1px);
                       width:2px;background:var(--text);border-radius:1px"></span>
        </div>
      </div>`;
  }).join('');

  const worst = bands.reduce(
    (acc, b) => (Math.abs(b.actual - b.predicted) > Math.abs(acc.actual - acc.predicted) ? b : acc),
    bands[0],
  );
  const worstGap = Math.round(Math.abs(worst.actual - worst.predicted) * 100);

  return `
  <section class="card">
    <h2 class="card__title">Calibracao</h2>
    <p class="card__sub">
      Barra = quantas ganharam mesmo. Marca = o que o modelo tinha previsto.
      Quanto mais perto uma da outra, mais fiaveis sao as probabilidades.
    </p>
    <div class="bars">${rows}</div>
    <p class="card__sub" style="margin:14px 0 0">
      Maior desvio: ${worstGap} pontos percentuais na banda ${esc(worst.band)}%.
    </p>
  </section>`;
}

/* ── Reparticoes ────────────────────────────────────────────────────── */

function breakdownCard(title, groups = {}, names = {}) {
  const entries = Object.entries(groups)
    .filter(([, g]) => g.n > 0)
    .sort((a, b) => b[1].n - a[1].n);

  if (entries.length === 0) return '';

  // Escala comum a todas as barras, senao a maior parece sempre igual.
  const peak = Math.max(...entries.map(([, g]) => Math.abs(g.roi)), 0.01);

  const rows = entries.map(([key, g]) => {
    const positive = g.roi >= 0;
    const width = Math.max(2, (Math.abs(g.roi) / peak) * 100);

    return `
      <div>
        <div class="bar__head">
          <span class="bar__name">${esc(names[key] ?? key)}</span>
          <span class="bar__meta" style="color:${positive ? 'var(--win)' : 'var(--loss)'}">
            ${esc(fmtSigned(g.roi, 1))}
          </span>
        </div>
        <div class="bar__track" role="img"
             aria-label="${esc(names[key] ?? key)}: retorno ${fmtSigned(g.roi, 1)} em ${g.n} apostas.">
          <span class="bar__fill bar__fill--${positive ? 'pos' : 'neg'}" style="width:${width}%"></span>
        </div>
        <p class="bar__meta" style="margin-top:4px">
          ${g.n} apostas · ${g.wins}V-${g.losses}D · acerto ${esc(fmtPct(g.hitRate, 0))}
        </p>
      </div>`;
  }).join('');

  return `
  <section class="card">
    <h2 class="card__title">${esc(title)}</h2>
    <p class="card__sub">Retorno sobre o valor arriscado em cada grupo.</p>
    <div class="bars">${rows}</div>
  </section>`;
}

function disclaimer() {
  return `
  <p class="legal">
    <strong>Como ler estes numeros.</strong>
    Todas as apostas sao gravadas antes do jogo comecar e o resultado e colado por cima
    depois, sem hipotese de reescrever o registo. Desempenho passado nao garante
    desempenho futuro: uma amostra de poucas centenas de apostas ainda tem muito
    acaso pelo meio. Aposta apenas o que podes perder.
  </p>`;
}
