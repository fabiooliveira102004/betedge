# BetEdge

Ferramenta de análise de jogos de futebol, que corre no telemóvel a partir de um
link `github.io` e não precisa de servidor.

Abres a app, vês os jogos que vêm aí, e para cada um: o que um modelo estatístico
calcula para cada resultado, como isso se compara com as odds da **Betclic**, e
que dados sustentam essa conclusão — forma, confrontos diretos, ausências,
notícias.

**Não é uma app de apostas.** Não aposta por ti, não se liga a nenhuma conta, não
gere dinheiro e não sugere quanto arriscar. Mostra análise; a decisão é tua.

```
GitHub Actions (de 6 em 6 h)          GitHub Pages
┌──────────────────────────┐         ┌──────────────┐
│ odds Betclic             │         │              │
│ histórico + lesões       │ ──JSON→ │  app (PWA)   │
│ notícias                 │         │              │
│ modelo → probabilidades  │         └──────────────┘
└──────────────────────────┘
```

---

## O que vês

**Jogos** — os próximos jogos por dia, cada um com o resultado que o modelo
considera mais provável, a probabilidade dos três resultados, e uma etiqueta
quando há odds que o modelo considera generosas.

**O jogo, em detalhe** — toca num jogo e abre:

| Secção | O que mostra |
|---|---|
| **Veredicto** | o que o modelo acha que vai acontecer, e com que força |
| **O que a casa paga, o que o modelo calcula** | todos os mercados, linha a linha: odd, probabilidade do modelo, diferença |
| **Como o jogo deve correr** | probabilidade por total de golos, resultados exatos mais prováveis |
| **As equipas** | forma recente, médias em casa e fora, Elo, últimos jogos, ausências |
| **Confrontos diretos** | resultados anteriores entre as duas |
| **Notícias recentes** | títulos dos últimos dias sobre cada equipa, sem filtro |
| **O que o modelo teve em conta** | lesões, descanso, e a leitura de contexto quando há IA configurada |
| **Fiabilidade** | qualidade dos dados desta análise e o que pode falhar |

**Resultados** — jogos já disputados, com o resultado real ao lado da previsão
que tinha sido publicada antes do apito. Inclui os que o modelo falhou.

**Modelo** — quantas vezes acerta, comparado com um palpite sem análise nenhuma,
e a calibração: quando diz 60%, acontece mesmo ~60% das vezes?

---

## Ver a funcionar agora

Sem chave nenhuma o motor gera jogos de exemplo e a app funciona de ponta a ponta.

```bash
cd engine && npm install

node seed.mjs 45   # jogos passados simulados
node run.mjs       # análise dos próximos jogos

cd .. && python3 -m http.server 8000
```

Abre <http://localhost:8000>. A app avisa, no topo e na lista, que os jogos são
inventados.

---

## Pôr online

### 1. GitHub Pages

Faz push e, em **Settings → Pages**, escolhe **Source: GitHub Actions** (o
workflow ativa-o sozinho na primeira execução). A app fica em
`https://<utilizador>.github.io/<repositorio>/`.

No telemóvel, *Adicionar ao ecrã principal* instala-a como aplicação: arranca em
ecrã inteiro e funciona offline com os últimos dados descarregados.

### 2. Dados reais

