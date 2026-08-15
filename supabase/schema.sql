-- ============================================================================
-- BetEdge — esquema da base de dados
--
-- Executa este ficheiro inteiro no SQL Editor do Supabase (uma vez).
-- E idempotente: podes voltar a correr depois de alterares alguma coisa.
--
-- Modelo de seguranca:
--   * As analises (fixtures, picks, stats) sao publicas para leitura — sao o
--     produto da app e nao contem nada de pessoal.
--   * Escrita nessas tabelas so com a service_role key, que vive nos GitHub
--     Secrets e nunca chega ao browser.
--   * Os dados de cada utilizador (perfil, apostas registadas) so sao
--     visiveis e editaveis pelo proprio, garantido por RLS ao nivel da base
--     de dados — nao por verificacoes no frontend.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Perfis
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,

  -- Banca em euros. As stakes vem do motor em fracao da banca; e aqui que
  -- se converte para dinheiro real.
  bankroll     numeric(12,2) not null default 100 check (bankroll >= 0),
  currency     text not null default 'EUR',

  -- Filtros pessoais: cada utilizador pode ser mais ou menos exigente do
  -- que os limites com que o motor publica.
  min_edge       numeric(5,4) not null default 0.04 check (min_edge >= 0 and min_edge <= 1),
  min_confidence numeric(5,4) not null default 0.35 check (min_confidence >= 0 and min_confidence <= 1),
  max_stake_pct  numeric(5,4) not null default 0.03 check (max_stake_pct > 0 and max_stake_pct <= 0.25),
  leagues        text[] not null default '{}',            -- vazio = todas

  onboarded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.profiles.leagues is
  'Ligas seguidas. Array vazio significa todas as ligas.';

-- ---------------------------------------------------------------------------
-- Jogos analisados
-- ---------------------------------------------------------------------------
create table if not exists public.fixtures (
  id          text primary key,
  league      text not null,
  home_team   text not null,
  away_team   text not null,
  kickoff     timestamptz not null,
  status      text not null default 'scheduled',
  home_goals  int,
  away_goals  int,
  lambda_home numeric(6,3),
  lambda_away numeric(6,3),
  updated_at  timestamptz not null default now()
);

create index if not exists fixtures_kickoff_idx on public.fixtures (kickoff desc);

-- ---------------------------------------------------------------------------
-- Apostas propostas pelo motor
-- ---------------------------------------------------------------------------
create table if not exists public.picks (
  id          text primary key,
  fixture_id  text references public.fixtures(id) on delete cascade,
  league      text not null,
  home_team   text not null,
  away_team   text not null,
  kickoff     timestamptz not null,

  market      text not null,
  selection   text not null,
  line        numeric(4,1),
  description text not null,

  odds        numeric(7,3) not null check (odds > 1),
  bookmaker   text not null default 'betclic',

  model_prob  numeric(6,5) not null check (model_prob between 0 and 1),
  fair_prob   numeric(6,5) not null check (fair_prob between 0 and 1),
  edge        numeric(6,5) not null,
  ev          numeric(7,5) not null,
  stake       numeric(7,5) not null check (stake >= 0),
  confidence  numeric(5,4) not null check (confidence between 0 and 1),

  -- Porque e que o modelo chegou aqui: lesoes, descanso, contexto da IA.
  factors     jsonb,
  ai_summary  jsonb,

  is_demo      boolean not null default false,
  generated_at timestamptz not null default now(),

  -- Preenchidos pela liquidacao, depois do jogo.
  settled     boolean not null default false,
  result      text check (result in ('win','loss','push','void')),
  final_score text,
  pnl_units   numeric(8,5),
  settled_at  timestamptz
);

create index if not exists picks_kickoff_idx  on public.picks (kickoff desc);
create index if not exists picks_settled_idx  on public.picks (settled, kickoff desc);
create index if not exists picks_league_idx   on public.picks (league);

-- ---------------------------------------------------------------------------
-- Apostas que o utilizador realmente registou
--
-- Separado de `picks` de proposito: o motor propoe, o utilizador decide.
-- A odd e a stake ficam congeladas no momento em que ele aposta, porque a
-- odd da Betclic muda e o registo tem de refletir o que ele apanhou.
-- ---------------------------------------------------------------------------
create table if not exists public.user_bets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  pick_id    text references public.picks(id) on delete set null,

  stake_amount numeric(12,2) not null check (stake_amount > 0),
  odds_taken   numeric(7,3) not null check (odds_taken > 1),
  placed_at    timestamptz not null default now(),

  status  text not null default 'open' check (status in ('open','win','loss','push','void','cancelled')),
  payout  numeric(12,2),
  note    text,

  -- Copia dos dados do jogo, para o historico continuar legivel mesmo que o
  -- pick seja apagado.
  snapshot jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, pick_id)
);

