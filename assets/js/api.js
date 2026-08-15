import { APP, SUPABASE, supabaseReady } from './config.js';
import { store } from './util.js';

/**
 * Acesso a dados.
 *
 * Duas fontes, deliberadamente:
 *
 *  - As analises (apostas, historico, estatisticas) vem de ficheiros JSON
 *    estaticos publicados pelo GitHub Actions. Sao publicas, iguais para
 *    toda a gente e funcionam offline via service worker.
 *
 *  - Os dados pessoais (conta, banca, apostas seguidas) vem do Supabase.
 *    Sem Supabase configurado a app cai para armazenamento local: continua
 *    utilizavel num so dispositivo, sem sincronizacao.
 *
 * O cliente Supabase e escrito a mao sobre `fetch` em vez de usar o SDK.
 * Sao tres endpoints de autenticacao e chamadas REST simples; puxar 60 kB
 * de biblioteca de um CDN acrescentaria uma dependencia externa em runtime
 * a uma app que tem de arrancar offline.
 */

const SESSION_KEY = 'session';

/* ── Analises publicadas ────────────────────────────────────────────── */

export async function loadPublished(name, fallback) {
  try {
    const res = await fetch(`${APP.dataPath}${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    // O service worker serve a copia em cache quando ha rede intermitente;
    // se falhar mesmo assim, devolvemos a estrutura vazia esperada para
    // que as vistas mostrem o estado "sem dados" em vez de rebentarem.
    return fallback;
  }
}

/* ── Sessao ─────────────────────────────────────────────────────────── */

let session = store.get(SESSION_KEY);

export const getSession = () => session;
export const isAuthed = () => Boolean(session?.access_token);
export const currentUser = () => session?.user ?? null;

function saveSession(next) {
  session = next;
  if (next) store.set(SESSION_KEY, next);
  else store.remove(SESSION_KEY);
  return next;
}

/** Renova o token quando esta perto de expirar. */
async function freshToken() {
  if (!session?.access_token) return null;

  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt - Date.now() > 60_000) return session.access_token;

  if (!session.refresh_token) {
    saveSession(null);
    return null;
  }

  try {
    const renewed = await authRequest('token?grant_type=refresh_token', {
      refresh_token: session.refresh_token,
    });
    return saveSession(normaliseSession(renewed)).access_token;
  } catch {
    // Refresh token invalido ou revogado: sessao terminada.
    saveSession(null);
    return null;
  }
}

function normaliseSession(raw) {
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: raw.expires_at ?? Math.floor(Date.now() / 1000) + (raw.expires_in ?? 3600),
    user: raw.user ?? null,
  };
}

/* ── Autenticacao ───────────────────────────────────────────────────── */

async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(authMessage(data, res.status));
  return data;
}

/** Traduz os erros do Supabase para portugues legivel. */
function authMessage(data, status) {
  const raw = data.error_description || data.msg || data.message || data.error || '';

  if (/invalid login credentials/i.test(raw)) return 'Email ou palavra-passe incorretos.';
  if (/email not confirmed/i.test(raw)) return 'Confirma o email antes de entrar. Verifica a tua caixa de entrada.';
  if (/user already registered/i.test(raw)) return 'Ja existe uma conta com este email.';
  if (/password should be at least/i.test(raw)) return 'A palavra-passe precisa de pelo menos 6 caracteres.';
  if (/rate limit|too many/i.test(raw)) return 'Demasiadas tentativas. Espera um pouco e tenta de novo.';
  if (/unable to validate email|invalid email/i.test(raw)) return 'Esse email nao parece valido.';

  return raw || `Falha na autenticacao (${status}).`;
}

export async function signUp({ email, password, displayName }) {
  requireSupabase();
  const data = await authRequest('signup', {
    email,
    password,
    data: { display_name: displayName || email.split('@')[0] },
  });

  // Com confirmacao de email ligada no Supabase, o signup devolve o
  // utilizador mas nao a sessao — nesse caso ha um passo extra no email.
  if (data.access_token) {
    saveSession(normaliseSession(data));
    return { needsConfirmation: false };
  }
  return { needsConfirmation: true };
}

export async function signIn({ email, password }) {
  requireSupabase();
  const data = await authRequest('token?grant_type=password', { email, password });
  saveSession(normaliseSession(data));
}

export async function resetPassword(email) {
  requireSupabase();
  await authRequest('recover', { email });
}

export async function signOut() {
  if (session?.access_token && supabaseReady()) {
    // Falhar aqui nao pode impedir o logout local — se o pedido nao passar,
    // apagamos a sessao na mesma.
    await fetch(`${SUPABASE.url}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE.anonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
    }).catch(() => {});
  }
  saveSession(null);
}

