import { $, $$, esc, store } from './util.js';

/* ── Tema ───────────────────────────────────────────────────────────── */

const THEME_KEY = 'theme';

export function initTheme() {
  const saved = store.get(THEME_KEY);
  const system = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(saved ?? system);

  // Sem escolha explicita do utilizador, seguimos o sistema em tempo real.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (store.get(THEME_KEY) === null) applyTheme(e.matches ? 'light' : 'dark');
  });

  $('#theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set(THEME_KEY, next);
    applyTheme(next);
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const color = theme === 'dark' ? '#08090C' : '#FBFBFD';
  // Sem isto a barra de estado do iOS fica com a cor do tema anterior.
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}

/* ── Toasts ─────────────────────────────────────────────────────────── */

export function toast(message, kind = 'info', ms = 3200) {
  const host = $('#toasts');
  if (!host) return;

  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  host.append(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ── Bottom sheet ───────────────────────────────────────────────────── */

let lastFocused = null;

export function openSheet(title, html, { onMount } = {}) {
  const root = $('#sheet-root');
  lastFocused = document.activeElement;

  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  root.hidden = false;
  document.body.style.overflow = 'hidden';

  onMount?.($('#sheet-body'));

  // Foco no primeiro campo util, para que o teclado abra logo em formularios.
  const focusable = focusableIn(root);
  (focusable.find((el) => el.matches('input, select, textarea')) ?? focusable[0])?.focus();

  document.addEventListener('keydown', onKeydown);
}

export function closeSheet() {
  const root = $('#sheet-root');
  if (root.hidden) return;

  root.hidden = true;
  $('#sheet-body').innerHTML = '';
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKeydown);
  lastFocused?.focus?.();
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    closeSheet();
    return;
  }

  // Prende o foco dentro do sheet: sem isto o Tab leva o utilizador para a
  // pagina por baixo, que esta visualmente tapada.
  if (event.key !== 'Tab') return;

  const items = focusableIn($('#sheet-root'));
  if (items.length === 0) return;

  const first = items[0];
  const last = items[items.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusableIn(root) {
  return $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', root)
    .filter((el) => !el.disabled && el.offsetParent !== null);
}

export function initSheet() {
  $$('[data-close-sheet]').forEach((el) => el.addEventListener('click', closeSheet));
}

/* ── Blocos reutilizaveis ───────────────────────────────────────────── */

export function emptyState({ icon = 'inbox', title, text, action }) {
  const icons = {
    inbox: '<path d="M3 13h5l2 3h4l2-3h5M3 13l3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  };

  return `
    <div class="empty">
      <svg class="empty__icon" viewBox="0 0 24 24" aria-hidden="true">${icons[icon] ?? icons.inbox}</svg>
      <p class="empty__title">${esc(title)}</p>
      <p class="empty__text">${esc(text)}</p>
      ${action ? `<button type="button" class="btn btn--ghost btn--sm" data-action="${esc(action.id)}">${esc(action.label)}</button>` : ''}
    </div>`;
}

export const skeletons = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
