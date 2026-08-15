import { APP } from './config.js';

/* ── DOM ────────────────────────────────────────────────────────────── */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Escapa texto antes de o interpolar em HTML.
 *
 * Nomes de equipas, resumos da IA e titulos de noticias vem de fontes
 * externas — passam por aqui sempre, sem excecao.
 */
export function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Substitui o conteudo de um elemento por HTML ja construido. */
export function render(target, html) {
  target.innerHTML = html;
  return target;
}

/* ── Formatacao ─────────────────────────────────────────────────────── */

const money = new Intl.NumberFormat(APP.locale, {
  style: 'currency',
  currency: APP.currency,
  maximumFractionDigits: 2,
});

const dayLong = new Intl.DateTimeFormat(APP.locale, {
  weekday: 'long', day: 'numeric', month: 'long',
});

const timeShort = new Intl.DateTimeFormat(APP.locale, {
  hour: '2-digit', minute: '2-digit',
});

export const fmtMoney = (v) => money.format(Number(v) || 0);

export const fmtOdds = (v) => (Number(v) || 0).toFixed(2);

export function fmtPct(v, digits = 1) {
  const n = (Number(v) || 0) * 100;
  return `${n.toFixed(digits)}%`;
}

export function fmtSigned(v, digits = 1) {
  const n = (Number(v) || 0) * 100;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** "Hoje, 19:00" / "Sabado, 20:30" / "12 de outubro, 18:00" */
export function fmtKickoff(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const days = Math.round((target - today) / 86400000);

  const time = timeShort.format(d);
  if (days === 0) return `Hoje, ${time}`;
  if (days === 1) return `Amanha, ${time}`;
  if (days === -1) return `Ontem, ${time}`;
  if (days > 1 && days < 7) {
    const weekday = new Intl.DateTimeFormat(APP.locale, { weekday: 'long' }).format(d);
    return `${capitalise(weekday)}, ${time}`;
  }
  return `${new Intl.DateTimeFormat(APP.locale, { day: 'numeric', month: 'short' }).format(d)}, ${time}`;
}

/** Cabecalho de agrupamento por dia no historico. */
export function fmtDayHeading(iso) {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const days = Math.round((today - target) / 86400000);

  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return capitalise(dayLong.format(d));
}

/** "ha 3 min" / "ha 2 h" / "ha 4 dias" */
export function fmtAgo(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'agora mesmo';
  if (seconds < 3600) return `ha ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `ha ${Math.floor(seconds / 3600)} h`;
  const days = Math.floor(seconds / 86400);
  return days === 1 ? 'ha 1 dia' : `ha ${days} dias`;
}

export const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* ── Armazenamento local ────────────────────────────────────────────── */

/**
 * localStorage tolerante a falhas. No Safari em navegacao privada, e em
 * iframes com cookies bloqueados, o acesso lanca — a app tem de continuar
 * a funcionar, apenas sem persistir.
 */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(APP.storagePrefix + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(APP.storagePrefix + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(APP.storagePrefix + key);
    } catch { /* sem persistencia disponivel */ }
  },
};

/* ── Diversos ───────────────────────────────────────────────────────── */

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export function initials(name = '') {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
