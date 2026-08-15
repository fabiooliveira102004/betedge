import { $, esc, fmtKickoff, fmtMoney, fmtOdds, fmtPct, initials, render } from './util.js';
import { emptyState } from './ui.js';
import { currentUser, isAuthed } from './api.js';
import { supabaseReady } from './config.js';
import { state } from './state.js';

const BET_STATUS = {
  open: { label: 'Por resolver', cls: 'open' },
  win: { label: 'Ganhou', cls: 'win' },
  loss: { label: 'Perdeu', cls: 'loss' },
  push: { label: 'Anulada', cls: 'push' },
  void: { label: 'Anulada', cls: 'push' },
  cancelled: { label: 'Cancelada', cls: 'push' },
};

export function renderProfile() {
  const host = $('#profile-body');
  const meta = $('#profile-meta');
  const user = currentUser();

  meta.textContent = isAuthed()
    ? esc(user?.email ?? 'sessao iniciada')
    : supabaseReady() ? 'Sem sessao iniciada' : 'Modo local, so neste dispositivo';

  render(host, [
    isAuthed() ? accountCard(user) : authCard(),
    bankrollCard(),
    filtersCard(),
    myBetsCard(),
    aboutCard(),
    responsibleGambling(),
  ].join(''));

  updateAvatar();
}

/* ── Conta ──────────────────────────────────────────────────────────── */

function accountCard(user) {
  const perf = performance();

  return `
  <section class="card">
    <div class="row-between">
      <div>
        <h2 class="card__title">${esc(user?.user_metadata?.display_name ?? 'A tua conta')}</h2>
        <p class="card__sub" style="margin:2px 0 0">${esc(user?.email ?? '')}</p>
      </div>
      <button type="button" class="btn btn--danger btn--sm" data-action="sign-out">Sair</button>
    </div>
    ${perf ? `
      <div class="tiles" style="margin-top:16px">
        <div class="tile">
          <span class="tile__label">Apostas registadas</span>
          <span class="tile__value">${perf.total}</span>
          <span class="tile__hint">${perf.open} por resolver</span>
        </div>
        <div class="tile">
          <span class="tile__label">Resultado</span>
          <span class="tile__value" style="color:${perf.profit >= 0 ? 'var(--win)' : 'var(--loss)'}">
            ${perf.profit >= 0 ? '+' : ''}${esc(fmtMoney(perf.profit))}
          </span>
          <span class="tile__hint">${perf.wins}V · ${perf.losses}D</span>
        </div>
      </div>` : ''}
  </section>`;
}

function authCard() {
  if (!supabaseReady()) {
    return `
    <section class="card">
      <h2 class="card__title">Modo local</h2>
      <p class="card__sub" style="margin-bottom:0">
        A base de dados ainda nao esta ligada, por isso a banca e as apostas que registares
        ficam guardadas so neste telemovel. Para teres conta e sincronizacao entre
        dispositivos, preenche as chaves do Supabase em
        <code>assets/js/config.js</code> — as instrucoes estao no README.
      </p>
    </section>`;
  }

  return `
  <section class="card">
    <h2 class="card__title">Entrar</h2>
    <p class="card__sub">
      Com conta, a tua banca, filtros e apostas registadas seguem-te em qualquer dispositivo.
    </p>

    <div class="segmented" style="margin-bottom:16px">
      <button type="button" class="segmented__item is-active" data-auth-mode="signin" aria-pressed="true">Entrar</button>
      <button type="button" class="segmented__item" data-auth-mode="signup" aria-pressed="false">Criar conta</button>
    </div>

    <form class="form" id="auth-form" novalidate>
      <div class="field" id="name-field" hidden>
        <label class="field__label" for="auth-name">Nome</label>
        <input class="input" id="auth-name" name="displayName" type="text"
               autocomplete="nickname" placeholder="Como queres ser tratado">
      </div>

      <div class="field">
        <label class="field__label" for="auth-email">Email</label>
        <input class="input" id="auth-email" name="email" type="email" required
               autocomplete="email" inputmode="email" placeholder="tu@exemplo.pt">
      </div>

      <div class="field">
        <label class="field__label" for="auth-password">Palavra-passe</label>
        <input class="input" id="auth-password" name="password" type="password" required
               minlength="6" autocomplete="current-password" placeholder="minimo 6 caracteres">
      </div>

      <p class="form__error" id="auth-error" hidden></p>

      <button type="submit" class="btn btn--block" id="auth-submit">Entrar</button>
      <button type="button" class="link-btn" data-action="reset-password"
              style="align-self:center">Esqueci-me da palavra-passe</button>
    </form>
  </section>`;
}

