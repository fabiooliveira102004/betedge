import { APP } from './config.js';
import { $, $$, esc, fmtMoney, fmtOdds, fmtPct } from './util.js';
import { closeSheet, initSheet, initTheme, openSheet, toast } from './ui.js';
import {
  fetchProfile, fetchUserBets, isAuthed, loadPublished, resetPassword,
  saveProfile, settleLocalBets, signIn, signOut, signUp, trackBet, untrackBet,
} from './api.js';
import { setState, state, subscribe } from './state.js';
import { renderPicks } from './views-picks.js';
import { renderHistory } from './views-history.js';
import { renderStats } from './views-stats.js';
import { renderProfile, updateAvatar } from './views-profile.js';

/* ── Arranque ───────────────────────────────────────────────────────── */

/**
 * O arranque vive numa funcao chamada no fim do ficheiro, nao no topo:
 * `const` nao sofre hoisting, por isso codigo de arranque colocado antes
 * das declaracoes rebenta com um ReferenceError na temporal dead zone.
 */
function boot() {
  initTheme();
  initSheet();
  wireNavigation();
  wireGlobalActions();
  wireConnectivity();
  subscribe(renderCurrentView);

  goTo(state.view, { push: false });
  loadEverything();
  registerServiceWorker();
}

async function loadEverything({ silent = false } = {}) {
  if (!silent) setState({ loading: true, error: null });

  try {
    const [picksDoc, historyDoc, statsDoc, metaDoc] = await Promise.all([
      loadPublished('picks', { picks: [] }),
      loadPublished('history', { picks: [] }),
      loadPublished('stats', null),
      loadPublished('meta', null),
    ]);

    const history = historyDoc.picks ?? [];

    // O perfil e as apostas do utilizador podem falhar sem levar a app
    // abaixo: as analises sao o essencial, os dados pessoais sao extra.
    const [profile, bets] = await Promise.all([
      fetchProfile().catch(() => null),
      fetchUserBets().catch(() => []),
    ]);

    setState({
      picks: picksDoc.picks ?? [],
      history,
      stats: statsDoc,
      meta: metaDoc,
      profile,
      // Sem Supabase a liquidacao das apostas seguidas tem de ser feita
      // no cliente, comparando com o historico publicado.
      bets: isAuthed() ? bets : settleLocalBets(history),
      loading: false,
      error: null,
    });

    $('#demo-banner').hidden = !metaDoc?.demo;
  } catch (err) {
    setState({ loading: false, error: err.message || 'Falha ao carregar os dados.' });
  }
}

/* ── Navegacao ──────────────────────────────────────────────────────── */

const VIEWS = ['picks', 'history', 'stats', 'profile'];

function wireNavigation() {
  for (const tab of $$('.tabbar__item')) {
    tab.addEventListener('click', () => goTo(tab.dataset.view));
  }

  addEventListener('hashchange', () => {
    const view = location.hash.slice(1);
    if (VIEWS.includes(view) && view !== state.view) goTo(view, { push: false });
  });

  const initial = location.hash.slice(1);
  if (VIEWS.includes(initial)) state.view = initial;
}

function goTo(view, { push = true } = {}) {
  if (!VIEWS.includes(view)) return;

  setState({ view });
  if (push) history.replaceState(null, '', `#${view}`);

  for (const tab of $$('.tabbar__item')) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const section of $$('.view')) {
    section.hidden = section.id !== `view-${view}`;
  }

  // Cada troca de separador volta ao topo — a posicao de scroll da vista
  // anterior nao significa nada na nova.
  scrollTo({ top: 0, behavior: 'instant' });
  $('#main').focus({ preventScroll: true });
}

function renderCurrentView() {
  switch (state.view) {
    case 'picks': renderPicks(); break;
    case 'history': renderHistory(); break;
    case 'stats': renderStats(); break;
    case 'profile': renderProfile(); break;
  }
  updateAvatar();
}

/* ── Acoes ──────────────────────────────────────────────────────────── */

function wireGlobalActions() {
  // Delegacao unica: as vistas sao redesenhadas por completo, por isso
  // ligar handlers a cada cartao criaria fugas a cada render.
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);

  $('#refresh-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.classList.add('is-busy');
    await loadEverything({ silent: true });
    btn.classList.remove('is-busy');
    toast('Dados atualizados', 'ok', 1800);
  });

  $('#account-btn')?.addEventListener('click', () => goTo('profile'));
  $('#edit-bankroll')?.addEventListener('click', () => goTo('profile'));
  $('#history-more')?.addEventListener('click', () => {
    setState({ historyShown: (state.historyShown || APP.historyPageSize) + APP.historyPageSize });
  });
}

