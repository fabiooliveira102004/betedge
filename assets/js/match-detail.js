import { esc, fmtKickoff, fmtPct, fmtSigned } from './util.js';

/**
 * A analise completa de um jogo.
 *
 * A ordem responde as perguntas pela ordem em que se fazem: o que e que o
 * modelo acha que vai acontecer, como se compara com o que a casa esta a
 * pagar em cada mercado, e que dados sustentam isso.
 *
 * O quadro de mercados mostra *todas* as opcoes, nao so as interessantes.
 * Saber que uma odd esta cara e tao util como saber que esta barata, e uma
 * lista filtrada esconde a informacao que permite julgar o modelo.
 */
export function matchDetail(match) {
  const isResult = Boolean(match.score);

  return `
<article class="detail">
  ${header(match, isResult)}
  ${isResult ? finalScore(match) : verdict(match)}
  ${isResult ? resultMarkets(match) : marketTable(match)}
  ${goals(match)}
  ${teams(match)}
  ${h2h(match)}
  ${news(match)}
  ${context(match)}
  ${quality(match)}
</article>`;
}

/* ── Cabecalho ──────────────────────────────────────────────────────── */

function header(match, isResult) {
  return `
  <header class="detail__head">
    <p class="detail__league">${esc(match.league)}</p>
    <h2 class="detail__match">${esc(match.home)} <span>vs</span> ${esc(match.away)}</h2>
    <p class="detail__when num">
      ${esc(fmtKickoff(match.kickoff))}${isResult ? ' · terminado' : ''}
    </p>
  </header>`;
}

/* ── Veredicto ──────────────────────────────────────────────────────── */

function verdict(match) {
  const v = match.verdict;
  const h2hMarket = match.markets?.find((m) => m.market === 'h2h');
  const probs = Object.fromEntries(
    (h2hMarket?.selections ?? []).map((s) => [s.selection, s.modelProb ?? 0]),
  );

  const STRENGTH = {
    claro: { label: 'Previsao clara', tone: 'strong' },
    ligeiro: { label: 'Ligeiro favorito', tone: 'mild' },
    aberto: { label: 'Jogo em aberto', tone: 'open' },
  };
  const s = STRENGTH[v.strength] ?? STRENGTH.aberto;

  return `
  <section class="verdict verdict--${esc(s.tone)}">
    <p class="verdict__kicker">${esc(s.label)}</p>
    <p class="verdict__summary">${esc(v.summary)}</p>

    <div class="outcomes">
      ${outcomeRow(match.home, probs.home ?? 0, v.outcome === 'home')}
      ${outcomeRow('Empate', probs.draw ?? 0, v.outcome === 'draw')}
      ${outcomeRow(match.away, probs.away ?? 0, v.outcome === 'away')}
    </div>

    <div class="verdict__facts">
      <div>
        <span class="detail__label">Resultado mais provavel</span>
        <strong class="num">${esc(v.likelyScore ?? '—')}</strong>
        <span class="detail__note">${v.likelyScoreProb ? esc(fmtPct(v.likelyScoreProb, 1)) : ''}</span>
      </div>
      <div>
        <span class="detail__label">Golos esperados</span>
        <strong class="num">${(match.lambdas.home + match.lambdas.away).toFixed(1)}</strong>
        <span class="detail__note">${match.lambdas.home.toFixed(1)} – ${match.lambdas.away.toFixed(1)}</span>
      </div>
    </div>
  </section>`;
}

function outcomeRow(label, p, isTop) {
  return `
    <div class="outcome${isTop ? ' is-top' : ''}">
      <span class="outcome__label">${esc(label)}</span>
      <div class="bar__track">
        <span class="bar__fill${isTop ? '' : ' bar__fill--muted'}" style="width:${p * 100}%"></span>
      </div>
      <span class="outcome__pct num">${esc(fmtPct(p, 0))}</span>
    </div>`;
}

/* ── Quadro de mercados ─────────────────────────────────────────────── */

