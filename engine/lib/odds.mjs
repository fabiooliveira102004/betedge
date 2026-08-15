import { config } from '../config.mjs';
import { request } from './http.mjs';
import { log } from './log.mjs';

const BASE = 'https://api.the-odds-api.com/v4';

/**
 * Cotacoes via The Odds API.
 *
 * Duas decisoes que vale a pena explicar, porque nenhuma delas e obvia:
 *
 * 1. Pedimos TODAS as casas da regiao, nao so a Betclic. Custa exatamente
 *    o mesmo — a API cobra por mercado e por regiao, nao por casa — e com
 *    vinte casas o preco justo sai de um consenso em vez de sair da margem
 *    de uma so. A Pinnacle, que costuma ser a mais afinada do mercado, esta
 *    sempre neste conjunto.
 *
 * 2. A Betclic continua a ser a referencia: e o preco que o utilizador vai
 *    mesmo encontrar. Quando ela nao cota um mercado (acontece muito nos
 *    totais), mostramos a melhor odd disponivel e dizemos de que casa e.
 *
 * A Betclic aparece na API como `betclic_fr`. Nao existe entrada para a
 * Betclic portuguesa; sendo o mesmo operador, os precos batem quase sempre
 * certo, mas isso fica dito na app em vez de ser escondido.
 */

/** Creditos gastos: a API cobra 1 por mercado x regiao em cada pedido. */
const creditsPerRequest = () => config.markets.split(',').length;

export async function fetchBetclicOdds() {
  const offers = [];
  let creditsUsed = 0;
  let creditsLeft = null;

  for (const league of config.leagues) {
    if (creditsUsed + creditsPerRequest() > config.oddsBudget) {
      log.warn(`Orcamento de ${config.oddsBudget} creditos esgotado — ${league.name} fica de fora desta execucao`);
      continue;
    }

    const url = `${BASE}/sports/${league.key}/odds?`
      + new URLSearchParams({
        apiKey: config.oddsApiKey,
        regions: config.region,
        markets: config.markets,
        oddsFormat: 'decimal',
        dateFormat: 'iso',
      });

    let events;
    let headers;
    try {
      const res = await requestWithHeaders(url);
      events = res.body;
      headers = res.headers;
    } catch (err) {
      log.warn(`Odds indisponiveis para ${league.name}: ${err.message}`);
      continue;
    }

    creditsUsed += Number(headers.get('x-requests-last')) || creditsPerRequest();
    const remaining = headers.get('x-requests-remaining');
    if (remaining != null) creditsLeft = Number(remaining);

    const before = offers.length;
    for (const event of events) {
      const books = event.bookmakers ?? [];
      if (books.length === 0) continue;

      const fixture = {
        id: event.id,
        league: league.name,
        leagueKey: league.key,
        apiFootballLeagueId: league.apiFootballId,
        home: event.home_team,
        away: event.away_team,
        kickoff: event.commence_time,
        bookCount: books.length,
      };

      for (const parsed of parseEvent(event, books)) {
        offers.push({ fixture, ...parsed });
      }
    }

    log.info(`${league.name}: ${events.length} jogos, ${offers.length - before} selecoes`);
  }

  log.info(`Creditos gastos nesta execucao: ${creditsUsed}`
    + (creditsLeft != null ? ` · restam ${creditsLeft} este mes` : ''));

  if (creditsLeft != null && creditsLeft < 30) {
    log.warn(`Poucos creditos: ${creditsLeft}. Reduz ODDS_BUDGET ou o numero de ligas.`);
  }

  return { offers, creditsUsed, creditsLeft };
}

async function requestWithHeaders(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return { body: await res.json(), headers: res.headers };
}

/**
 * Junta as cotacoes de todas as casas por mercado e selecao, e produz uma
 * entrada por selecao com: o consenso do mercado, o preco da Betclic e o
 * melhor preco disponivel.
 */
export function parseEvent(event, books) {
  const out = [];

  // groupKey -> selection -> [{ book, odds }]
  const byGroup = new Map();

  for (const book of books) {
    for (const market of book.markets ?? []) {
      for (const parsed of parseMarket(market, event)) {
        const { groupKey, selection, odds, line, marketKey } = parsed;
        if (!byGroup.has(groupKey)) {
          byGroup.set(groupKey, { marketKey, line, selections: new Map() });
        }
        const group = byGroup.get(groupKey);
        if (!group.selections.has(selection)) group.selections.set(selection, []);
        group.selections.get(selection).push({ book: book.key, odds });
      }
    }
  }

  for (const [groupKey, group] of byGroup) {
    // Um mercado so serve se tivermos todas as pernas: sem elas nao da para
    // retirar a margem nem calcular o preco justo.
    const expected = expectedLegs(group.marketKey);
    if (group.selections.size < expected) continue;

    const legs = [...group.selections.entries()].map(([selection, quotes]) => {
      const sorted = [...quotes].sort((a, b) => b.odds - a.odds);
      const best = sorted[0];
      const betclic = quotes.find((q) => q.book === config.bookmaker);

      return {
        selection,
        // Consenso: a mediana e menos sensivel a uma casa desalinhada do
        // que a media.
        consensusOdds: median(quotes.map((q) => q.odds)),
        bookCount: quotes.length,
        betclicOdds: betclic?.odds ?? null,
        bestOdds: best.odds,
        bestBook: best.book,
        // A odd de referencia e a da Betclic quando existe; caso contrario
        // a melhor do mercado, identificada na app.
        //
        // Tem de ficar aqui, na perna: e este array que segue como `group`
        // e e dele que o quadro de mercados le. Estava a ser acrescentada
        // so a oferta individual, o que deixava as selecoes publicadas sem
        // preco nenhum — e o ecra de analise rebentava ao tentar formata-lo.
        odds: betclic?.odds ?? best.odds,
        oddsBook: betclic ? config.bookmaker : best.book,
      };
    });

    for (const leg of legs) {
      out.push({ market: group.marketKey, line: group.line, groupKey, group: legs, ...leg });
    }
  }

  return out;
}

const expectedLegs = (marketKey) => (marketKey === 'h2h' ? 3 : 2);

function parseMarket(market, event) {
  const out = [];

  if (market.key === 'h2h') {
    for (const o of market.outcomes ?? []) {
      out.push({
        marketKey: 'h2h',
        groupKey: 'h2h',
        line: null,
        selection: o.name === event.home_team ? 'home'
          : o.name === event.away_team ? 'away' : 'draw',
        odds: o.price,
      });
    }
  }

  if (market.key === 'totals') {
    for (const o of market.outcomes ?? []) {
      if (o.point == null) continue;
      out.push({
        marketKey: 'totals',
        groupKey: `totals:${o.point}`,
        line: o.point,
        selection: o.name.toLowerCase() === 'over' ? 'over' : 'under',
        odds: o.price,
      });
    }
  }

  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Resultados finais, para arquivar os jogos ja disputados. */
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
