# BetEdge

Análise de apostas desportivas que corre no telemóvel a partir de um link
`github.io`, sem servidor para manter.

Um motor em Node analisa os jogos, compara as suas probabilidades com as odds
da **Betclic** e publica só as apostas em que há vantagem real. A app mostra
essas apostas, explica o raciocínio de cada uma e guarda o resultado de todas —
incluindo as que correram mal.

```
GitHub Actions (de 6 em 6 h)          GitHub Pages                Supabase
┌──────────────────────────┐         ┌──────────────┐        ┌──────────────┐
│ odds Betclic             │         │              │        │ contas       │
│ histórico + lesões       │ ──JSON→ │  app (PWA)   │ ←────→ │ banca        │
│ notícias + leitura IA    │         │              │        │ apostas      │
│ modelo → apostas         │         └──────────────┘        └──────────────┘
└──────────────────────────┘
```

---

## Ver a funcionar agora

Não precisas de chave nenhuma para começar — sem chaves o motor gera dados de
demonstração e a app funciona de ponta a ponta.

```bash
cd engine && npm install

node seed.mjs 45   # histórico simulado dos últimos 45 dias
node run.mjs       # apostas para os próximos jogos

cd .. && python3 -m http.server 8000
```

Abre <http://localhost:8000>. A app avisa que está em modo demonstração.

---

## Pôr online

### 1. Publicar no GitHub Pages

Faz push do repositório e, em **Settings → Pages**, escolhe **Source: GitHub
Actions**. O workflow `.github/workflows/pages.yml` trata do resto.

A app fica em `https://<utilizador>.github.io/<repositorio>/`. Abre esse link no
telemóvel e usa *Adicionar ao ecrã principal* — instala como aplicação, arranca
em ecrã inteiro e funciona offline com os últimos dados descarregados.

### 2. Chaves de dados

Guarda-as em **Settings → Secrets and variables → Actions → Secrets**.

