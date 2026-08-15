/**
 * Configuracao central do motor.
 *
 * Tudo o que e segredo vem de variaveis de ambiente (GitHub Secrets em
 * producao, ficheiro .env em local). O motor funciona sem chave nenhuma:
 * nesse caso corre em modo demo com dados sinteticos.
 */

const env = (name, fallback = null) => process.env[name]?.trim() || fallback;
const num = (name, fallback) => {
  const raw = env(name);
  // Number(null) e 0 e passa no isFinite, o que transformaria uma variavel
  // por definir num limite de zero.
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

export const config = {
  // --- Fontes de dados ---------------------------------------------------
  oddsApiKey: env('ODDS_API_KEY'),
  footballApiKey: env('API_FOOTBALL_KEY'),
  anthropicApiKey: env('ANTHROPIC_API_KEY'),

  // --- Persistencia ------------------------------------------------------
  supabaseUrl: env('SUPABASE_URL'),
  supabaseServiceKey: env('SUPABASE_SERVICE_ROLE_KEY'),

  // --- Casa de apostas ---------------------------------------------------
  // A Betclic nao tem API publica. As odds vem da The Odds API, que agrega
  // a Betclic na regiao "eu". Se a Betclic nao cotar um jogo, esse jogo e
  // ignorado em vez de usarmos a odd de outra casa.
  bookmaker: 'betclic',
  region: 'eu',

  // Ligas seguidas. Chaves da The Odds API.
  leagues: [
    { key: 'soccer_portugal_primeira_liga', name: 'Liga Portugal', apiFootballId: 94 },
    { key: 'soccer_epl', name: 'Premier League', apiFootballId: 39 },
    { key: 'soccer_spain_la_liga', name: 'La Liga', apiFootballId: 140 },
    { key: 'soccer_italy_serie_a', name: 'Serie A', apiFootballId: 135 },
    { key: 'soccer_germany_bundesliga', name: 'Bundesliga', apiFootballId: 78 },
    { key: 'soccer_france_ligue_one', name: 'Ligue 1', apiFootballId: 61 },
    { key: 'soccer_uefa_champs_league', name: 'Champions League', apiFootballId: 2 },
  ],

  // --- Janela de analise -------------------------------------------------
  horizonDays: num('HORIZON_DAYS', 4),

  // --- Modelo ------------------------------------------------------------
  model: {
    // Correcao de Dixon-Coles. Negativo aumenta 0-0 e 1-1, que o Poisson
    // independente subestima sistematicamente no futebol.
    rho: -0.13,
    maxGoals: 10,
    // Vantagem de jogar em casa, em golos esperados.
    homeAdvantage: 0.22,
    // Peso do Elo contra as taxas de golos observadas ao calcular a
    // supremacia esperada. 0 = so golos, 1 = so Elo.
    eloWeight: 0.45,
    eloStart: 1500,
    eloK: 20,
    // Quantos golos de supremacia vale 100 pontos de Elo de diferenca.
    eloGoalsPer100: 0.34,
  },

  // --- Criterios de aposta -----------------------------------------------
  betting: {
    // Vantagem minima sobre a probabilidade justa do mercado.
    minEdge: num('MIN_EDGE', 0.04),
    // Fora desta janela de odds o modelo e pouco fiavel ou o retorno nao
    // compensa a variancia.
    minOdds: num('MIN_ODDS', 1.45),
    maxOdds: num('MAX_ODDS', 6.0),
    // Fracao de Kelly. Kelly inteiro e demasiado agressivo com
    // probabilidades estimadas.
    kellyFraction: num('KELLY_FRACTION', 0.25),
    maxStakePct: num('MAX_STAKE_PCT', 0.03),
    // Confianca minima (0-1) para a aposta aparecer na lista.
    minConfidence: num('MIN_CONFIDENCE', 0.35),
    maxPicksPerDay: num('MAX_PICKS_PER_DAY', 12),
    // Metodo para remover a margem da casa das odds.
    devigMethod: env('DEVIG_METHOD', 'shin'), // shin | proportional
  },

  // --- Camada de IA ------------------------------------------------------
  ai: {
    enabled: env('AI_ENABLED', 'true') !== 'false',
    model: env('AI_MODEL', 'claude-opus-5'),
    effort: env('AI_EFFORT', 'medium'),
    // Limite de jogos enviados ao modelo por execucao, para travar custo.
    maxFixtures: num('AI_MAX_FIXTURES', 20),
    // O ajuste da IA nunca pode dominar o modelo estatistico.
    maxAdjustment: 0.08,
  },

};

export const hasOdds = () => Boolean(config.oddsApiKey);
export const hasFootball = () => Boolean(config.footballApiKey);
export const hasAI = () => config.ai.enabled && Boolean(config.anthropicApiKey);
export const hasSupabase = () => Boolean(config.supabaseUrl && config.supabaseServiceKey);
export const isDemo = () => !hasOdds();
