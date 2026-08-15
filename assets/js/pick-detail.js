import {
  esc, fmtKickoff, fmtMoney, fmtOdds, fmtPct, fmtSigned,
} from './util.js';
import { MARKET_LABEL } from './components.js';

/**
 * A analise completa de uma aposta.
 *
 * A ordem das seccoes segue as perguntas que alguem faz antes de apostar,
 * pela ordem em que as faz: o que e que estou a apostar, o que tem de
 * acontecer, quanto ganho, porque e que o modelo acha isto, que dados
 * sustentam essa conclusao, e o que pode correr mal.
 *
 * O "o que pode correr mal" nao e opcional. Um servico que so mostra o
 * lado bom nao merece confianca, e a probabilidade de perder e sempre a
 * parte maior da historia.
 */
export function pickDetail(pick, { bankroll = 100, tracked = false } = {}) {
  const settled = Boolean(pick.settled && pick.result);
  const stakeMoney = (pick.stake ?? 0) * bankroll;

  return `
<article class="detail">
  ${matchHeader(pick)}
  ${betSummary(pick)}
  ${settled ? outcomeBlock(pick, stakeMoney) : conditions(pick)}
  ${settled ? '' : money(pick, stakeMoney, tracked)}
  ${reasoning(pick)}
  ${numbers(pick)}
  ${teams(pick)}
  ${headToHead(pick)}
  ${market(pick)}
  ${risk(pick)}
</article>`;
}

/* ── Cabecalho ──────────────────────────────────────────────────────── */

function matchHeader(pick) {
  return `
  <header class="detail__head">
    <p class="detail__league">${esc(pick.league)}</p>
    <h2 class="detail__match">${esc(pick.home)} <span>vs</span> ${esc(pick.away)}</h2>
    <p class="detail__when num">${esc(fmtKickoff(pick.kickoff))}</p>
  </header>`;
}

function betSummary(pick) {
  return `
  <section class="detail__hero">
    <div>
      <p class="detail__label">A aposta</p>
      <p class="detail__bet">${esc(pick.description)}</p>
      <p class="detail__market">${esc(MARKET_LABEL[pick.market] ?? pick.market)} · ${esc(pick.bookmaker ?? 'betclic')}</p>
    </div>
    <div class="detail__odds">
      <span class="odds__value">${esc(fmtOdds(pick.odds))}</span>
      <span class="odds__book">odd</span>
    </div>
  </section>`;
}

/* ── O que tem de acontecer ─────────────────────────────────────────── */

function conditions(pick) {
  if (!pick.winCondition) return '';
  return `
  <section class="detail__section">
    <h3 class="detail__title">O que tem de acontecer</h3>
    <div class="cond cond--win">
      <span class="cond__tag">Ganhas</span>
      <p>${esc(pick.winCondition.wins)}</p>
    </div>
    <div class="cond cond--loss">
      <span class="cond__tag">Perdes</span>
      <p>${esc(pick.winCondition.loses)}</p>
    </div>
  </section>`;
}

function outcomeBlock(pick, stakeMoney) {
  const pnl = pick.pnlUnits ?? 0;
  const tone = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  return `
  <section class="detail__section">
    <h3 class="detail__title">Como acabou</h3>
    <div class="cond cond--${pick.result === 'win' ? 'win' : pick.result === 'loss' ? 'loss' : 'flat'}">
      <span class="cond__tag">${pick.result === 'win' ? 'Ganhou' : pick.result === 'loss' ? 'Perdeu' : 'Anulada'}</span>
      <p>
        Resultado final <strong>${esc(pick.finalScore ?? '—')}</strong>.
        Retorno de <strong class="pnl pnl--${tone}">${pnl >= 0 ? '+' : ''}${(pnl * 100).toFixed(2)}%</strong> da banca
        ${stakeMoney > 0 ? `(${esc(fmtMoney(pnl * (stakeMoney / (pick.stake || 1))))} numa banca de ${esc(fmtMoney(stakeMoney / (pick.stake || 1)))})` : ''}.
      </p>
    </div>
  </section>`;
}

/* ── O dinheiro ─────────────────────────────────────────────────────── */