/* ── Banca ──────────────────────────────────────────────────────────── */

function bankrollCard() {
  const bankroll = Number(state.profile?.bankroll) || 100;
  const maxStake = Number(state.profile?.max_stake_pct ?? 0.03);

  return `
  <section class="card">
    <h2 class="card__title">Banca</h2>
    <p class="card__sub">
      As stakes sugeridas sao uma fracao desta quantia, calculada por Kelly fracionado.
      Nunca passam de ${esc(fmtPct(maxStake, 1))} — ${esc(fmtMoney(bankroll * maxStake))} — numa unica aposta.
    </p>

    <form class="form" id="bankroll-form">
      <div class="field">
        <label class="field__label" for="bankroll-input">Valor total (EUR)</label>
        <input class="input" id="bankroll-input" name="bankroll" type="number"
               min="1" max="1000000" step="0.01" value="${bankroll}" inputmode="decimal" required>
        <p class="field__hint">
          Define o valor que separaste para apostar, nao o teu saldo total.
        </p>
      </div>
      <button type="submit" class="btn btn--ghost btn--sm" style="align-self:flex-start">Guardar</button>
    </form>
  </section>`;
}

/* ── Filtros pessoais ───────────────────────────────────────────────── */

function filtersCard() {
  const minEdge = Number(state.profile?.min_edge ?? 0.04);
  const minConfidence = Number(state.profile?.min_confidence ?? 0.35);

  return `
  <section class="card">
    <h2 class="card__title">Exigencia</h2>
    <p class="card__sub">
      O motor publica tudo o que tem vantagem. Aqui decides onde fica a tua fasquia —
      mais alto significa menos apostas, mas melhores.
    </p>

    <form class="form" id="filters-form">
      <div class="field">
        <label class="field__label" for="min-edge">
          Vantagem minima · <span class="num" id="min-edge-out">${esc(fmtPct(minEdge, 1))}</span>
        </label>
        <input type="range" id="min-edge" name="minEdge"
               min="0" max="0.15" step="0.005" value="${minEdge}">
        <p class="field__hint">Quanto o modelo tem de estar acima do preco justo da Betclic.</p>
      </div>

      <div class="field">
        <label class="field__label" for="min-conf">
          Confianca minima · <span class="num" id="min-conf-out">${esc(fmtPct(minConfidence, 0))}</span>
        </label>
        <input type="range" id="min-conf" name="minConfidence"
               min="0" max="0.9" step="0.05" value="${minConfidence}">
        <p class="field__hint">Quanta informacao o modelo teve para sustentar a estimativa.</p>
      </div>

      <button type="submit" class="btn btn--ghost btn--sm" style="align-self:flex-start">Guardar</button>
    </form>
  </section>`;
}

/* ── Apostas registadas ─────────────────────────────────────────────── */