async function onClick(event) {
  const why = event.target.closest('.why__toggle');
  if (why) {
    const expanded = why.getAttribute('aria-expanded') === 'true';
    why.setAttribute('aria-expanded', String(!expanded));
    $(`#${CSS.escape(why.getAttribute('aria-controls'))}`).hidden = expanded;
    return;
  }

  const chip = event.target.closest('[data-league]');
  if (chip) {
    setState({ league: chip.dataset.league });
    return;
  }

  const conf = event.target.closest('[data-conf]');
  if (conf) {
    for (const c of $$('[data-conf]')) c.setAttribute('aria-pressed', String(c === conf));
    setState({ sort: conf.dataset.conf });
    return;
  }

  const seg = event.target.closest('[data-result]');
  if (seg) {
    for (const s of $$('[data-result]')) {
      s.classList.toggle('is-active', s === seg);
      s.setAttribute('aria-pressed', String(s === seg));
    }
    setState({ resultFilter: seg.dataset.result, historyShown: APP.historyPageSize });
    return;
  }

  const mode = event.target.closest('[data-auth-mode]');
  if (mode) {
    switchAuthMode(mode.dataset.authMode);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action) await handleAction(action.dataset.action, action);
}

async function handleAction(action, el) {
  switch (action) {
    case 'reload':
      await loadEverything();
      break;

    case 'open-filters':
      goTo('profile');
      break;

    case 'track':
      openStakeSheet(el.dataset.pickId);
      break;

    case 'untrack': {
      const bet = state.bets.find((b) => String(b.id) === el.dataset.betId);
      if (!bet) return;
      try {
        await untrackBet(bet);
        setState({ bets: state.bets.filter((b) => b.id !== bet.id) });
        toast('Aposta removida', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }

    case 'sign-out':
      await signOut();
      setState({ profile: await fetchProfile().catch(() => null), bets: [] });
      toast('Sessao terminada', 'ok');
      break;

    case 'reset-password': {
      const email = $('#auth-email')?.value.trim();
      if (!email) {
        showAuthError('Escreve o teu email primeiro.');
        return;
      }
      try {
        await resetPassword(email);
        toast('Enviamos um link de recuperacao para o teu email.', 'ok', 5000);
      } catch (err) {
        showAuthError(err.message);
      }
      break;
    }
  }
}

/* ── Registar uma aposta ────────────────────────────────────────────── */

function openStakeSheet(pickId) {
  const pick = state.picks.find((p) => p.id === pickId) ?? state.history.find((p) => p.id === pickId);
  if (!pick) return;

  const bankroll = Number(state.profile?.bankroll) || 100;
  const suggested = Math.max(0.5, Math.round(pick.stake * bankroll * 100) / 100);

  openSheet('Registar aposta', `
    <p class="card__sub" style="margin-bottom:14px">
      ${esc(pick.home)} vs ${esc(pick.away)} — <strong>${esc(pick.description)}</strong>
      a ${esc(fmtOdds(pick.odds))} na Betclic.
    </p>

    <form class="form" id="stake-form">
      <div class="field">
        <label class="field__label" for="stake-input">Quanto vais apostar (EUR)</label>
        <!-- step tem de ser 0.01: com 0.1 uma sugestao de 2,65 EUR falha a
             validacao do browser e o formulario nao submete. -->
        <input class="input" id="stake-input" name="stake" type="number"
               min="0.01" step="0.01" value="${suggested}" inputmode="decimal" required>
        <p class="field__hint">
          Sugestao de ${esc(fmtMoney(suggested))}, que e ${esc(fmtPct(pick.stake, 2))} da tua banca —
          o valor que Kelly fracionado indica para uma vantagem de ${esc(fmtPct(pick.edge, 1))}.
        </p>
      </div>

      <div class="row-between">
        <span class="bar__meta">Retorno se ganhar</span>
        <span class="num" id="stake-return" style="font-weight:700">
          ${esc(fmtMoney(suggested * pick.odds))}
        </span>
      </div>

      <button type="submit" class="btn btn--block">Registar</button>
      <p class="field__hint" style="text-align:center">
        Isto so guarda a aposta no teu historico. Nao coloca nada na Betclic por ti.
      </p>
    </form>
  `, {
    onMount(body) {
      const input = body.querySelector('#stake-input');
      const out = body.querySelector('#stake-return');
      input.addEventListener('input', () => {
        out.textContent = fmtMoney((Number(input.value) || 0) * pick.odds);
      });
      body.querySelector('#stake-form').dataset.pickId = pick.id;
    },
  });
}

/* ── Formularios ────────────────────────────────────────────────────── */

async function onSubmit(event) {
  const form = event.target;
  event.preventDefault();

  if (form.id === 'auth-form') return handleAuth(form);
  if (form.id === 'bankroll-form') return handleBankroll(form);
  if (form.id === 'filters-form') return handleFilters(form);
  if (form.id === 'stake-form') return handleStake(form);
}

async function handleAuth(form) {
  const submit = $('#auth-submit');
  const data = Object.fromEntries(new FormData(form));
  const signingUp = form.dataset.mode === 'signup';

  hideAuthError();
  submit.disabled = true;
  submit.textContent = signingUp ? 'A criar conta…' : 'A entrar…';

  try {
    if (signingUp) {
      const { needsConfirmation } = await signUp(data);
      if (needsConfirmation) {
        toast('Conta criada. Confirma o email para entrares.', 'ok', 6000);
        submit.disabled = false;
        submit.textContent = 'Criar conta';
        return;
      }
    } else {
      await signIn(data);
    }

    await loadEverything({ silent: true });
    toast(signingUp ? 'Bem-vindo ao BetEdge' : 'Sessao iniciada', 'ok');
  } catch (err) {
    showAuthError(err.message);
    submit.disabled = false;
    submit.textContent = signingUp ? 'Criar conta' : 'Entrar';
  }
}

async function handleBankroll(form) {
  const bankroll = Number(new FormData(form).get('bankroll'));
  if (!Number.isFinite(bankroll) || bankroll <= 0) {
    toast('Indica um valor valido.', 'error');
    return;
  }

  try {
    const profile = await saveProfile({ bankroll });
    setState({ profile });
    toast(`Banca definida em ${fmtMoney(bankroll)}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleFilters(form) {
  const data = new FormData(form);
  try {
    const profile = await saveProfile({
      min_edge: Number(data.get('minEdge')),
      min_confidence: Number(data.get('minConfidence')),
    });
    setState({ profile });
    toast('Filtros guardados', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleStake(form) {
  const pick = state.picks.find((p) => p.id === form.dataset.pickId);
  const stake = Number(new FormData(form).get('stake'));

  if (!pick || !Number.isFinite(stake) || stake <= 0) {
    toast('Indica um valor valido.', 'error');
    return;
  }

  try {
    const bet = await trackBet(pick, stake);
    setState({ bets: [bet, ...state.bets] });
    closeSheet();
    toast('Aposta registada', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function onInput(event) {
  // Os sliders precisam de mostrar o valor enquanto se arrastam, senao o
  // utilizador esta a escolher as cegas.
  if (event.target.id === 'min-edge') {
    $('#min-edge-out').textContent = fmtPct(event.target.value, 1);
  }
  if (event.target.id === 'min-conf') {
    $('#min-conf-out').textContent = fmtPct(event.target.value, 0);
  }
}

function switchAuthMode(mode) {
  const form = $('#auth-form');
  if (!form) return;

  form.dataset.mode = mode;
  const signingUp = mode === 'signup';

  $('#name-field').hidden = !signingUp;
  $('#auth-password').autocomplete = signingUp ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = signingUp ? 'Criar conta' : 'Entrar';
  hideAuthError();

  for (const btn of $$('[data-auth-mode]')) {
    const active = btn.dataset.authMode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
}

function showAuthError(message) {
  const el = $('#auth-error');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function hideAuthError() {
  const el = $('#auth-error');
  if (el) el.hidden = true;
}

/* ── Conectividade e service worker ─────────────────────────────────── */

function wireConnectivity() {
  const banner = $('#offline-banner');
  const sync = () => {
    banner.hidden = navigator.onLine;
    setState({ offline: !navigator.onLine });
  };
  addEventListener('online', () => { sync(); loadEverything({ silent: true }); });
  addEventListener('offline', sync);
  sync();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Falha a registar apenas significa que a app nao funciona offline.
    });
  });
}

boot();
