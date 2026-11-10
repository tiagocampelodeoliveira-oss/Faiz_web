-- Banco do Faiz. Pode rodar várias vezes (tudo é "se não existir").

-- Estado do app de cada pessoa (tarefas, conversa, ajustes). A pessoa só vê e grava o próprio.
create table if not exists public.states (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.states enable row level security;
drop policy if exists "dono le e grava" on public.states;
create policy "dono le e grava" on public.states for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.states to authenticated;

-- Inscrições de aviso (uma por celular). Só o servidor lê e grava.
create table if not exists public.subs (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now()
);
alter table public.subs enable row level security;

-- Avisos já enviados (para nunca repetir). Só o servidor.
create table if not exists public.sent (
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.sent enable row level security;

-- Pedidos à IA por dia (limite por pessoa). Só o servidor.
create table if not exists public.usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.usage enable row level security;

-- Para o relógio de cada minuto.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Dono do teste (recebe alertas, como "crédito da IA acabou"). Só o servidor.
create table if not exists public.owners (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;

-- Situação do serviço (ex.: crédito da IA). Só o servidor.
create table if not exists public.status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.status enable row level security;

-- Problemas relatados pelos testadores ("Algo deu errado"). Só o servidor.
create table if not exists public.reports (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  text text not null,
  ctx jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;

-- Pessoas liberadas sem limite (teste de 7 dias e 40 pedidos por dia), escolhidas pelo Tiago.
-- Preenchida pelo workflow "Liberar sem limite" (scripts/liberar.ts). Só o servidor lê.
create table if not exists public.unlimited (
  user_id uuid primary key references auth.users on delete cascade,
  nome text,
  created_at timestamptz not null default now()
);
alter table public.unlimited enable row level security;

-- Registro de cada chamada à IA (sem o conteúdo): tempo, modelo, resposta cortada, erros. Só o servidor lê.
create table if not exists public.ai_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  at timestamptz not null default now(),
  model text,
  status int,
  stop text,
  ms int,
  out_tokens int,
  err text
);
alter table public.ai_log enable row level security;
create index if not exists ai_log_at on public.ai_log (at desc);
-- o registro fica mesmo se a pessoa (ou o usuário do teste automático) for apagada
alter table public.ai_log drop constraint if exists ai_log_user_id_fkey;
alter table public.ai_log add constraint ai_log_user_id_fkey foreign key (user_id) references auth.users on delete set null;

-- Resultado de cada aviso enviado (sem o texto): entregue, recusado, inscrição apagada. Só o servidor lê.
create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  at timestamptz not null default now(),
  kind text,
  host text,
  status int,
  ok boolean,
  gone boolean
);
alter table public.push_log enable row level security;
create index if not exists push_log_at on public.push_log (at desc);

-- Integrações com o Google (Agenda, Contatos, Gmail): a chave de renovação do Google de cada pessoa.
-- Só o servidor lê; o app recebe, quando pede, uma chave temporária (1 hora) para falar direto com o Google.
create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  scopes text,
  updated_at timestamptz not null default now()
);
alter table public.google_tokens enable row level security;

-- Calendário assinado (iPhone/Android): link secreto por pessoa. Só o servidor lê.
create table if not exists public.cal_feeds (
  user_id uuid primary key references auth.users on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  last_fetch timestamptz
);
alter table public.cal_feeds enable row level security;

-- Avisos pessoais mandados à mão pelo dono do teste (workflow "Mandar aviso"). O relógio (tick) manda quando chega a hora. Só o servidor.
create table if not exists public.manual_push (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  nome text,
  title text not null,
  body text not null,
  url text not null default './?v=planejar',
  send_at timestamptz not null default now(),
  sent_at timestamptz,
  entregues int,
  created_at timestamptz not null default now()
);
alter table public.manual_push enable row level security;

-- Botões do aviso (Feito / Adiar 15 min): o que a pessoa tocou sem abrir o app. O app aplica ao abrir (ação "acoes").
create table if not exists public.push_actions (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  task_id text not null,
  action text not null,
  date text,
  start_min int,
  end_min int,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists push_actions_user on public.push_actions (user_id) where applied_at is null;
alter table public.push_actions enable row level security;

-- Plano escolhido por pessoa (Grátis ou Plus). Enquanto a cobrança não existe, "plus" = preço reservado. Só o servidor.
create table if not exists public.planos (
  user_id uuid primary key references auth.users on delete cascade,
  escolha text not null,
  preco int,
  fundador boolean,
  nome text,
  escolhido_em timestamptz not null default now()
);
alter table public.planos enable row level security;
