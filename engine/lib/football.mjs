import { config } from '../config.mjs';
import { request } from './http.mjs';
import { log } from './log.mjs';

const BASE = 'https://v3.football.api-sports.io';

const headers = () => ({ 'x-apisports-key': config.footballApiKey });

/** Epoca corrente: as ligas europeias arrancam em Julho/Agosto. */
export function currentSeason(date = new Date()) {
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/**
 * Resultados ja disputados, que alimentam o Elo e as taxas de golos.
 * Inclui a epoca anterior quando a atual ainda tem poucos jogos, senao o
 * modelo comeca a temporada praticamente as cegas.
 */
export async function fetchHistory(leagueId, season = currentSeason()) {
  const matches = [];

  for (const s of [season, season - 1]) {
    let data;
    try {
      data = await request(
        `${BASE}/fixtures?${new URLSearchParams({ league: String(leagueId), season: String(s), status: 'FT' })}`,
        { headers: headers() },
      );
    } catch (err) {
      log.warn(`Historico indisponivel (liga ${leagueId}, epoca ${s}): ${err.message}`);
      continue;
    }

    for (const f of data.response ?? []) {
      matches.push({
        home: f.teams.home.name,
        away: f.teams.away.name,
        homeGoals: f.goals.home,
        awayGoals: f.goals.away,
        kickoff: f.fixture.date,
        season: s,
      });
    }

    // Meia epoca chega para ratings estaveis; nao gastamos pedidos a mais.
    if (matches.length >= 180) break;
  }

  return matches;
}

/** Lesionados e castigados por liga, indexados por equipa. */
export async function fetchInjuries(leagueId, season = currentSeason()) {
  let data;
  try {
    data = await request(
      `${BASE}/injuries?${new URLSearchParams({ league: String(leagueId), season: String(season) })}`,
      { headers: headers() },
    );
  } catch (err) {
    log.warn(`Lesoes indisponiveis (liga ${leagueId}): ${err.message}`);
    return new Map();
  }

  const byTeam = new Map();
  for (const item of data.response ?? []) {
    const team = item.team?.name;
    if (!team) continue;
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push({
      player: item.player?.name ?? 'desconhecido',
      position: item.player?.position ?? null,
      reason: item.player?.reason ?? item.player?.type ?? 'indisponivel',
      type: item.player?.type ?? null,
    });
  }
  return byTeam;
}

/**
 * Emparelha nomes de equipa entre a The Odds API e a API-Football, que
 * escrevem o mesmo clube de formas diferentes ("Wolverhampton Wanderers"
 * vs "Wolves", "Sporting CP" vs "Sporting Lisbon").
 */
export function matchTeamName(target, candidates) {
  const t = normalise(target);
  if (candidates.has(target)) return target;

  let best = null;
  let bestScore = 0;

  for (const candidate of candidates.keys()) {
    const c = normalise(candidate);
    if (c === t) return candidate;

    const score = similarity(t, c);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // Abaixo de 0.72 e mais provavel ser outro clube do que uma grafia
  // diferente do mesmo — preferimos nao ter dados a ter dados errados.
  return bestScore >= 0.72 ? best : null;
}

const STOPWORDS = new Set([
  'fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'ud', 'sd', 'rc', 'as', 'ss', 'ssc',
  'club', 'clube', 'de', 'do', 'da', 'the', 'city', 'calcio', 'futbol',
  'football', 'deportivo', 'atletico', 'athletic', 'united',
]);

function normalise(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

/** Coeficiente de Dice sobre bigramas: robusto a abreviaturas e sufixos. */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  if (a.includes(b) || b.includes(a)) return 0.85;

  const bigrams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };

  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  for (const [g, count] of ga) {
    if (gb.has(g)) shared += Math.min(count, gb.get(g));
  }
  return (2 * shared) / (a.length - 1 + b.length - 1);
}