create index if not exists user_bets_user_idx on public.user_bets (user_id, placed_at desc);

-- ---------------------------------------------------------------------------
-- Fotografias diarias das estatisticas globais
-- ---------------------------------------------------------------------------
create table if not exists public.stats_snapshots (
  id          text primary key,          -- YYYY-MM-DD
  captured_at timestamptz not null default now(),
  payload     jsonb not null
);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles       enable row level security;
alter table public.fixtures       enable row level security;
alter table public.picks          enable row level security;
alter table public.user_bets      enable row level security;
alter table public.stats_snapshots enable row level security;

-- Analises: leitura livre, escrita so pela service_role (que ignora RLS,
-- por isso nao precisa de politica).
drop policy if exists "leitura publica de jogos" on public.fixtures;
create policy "leitura publica de jogos"
  on public.fixtures for select using (true);

drop policy if exists "leitura publica de apostas" on public.picks;
create policy "leitura publica de apostas"
  on public.picks for select using (true);

drop policy if exists "leitura publica de estatisticas" on public.stats_snapshots;
create policy "leitura publica de estatisticas"
  on public.stats_snapshots for select using (true);

-- Perfis: cada um so ve e edita o seu.
drop policy if exists "ver o proprio perfil" on public.profiles;
create policy "ver o proprio perfil"
  on public.profiles for select using (auth.uid() = id);

drop policy if exists "criar o proprio perfil" on public.profiles;
create policy "criar o proprio perfil"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "editar o proprio perfil" on public.profiles;
create policy "editar o proprio perfil"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Apostas do utilizador: idem.
drop policy if exists "ver as proprias apostas" on public.user_bets;
create policy "ver as proprias apostas"
  on public.user_bets for select using (auth.uid() = user_id);

drop policy if exists "registar apostas" on public.user_bets;
create policy "registar apostas"
  on public.user_bets for insert with check (auth.uid() = user_id);

drop policy if exists "editar as proprias apostas" on public.user_bets;
create policy "editar as proprias apostas"
  on public.user_bets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "apagar as proprias apostas" on public.user_bets;
create policy "apagar as proprias apostas"
  on public.user_bets for delete using (auth.uid() = user_id);

-- ============================================================================
-- Automatismos
-- ============================================================================

-- Cria o perfil assim que alguem se regista, para que a app nunca encontre
-- um utilizador autenticado sem linha em profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at automatico.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists user_bets_touch on public.user_bets;
create trigger user_bets_touch before update on public.user_bets
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Liquidacao automatica das apostas do utilizador
--
-- Quando o motor marca um pick como liquidado, as apostas dos utilizadores
-- sobre esse pick seguem o mesmo destino. Fazer isto na base de dados evita
-- que o motor precise de percorrer utilizadores um a um.
-- ============================================================================
create or replace function public.settle_user_bets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.settled and coalesce(old.settled, false) = false and new.result is not null then
    update public.user_bets ub
       set status = new.result,
           payout = case
                      when new.result = 'win'  then ub.stake_amount * ub.odds_taken
                      when new.result = 'loss' then 0
                      else ub.stake_amount      -- push / void devolvem a stake
                    end
     where ub.pick_id = new.id
       and ub.status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists picks_settle_user_bets on public.picks;
create trigger picks_settle_user_bets
  after update on public.picks
  for each row execute function public.settle_user_bets();

-- ============================================================================
-- Vista de desempenho por utilizador
-- ============================================================================
create or replace view public.user_performance
with (security_invoker = true) as
select
  ub.user_id,
  count(*)                                              as total_bets,
  count(*) filter (where ub.status = 'open')            as open_bets,
  count(*) filter (where ub.status = 'win')             as wins,
  count(*) filter (where ub.status = 'loss')            as losses,
  count(*) filter (where ub.status in ('push','void'))  as pushes,
  coalesce(sum(ub.stake_amount) filter (where ub.status <> 'open'), 0)          as total_staked,
  coalesce(sum(coalesce(ub.payout, 0) - ub.stake_amount)
           filter (where ub.status <> 'open'), 0)                               as profit
from public.user_bets ub
group by ub.user_id;
