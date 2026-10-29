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
