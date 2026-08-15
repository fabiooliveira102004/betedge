/**
 * Service worker do BetEdge.
 *
 * Duas estrategias, porque os dois tipos de recurso tem necessidades
 * opostas:
 *
 *  - A casca da app (HTML, CSS, JS) e servida da cache primeiro. Abre
 *    instantaneamente, mesmo no metro sem rede, e so e atualizada quando
 *    uma nova versao do worker toma conta.
 *
 *  - As analises (data/*.json) vao a rede primeiro. Uma aposta so serve
 *    antes do jogo comecar, por isso servir dados velhos e pior do que
 *    esperar meio segundo. A cache fica como rede de seguranca.
 */

const VERSION = 'betedge-v7';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/api.js',
  './assets/js/config.js',
  './assets/js/match-detail.js',
  './assets/js/state.js',
  './assets/js/ui.js',
  './assets/js/util.js',
  './assets/js/views-matches.js',
  './assets/js/views-results.js',
  './assets/js/views-model.js',
  './assets/js/views-about.js',
  './assets/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll falha inteiro se um recurso faltar; adicionamos um a um para
    // que um icone em falta nao impeca a app de funcionar offline.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Pedidos ao Supabase nunca sao cacheados: sao dados de conta, e servir
  // uma resposta antiga daria a impressao de que uma aposta foi guardada
  // quando nao foi.
  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ picks: [], offline: true }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Revalida em segundo plano: o utilizador ve a versao em cache agora e
    // a proxima visita ja apanha a nova.
    fetch(request)
      .then((response) => response.ok && caches.open(SHELL_CACHE).then((c) => c.put(request, response)))
      .catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Navegacao sem rede e sem cache: devolvemos a casca da app, que sabe
    // mostrar o estado offline.
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('offline');
  }
}
