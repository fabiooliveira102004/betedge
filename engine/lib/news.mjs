import { request } from './http.mjs';
import { log } from './log.mjs';

/**
 * Titulos recentes por equipa, via RSS do Google News (sem chave).
 *
 * E aqui que entra o contexto que nao aparece em nenhuma tabela: conflitos
 * com o treinador, transferencias por fechar, problemas pessoais de um
 * jogador, crise diretiva. O RSS so nos da os titulos — quem os interpreta
 * e a camada de IA em ai.mjs.
 */
export async function fetchTeamNews(team, { lang = 'pt-PT', country = 'PT', days = 5 } = {}) {
  const query = `${team} when:${days}d`;
  const url = 'https://news.google.com/rss/search?'
    + new URLSearchParams({
      q: query,
      hl: lang,
      gl: country,
      ceid: `${country}:${lang.split('-')[0]}`,
    });

  try {
    const xml = await request(url, { parse: 'text', retries: 1, timeoutMs: 12000 });
    return parseRss(xml).slice(0, 12);
  } catch (err) {
    log.warn(`Noticias indisponiveis para ${team}: ${err.message}`);
    return [];
  }
}

function parseRss(xml) {
  const items = [];
  // Um parser XML completo seria uma dependencia inteira para ler tres
  // campos de um feed com formato fixo.
  const itemBlocks = xml.split('<item>').slice(1);

  for (const block of itemBlocks) {
    const title = decode(tag(block, 'title'));
    const pubDate = tag(block, 'pubDate');
    const source = decode(tag(block, 'source'));
    if (!title) continue;
    items.push({ title, source: source || null, publishedAt: pubDate || null });
  }

  return items;
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!match) return '';
  return match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
