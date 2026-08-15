import { config, hasSupabase } from '../config.mjs';
import { request } from './http.mjs';
import { log } from './log.mjs';

/**
 * Escrita no Supabase pelo motor, com a service role key.
 *
 * A chave de service role ignora as politicas RLS, por isso so existe nos
 * GitHub Secrets e nunca chega ao browser. A app usa a chave anon, que esta
 * sujeita as politicas definidas em supabase/schema.sql.
 */

const rest = (table) => `${config.supabaseUrl}/rest/v1/${table}`;

const headers = (extra = {}) => ({
  apikey: config.supabaseServiceKey,
  Authorization: `Bearer ${config.supabaseServiceKey}`,
  'Content-Type': 'application/json',
  ...extra,
});

/** Insere ou atualiza linhas por chave primaria, em lotes. */
export async function upsert(table, rows, { onConflict = 'id', chunkSize = 200 } = {}) {
  if (!hasSupabase() || rows.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    try {
      await request(`${rest(table)}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(chunk),
      });
      written += chunk.length;
    } catch (err) {
      log.error(`Falha ao gravar ${chunk.length} linhas em ${table}: ${err.message}`);
    }
  }

  log.info(`Supabase: ${written} linhas em ${table}`);
  return written;
}

export async function select(table, query = '') {
  if (!hasSupabase()) return [];
  try {
    return await request(`${rest(table)}?${query}`, { headers: headers() });
  } catch (err) {
    log.error(`Falha ao ler ${table}: ${err.message}`);
    return [];
  }
}

export async function patch(table, filter, values) {
  if (!hasSupabase()) return false;
  try {
    await request(`${rest(table)}?${filter}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(values),
    });
    return true;
  } catch (err) {
    log.error(`Falha ao atualizar ${table}: ${err.message}`);
    return false;
  }
}
