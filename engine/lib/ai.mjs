import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.mjs';
import { clamp } from './math.mjs';
import { log } from './log.mjs';

/**
 * Camada de leitura de contexto.
 *
 * O modelo estatistico sabe golos, forma e Elo. Nao sabe que o capitao se
 * divorciou, que o treinador esta de saida, que o plantel entrou em greve ou
 * que o jogo nao vale nada porque a equipa ja esta despromovida. E isso que
 * esta camada le — nos titulos de noticias — e converte em ajustes pequenos
 * e limitados aos golos esperados.
 *
 * O ajuste e deliberadamente limitado (config.ai.maxAdjustment): a IA
 * tempera o modelo, nunca o substitui.
 */

const SYSTEM_PROMPT = `Es um analista de futebol que le contexto extra-desportivo para um modelo de apostas.

Recebes, para cada jogo: as equipas, os golos esperados que o modelo estatistico ja calculou, as ausencias conhecidas e titulos de noticias recentes sobre cada equipa.

A tua tarefa e identificar o que os numeros nao captam e traduzi-lo num ajuste pequeno aos golos esperados de cada equipa.

Considera qualquer coisa que afete o rendimento em campo:
- instabilidade tecnica (treinador de saida, acabado de chegar, conflito com o plantel)
- problemas pessoais de jogadores importantes (divorcio, luto, processos judiciais, problemas de saude na familia)
- ambiente do clube (salarios em atraso, contestacao dos adeptos, crise diretiva, greve)
- motivacao real do jogo (ja campeao, ja despromovido, final da epoca sem nada em jogo, decisao na semana seguinte)
- calendario e rotacao (jogo europeu a meio da semana, final proxima, castigos)
- transferencias em cima da hora que tirem um titular
- fatores externos relevantes (relvado, viagem longa, condicoes meteorologicas extremas)

Regras:
- attackAdjust e defenceAdjust sao multiplicadores centrados em 1.0. 1.0 significa "nada a assinalar".
- Fica entre 0.92 e 1.08. So te aproximas dos extremos com evidencia forte e concreta nos titulos.
- Se os titulos forem rotina (antevisoes, resultados passados, escalacoes provaveis), devolve 1.0. A ausencia de noticia nao e sinal.
- defenceAdjust acima de 1.0 significa que a equipa vai sofrer MAIS golos.
- Nao repitas o efeito das lesoes: essas ja foram contabilizadas pelo modelo. So as mencionas se o titulo revelar algo que a lista de lesionados nao diz.
- summary em portugues, uma frase, concreta. Se nao ha nada a assinalar escreve "sem sinais relevantes".
- confidenceModifier entre -0.2 e 0.2: negativo quando o contexto torna o jogo imprevisivel (caos no clube, escalacao incerta), positivo quando tudo esta estavel e previsivel.`;

const SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fixtureId: { type: 'string' },
          home: {
            type: 'object',
            properties: {
              attackAdjust: { type: 'number' },
              defenceAdjust: { type: 'number' },
              summary: { type: 'string' },
            },
            required: ['attackAdjust', 'defenceAdjust', 'summary'],
            additionalProperties: false,
          },
          away: {
            type: 'object',
            properties: {
              attackAdjust: { type: 'number' },
              defenceAdjust: { type: 'number' },
              summary: { type: 'string' },
            },
            required: ['attackAdjust', 'defenceAdjust', 'summary'],
            additionalProperties: false,
          },
          keySignals: { type: 'array', items: { type: 'string' } },
          confidenceModifier: { type: 'number' },
        },
        required: ['fixtureId', 'home', 'away', 'keySignals', 'confidenceModifier'],
        additionalProperties: false,
      },
    },
  },
  required: ['assessments'],
  additionalProperties: false,
};

export async function assessContext(briefs) {
  if (briefs.length === 0) return new Map();

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const batch = briefs.slice(0, config.ai.maxFixtures);

  let response;
  try {
    response = await client.beta.messages.create({
      model: config.ai.model,
      max_tokens: 32000,
      // Fallback do lado do servidor: se um classificador recusar o pedido,
      // a Anthropic reencaminha para outro modelo na mesma chamada em vez
      // de nos devolver uma analise vazia.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: {
        effort: config.ai.effort,
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{ role: 'user', content: renderBriefs(batch) }],
    });
  } catch (err) {
    log.warn(`Analise de contexto falhou, seguimos so com o modelo: ${err.message}`);
    return new Map();
  }

  if (response.stop_reason === 'refusal') {
    log.warn(`Analise de contexto recusada (${response.stop_details?.category ?? 'sem categoria'})`);
    return new Map();
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    log.warn('Analise de contexto devolveu resposta vazia');
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    log.warn('Analise de contexto devolveu JSON invalido');
    return new Map();
  }

  const max = config.ai.maxAdjustment;
  const bound = (v) => clamp(Number(v) || 1, 1 - max, 1 + max);

  const out = new Map();
  for (const a of parsed.assessments ?? []) {
    out.set(a.fixtureId, {
      home: {
        attack: bound(a.home?.attackAdjust),
        defence: bound(a.home?.defenceAdjust),
        summary: a.home?.summary ?? null,
      },
      away: {
        attack: bound(a.away?.attackAdjust),
        defence: bound(a.away?.defenceAdjust),
        summary: a.away?.summary ?? null,
      },
      keySignals: Array.isArray(a.keySignals) ? a.keySignals.slice(0, 5) : [],
      confidenceModifier: clamp(Number(a.confidenceModifier) || 0, -0.2, 0.2),
    });
  }

  log.info(`Contexto analisado para ${out.size}/${batch.length} jogos (${response.model})`);
  return out;
}

function renderBriefs(briefs) {
  const blocks = briefs.map((b) => {
    const lines = [
      `## Jogo ${b.fixtureId}`,
      `${b.home} (casa) vs ${b.away} (fora) — ${b.league}, ${b.kickoff}`,
      `Golos esperados pelo modelo: ${b.home} ${b.lambdaHome.toFixed(2)}, ${b.away} ${b.lambdaAway.toFixed(2)}`,
    ];

    for (const side of ['home', 'away']) {
      const team = b[side];
      const injuries = b.injuries?.[side] ?? [];
      lines.push(
        injuries.length
          ? `Ausencias ${team}: ${injuries.map((i) => `${i.player} (${i.position ?? '?'}, ${i.reason})`).join('; ')}`
          : `Ausencias ${team}: nenhuma reportada`,
      );
    }

    for (const side of ['home', 'away']) {
      const team = b[side];
      const news = b.news?.[side] ?? [];
      lines.push(`Noticias recentes sobre ${team}:`);
      lines.push(news.length
        ? news.map((n) => `  - ${n.title}`).join('\n')
        : '  - (sem titulos recolhidos)');
    }

    return lines.join('\n');
  });

  return `Analisa o contexto extra-desportivo dos jogos abaixo e devolve um objeto com um elemento em "assessments" por jogo, usando exatamente o fixtureId indicado.\n\n${blocks.join('\n\n')}`;
}