function marketTable(match) {
  if (!match.markets?.length) return '';

  const blocks = match.markets.map((m) => `
    <div class="market">
      <div class="market__head">
        <h4 class="market__title">${esc(m.label)}</h4>
        <span class="detail__note">margem ${esc(fmtPct(m.overround, 1))}</span>
      </div>
      <p class="detail__note" style="margin:0 0 10px">${esc(m.hint)}</p>

      <div class="mrow mrow--head" aria-hidden="true">
        <span>Opcao</span>
        <span class="num">Odd</span>
        <span class="num">Modelo</span>
        <span class="num">Dif.</span>
      </div>

      ${m.selections.map(selectionRow).join('')}
    </div>`).join('');

  return `
  <section class="detail__section">
    <h3 class="detail__title">O que a casa paga, o que o modelo calcula</h3>
    <p class="detail__note" style="margin-top:0">
      <strong>Odd</strong> e o preco da Betclic. <strong>Modelo</strong> e a probabilidade
      que o algoritmo calcula. <strong>Dif.</strong> e a distancia entre o modelo e o preco
      justo do mercado — positivo significa que a odd esta generosa para o risco real.
    </p>
    ${blocks}
  </section>`;
}

function selectionRow(s) {
  const edge = s.edge ?? 0;
  const tone = s.isValue ? 'value' : edge > 0 ? 'pos' : edge < -0.03 ? 'neg' : 'flat';

  return `
    <div class="mrow mrow--${tone}">
      <span class="mrow__label">
        ${esc(s.label)}
        ${s.isValue ? '<span class="tag tag--value tag--sm">valor</span>' : ''}
      </span>
      <span class="mrow__odds num">${s.odds.toFixed(2)}</span>
      <span class="mrow__model num">${s.modelProb == null ? '—' : esc(fmtPct(s.modelProb, 0))}</span>
      <span class="mrow__edge num">${s.edge == null ? '—' : esc(fmtSigned(s.edge, 1))}</span>
    </div>`;
}

/* ── Resultado final (jogos passados) ───────────────────────────────── */

function finalScore(match) {
  const v = match.verdict;
  const hit = match.verdictHit;

  return `
  <section class="verdict verdict--${hit ? 'strong' : 'open'}">
    <p class="verdict__kicker">Resultado final</p>
    <p class="final-score num">${match.score.home} – ${match.score.away}</p>
    <p class="verdict__summary">
      O modelo previa <strong>${esc(v?.label ?? '—')}</strong>
      com ${v ? esc(fmtPct(v.probability, 0)) : '—'}.
      ${hit ? 'Acertou.' : 'Falhou.'}
    </p>
    <div class="verdict__facts">
      <div>
        <span class="detail__label">Total de golos</span>
        <strong class="num">${match.totalGoals}</strong>
        <span class="detail__note">previstos ${(match.lambdas.home + match.lambdas.away).toFixed(1)}</span>
      </div>
      <div>
        <span class="detail__label">Ambas marcaram</span>
        <strong>${match.bothScored ? 'Sim' : 'Nao'}</strong>
      </div>
    </div>
  </section>`;
}

function resultMarkets(match) {
  if (!match.odds) return '';

  const rows = ['home', 'draw', 'away'].map((sel) => {
    const label = sel === 'home' ? match.home : sel === 'away' ? match.away : 'Empate';
    const won = match.outcome === sel;
    return `
      <div class="mrow mrow--${won ? 'value' : 'flat'}">
        <span class="mrow__label">${esc(label)}${won ? ' <span class="tag tag--value tag--sm">aconteceu</span>' : ''}</span>
        <span class="mrow__odds num">${(match.odds[sel] ?? 0).toFixed(2)}</span>
        <span class="mrow__model num">${esc(fmtPct(match.modelProbs?.[sel] ?? 0, 0))}</span>
        <span class="mrow__edge num"></span>
      </div>`;
  }).join('');

  return `
  <section class="detail__section">
    <h3 class="detail__title">O que se pagava antes do jogo</h3>
    <div class="market">
      <div class="mrow mrow--head" aria-hidden="true">
        <span>Opcao</span><span class="num">Odd</span><span class="num">Modelo</span><span></span>
      </div>
      ${rows}
    </div>
    ${match.valueSelections?.length ? `
      <h4 class="detail__subtitle">Odds que o modelo considerou generosas</h4>
      ${match.valueSelections.map((s) => `
        <div class="mrow mrow--flat">
          <span class="mrow__label">${esc(s.label)}</span>
          <span class="mrow__odds num">${s.odds.toFixed(2)}</span>
          <span class="mrow__model num">${esc(fmtPct(s.modelProb, 0))}</span>
          <span class="mrow__edge num">${esc(fmtSigned(s.edge, 1))}</span>
        </div>`).join('')}` : ''}
  </section>`;
}

