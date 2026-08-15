import { APP } from './config.js';
import { store } from './util.js';

/**
 * Acesso a dados.
 *
 * As analises vem de ficheiros JSON estaticos publicados pelo GitHub
 * Actions: sao publicas, iguais para toda a gente, e funcionam offline
 * atraves do service worker.
 *
 * Nao ha contas nem sincronizacao. A app nao guarda nada sobre o utilizador
 * alem de duas preferencias — que ligas seguir e o tema — e essas vivem no
 * proprio dispositivo. Sem dinheiro nem apostas registadas para proteger,
 * uma conta seria burocracia sem beneficio.
 */

export async function loadPublished(name, fallback) {
  try {
    const res = await fetch(`${APP.dataPath}${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    // O service worker serve a copia em cache quando ha rede intermitente;
    // se falhar mesmo assim, devolvemos a estrutura vazia esperada para que
    // as vistas mostrem o estado "sem dados" em vez de rebentarem.
    return fallback;
  }
}

const DEFAULTS = { leagues: [] };

export async function fetchProfile() {
  return { ...DEFAULTS, ...store.get('profile', {}) };
}

export async function saveProfile(patch) {
  const next = { ...await fetchProfile(), ...patch };
  store.set('profile', next);
  return next;
}