function requireSupabase() {
  if (!supabaseReady()) {
    throw new Error('Base de dados nao configurada. Preenche assets/js/config.js.');
  }
}

/* ── Base de dados ──────────────────────────────────────────────────── */

async function db(path, { method = 'GET', body, prefer } = {}) {
  requireSupabase();
  const token = await freshToken();

  const headers = {
    apikey: SUPABASE.anonKey,
    Authorization: `Bearer ${token ?? SUPABASE.anonKey}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || data?.hint || `Erro na base de dados (${res.status}).`);
  }
  return data;
}

/* ── Perfil ─────────────────────────────────────────────────────────── */

const LOCAL_PROFILE_DEFAULTS = {
  display_name: null,
  bankroll: 100,
  currency: APP.currency,
  min_edge: 0.04,
  min_confidence: 0.35,
  max_stake_pct: 0.03,
  leagues: [],
};

export async function fetchProfile() {
  if (!isAuthed()) return { ...LOCAL_PROFILE_DEFAULTS, ...store.get('profile', {}), local: true };

  const rows = await db(`profiles?id=eq.${currentUser().id}&select=*`);
  if (rows?.length) return rows[0];

  // O trigger on_auth_user_created cria o perfil, mas se por alguma razao
  // faltar, criamos aqui em vez de deixar a app sem banca definida.
  const created = await db('profiles', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      id: currentUser().id,
      email: currentUser().email,
      display_name: currentUser().user_metadata?.display_name ?? null,
      ...LOCAL_PROFILE_DEFAULTS,
    }],
  });
  return created?.[0] ?? { ...LOCAL_PROFILE_DEFAULTS, local: true };
}

export async function saveProfile(patch) {
  if (!isAuthed()) {
    const next = { ...store.get('profile', LOCAL_PROFILE_DEFAULTS), ...patch };
    store.set('profile', next);
    return { ...next, local: true };
  }

  const rows = await db(`profiles?id=eq.${currentUser().id}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: patch,
  });
  return rows?.[0];
}

/* ── Apostas seguidas ───────────────────────────────────────────────── */

export async function fetchUserBets() {
  if (!isAuthed()) return store.get('bets', []);
  return await db('user_bets?select=*&order=placed_at.desc') ?? [];
}

export async function trackBet(pick, stakeAmount) {
  const snapshot = {
    league: pick.league,
    home: pick.home,
    away: pick.away,
    kickoff: pick.kickoff,
    description: pick.description,
    market: pick.market,
    edge: pick.edge,
    confidence: pick.confidence,
  };

  if (!isAuthed()) {
    const bets = store.get('bets', []);
    // Uma aposta por pick: seguir duas vezes o mesmo jogo seria um erro de
    // registo, nao uma segunda aposta.
    if (bets.some((b) => b.pick_id === pick.id)) {
      throw new Error('Ja registaste esta aposta.');
    }
    const bet = {
      id: `local-${Date.now()}`,
      pick_id: pick.id,
      stake_amount: stakeAmount,
      odds_taken: pick.odds,
      placed_at: new Date().toISOString(),
      status: 'open',
      snapshot,
    };
    store.set('bets', [bet, ...bets]);
    return bet;
  }

  const rows = await db('user_bets', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      user_id: currentUser().id,
      pick_id: pick.id,
      stake_amount: stakeAmount,
      odds_taken: pick.odds,
      snapshot,
    }],
  }).catch((err) => {
    if (/duplicate key/i.test(err.message)) throw new Error('Ja registaste esta aposta.');
    throw err;
  });

  return rows?.[0];
}

export async function untrackBet(bet) {
  if (!isAuthed()) {
    store.set('bets', store.get('bets', []).filter((b) => b.id !== bet.id));
    return;
  }
  await db(`user_bets?id=eq.${bet.id}`, { method: 'DELETE' });
}

/**
 * Liquida localmente as apostas seguidas, comparando com o historico
 * publicado. No modo autenticado isto e feito por um trigger na base de
 * dados; sem Supabase, tem de acontecer no cliente.
 */
export function settleLocalBets(historyPicks) {
  const bets = store.get('bets', []);
  if (bets.length === 0) return bets;

  const byPick = new Map(historyPicks.map((p) => [p.id, p]));
  let changed = false;

  for (const bet of bets) {
    if (bet.status !== 'open') continue;
    const pick = byPick.get(bet.pick_id);
    if (!pick?.settled || !pick.result) continue;

    bet.status = pick.result;
    bet.payout = pick.result === 'win' ? bet.stake_amount * bet.odds_taken
      : pick.result === 'loss' ? 0
        : bet.stake_amount;
    bet.snapshot = { ...bet.snapshot, result: pick.result, finalScore: pick.finalScore };
    changed = true;
  }

  if (changed) store.set('bets', bets);
  return bets;
}
