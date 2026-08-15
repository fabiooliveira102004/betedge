import { config } from '../config.mjs';

/**
 * Ratings Elo adaptados a futebol: o K e escalado pela diferenca de golos,
 * para que um 4-0 mova mais o rating do que um 1-0.
 */
export function buildRatings(finishedMatches) {
  const { eloStart, eloK } = config.model;
  const elo = new Map();
  const played = new Map();

  const get = (team) => elo.get(team) ?? eloStart;
  const bump = (team) => played.set(team, (played.get(team) ?? 0) + 1);

  // Cronologico: um Elo construido fora de ordem nao significa nada.
  const ordered = [...finishedMatches].sort(
    (a, b) => new Date(a.kickoff) - new Date(b.kickoff),
  );

  for (const m of ordered) {
    if (!Number.isFinite(m.homeGoals) || !Number.isFinite(m.awayGoals)) continue;

    const rh = get(m.home);
    const ra = get(m.away);

    // 65 pontos de Elo e a vantagem caseira tipica no futebol europeu.
    const expectedHome = 1 / (1 + 10 ** ((ra - rh - 65) / 400));
    const gd = m.homeGoals - m.awayGoals;
    const scoreHome = gd > 0 ? 1 : gd === 0 ? 0.5 : 0;

    const absGd = Math.abs(gd);
    const multiplier = absGd <= 1 ? 1 : absGd === 2 ? 1.5 : (11 + absGd) / 8;
    const delta = eloK * multiplier * (scoreHome - expectedHome);

    elo.set(m.home, rh + delta);
    elo.set(m.away, ra - delta);
    bump(m.home);
    bump(m.away);
  }

  return {
    get: (team) => elo.get(team) ?? eloStart,
    matches: (team) => played.get(team) ?? 0,
    size: elo.size,
    all: () => Object.fromEntries(elo),
  };
}

/**
 * Taxas de ataque e defesa por equipa, relativas a media da liga.
 * atk > 1 marca mais que a media; def > 1 sofre mais que a media.
 */
export function buildScoringRates(finishedMatches) {
  const tally = new Map();
  const touch = (team) => {
    if (!tally.has(team)) tally.set(team, { gf: 0, ga: 0, n: 0 });
    return tally.get(team);
  };

  let totalHomeGoals = 0;
  let totalAwayGoals = 0;
  let games = 0;

  for (const m of finishedMatches) {
    if (!Number.isFinite(m.homeGoals) || !Number.isFinite(m.awayGoals)) continue;
    const h = touch(m.home);
    const a = touch(m.away);
    h.gf += m.homeGoals; h.ga += m.awayGoals; h.n += 1;
    a.gf += m.awayGoals; a.ga += m.homeGoals; a.n += 1;
    totalHomeGoals += m.homeGoals;
    totalAwayGoals += m.awayGoals;
    games += 1;
  }

  const avgHome = games > 0 ? totalHomeGoals / games : 1.5;
  const avgAway = games > 0 ? totalAwayGoals / games : 1.15;
  const avgPerTeam = (avgHome + avgAway) / 2;

  return {
    leagueAvgHome: avgHome,
    leagueAvgAway: avgAway,
    forTeam(team) {
      const t = tally.get(team);
      if (!t || t.n === 0) return { atk: 1, def: 1, matches: 0 };
      return {
        atk: t.gf / t.n / avgPerTeam,
        def: t.ga / t.n / avgPerTeam,
        matches: t.n,
      };
    },
  };
}