function money(pick, stakeMoney, tracked) {
  const returnMoney = stakeMoney * pick.odds;
  const profit = returnMoney - stakeMoney;

  return `
  <section class="detail__section">
    <h3 class="detail__title">Quanto apostar</h3>
    <div class="money">
      <div class="money__row">
        <span>Stake sugerida</span>
        <strong class="num">${esc(fmtMoney(stakeMoney))}</strong>
      </div>
      <div class="money__row">
        <span>Se ganhar, recebes</span>
        <strong class="num" style="color:var(--win)">${esc(fmtMoney(returnMoney))}</strong>
      </div>
      <div class="money__row">
        <span>Lucro</span>
        <strong class="num" style="color:var(--win)">+${esc(fmtMoney(profit))}</strong>
      </div>
      <div class="money__row">
        <span>Se perder</span>
        <strong class="num" style="color:var(--loss)">-${esc(fmtMoney(stakeMoney))}</strong>
      </div>
    </div>
    <p class="detail__note">
      ${esc(fmtPct(pick.stake, 2))} da tua banca. O valor sai do criterio de Kelly a
      um quarto, reduzido ainda pela confianca — quanto menos certeza, menos dinheiro.
    </p>
    <button type="button" class="btn btn--block" data-action="track"
            data-pick-id="${esc(pick.id)}"${tracked ? ' disabled' : ''}>
      ${tracked ? 'Ja registada' : 'Registar esta aposta'}
    </button>
  </section>`;
}

/* ── O raciocinio ───────────────────────────────────────────────────── */

function reasoning(pick) {
  if (!pick.narrative?.length) return '';
  return `
  <section class="detail__section">
    <h3 class="detail__title">Porque esta aposta</h3>
    ${pick.narrative.map((p) => `<p class="detail__prose">${esc(p)}</p>`).join('')}
  </section>`;
}

/* ── Os numeros ─────────────────────────────────────────────────────── */

function numbers(pick) {
  if (!pick.lambdas) return '';

  const total = pick.lambdas.home + pick.lambdas.away;
  const peak = Math.max(pick.lambdas.home, pick.lambdas.away, 1);

  const xgBar = (name, value) => `
    <div class="xgbar">
      <div class="xgbar__head">
        <span>${esc(name)}</span>
        <strong class="num">${value.toFixed(2)}</strong>
      </div>
      <div class="bar__track">
        <span class="bar__fill" style="width:${(value / peak) * 100}%"></span>
      </div>
    </div>`;

  return `
  <section class="detail__section">
    <h3 class="detail__title">Golos esperados</h3>
    <p class="detail__note" style="margin-top:0">
      Quantos golos o modelo espera de cada equipa neste jogo. Total: <strong class="num">${total.toFixed(2)}</strong>.
    </p>
    ${xgBar(pick.home, pick.lambdas.home)}
    ${xgBar(pick.away, pick.lambdas.away)}

    ${goalsChart(pick.goalsDistribution)}
    ${scorelines(pick.scorelines)}
  </section>`;
}

function goalsChart(distribution) {
  if (!distribution?.length) return '';
  const peak = Math.max(...distribution.map((d) => d.p), 0.01);

  const bars = distribution.map((d) => `
    <div class="hist__col">
      <div class="hist__bar" style="height:${Math.max(3, (d.p / peak) * 100)}%"
           role="img" aria-label="${d.label} golos: ${Math.round(d.p * 100)} por cento"></div>
      <span class="hist__pct num">${Math.round(d.p * 100)}</span>
      <span class="hist__label num">${esc(d.label)}</span>
    </div>`).join('');

  return `
    <h4 class="detail__subtitle">Probabilidade por total de golos</h4>
    <div class="hist">${bars}</div>
    <p class="detail__note">Percentagem de o jogo terminar com esse numero de golos, somando as duas equipas.</p>`;
}

function scorelines(list) {
  if (!list?.length) return '';
  const items = list.map((s) => `
    <li class="scoreline">
      <span class="scoreline__score num">${esc(s.score)}</span>
      <span class="scoreline__pct num">${(s.p * 100).toFixed(1)}%</span>
    </li>`).join('');

  return `
    <h4 class="detail__subtitle">Resultados mais provaveis</h4>
    <ul class="scorelines">${items}</ul>`;
}

