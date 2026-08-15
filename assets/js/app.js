import { APP } from './config.js';
import { $, $$ } from './util.js';
import { initTheme, toast } from './ui.js';
import { fetchProfile, loadPublished, saveProfile } from './api.js';
import { findMatch, setState, state, subscribe } from './state.js';
import { renderMatches } from './views-matches.js';
import { renderResults } from './views-results.js';
import { renderModel } from './views-model.js';
import { renderAbout } from './views-about.js';
import { matchDetail } from './match-detail.js';

/* ── Arranque ───────────────────────────────────────────────────────── */

/**
 * O arranque vive numa funcao chamada no fim do ficheiro: `const` nao sofre
 * hoisting, por isso codigo colocado antes das declaracoes rebenta com um
 * ReferenceError na temporal dead zone.
 */
function boot() {
  initTheme();
  wireNavigation();
  wireActions();
  wireConnectivity();
  subscribe(renderCurrentView);

  loadEverything().then(() => applyRoute({ initial: true }));
  registerServiceWorker();
}

async function loadEverything({ silent = false } = {}) {
  if (!silent) setState({ loading: true, error: null });

  try {
    const [matchesDoc, resultsDoc, statsDoc, metaDoc] = await Promise.all([
      loadPublished('matches', { matches: [] }),
      loadPublished('results', { results: [] }),
      loadPublished('stats', null),
      loadPublished('meta', null),
    ]);

    const profile = await fetchProfile().catch(() => null);

    setState({
      matches: matchesDoc.matches ?? [],
      results: resultsDoc.results ?? [],
      accuracy: resultsDoc.accuracy ?? null,
      stats: statsDoc,
      meta: metaDoc,
      profile,
      loading: false,
      error: null,
    });

    $('#demo-banner').hidden = !metaDoc?.demo;
  } catch (err) {
    setState({ loading: false, error: err.message || 'Falha ao carregar os dados.' });
  }
}

/* ── Navegacao ──────────────────────────────────────────────────────── */

const VIEWS = ['matches', 'results', 'model', 'about'];

function wireNavigation() {
  for (const tab of $$('.tabbar__item')) {
    tab.addEventListener('click', () => goTo(tab.dataset.view));
  }
  addEventListener('hashchange', () => applyRoute());
}

/**
 * O endereco e a fonte da verdade. A analise de um jogo tem endereco proprio
 * (`#match=<id>`) para que o gesto de voltar do telemovel a feche, em vez de
 * sair da app — que e o que acontece quando uma camada modal nao mexe no
 * historico do browser.
 */
function applyRoute({ initial = false } = {}) {
  const hash = decodeURIComponent(location.hash.slice(1));

  if (hash.startsWith('match=')) {
    openMatch(hash.slice(6), { push: false });
    return;
  }

  closeDetail({ pop: false });
  const view = VIEWS.includes(hash) ? hash : state.view;
  if (initial || view !== state.view) goTo(view, { push: false });
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

  scrollTo({ top: 0, behavior: 'instant' });
  $('#main').focus({ preventScroll: true });
}

function renderCurrentView() {
  switch (state.view) {
    case 'matches': renderMatches(); break;
    case 'results': renderResults(); break;
    case 'model': renderModel(); break;
    case 'about': renderAbout(); break;
  }
  if (state.openMatch) renderDetail(state.openMatch);
}

/* ── Analise de um jogo ─────────────────────────────────────────────── */

function openMatch(id, { push = true } = {}) {
  const match = findMatch(id);
  if (!match) {
    // Endereco aberto de raiz antes de os dados chegarem: applyRoute volta
    // a correr quando loadEverything termina.
    if (!state.loading) toast('Jogo nao encontrado.', 'error');
    return;
  }

  state.openMatch = id;
  if (push) location.hash = `match=${encodeURIComponent(id)}`;

  renderDetail(id);
  $('#detail-root').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#detail-body').scrollTop = 0;
  $('#detail-body').focus({ preventScroll: true });
}

function renderDetail(id) {
  const match = findMatch(id);
  if (!match) return;
  $('#detail-bar-title').textContent = match.score ? 'Jogo terminado' : 'Analise do jogo';
  $('#detail-body').innerHTML = matchDetail(match);
}

function closeDetail({ pop = true } = {}) {
  if (!state.openMatch) return;
  state.openMatch = null;
  $('#detail-root').hidden = true;
  $('#detail-body').innerHTML = '';
  document.body.style.overflow = '';
  if (pop) history.back();
}

/* ── Acoes ──────────────────────────────────────────────────────────── */

function wireActions() {
  // Delegacao unica: as vistas sao redesenhadas por completo, por isso
  // ligar handlers a cada cartao criaria fugas a cada render.
  document.addEventListener('click', onClick);

  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.openMatch) closeDetail();
  });

  $('#refresh-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.classList.add('is-busy');
    await loadEverything({ silent: true });
    btn.classList.remove('is-busy');
    toast('Dados atualizados', 'ok', 1800);
  });

  $('#results-more')?.addEventListener('click', () => {
    setState({ resultsShown: (state.resultsShown || APP.historyPageSize) + APP.historyPageSize });
  });
}

async function onClick(event) {
  const league = event.target.closest('[data-league]');
  if (league) {
    setState({ league: league.dataset.league });
    return;
  }

  if (event.target.closest('[data-toggle="value"]')) {
    setState({ onlyValue: !state.onlyValue });
    return;
  }

  const followed = event.target.closest('[data-follow]');
  if (followed) {
    await toggleLeague(followed.dataset.follow);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (!action) return;

  switch (action.dataset.action) {
    case 'reload':
      await loadEverything();
      break;
    case 'open-match':
      openMatch(action.dataset.matchId);
      break;
    case 'close-detail':
      closeDetail();
      break;
    case 'clear-leagues':
      await saveLeagues([]);
      break;
  }
}

async function toggleLeague(name) {
  const current = state.profile?.leagues ?? [];
  await saveLeagues(current.includes(name)
    ? current.filter((l) => l !== name)
    : [...current, name]);
}

async function saveLeagues(leagues) {
  try {
    setState({ profile: await saveProfile({ leagues }) });
  } catch (err) {
    toast(err.message, 'error');
  }
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
