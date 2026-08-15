import { config } from '../config.mjs';

/**
 * Dados sinteticos para o modo demo.
 *
 * Sem ODDS_API_KEY o motor gera jogos e cotacoes plausiveis em vez de nao
 * produzir nada. Serve para veres a app a funcionar de ponta a ponta antes
 * de teres chaves, e para os testes correrem sem rede. Tudo o que sai deste
 * modulo fica marcado com `demo: true` e a app avisa que sao dados fictos.
 */

const TEAMS = {
  'Liga Portugal': [
    ['Benfica', 1720], ['FC Porto', 1710], ['Sporting CP', 1735], ['SC Braga', 1620],
    ['Vitoria Guimaraes', 1545], ['Moreirense', 1470], ['Gil Vicente', 1465],
    ['Casa Pia', 1440], ['Estoril', 1435], ['Rio Ave', 1430], ['Famalicao', 1450],
    ['Santa Clara', 1405], ['Arouca', 1415], ['Nacional', 1380],
  ],
  'Premier League': [
    ['Manchester City', 1810], ['Liverpool', 1790], ['Arsenal', 1780],
    ['Chelsea', 1700], ['Tottenham', 1685], ['Newcastle', 1670],
    ['Aston Villa', 1660], ['Brighton', 1630], ['West Ham', 1570],
    ['Everton', 1520], ['Wolves', 1505], ['Brentford', 1560],
  ],
  'La Liga': [
    ['Real Madrid', 1830], ['Barcelona', 1800], ['Atletico Madrid', 1740],
    ['Athletic Club', 1660], ['Real Sociedad', 1630], ['Villarreal', 1620],
    ['Real Betis', 1595], ['Valencia', 1540], ['Sevilla', 1560], ['Girona', 1585],
  ],
};

// Gerador determinista: a mesma seed produz sempre a mesma lista de jogos,
// para que uma re-execucao em demo nao invente resultados diferentes.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function demoOdds(now = new Date()) {
  const random = rng(Math.floor(now.getTime() / 86400000));
  const offers = [];
  const history = [];

  for (const [league, teams] of Object.entries(TEAMS)) {
    // Historico: cada equipa joga contra as outras, resultado sorteado a
    // partir da diferenca de Elo.
    for (let i = 0; i < teams.length; i++) {
      for (let j = 0; j < teams.length; j++) {
        if (i === j) continue;
        const [home, eloH] = teams[i];
        const [away, eloA] = teams[j];
        const sup = (eloH - eloA) / 100 * 0.34 + 0.22;
        const lh = Math.max(0.3, 1.4 + sup / 2);
        const la = Math.max(0.3, 1.4 - sup / 2);
        history.push({
          league,
          home,
          away,
          homeGoals: samplePoisson(lh, random),
          awayGoals: samplePoisson(la, random),
          kickoff: new Date(now.getTime() - (i * teams.length + j + 7) * 86400000).toISOString(),
        });
      }
    }

    // Proximos jogos: pares aleatorios nos proximos dias.
    const shuffled = [...teams].sort(() => random() - 0.5);
    for (let k = 0; k + 1 < Math.min(shuffled.length, 8); k += 2) {
      const [home, eloH] = shuffled[k];
      const [away, eloA] = shuffled[k + 1];
      const kickoff = new Date(now.getTime() + (1 + Math.floor(random() * config.horizonDays)) * 86400000);
      kickoff.setUTCHours(19, 0, 0, 0);

      const sup = (eloH - eloA) / 100 * 0.34 + 0.22;
      const lh = Math.max(0.35, 1.42 + sup / 2);
      const la = Math.max(0.30, 1.42 - sup / 2);

      const fixture = {
        id: `demo-${slug(home)}-${slug(away)}-${kickoff.toISOString().slice(0, 10)}`,
        league,
        leagueKey: 'demo',
        apiFootballLeagueId: null,
        home,
        away,
        kickoff: kickoff.toISOString(),
        lastUpdate: now.toISOString(),
        demo: true,
      };

      offers.push(...syntheticMarket(fixture, lh, la, random));
    }
  }

  return { offers, history };
}

/**
 * Constroi odds a partir das probabilidades verdadeiras do gerador, mais
 * uma margem de casa e um erro aleatorio. O erro e que cria as apostas de
 * valor: sem ele o modelo nunca discordaria do mercado.
 */
function syntheticMarket(fixture, lh, la, random) {
  const out = [];
  const margin = 1.06;

  let home = 0; let draw = 0; let away = 0; let over25 = 0; let btts = 0;
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p = pois(h, lh) * pois(a, la);
      if (h > a) home += p; else if (h === a) draw += p; else away += p;
      if (h + a > 2.5) over25 += p;
      if (h > 0 && a > 0) btts += p;
    }
  }

  const noise = () => 1 + (random() - 0.5) * 0.14;
  const price = (p) => Math.max(1.05, Math.round((1 / (p * margin * noise())) * 100) / 100);

  const h2h = [
    { selection: 'home', odds: price(home) },
    { selection: 'draw', odds: price(draw) },
    { selection: 'away', odds: price(away) },
  ];
  for (const g of h2h) out.push({ fixture, market: 'h2h', line: null, groupKey: 'h2h', group: h2h, ...g });

  const totals = [
    { selection: 'over', odds: price(over25) },
    { selection: 'under', odds: price(1 - over25) },
  ];
  for (const g of totals) {
    out.push({ fixture, market: 'totals', line: 2.5, groupKey: 'totals:2.5', group: totals, ...g });
  }

  const bttsGroup = [
    { selection: 'yes', odds: price(btts) },
    { selection: 'no', odds: price(1 - btts) },
  ];
  for (const g of bttsGroup) out.push({ fixture, market: 'btts', line: null, groupKey: 'btts', group: bttsGroup, ...g });

  return out;
}

const pois = (k, l) => (l ** k) * Math.exp(-l) / factorial(k);
const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

function samplePoisson(lambda, random) {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= random();
  } while (p > limit && k < 12);
  return k - 1;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
