-- Consolidated migration for core dashboard features (chat persistence, predictions cache, IFC analyses, reports, permit workflow).
-- Apply in Supabase SQL editor.

create extension if not exists pgcrypto;
create extension if not exists postgis;

-- Profiles
create table if not exists public.profiles (
  id uuid references auth.users(id) primary key,
  email text,
  role text not null default 'engineer',
  created_at timestamptz not null default now(),
  last_active timestamptz,
  preferences jsonb not null default '{}'::jsonb
);

-- Chat persistence
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

-- Predictions cache
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

-- Reports
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

-- IFC analyses
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

-- Permit workflow
create table if not exists public.permit_applications (
  id uuid primary key default gen_random_uuid(),
  application_number text unique,
  engineer_id uuid references auth.users(id),
  ifc_file_url text,
  building_location geometry(Point, 4326),
  site_class text,
  vs_predictions jsonb,
  status text not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id),
  reviewer_comments text,
  approved_conditions jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.permit_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.permit_applications(id) on delete cascade,
  reviewer_id uuid references auth.users(id),
  decision text,
  comments text,
  code_sections_cited jsonb,
  reviewed_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  application_id uuid references public.permit_applications(id) on delete cascade,
  type text,
  message text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_chat_sessions_user_last_message on public.chat_sessions(user_id, last_message_at desc);
create index if not exists idx_chat_sessions_client_last_message on public.chat_sessions(client_id, last_message_at desc);
create index if not exists idx_chat_messages_session_created on public.chat_messages(session_id, created_at asc);
create index if not exists idx_reports_user_created on public.reports(user_id, created_at desc);
create index if not exists idx_reports_client_created on public.reports(client_id, created_at desc);
create index if not exists idx_ifc_analyses_user_created on public.ifc_analyses(user_id, created_at desc);
create index if not exists idx_ifc_analyses_client_created on public.ifc_analyses(client_id, created_at desc);
create index if not exists idx_predictions_cache_lookup on public.predictions_cache(latitude, longitude, depth_m, pga_g, expires_at desc);
create index if not exists idx_permit_applications_engineer on public.permit_applications(engineer_id, created_at desc);
create index if not exists idx_permit_applications_status on public.permit_applications(status, created_at desc);
create index if not exists idx_permit_reviews_application on public.permit_reviews(application_id, reviewed_at desc);
create index if not exists idx_notifications_user on public.notifications(user_id, is_read, created_at desc);

-- RLS
alter table public.profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.predictions_cache enable row level security;
alter table public.reports enable row level security;
alter table public.ifc_analyses enable row level security;
alter table public.permit_applications enable row level security;
alter table public.permit_reviews enable row level security;
alter table public.notifications enable row level security;

-- Profiles: users can manage only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- Chat sessions/messages: authenticated users can only access their own sessions.
drop policy if exists "chat_sessions_select_own" on public.chat_sessions;
create policy "chat_sessions_select_own" on public.chat_sessions for select using (auth.uid() = user_id);
drop policy if exists "chat_sessions_insert_own" on public.chat_sessions;
create policy "chat_sessions_insert_own" on public.chat_sessions for insert with check (auth.uid() = user_id);
drop policy if exists "chat_sessions_update_own" on public.chat_sessions;
create policy "chat_sessions_update_own" on public.chat_sessions for update using (auth.uid() = user_id);
drop policy if exists "chat_sessions_delete_own" on public.chat_sessions;
create policy "chat_sessions_delete_own" on public.chat_sessions for delete using (auth.uid() = user_id);

drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own" on public.chat_messages
  for select using (
    exists (select 1 from public.chat_sessions s where s.id = chat_messages.session_id and s.user_id = auth.uid())
  );
drop policy if exists "chat_messages_insert_own" on public.chat_messages;
create policy "chat_messages_insert_own" on public.chat_messages
  for insert with check (
    exists (select 1 from public.chat_sessions s where s.id = chat_messages.session_id and s.user_id = auth.uid())
  );
drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own" on public.chat_messages
  for delete using (
    exists (select 1 from public.chat_sessions s where s.id = chat_messages.session_id and s.user_id = auth.uid())
  );

-- Public read cache; service role jobs may refresh rows.
drop policy if exists "predictions_cache_public_read" on public.predictions_cache;
create policy "predictions_cache_public_read" on public.predictions_cache for select using (true);

-- Reports and IFC analyses scoped to authenticated user.
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports for select using (auth.uid() = user_id);
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert with check (auth.uid() = user_id);
drop policy if exists "reports_delete_own" on public.reports;
create policy "reports_delete_own" on public.reports for delete using (auth.uid() = user_id);

drop policy if exists "ifc_analyses_select_own" on public.ifc_analyses;
create policy "ifc_analyses_select_own" on public.ifc_analyses for select using (auth.uid() = user_id);
drop policy if exists "ifc_analyses_insert_own" on public.ifc_analyses;
create policy "ifc_analyses_insert_own" on public.ifc_analyses for insert with check (auth.uid() = user_id);
drop policy if exists "ifc_analyses_delete_own" on public.ifc_analyses;
create policy "ifc_analyses_delete_own" on public.ifc_analyses for delete using (auth.uid() = user_id);

-- Permit applications: engineers see their own; authority roles can see all.
drop policy if exists permit_applications_engineer_select on public.permit_applications;
create policy permit_applications_engineer_select on public.permit_applications for select using (auth.uid() = engineer_id);
drop policy if exists permit_applications_engineer_insert on public.permit_applications;
create policy permit_applications_engineer_insert on public.permit_applications for insert with check (auth.uid() = engineer_id);
drop policy if exists permit_applications_engineer_update on public.permit_applications;
create policy permit_applications_engineer_update on public.permit_applications for update using (auth.uid() = engineer_id);

drop policy if exists permit_applications_authority_select on public.permit_applications;
create policy permit_applications_authority_select on public.permit_applications
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin')));
drop policy if exists permit_applications_authority_update on public.permit_applications;
create policy permit_applications_authority_update on public.permit_applications
  for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin')));

drop policy if exists permit_reviews_select_parties on public.permit_reviews;
create policy permit_reviews_select_parties on public.permit_reviews
  for select using (
    exists (select 1 from public.permit_applications a where a.id = permit_reviews.application_id and a.engineer_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin'))
  );
drop policy if exists permit_reviews_insert_authority on public.permit_reviews;
create policy permit_reviews_insert_authority on public.permit_reviews
  for insert with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin')));

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select using (auth.uid() = user_id);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update using (auth.uid() = user_id);

-- Storage buckets (optional convenience in SQL editor)
insert into storage.buckets (id, name, public) values ('ifc_uploads', 'ifc_uploads', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('models', 'models', false) on conflict (id) do nothing;

-- Storage policies: allow authenticated users basic access per-bucket
drop policy if exists "ifc_uploads_read_auth" on storage.objects;
create policy "ifc_uploads_read_auth" on storage.objects for select to authenticated using (bucket_id = 'ifc_uploads');
drop policy if exists "ifc_uploads_insert_auth" on storage.objects;
create policy "ifc_uploads_insert_auth" on storage.objects for insert to authenticated with check (bucket_id = 'ifc_uploads');

drop policy if exists "reports_read_auth" on storage.objects;
create policy "reports_read_auth" on storage.objects for select to authenticated using (bucket_id = 'reports');
drop policy if exists "reports_insert_auth" on storage.objects;
create policy "reports_insert_auth" on storage.objects for insert to authenticated with check (bucket_id = 'reports');

drop policy if exists "models_read_auth" on storage.objects;
create policy "models_read_auth" on storage.objects for select to authenticated using (bucket_id = 'models');
drop policy if exists "models_insert_auth" on storage.objects;
create policy "models_insert_auth" on storage.objects for insert to authenticated with check (bucket_id = 'models');

