import { readJson, writeJson } from './store.mjs';

/**
 * Historico proprio de resultados.
 *
 * O plano gratuito da API-Football so da acesso as epocas 2022-2024: a atual
 * esta bloqueada. Sem isto o motor ficaria para sempre sem dados da epoca a
 * decorrer, e portanto sem opiniao propria sobre nenhuma equipa.
 *
 * A solucao e nao depender de ninguem: o passo de liquidacao ja vai buscar
 * os resultados dos jogos que analisou, por isso guarda-os. Ao fim de umas
 * semanas o motor tem historico da epoca corrente construido por si, sempre
 * atualizado e sem custo adicional — cada resultado ja foi pago uma vez.
 *
 * O arranque e lento por natureza: nos primeiros dias ha poucos jogos e o
 * modelo apoia-se no que a API-Football deixa ver das epocas antigas. A app
 * diz sempre em que pe esta.
 */

const FILE = 'matchlog.json';
const MAX_MATCHES = 4000;

export async function loadMatchlog() {
  const doc = await readJson(FILE, { matches: [] });
  return doc.matches ?? [];
}

/**
 * Junta resultados novos ao registo. A chave e o id do jogo, por isso
 * reprocessar a mesma execucao nao duplica nada.
 */
export async function appendToMatchlog(entries) {
  const existing = await loadMatchlog();
  const byId = new Map(existing.map((m) => [m.id, m]));

  let added = 0;
  for (const entry of entries) {
    if (!entry.id || byId.has(entry.id)) continue;
    if (!Number.isFinite(entry.homeGoals) || !Number.isFinite(entry.awayGoals)) continue;
    byId.set(entry.id, entry);
    added += 1;
  }

  const merged = [...byId.values()]
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, MAX_MATCHES);

  await writeJson(FILE, {
    updatedAt: new Date().toISOString(),
    count: merged.length,
    matches: merged,
  });

  return { added, total: merged.length };
}

/** Resultados de uma liga, no formato que os ratings esperam. */
export const matchlogFor = (matchlog, league) => matchlog
  .filter((m) => m.league === league)
  .map((m) => ({
    league: m.league,
    home: m.home,
    away: m.away,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
    kickoff: m.kickoff,
  }));