/* ── Golos ──────────────────────────────────────────────────────────── */

function goals(match) {
  const dist = match.analysis?.goalsDistribution;
  const scorelines = match.analysis?.scorelines;
  if (!dist?.length && !scorelines?.length) return '';

  const peak = Math.max(...(dist ?? []).map((d) => d.p), 0.01);

  return `
  <section class="detail__section">
    <h3 class="detail__title">Como o jogo deve correr</h3>

    ${dist?.length ? `
      <h4 class="detail__subtitle">Probabilidade por total de golos</h4>
      <div class="hist">
        ${dist.map((d) => `
          <div class="hist__col">
            <div class="hist__bar" style="height:${Math.max(3, (d.p / peak) * 100)}%"
                 role="img" aria-label="${d.label} golos: ${Math.round(d.p * 100)} por cento"></div>
            <span class="hist__pct num">${Math.round(d.p * 100)}</span>
            <span class="hist__label num">${esc(d.label)}</span>
          </div>`).join('')}
      </div>` : ''}

    ${scorelines?.length ? `
      <h4 class="detail__subtitle">Resultados mais provaveis</h4>
      <ul class="scorelines">
        ${scorelines.map((s) => `
          <li class="scoreline">
            <span class="scoreline__score num">${esc(s.score)}</span>
            <span class="scoreline__pct num">${(s.p * 100).toFixed(1)}%</span>
          </li>`).join('')}
      </ul>` : ''}
  </section>`;
}

/* ── Equipas ────────────────────────────────────────────────────────── */

function teams(match) {
  const t = match.analysis?.teams;
  if (!t) return '';
  return `
  <section class="detail__section">
    <h3 class="detail__title">As equipas</h3>
    ${teamBlock(t.home, 'em casa')}
    ${teamBlock(t.away, 'fora')}
  </section>`;
}

function teamBlock(team, venue) {
  if (!team) return '';
  const split = venue === 'em casa' ? team.split?.home : team.split?.away;

  const games = team.form?.games ?? [];
  const chips = games.length
    // Do mais antigo para o mais recente: le-se como uma linha do tempo.
    ? [...games].reverse().map((g) => `
        <span class="form-chip form-chip--${g.result.toLowerCase()}"
              title="${esc(g.atHome ? 'casa' : 'fora')} vs ${esc(g.opponent)}: ${g.scored}-${g.conceded}">
          ${g.result === 'W' ? 'V' : g.result === 'D' ? 'E' : 'D'}
        </span>`).join('')
    : '<span class="detail__note">sem jogos registados</span>';

  const recent = games.slice(0, 5).map((g) => `
    <li class="h2h__row">
      <span>${esc(g.atHome ? 'casa' : 'fora')} vs ${esc(g.opponent)}</span>
      <span class="num">${g.scored}–${g.conceded}</span>
    </li>`).join('');

  return `
  <div class="team">
    <div class="team__head">
      <strong>${esc(team.name)}</strong>
      <span class="detail__note">${esc(venue)}${team.elo ? ` · Elo ${team.elo}` : ''}</span>
    </div>

    <div class="team__form">${chips}</div>

    ${split ? `
      <p class="detail__note">
        ${esc(venue === 'em casa' ? 'Em casa' : 'Fora')}, em ${split.played} jogos:
        marca <strong class="num">${split.scoredAvg.toFixed(2)}</strong> e
        sofre <strong class="num">${split.concededAvg.toFixed(2)}</strong> golos por jogo.
      </p>` : ''}

    ${recent ? `<ul class="h2h" style="margin-top:8px">${recent}</ul>` : ''}

    ${team.absences?.length ? `
      <p class="detail__note">
        <strong>Ausencias:</strong>
        ${team.absences.map((a) => esc(`${a.player}${a.position ? ` (${a.position})` : ''}`)).join(', ')}.
      </p>` : ''}
  </div>`;
}

/* ── Confrontos diretos ─────────────────────────────────────────────── */