Em **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Onde obter | Plano gratuito | Sem ela |
|---|---|---|---|
| `ODDS_API_KEY` | [the-odds-api.com](https://the-odds-api.com) | 500 pedidos/mês | jogos de exemplo |
| `API_FOOTBALL_KEY` | [api-football.com](https://www.api-football.com) | 100 pedidos/dia | sem forma, Elo, h2h nem lesões |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | pago ao uso | notícias aparecem sem interpretação |

As notícias funcionam sempre: vêm do RSS do Google News, que não precisa de chave.

**Porque não vai à Betclic diretamente:** a Betclic não tem API pública, e fazer
scraping seria frágil e contra os termos de utilização. As odds vêm de um
agregador licenciado que a inclui. Se a Betclic não cotar um jogo, esse jogo não
aparece — nunca se substitui pela odd de outra casa.

### 3. Base de dados (opcional)

O motor pode escrever as análises para Supabase, o que dá um histórico completo e
consultável para além da janela que os ficheiros JSON guardam. Corre
[`supabase/schema.sql`](supabase/schema.sql) no SQL Editor e adiciona
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` aos secrets.

A app não precisa disto para funcionar, e não tem contas de utilizador: as únicas
preferências que guarda — ligas seguidas e tema — ficam no próprio dispositivo.

---

## Como as probabilidades são calculadas

**1. Força das equipas.** Ratings Elo atualizados jogo a jogo, com o K escalado
pela diferença de golos (4-0 move mais que 1-0), combinados com as taxas de golos
marcados e sofridos, separadas entre casa e fora e encolhidas para a média da
liga quando há poucos jogos.

**2. Golos esperados.** O ataque de cada equipa cruza com a defesa da outra. O Elo
diz quem é melhor, as taxas dizem quantos golos se marcam, e a vantagem caseira
entra por cima.

**3. Probabilidade de cada resultado.** Um modelo **Dixon-Coles** transforma os
golos esperados na probabilidade de cada resultado exato. É Poisson com uma
correção nos resultados baixos, porque o Poisson simples subestima 0-0 e 1-1.
Todos os mercados saem da mesma matriz, por isso as percentagens são coerentes
entre si.

**4. Contexto.** Lesões e castigos pesados por posição (um avançado tira ataque,
um guarda-redes tira defesa), dias de descanso, e — com chave de IA — uma leitura
dos títulos de notícias à procura do que os números não mostram: treinador de
saída, salários em atraso, jogo sem nada em jogo. O ajuste é limitado a ±8%.

**5. Comparação com a casa.** A soma de `1/odd` de um mercado dá sempre mais de 1:
a sobra é a margem. É retirada pelo **método de Shin**, mais realista do que uma
repartição proporcional. O que fica é o preço justo, e é contra esse preço que a
probabilidade do modelo é comparada.

---

## Registo honesto

Cada previsão é gravada **antes** do jogo. O resultado é colado por cima depois,
pelo passo de liquidação. Os jogos em que o modelo falhou aparecem exatamente
como os outros.

A página do **Modelo** compara o acerto com um palpite sem análise nenhuma
(apostar sempre na equipa da casa). Se o modelo não bater esse baseline, a app
mostra isso — um número de acerto sem termo de comparação não diz nada.

---

## Estrutura

```
index.html, assets/       app (PWA, sem passo de build)
  └── js/match-detail.js  a análise completa de um jogo
data/
  ├── matches.json        próximos jogos com todos os mercados
  ├── results.json        jogos passados e acerto do modelo
  └── stats.json          calibração e desempenho por mercado
engine/
  ├── run.mjs             analisar e publicar
  ├── settle.mjs          verificar resultados
  ├── seed.mjs            dados de exemplo
  └── lib/
      ├── model.mjs       Dixon-Coles
      ├── match.mjs       o jogo com todos os mercados
      ├── insight.mjs     forma, confrontos, distribuições
      ├── results.mjs     arquivo e acerto do veredicto
      └── value.mjs       margem da casa e comparação
supabase/schema.sql       tabelas e políticas (opcional)
.github/workflows/        análise agendada e publicação
```

---

## Comandos

```bash
cd engine
node run.mjs          # analisar os próximos jogos
node settle.mjs       # arquivar jogos terminados com o resultado real
node seed.mjs 60      # regenerar dados de exemplo
```

---

## Aviso

Nenhum modelo prevê resultados desportivos com certeza. Estas são estimativas de
probabilidade, e uma probabilidade de 70% falha 3 vezes em cada 10.

Apostas são proibidas a menores de 18 anos. Aposta apenas dinheiro que podes
perder, nunca para recuperar perdas anteriores, e define limites antes de
começar. Se sentires que perdeste o controlo, procura ajuda:
**SICAD — Linha Vida 1414**.
