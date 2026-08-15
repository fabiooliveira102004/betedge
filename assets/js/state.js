/**
 * Estado partilhado da app.
 *
 * Um objeto simples com subscritores em vez de uma framework: a app tem
 * quatro vistas e um punhado de campos, e uma dependencia de runtime seria
 * mais codigo do que isto.
 */

const listeners = new Set();

export const state = {
  view: 'picks',

  // Analises publicadas pelo motor.
  picks: [],
  history: [],
  stats: null,
  meta: null,

  // Utilizador.
  profile: null,
  bets: [],

  // Filtros da vista de apostas.
  league: 'all',
  sort: 'all',
  resultFilter: 'all',
  historyShown: 0,

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

/** Apostas seguidas indexadas por pick, para saber o que ja foi registado. */
export const trackedPickIds = () => new Set(state.bets.map((b) => b.pick_id));

export const bankroll = () => Number(state.profile?.bankroll) || 100;

/**
 * Aplica os filtros pessoais do perfil e os filtros da vista.
 *
 * Os limites do perfil sao mais restritivos do que os do motor de
 * proposito: o motor publica tudo o que tem valor, o utilizador decide
 * onde e que a fasquia dele fica.
 */
export function visiblePicks() {
  const minEdge = Number(state.profile?.min_edge ?? 0);
  const minConfidence = Number(state.profile?.min_confidence ?? 0);
  const leagues = state.profile?.leagues ?? [];

  let list = state.picks.filter((p) => (
    p.edge >= minEdge
    && p.confidence >= minConfidence
    && (leagues.length === 0 || leagues.includes(p.league))
    && (state.league === 'all' || p.league === state.league)
  ));

  if (state.sort === 'high') {
    list = list.filter((p) => p.confidence >= 0.65);
  }

  list.sort(state.sort === 'value'
    ? (a, b) => b.edge - a.edge
    // Por omissao ordenamos por hora de inicio: a app serve para decidir o
    // que apostar a seguir, nao para ranquear apostas em abstrato.
    : (a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  return list;
}

export function visibleHistory() {
  if (state.resultFilter === 'all') return state.history;
  return state.history.filter((p) => p.result === state.resultFilter);
}