/* ── As equipas ─────────────────────────────────────────────────────── */

function teams(pick) {
  if (!pick.teams) return '';
  return `
  <section class="detail__section">
    <h3 class="detail__title">As equipas</h3>
    ${teamBlock(pick.teams.home, 'em casa')}
    ${teamBlock(pick.teams.away, 'fora')}
  </section>`;
}

function teamBlock(team, venue) {
  if (!team) return '';
  const form = team.form;
  const split = venue === 'em casa' ? team.split?.home : team.split?.away;

  const streak = form?.games?.length
    // Do mais antigo para o mais recente: le-se como uma linha do tempo.
    ? [...form.games].reverse().map((g) => `
        <span class="form-chip form-chip--${g.result.toLowerCase()}"
              title="${esc(g.atHome ? 'casa' : 'fora')} vs ${esc(g.opponent)}: ${g.scored}-${g.conceded}">
          ${g.result === 'W' ? 'V' : g.result === 'D' ? 'E' : 'D'}
        </span>`).join('')
    : '<span class="detail__note">sem jogos registados</span>';

  return `
  <div class="team">
    <div class="team__head">
      <strong>${esc(team.name)}</strong>
      <span class="detail__note">${esc(venue)}${team.elo ? ` · Elo ${team.elo}` : ''}</span>
    </div>

    <div class="team__form">${streak}</div>

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

/* ── Confrontos diretos ─────────────────────────────────────────────── */

function headToHead(pick) {
  if (!pick.h2h?.games?.length) return '';

  const rows = pick.h2h.games.map((g) => `
    <li class="h2h__row">
      <span>${esc(g.home)} <strong class="num">${esc(g.score)}</strong> ${esc(g.away)}</span>
      <span class="detail__note num">${new Date(g.date).toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })}</span>
    </li>`).join('');

  return `
  <section class="detail__section">
    <h3 class="detail__title">Confrontos diretos</h3>
    <ul class="h2h">${rows}</ul>
    <p class="detail__note">
      Media de <strong class="num">${pick.h2h.avgGoals.toFixed(2)}</strong> golos por jogo;
      as duas marcaram em ${pick.h2h.bothScoredCount} de ${pick.h2h.played}.
    </p>
  </section>`;
}

/* ── O mercado ──────────────────────────────────────────────────────── */

/**
 * Onde esta a vantagem, em imagem. Tres leituras da mesma probabilidade:
 * o que a odd implica, o que implicaria sem a margem da casa, e o que o
 * modelo calcula. A distancia entre a segunda e a terceira e a aposta.
 */
function market(pick) {
  const rows = [
    { label: 'A odd da Betclic implica', value: pick.impliedProb, tone: 'muted' },
    { label: 'Preco justo, sem a margem', value: pick.fairProb, tone: 'muted' },
    { label: 'O modelo calcula', value: pick.modelProb, tone: 'accent' },
  ];

  const bars = rows.map((r) => `
    <div class="cmp">
      <div class="cmp__head">
        <span>${esc(r.label)}</span>
        <strong class="num">${esc(fmtPct(r.value, 0))}</strong>
      </div>
      <div class="bar__track">
        <span class="bar__fill${r.tone === 'muted' ? ' bar__fill--muted' : ''}"
              style="width:${(r.value ?? 0) * 100}%"></span>
      </div>
    </div>`).join('');

  return `
  <section class="detail__section">
    <h3 class="detail__title">Onde esta a vantagem</h3>
    ${bars}
    <p class="detail__note">
      A margem da casa neste mercado e de ${esc(fmtPct(pick.overround ?? 0, 1))} — e o que a Betclic
      cobra por aceitar a aposta. Depois de a retirar, sobra o preco justo. A aposta so existe
      porque o modelo esta <strong>${esc(fmtSigned(pick.edge))}</strong> acima desse preco.
    </p>
  </section>`;
}

/* ── O risco ────────────────────────────────────────────────────────── */

function risk(pick) {
  if (!pick.caveats?.length) return '';
  return `
  <section class="detail__section detail__section--risk">
    <h3 class="detail__title">O que pode correr mal</h3>
    ${pick.caveats.map((c) => `<p class="detail__prose">${esc(c)}</p>`).join('')}
  </section>`;
}
