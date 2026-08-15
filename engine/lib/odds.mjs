import { config } from '../config.mjs';
import { request } from './http.mjs';
import { log } from './log.mjs';

const BASE = 'https://api.the-odds-api.com/v4';

/**
 * Odds da Betclic via The Odds API.
 *
 * A Betclic nao expoe API publica e fazer scraping do site seria fragil e
 * contra os termos de utilizacao. A The Odds API agrega-a na regiao "eu" de
 * forma licenciada. Se a Betclic nao cotar um jogo, esse jogo fica de fora —
 * nunca substituimos pela odd de outra casa, porque o objetivo e apostar
 * exatamente ao preco que vais encontrar na tua conta.
 */
export async function fetchBetclicOdds() {
  const offers = [];
  let creditsLeft = null;

  for (const league of config.leagues) {
    const url = `${BASE}/sports/${league.key}/odds?`
      + new URLSearchParams({
        apiKey: config.oddsApiKey,
        regions: config.region,
        markets: 'h2h,totals,btts',
        bookmakers: config.bookmaker,
        oddsFormat: 'decimal',
        dateFormat: 'iso',
      });

    let events;
    try {
      events = await request(url);
    } catch (err) {
      log.warn(`Odds indisponiveis para ${league.name}: ${err.message}`);
      continue;
    }

    const before = offers.length;
    for (const event of events) {
      const book = event.bookmakers?.find((b) => b.key === config.bookmaker);
      if (!book) continue;

      const fixture = {
        id: event.id,
        league: league.name,
        leagueKey: league.key,
        apiFootballLeagueId: league.apiFootballId,
        home: event.home_team,
        away: event.away_team,
        kickoff: event.commence_time,
        lastUpdate: book.last_update,
      };

      for (const market of book.markets ?? []) {
        const parsed = parseMarket(market, event);
        for (const p of parsed) offers.push({ fixture, ...p });
      }
    }

    log.info(`${league.name}: ${offers.length - before} cotacoes da Betclic`);
  }

  return { offers, creditsLeft };
}

/**
 * Converte um mercado da The Odds API em selecoes normalizadas. Cada grupo
 * de selecoes fica junto (mesma `groupKey`) porque a remocao da margem tem
 * de ser feita sobre o mercado completo, nao selecao a selecao.
 */
function parseMarket(market, event) {
  const out = [];

  if (market.key === 'h2h') {
    const group = market.outcomes.map((o) => ({
      selection: o.name === event.home_team ? 'home'
        : o.name === event.away_team ? 'away'
          : 'draw',
      odds: o.price,
    }));
    for (const g of group) {
      out.push({ market: 'h2h', line: null, groupKey: 'h2h', group, ...g });
    }
  }

  if (market.key === 'totals') {
    // Podem vir varias linhas (1.5, 2.5, 3.5) no mesmo mercado.
    const byLine = new Map();
    for (const o of market.outcomes) {
      const line = o.point;
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push({
        selection: o.name.toLowerCase() === 'over' ? 'over' : 'under',
        odds: o.price,
      });
    }
    for (const [line, group] of byLine) {
      for (const g of group) {
        out.push({ market: 'totals', line, groupKey: `totals:${line}`, group, ...g });
      }
    }
  }

  if (market.key === 'btts') {
    const group = market.outcomes.map((o) => ({
      selection: o.name.toLowerCase() === 'yes' ? 'yes' : 'no',
      odds: o.price,
    }));
    for (const g of group) {
      out.push({ market: 'btts', line: null, groupKey: 'btts', group, ...g });
    }
  }

  return out;
}

/** Resultados finais para liquidar apostas pendentes. */
export async function fetchScores(leagueKey, daysFrom = 3) {
  const url = `${BASE}/sports/${leagueKey}/scores?`
    + new URLSearchParams({
      apiKey: config.oddsApiKey,
      daysFrom: String(daysFrom),
      dateFormat: 'iso',
    });

  const events = await request(url);
  return events
    .filter((e) => e.completed && Array.isArray(e.scores))
    .map((e) => {
      const homeScore = e.scores.find((s) => s.name === e.home_team);
      const awayScore = e.scores.find((s) => s.name === e.away_team);
      return {
        id: e.id,
        home: e.home_team,
        away: e.away_team,
        homeGoals: Number(homeScore?.score),
        awayGoals: Number(awayScore?.score),
        completedAt: e.last_update ?? e.commence_time,
      };
    })
    .filter((e) => Number.isFinite(e.homeGoals) && Number.isFinite(e.awayGoals));
}
