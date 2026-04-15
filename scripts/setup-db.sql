create extension if not exists pgcrypto;

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  client_id text null,
  session_title text null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  tool_calls jsonb null,
  citations jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_user on public.chat_sessions(user_id);
create index if not exists idx_chat_sessions_client on public.chat_sessions(client_id);
create index if not exists idx_chat_messages_session on public.chat_messages(session_id);
create index if not exists idx_chat_messages_created_at on public.chat_messages(created_at);

