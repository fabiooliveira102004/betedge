import { log } from './log.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch com retries em erros transitorios (429 / 5xx / falha de rede).
 * Devolve o corpo ja parseado, ou lanca em erro permanente.
 */
export async function request(url, { retries = 3, timeoutMs = 20000, parse = 'json', ...init } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });

      if (res.status === 429 || res.status >= 500) {
        // O header retry-after ganha ao backoff calculado quando existe.
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30000, 800 * 2 ** attempt);
        lastError = new Error(`HTTP ${res.status} em ${hostOf(url)}`);
        if (attempt < retries) {
          log.warn(`${lastError.message} — nova tentativa em ${Math.round(waitMs / 1000)}s`);
          await sleep(waitMs);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} em ${hostOf(url)}: ${body.slice(0, 300)}`);
      }

      return parse === 'text' ? res.text() : res.json();
    } catch (err) {
      lastError = err;
      const transient = err.name === 'AbortError' || err.name === 'TypeError';
      if (transient && attempt < retries) {
        await sleep(Math.min(30000, 800 * 2 ** attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
