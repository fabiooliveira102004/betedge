/**
 * Versao leve de uma aposta, para o arquivo.
 *
 * A analise completa — narrativa, forma das equipas, confrontos diretos,
 * distribuicao de golos — pesa alguns kB por aposta. Multiplicado por
 * centenas de apostas arquivadas, o telemovel teria de descarregar
 * megabytes so para abrir o separador do historico.
 *
 * No arquivo o que interessa e o que foi apostado e o que aconteceu. A
 * analise so acompanha as apostas ativas, que sao as que ainda dao para
 * jogar e onde a explicacao serve para alguma coisa.
 *
 * Vive num modulo proprio porque tanto run.mjs como settle.mjs e seed.mjs
 * precisam dela, e importa-la de um deles faria correr o `main()` desse
 * ficheiro como efeito secundario.
 */
export function slimPick(pick) {
  const {
    narrative, caveats, scorelines, goalsDistribution, teams, h2h, winCondition,
    ...rest
  } = pick;
  return rest;
}
