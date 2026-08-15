import { $, esc, render } from './util.js';
import { supabaseReady } from './config.js';
import { state } from './state.js';

/**
 * Como funciona, e as preferencias.
 *
 * Nao ha banca nem apostas registadas: a app nao gere dinheiro, so analisa
 * jogos. As unicas preferencias que fazem sentido sao quais as ligas a
 * seguir e o tema.
 */
export function renderAbout() {
  const meta = $('#about-meta');
  meta.textContent = state.meta?.demo ? 'a correr com dados de exemplo' : 'a correr com dados reais';

  render($('#about-body'), [
    leaguesCard(),
    methodCard(),
    sourcesCard(),
    limitsCard(),
    responsible(),
  ].join(''));
}

/* ── Ligas seguidas ─────────────────────────────────────────────────── */

function leaguesCard() {
  const all = [...new Set([
    ...state.matches.map((m) => m.league),
    ...state.results.map((r) => r.league),
  ])].sort();

  if (all.length === 0) return '';

  const followed = state.profile?.leagues ?? [];

  return `
  <section class="card">
    <h2 class="card__title">Ligas</h2>
    <p class="card__sub">
      Escolhe as que queres ver. Sem nenhuma selecionada aparecem todas.
    </p>
    <div class="chips" style="margin:0;padding:0">
      ${all.map((l) => `
        <button type="button" class="chip" data-follow="${esc(l)}"
                aria-pressed="${followed.includes(l)}">${esc(l)}</button>`).join('')}
    </div>
    ${followed.length ? `
      <button type="button" class="link-btn" style="margin-top:12px" data-action="clear-leagues">
        mostrar todas
      </button>` : ''}
    ${!supabaseReady() ? `
      <p class="detail__note">
        Guardado neste dispositivo. Com base de dados configurada, a escolha
        acompanha-te em qualquer telemovel.
      </p>` : ''}
  </section>`;
}

/* ── Metodo ─────────────────────────────────────────────────────────── */

function methodCard() {
  return `
  <section class="card">
    <h2 class="card__title">Como as probabilidades sao calculadas</h2>

    <h4 class="detail__subtitle">1. Forca das equipas</h4>
    <p class="detail__prose">
      Cada equipa tem um rating Elo, atualizado jogo a jogo e escalado pela diferenca
      de golos — vencer 4-0 move mais o rating do que vencer 1-0. A isso juntam-se as
      taxas de golos marcados e sofridos, separadas entre casa e fora, encolhidas para
      a media da liga quando ha poucos jogos.
    </p>

    <h4 class="detail__subtitle">2. Golos esperados</h4>
    <p class="detail__prose">
      O ataque de cada equipa cruza com a defesa da outra. O Elo diz quem e melhor,
      as taxas dizem quantos golos se marcam, e a vantagem de jogar em casa entra por
      cima. Sai um numero de golos esperados para cada lado.
    </p>

    <h4 class="detail__subtitle">3. Probabilidade de cada resultado</h4>
    <p class="detail__prose">
      Um modelo Dixon-Coles transforma esses golos esperados na probabilidade de cada
      resultado exato — 1-0, 2-1, 3-2. E Poisson com uma correcao nos resultados baixos,
      porque o Poisson simples subestima sistematicamente 0-0 e 1-1. Todos os mercados
      saem dessa mesma matriz, por isso as percentagens sao coerentes entre si.
    </p>

    <h4 class="detail__subtitle">4. Contexto</h4>
    <p class="detail__prose">
      Sobre os golos esperados entram lesoes e castigos (pesados por posicao: um avancado
      tira ataque, um guarda-redes tira defesa) e os dias de descanso desde o ultimo jogo.
      Quando ha chave de IA configurada, os titulos de noticias sao lidos a procura do que
      os numeros nao mostram — treinador de saida, salarios em atraso, jogo sem nada em
      jogo — com um ajuste limitado a 8%.
    </p>

    <h4 class="detail__subtitle">5. Comparacao com a casa</h4>
    <p class="detail__prose">
      A soma de 1 a dividir por cada odd de um mercado da sempre mais de 100%: a sobra e
      a margem da casa. E retirada pelo metodo de Shin, que a distribui de forma mais
      realista do que uma reparticao proporcional. O que fica e o preco justo do mercado,
      e e contra esse preco que a probabilidade do modelo e comparada.
    </p>
  </section>`;
}

/* ── Fontes ─────────────────────────────────────────────────────────── */

function sourcesCard() {
  const m = state.meta;
  const row = (label, value, note) => `
    <div class="row-between">
      <div>
        <span style="font-size:13.5px">${esc(label)}</span>
        ${note ? `<p class="detail__note" style="margin:1px 0 0">${esc(note)}</p>` : ''}
      </div>
      <span class="bar__meta">${esc(value ?? 'nao configurado')}</span>
    </div>`;

  return `
  <section class="card">
    <h2 class="card__title">De onde vem os dados</h2>
    ${row('Odds', m?.sources?.odds, 'cotacoes da Betclic, via agregador licenciado')}
    ${row('Resultados e lesoes', m?.sources?.football, 'historico de jogos e ausencias')}
    ${row('Noticias', m?.sources?.news ?? 'google-news-rss', 'titulos recentes por equipa')}
    ${row('Leitura de contexto', m?.sources?.ai, 'interpretacao dos titulos')}
    <p class="detail__note">
      A Betclic nao tem API publica, e fazer scraping do site seria fragil e contra os
      termos de utilizacao. As odds vem de um agregador licenciado. Se a Betclic nao
      cotar um jogo, esse jogo nao aparece — nunca substituimos pela odd de outra casa.
    </p>
  </section>`;
}

/* ── Limites ────────────────────────────────────────────────────────── */

function limitsCard() {
  return `
  <section class="card">
    <h2 class="card__title">O que esta app nao faz</h2>
    <p class="detail__prose">
      <strong>Nao aposta por ti</strong> e nao se liga a nenhuma conta de apostas.
      Mostra analise; a decisao e inteiramente tua.
    </p>
    <p class="detail__prose">
      <strong>Nao gere dinheiro.</strong> Nao ha banca, nao ha stakes sugeridas, nao ha
      registo de apostas. Isso era outra app.
    </p>
    <p class="detail__prose">
      <strong>Nao adivinha resultados.</strong> Nenhum modelo consegue. O que faz e
      estimar probabilidades — e uma probabilidade de 70% falha 3 vezes em cada 10.
      Se as odds da casa forem consistentemente melhores estimativas do que este modelo,
      a pagina do Modelo vai mostrar isso.
    </p>
  </section>`;
}

function responsible() {
  return `
  <p class="legal">
    <strong>Joga com cabeca.</strong>
    Apostas sao proibidas a menores de 18 anos. Aposta apenas dinheiro que podes perder,
    nunca para recuperar perdas anteriores, e define limites antes de comecar. Se sentires
    que perdeste o controlo, procura ajuda: <strong>SICAD — Linha Vida 1414</strong>.
  </p>`;
}