| Secret | Onde obter | Plano gratuito | Sem ela |
|---|---|---|---|
| `ODDS_API_KEY` | [the-odds-api.com](https://the-odds-api.com) | 500 pedidos/mês | modo demonstração |
| `API_FOOTBALL_KEY` | [api-football.com](https://www.api-football.com) | 100 pedidos/dia | sem histórico, Elo nem lesões |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | pago ao uso | sem leitura de contexto |

**Porque não vai a Betclic diretamente:** a Betclic não tem API pública, e fazer
scraping do site seria frágil e contra os termos de utilização. A The Odds API
agrega-a de forma licenciada na região `eu`. Se a Betclic não cotar um jogo, esse
jogo fica de fora — o motor nunca substitui pela odd de outra casa, porque a
aposta tem de ser ao preço que vais mesmo encontrar na tua conta.

### 3. Contas de utilizador (Supabase)

1. Cria um projeto em [supabase.com](https://supabase.com) (o plano gratuito
   chega bem).
2. No **SQL Editor**, cola e corre o ficheiro [`supabase/schema.sql`](supabase/schema.sql)
   inteiro. Cria as tabelas, as políticas de segurança e os automatismos.
3. Em **Project Settings → API**, copia o **Project URL** e a chave **anon**
   para `assets/js/config.js`:

   ```js
   export const SUPABASE = {
     url: 'https://xxxxxxxx.supabase.co',
     anonKey: 'eyJhbGciOi...',
   };
   ```

4. Adiciona aos secrets do GitHub, para o motor poder escrever:
   `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

> A chave **anon** é pública por design e pode ir para o repositório: quem
> protege os dados são as políticas RLS, que garantem ao nível da base de dados
> que cada utilizador só lê e escreve o que é dele. A chave **service_role**
> ignora essas políticas — vive só nos secrets do GitHub e nunca no browser.

Sem Supabase configurado a app continua a funcionar: a banca e as apostas
registadas ficam guardadas nesse telemóvel, sem sincronização.

### 4. Ajustes opcionais

Em **Settings → Secrets and variables → Actions → Variables**:

| Variável | Omissão | O que faz |
|---|---|---|
| `MIN_EDGE` | `0.04` | vantagem mínima para publicar uma aposta |
| `MIN_CONFIDENCE` | `0.35` | confiança mínima na estimativa |
| `MAX_PICKS_PER_DAY` | `12` | teto de apostas por execução |
| `AI_MODEL` | `claude-opus-5` | modelo da camada de contexto |

---

## O que cada aposta explica

Uma aposta sem explicacao e um palpite. Toca num cartao e abre-se a analise
completa, pela ordem das perguntas que se fazem antes de apostar:

| Seccao | Responde a |
|---|---|
| **O que tem de acontecer** | Ganhas se… / Perdes se…, em portugues corrente |
| **Quanto apostar** | stake, retorno se ganhar, perda se perder, e porque e esse valor |
| **Porque esta aposta** | a cadeia de raciocinio em texto: dos golos marcados e sofridos ate a vantagem |
| **Golos esperados** | quantos golos para cada equipa, probabilidade por total de golos, resultados mais provaveis |
| **As equipas** | forma dos ultimos jogos, medias em casa e fora, Elo, ausencias |
| **Confrontos diretos** | resultados anteriores entre as duas |
| **Onde esta a vantagem** | o que a odd implica, o preco justo sem margem, e o que o modelo calcula |
| **O que pode correr mal** | com que frequencia esta aposta perde, e que dados faltam |

A narrativa nao e gerada por IA: sao os mesmos numeros que o modelo usou,
traduzidos para portugues. Se o modelo mudar, a explicacao muda com ele — nunca
podem contradizer-se.

> A Betclic paga 1.88, que implica 53%; retirada a margem da casa, o preco justo
> do mercado e 50%. A diferenca de 14,1 pontos percentuais e a vantagem — e a
> razao pela qual esta aposta aparece e as outras nao.

---

## Como o modelo decide

### 1. Quantos golos se esperam

Ratings **Elo** por equipa (atualizados jogo a jogo, com o K escalado pela
diferença de golos) combinados com as **taxas de golos** marcados e sofridos,
encolhidas para a média da liga quando há poucos jogos. O Elo diz quem é melhor;
as taxas dizem quantos golos se marcam.

### 2. Distribuição de resultados

Modelo **Dixon-Coles**: Poisson para cada equipa mais uma correção nos
resultados baixos, porque o Poisson independente subestima sistematicamente
0-0 e 1-1. Daí sai a probabilidade de cada resultado exacto, e de uma só matriz
derivam-se todos os mercados — por isso as probabilidades são coerentes entre si.

### 3. Contexto

Sobre os golos esperados entram multiplicadores:

- **Lesões e castigos**, pesados por posição (um avançado tira ataque; um
  guarda-redes tira defesa) e saturados, porque há plantel.
- **Dias de descanso** desde o último jogo.
- **Leitura de notícias.** Títulos recentes de cada equipa passam por um modelo
  Claude que procura o que os números não mostram: treinador de saída, salários
  em atraso, problemas pessoais de um titular, jogo sem nada em jogo, contestação
  dos adeptos. O ajuste é limitado a ±8% — tempera o modelo, nunca o substitui.

### 4. Onde está a vantagem

A soma de `1/odd` de um mercado dá sempre mais de 1: a sobra é a margem da casa.
É removida pelo **método de Shin**, que a distribui de forma mais realista do que
uma repartição proporcional. Sobra a probabilidade justa do mercado.

**Vantagem = probabilidade do modelo − probabilidade justa.**

Só é publicada aposta quando a vantagem passa o mínimo, o valor esperado é
positivo e a confiança é suficiente.

### 5. Quanto apostar

**Kelly fracionado** a 25%, com teto de 3% da banca, escalado pela confiança.
Kelly inteiro é demasiado agressivo quando as probabilidades são estimadas em
vez de conhecidas.

### 6. Confiança

Não é a probabilidade de ganhar — é quanto se confia na estimativa. Combina
tamanho da amostra, qualidade dos dados, margem do mercado e a própria vantagem:
uma vantagem de 25% costuma significar que falta informação ao modelo, não que o
mercado está errado, por isso é penalizada.

---

## Histórico honesto

Cada aposta é gravada **antes** do jogo, com odd, probabilidade e raciocínio. O
resultado é colado por cima depois, pelo passo de liquidação. O registo inclui
todas as apostas publicadas — não há forma de apagar as que correram mal.

A vista de **Desempenho** mostra ROI, evolução da banca, queda máxima e, o mais
revelador, a **calibração**: quando o modelo diz 60%, ganha mesmo ~60% das vezes?
Acertar 55% das apostas não diz nada sem saber a que odds; a calibração diz.

---

## Estrutura

```
index.html, assets/       app (PWA sem passo de build)
  └── js/pick-detail.js   a analise completa de uma aposta
data/*.json               análises publicadas — a "API" da app
engine/                   motor de análise (Node)
  ├── config.mjs          limites e ligas
  ├── run.mjs             analisar e publicar
  ├── settle.mjs          verificar resultados
  ├── seed.mjs            histórico de demonstração
  └── lib/
      ├── model.mjs       Dixon-Coles
      ├── value.mjs       margem, vantagem, Kelly
      ├── insight.mjs     forma, confrontos, narrativa, avisos
      └── ...             fontes de dados
supabase/schema.sql       tabelas, RLS e automatismos
.github/workflows/        análise agendada e publicação
```

A app não tem passo de build: é HTML, CSS e módulos ES nativos, servidos tal
como estão. O `npm install` só existe para o motor.

---

## Comandos

```bash
cd engine
node run.mjs          # analisar os próximos jogos
node settle.mjs       # liquidar apostas já jogadas
node seed.mjs 60      # regenerar histórico de demonstração
npm run cycle         # liquidar e depois analisar (o que o Actions faz)
```

---

## Custos

Com os planos gratuitos das APIs de dados e quatro execuções por dia, o único
custo real é a camada de contexto: uns cêntimos por execução, conforme o número
de jogos analisados. Podes desligá-la com `AI_ENABLED=false` — o modelo
estatístico continua a funcionar sem ela.

GitHub Pages, GitHub Actions (em repositório público) e o plano gratuito do
Supabase não custam nada.

---

## Aviso

O BetEdge é uma ferramenta de análise, não uma promessa de lucro. Nenhum modelo
prevê resultados desportivos com certeza, e uma vantagem estatística só se nota
ao fim de muitas apostas — pelo meio há sequências más que é preciso aguentar.

Aposta apenas dinheiro que podes perder, nunca para recuperar perdas anteriores,
e define limites antes de começar. Apostas são proibidas a menores de 18 anos.
Se sentires que perdeste o controlo, procura ajuda: **SICAD — Linha Vida 1414**.
