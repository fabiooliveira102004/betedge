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
        <span class="detail__note">${esc(m.hint)}</span>
      </div>
      ${m.selections.map(selectionBlock).join('')}
    </div>`).join('');

  return `
  <section class="detail__section">
    <h3 class="detail__title">Cada opcao, ao preco da casa</h3>

    <!-- A explicacao vem antes do quadro e nao usa jargao. Sem ela, "odd",
         "modelo" e "diferenca" sao tres numeros sem significado para quem
         nunca comparou um preco com uma probabilidade. -->
    <div class="explainer">
      <p><strong>Uma odd e uma probabilidade disfarcada.</strong>
      Uma odd de 2.00 quer dizer que a casa conta com aquilo a acontecer
      1 vez em 2 — ou seja, 50%. Uma odd de 4.00 quer dizer 1 vez em 4, 25%.</p>
      <p>Em baixo esta essa percentagem ao lado da que o modelo calcula.
      Se o modelo da <strong>mais</strong> hipoteses do que o preco sugere, a odd
      esta generosa. Se da <strong>menos</strong>, esta cara.</p>
    </div>

    ${blocks}
  </section>`;
}

/**
 * Uma opcao de aposta, em duas linhas: o que e e quanto paga; depois a
 * comparacao entre as duas leituras da mesma coisa.
 */
function selectionBlock(s) {
  const edge = s.edge ?? 0;

  const verdict = s.isValue ? { label: 'generosa', tone: 'value' }
    : edge < -0.04 ? { label: 'cara', tone: 'neg' }
      : { label: 'justa', tone: 'flat' };

  // A odd de referencia pode nao ser da Betclic: ela nao cota todos os
  // mercados. Dizer de que casa e evita que o utilizador va procurar na
  // Betclic um preco que nao existe la.
  const isBetclic = s.oddsBook === 'betclic_fr' || s.oddsBook === 'betclic';
  const bookNote = isBetclic ? 'Betclic' : `melhor: ${s.oddsBook ?? 'mercado'}`;

  const better = s.betclicOdds && s.bestOdds && s.bestOdds > s.betclicOdds * 1.02
    ? `Ha ${s.bestOdds.toFixed(2)} noutra casa (${esc(s.bestBook)}).`
    : '';

  return `
    <div class="sel sel--${verdict.tone}">
      <div class="sel__top">
        <span class="sel__label">${esc(s.label)}</span>
        <span class="sel__odds">
          <b class="num">${s.odds.toFixed(2)}</b>
          <small>${esc(bookNote)}</small>
        </span>
      </div>

      <div class="sel__compare">
        <span class="sel__side">
          <i>A casa da</i>
          <b class="num">${esc(fmtPct(s.fairProb, 0))}</b>
        </span>
        <span class="sel__arrow" aria-hidden="true">vs</span>
        <span class="sel__side sel__side--model">
          <i>O modelo da</i>
          <b class="num">${s.modelProb == null ? '—' : esc(fmtPct(s.modelProb, 0))}</b>
        </span>
        <span class="verdict-chip verdict-chip--${verdict.tone}">${verdict.label}</span>
      </div>

      ${better ? `<p class="sel__note">${better}</p>` : ''}
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

const RESULT = {
  W: { letter: 'V', word: 'Vitoria', cls: 'w' },
  D: { letter: 'E', word: 'Empate', cls: 'd' },
  L: { letter: 'D', word: 'Derrota', cls: 'l' },
};

function teamBlock(team, venue) {
  if (!team) return '';
  const split = venue === 'em casa' ? team.split?.home : team.split?.away;
  const form = team.form;
  const games = form?.games ?? [];

  return `
  <div class="team">
    <div class="team__head">
      <strong>${esc(team.name)}</strong>
      <span class="detail__note">${esc(venue)}${team.elo ? ` · Elo ${team.elo}` : ''}</span>
    </div>

    ${games.length ? `
      <p class="team__record">
        <span class="rec rec--w">${form.wins}<i>V</i></span>
        <span class="rec rec--d">${form.draws}<i>E</i></span>
        <span class="rec rec--l">${form.losses}<i>D</i></span>
        <span class="detail__note">nos ultimos ${form.played} jogos</span>
      </p>

      <!-- Cada jogo numa linha propria, com a inicial do resultado e a cor.
           Antes eram so quadradinhos coloridos: nao se percebia contra quem,
           nem em que resultado, nem sequer qual tinha sido ganho. -->
      <ul class="games">
        ${games.map(gameRow).join('')}
      </ul>` : '<p class="detail__note">Sem jogos anteriores registados.</p>'}

    ${split ? `
      <p class="detail__note">
        ${esc(venue === 'em casa' ? 'Em casa' : 'Fora')}, em ${split.played} jogos:
        marca <strong class="num">${split.scoredAvg.toFixed(2)}</strong> e
        sofre <strong class="num">${split.concededAvg.toFixed(2)}</strong> golos por jogo.
      </p>` : ''}

    ${team.absences?.length ? `
      <p class="detail__note">
        <strong>Ausencias:</strong>
        ${team.absences.map((a) => esc(`${a.player}${a.position ? ` (${a.position})` : ''}`)).join(', ')}.
      </p>` : ''}
  </div>`;
}

function gameRow(g) {
  const r = RESULT[g.result] ?? RESULT.D;
  const date = new Date(g.date).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });

  return `
    <li class="game game--${r.cls}">
      <span class="game__badge" aria-hidden="true">${r.letter}</span>
      <span class="game__info">
        <span class="game__opponent">${esc(g.opponent)}</span>
        <span class="game__venue">${g.atHome ? 'em casa' : 'fora'} · ${esc(date)}</span>
      </span>
      <span class="game__score num">
        <span class="sr-only">${r.word}, </span>${g.scored}–${g.conceded}
      </span>
    </li>`;
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
