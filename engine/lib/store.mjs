import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

/**
 * Ficheiros JSON no repositorio.
 *
 * Sao a fonte de dados publica e sem autenticacao: a app le-os diretamente
 * do GitHub Pages, por isso funciona mesmo antes de o Supabase estar
 * configurado, e continua a funcionar se o Supabase estiver em baixo.
 */
export async function readJson(name, fallback) {
  try {
    const raw = await readFile(path.join(DATA_DIR, name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(name, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    path.join(DATA_DIR, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

export { DATA_DIR };
