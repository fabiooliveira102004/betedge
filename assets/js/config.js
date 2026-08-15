/**
 * Configuracao da app.
 *
 * Preenche estes dois valores com os do teu projeto Supabase
 * (Project Settings -> API). A chave `anon` e publica por design: quem
 * protege os dados sao as politicas RLS definidas em supabase/schema.sql,
 * nao o segredo da chave. Nunca coloques aqui a `service_role`.
 *
 * Enquanto estiverem vazios a app funciona na mesma, em modo local: le as
 * analises dos ficheiros JSON e guarda a banca e as apostas seguidas no
 * armazenamento do proprio telemovel.
 */
export const SUPABASE = {
  url: '',
  anonKey: '',
};

export const APP = {
  name: 'BetEdge',
  /** De onde a app le as analises publicadas pelo motor. */
  dataPath: './data/',
  /** Quantas apostas do historico mostrar de cada vez. */
  historyPageSize: 25,
  /** Prefixo das chaves guardadas no dispositivo. */
  storagePrefix: 'betedge.',
  currency: 'EUR',
  locale: 'pt-PT',
};

export const supabaseReady = () => Boolean(SUPABASE.url && SUPABASE.anonKey);
