-- Initial Supabase schema for chat persistence, caching, reports, and IFC analyses.
-- Apply via Supabase SQL editor or migration tooling.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid references auth.users(id) primary key,
  email text,
  created_at timestamptz not null default now(),
  last_active timestamptz,
  preferences jsonb not null default '{}'::jsonb
);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  client_id text,
  session_title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  tool_calls jsonb,
  citations jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.predictions_cache (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null,
  longitude double precision not null,
  depth_m double precision not null,
  pga_g double precision not null,
  vs_predicted double precision,
  vs_p10 double precision,
  vs_p90 double precision,
  sand_pct double precision,
  silt_pct double precision,
  clay_pct double precision,
  bulk_density double precision,
  water_content double precision,
  site_class text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique(latitude, longitude, depth_m, pga_g)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  client_id text,
  report_title text,
  location jsonb,
  pga_scenario double precision,
  building_type text,
  report_pdf_url text,
  report_summary text,
  created_at timestamptz not null default now(),
  file_size_bytes integer
);

create table if not exists public.ifc_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  client_id text,
  original_filename text,
  building_height double precision,
  site_class text,
  inconsistencies jsonb,
  summary jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_user_last_message on public.chat_sessions(user_id, last_message_at desc);
create index if not exists idx_chat_sessions_client_last_message on public.chat_sessions(client_id, last_message_at desc);
create index if not exists idx_chat_messages_session_created on public.chat_messages(session_id, created_at asc);
create index if not exists idx_reports_user_created on public.reports(user_id, created_at desc);
create index if not exists idx_reports_client_created on public.reports(client_id, created_at desc);
create index if not exists idx_ifc_analyses_user_created on public.ifc_analyses(user_id, created_at desc);
create index if not exists idx_ifc_analyses_client_created on public.ifc_analyses(client_id, created_at desc);
create index if not exists idx_predictions_cache_lookup on public.predictions_cache(latitude, longitude, depth_m, pga_g, expires_at desc);

alter table public.profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.predictions_cache enable row level security;
alter table public.reports enable row level security;
alter table public.ifc_analyses enable row level security;

-- Profiles: users can manage only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Chat sessions/messages: authenticated users can only access their own sessions.
drop policy if exists "chat_sessions_select_own" on public.chat_sessions;
create policy "chat_sessions_select_own" on public.chat_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "chat_sessions_insert_own" on public.chat_sessions;
create policy "chat_sessions_insert_own" on public.chat_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "chat_sessions_update_own" on public.chat_sessions;
create policy "chat_sessions_update_own" on public.chat_sessions
  for update using (auth.uid() = user_id);

drop policy if exists "chat_sessions_delete_own" on public.chat_sessions;
create policy "chat_sessions_delete_own" on public.chat_sessions
  for delete using (auth.uid() = user_id);

drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own" on public.chat_messages
  for select using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "chat_messages_insert_own" on public.chat_messages;
create policy "chat_messages_insert_own" on public.chat_messages
  for insert with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own" on public.chat_messages
  for delete using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

-- Public read cache; service role or future database jobs may refresh rows.
drop policy if exists "predictions_cache_public_read" on public.predictions_cache;
create policy "predictions_cache_public_read" on public.predictions_cache
  for select using (true);

-- Reports and IFC analyses are scoped to the authenticated user.
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports
  for select using (auth.uid() = user_id);

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert with check (auth.uid() = user_id);

drop policy if exists "reports_delete_own" on public.reports;
create policy "reports_delete_own" on public.reports
  for delete using (auth.uid() = user_id);

drop policy if exists "ifc_analyses_select_own" on public.ifc_analyses;
create policy "ifc_analyses_select_own" on public.ifc_analyses
  for select using (auth.uid() = user_id);

drop policy if exists "ifc_analyses_insert_own" on public.ifc_analyses;
create policy "ifc_analyses_insert_own" on public.ifc_analyses
  for insert with check (auth.uid() = user_id);

drop policy if exists "ifc_analyses_delete_own" on public.ifc_analyses;
create policy "ifc_analyses_delete_own" on public.ifc_analyses
  for delete using (auth.uid() = user_id);

create or replace function public.get_prediction(
  p_lat double precision,
  p_lon double precision,
  p_depth double precision,
  p_pga double precision
) returns table (
  vs_predicted double precision,
  vs_p10 double precision,
  vs_p90 double precision,
  site_class text,
  cached boolean
) as $$
begin
  return query
  select c.vs_predicted, c.vs_p10, c.vs_p90, c.site_class, true as cached
  from public.predictions_cache c
  where c.latitude = p_lat
    and c.longitude = p_lon
    and c.depth_m = p_depth
    and c.pga_g = p_pga
    and c.expires_at > now()
  order by c.created_at desc
  limit 1;

  if not found then
    return query
    select null::double precision, null::double precision, null::double precision, null::text, false;
  end if;
end;
$$ language plpgsql security definer;