function myBetsCard() {
  if (state.bets.length === 0) {
    return `
    <section class="card">
      <h2 class="card__title">As tuas apostas</h2>
      ${emptyState({
    icon: 'inbox',
    title: 'Nada registado ainda',
    text: 'Quando fizeres uma aposta na Betclic, regista-a aqui para acompanhares o resultado.',
  })}
    </section>`;
  }

  const rows = state.bets.slice(0, 20).map((bet) => {
    const snap = bet.snapshot ?? {};
    const status = BET_STATUS[bet.status] ?? BET_STATUS.open;
    const profit = bet.status === 'open' ? null
      : (Number(bet.payout) || 0) - Number(bet.stake_amount);

    return `
    <div class="row-between">
      <div style="min-width:0">
        <p style="font-size:13.5px;font-weight:600">${esc(snap.description ?? 'Aposta')}</p>
        <p class="bar__meta" style="margin-top:2px">
          ${esc(snap.home ?? '')} vs ${esc(snap.away ?? '')}
          ${snap.kickoff ? ` · ${esc(fmtKickoff(snap.kickoff))}` : ''}
        </p>
        <p class="bar__meta" style="margin-top:2px">
          ${esc(fmtMoney(bet.stake_amount))} @ ${esc(fmtOdds(bet.odds_taken))}
        </p>
      </div>
      <div style="text-align:end;flex:0 0 auto">
        <span class="result-tag result-tag--${status.cls}">${esc(status.label)}</span>
        ${profit !== null ? `
          <p class="pnl pnl--${profit > 0 ? 'pos' : profit < 0 ? 'neg' : 'flat'}" style="margin-top:5px">
            ${profit >= 0 ? '+' : ''}${esc(fmtMoney(profit))}
          </p>` : `
          <button type="button" class="link-btn" style="margin-top:6px"
                  data-action="untrack" data-bet-id="${esc(bet.id)}">remover</button>`}
      </div>
    </div>`;
  }).join('');

  return `
  <section class="card">
    <h2 class="card__title">As tuas apostas</h2>
    <p class="card__sub">${state.bets.length} registadas</p>
    ${rows}
  </section>`;
}

/* ── Sobre ──────────────────────────────────────────────────────────── */

function aboutCard() {
  const m = state.meta;
  const source = (label, value) => `
    <div class="row-between">
      <span class="bar__meta">${esc(label)}</span>
      <span style="font-size:13px">${esc(value ?? 'nao configurado')}</span>
    </div>`;

  return `
  <section class="card">
    <h2 class="card__title">Como funciona</h2>
    <p class="card__sub">
      As probabilidades saem de um modelo Dixon-Coles alimentado por ratings Elo e
      taxas de golos. Depois entram lesoes, dias de descanso e uma leitura de
      noticias que procura o que os numeros nao mostram — treinador de saida,
      problemas pessoais de titulares, jogos sem nada em jogo. So e publicada
      aposta quando o resultado fica acima do preco justo da Betclic.
    </p>
    ${source('Cotacoes', m?.sources?.odds)}
    ${source('Dados de jogo', m?.sources?.football)}
    ${source('Contexto', m?.sources?.ai)}
    ${source('Base de dados', m?.sources?.database ?? (supabaseReady() ? 'supabase' : 'local'))}
  </section>`;
}

function responsibleGambling() {
  return `
  <p class="legal">
    <strong>Joga com cabeca.</strong>
    O BetEdge e uma ferramenta de analise, nao uma promessa de lucro. Nenhum modelo
    consegue prever resultados desportivos com certeza, e vantagem estatistica so
    aparece ao fim de muitas apostas — pelo meio ha sequencias mas que aguentar.
    Aposta apenas dinheiro que podes perder, nunca para recuperar perdas anteriores,
    e define limites antes de comecar. Apostas sao proibidas a menores de 18 anos.
    Se sentires que perdeste o controlo, procura ajuda em
    <strong>SICAD — Linha Vida 1414</strong>.
  </p>`;
}

/* ── Auxiliares ─────────────────────────────────────────────────────── */

function performance() {
  if (state.bets.length === 0) return null;

  const closed = state.bets.filter((b) => b.status !== 'open');
  return {
    total: state.bets.length,
    open: state.bets.length - closed.length,
    wins: closed.filter((b) => b.status === 'win').length,
    losses: closed.filter((b) => b.status === 'loss').length,
    profit: closed.reduce(
      (sum, b) => sum + ((Number(b.payout) || 0) - Number(b.stake_amount)),
      0,
    ),
  };
}

export function updateAvatar() {
  const el = $('#avatar-initials');
  if (!el) return;

  const user = currentUser();
  if (user) {
    el.textContent = initials(user.user_metadata?.display_name || user.email);
    el.classList.add('is-authed');
  } else {
    el.textContent = '?';
    el.classList.remove('is-authed');
  }
}
