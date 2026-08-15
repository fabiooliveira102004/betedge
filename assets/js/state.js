/**
 * Estado partilhado da app.
 *
 * A unidade central e o *jogo*, nao a aposta. A app existe para perceber o
 * que vem ai e o que o modelo acha de cada opcao — nao para gerir dinheiro.
 * Nao ha banca, nao ha stakes, nao ha apostas registadas.
 */

const listeners = new Set();

export const state = {
  view: 'matches',

  matches: [],
  results: [],
  stats: null,
  accuracy: null,
  meta: null,

  profile: null,

  // Filtros.
  league: 'all',
  onlyValue: false,
  resultsShown: 0,

  openMatch: null,

  loading: true,
  error: null,
  offline: !navigator.onLine,
};

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function visibleMatches() {
  const leagues = state.profile?.leagues ?? [];

  return state.matches.filter((m) => (
    (leagues.length === 0 || leagues.includes(m.league))
    && (state.league === 'all' || m.league === state.league)
    && (!state.onlyValue || m.valueCount > 0)
  ));
}

export function visibleResults() {
  const leagues = state.profile?.leagues ?? [];
  return state.results.filter(
    (r) => (leagues.length === 0 || leagues.includes(r.league))
      && (state.league === 'all' || r.league === state.league),
  );
}

export const findMatch = (id) => state.matches.find((m) => m.id === id)
  ?? state.results.find((r) => r.id === id)
  ?? null;
