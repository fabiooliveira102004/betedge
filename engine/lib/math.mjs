// Funcoes numericas partilhadas pelo motor.

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export const mean = (xs) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

export const round = (x, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

// Poisson P(X = k) calculado em espaco logaritmico: k pode chegar a 12 e
// 12! ainda cabe num double, mas o produto lambda^k * e^-lambda perde
// precisao para lambdas pequenos.
export function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

const LOG_FACT = [0];
function logFactorial(k) {
  for (let i = LOG_FACT.length; i <= k; i++) {
    LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  }
  return LOG_FACT[k];
}

// Encolhe uma taxa observada em direcao a 1 (a media da liga) quando ha
// poucos jogos. `prior` jogos equivalem a "nao sei nada sobre esta equipa".
export function shrink(rate, matches, prior = 6) {
  if (!Number.isFinite(rate) || matches <= 0) return 1;
  return (rate * matches + 1 * prior) / (matches + prior);
}

export function normalise(vector) {
  const total = sum(vector);
  if (total <= 0) return vector.map(() => 0);
  return vector.map((v) => v / total);
}