function h2h(match) {
  const data = match.analysis?.h2h;
  if (!data?.games?.length) return '';

  return `
  <section class="detail__section">
    <h3 class="detail__title">Confrontos diretos</h3>
    <ul class="h2h">
      ${data.games.map((g) => `
        <li class="h2h__row">
          <span>${esc(g.home)} <strong class="num">${esc(g.score)}</strong> ${esc(g.away)}</span>
          <span class="detail__note num">${new Date(g.date).toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })}</span>
        </li>`).join('')}
    </ul>
    <p class="detail__note">
      Media de <strong class="num">${data.avgGoals.toFixed(2)}</strong> golos por jogo;
      as duas marcaram em ${data.bothScoredCount} de ${data.played}.
    </p>
  </section>`;
}

/* ── Noticias ───────────────────────────────────────────────────────── */

/**
 * Titulos em bruto, sem interpretacao. E onde aparece o que nenhuma tabela
 * mostra: treinador de saida, plantel em conflito, um titular com problemas
 * pessoais. O utilizador le e tira as suas conclusoes.
 */
function news(match) {
  const n = match.analysis?.news;
  const total = (n?.home?.length ?? 0) + (n?.away?.length ?? 0);
  if (total === 0) return '';

  const block = (team, items) => (items?.length ? `
    <h4 class="detail__subtitle">${esc(team)}</h4>
    <ul class="news">
      ${items.slice(0, 6).map((item) => `
        <li class="news__item">
          <p class="news__title">${esc(item.title)}</p>
          ${item.source ? `<p class="news__meta">${esc(item.source)}</p>` : ''}
        </li>`).join('')}
    </ul>` : '');

  return `
  <section class="detail__section">
    <h3 class="detail__title">Noticias recentes</h3>
    <p class="detail__note" style="margin-top:0">
      Titulos dos ultimos dias sobre cada equipa, tal como sairam. Nao passaram por
      nenhum filtro — servem para veres o contexto que os numeros nao apanham.
    </p>
    ${block(match.home, n.home)}
    ${block(match.away, n.away)}
  </section>`;
}

/* ── Contexto ───────────────────────────────────────────────────────── */

function context(match) {
  const c = match.analysis?.context;
  const ai = match.analysis?.ai;
  const factors = [...(c?.home ?? []), ...(c?.away ?? [])].filter((f) => f.detail);

  const aiNotes = ai
    ? [ai.home, ai.away].filter((s) => s && !/sem sinais relevantes/i.test(s))
    : [];

  if (factors.length === 0 && aiNotes.length === 0 && !(ai?.signals?.length)) return '';

  return `
  <section class="detail__section">
    <h3 class="detail__title">O que o modelo teve em conta</h3>
    ${factors.map((f) => `<p class="detail__prose">${esc(f.detail)}</p>`).join('')}
    ${aiNotes.map((s) => `<p class="detail__prose">${esc(s)}</p>`).join('')}
    ${(ai?.signals ?? []).map((s) => `<p class="detail__note">• ${esc(s)}</p>`).join('')}
  </section>`;
}

/* ── Qualidade dos dados ────────────────────────────────────────────── */

function quality(match) {
  const q = match.analysis?.dataQuality ?? 0;
  const sample = match.analysis?.sampleMatches ?? 0;

  const level = q >= 0.75 ? 'boa' : q >= 0.5 ? 'razoavel' : 'fraca';
  const warnings = [];

  if (sample < 8) {
    warnings.push(`Amostra curta: ${sample} jogos para a equipa com menos dados. `
      + 'Estimativas com poucos jogos sao instaveis.');
  }
  if (q < 0.5) {
    warnings.push('Faltam dados a esta analise — trata as probabilidades como indicativas.');
  }
  if (match.verdict?.strength === 'aberto') {
    warnings.push('Nenhum resultado se destaca neste jogo. O modelo nao tem opiniao forte.');
  }

  return `
  <section class="detail__section detail__section--risk">
    <h3 class="detail__title">Fiabilidade desta analise</h3>
    <p class="detail__prose">
      Qualidade dos dados: <strong>${esc(level)}</strong> (${Math.round(q * 100)}%),
      com ${sample} jogos de historico na equipa com menos amostra.
    </p>
    ${warnings.map((w) => `<p class="detail__prose">${esc(w)}</p>`).join('')}
    <p class="detail__note">
      Nenhum modelo preve resultados desportivos com certeza. Estas probabilidades sao
      estimativas, e uma probabilidade de 70% falha 3 vezes em cada 10.
    </p>
  </section>`;
}
