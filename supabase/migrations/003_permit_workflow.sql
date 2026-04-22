create table if not exists public.permit_applications (
  id uuid primary key default gen_random_uuid(),
  application_number text unique,
  engineer_id uuid references auth.users(id),
  ifc_file_url text,
  building_location jsonb,
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

create index if not exists idx_permit_applications_engineer on public.permit_applications(engineer_id, created_at desc);
create index if not exists idx_permit_applications_status on public.permit_applications(status, created_at desc);
create index if not exists idx_permit_reviews_application on public.permit_reviews(application_id, reviewed_at desc);
create index if not exists idx_notifications_user on public.notifications(user_id, is_read, created_at desc);

alter table public.permit_applications enable row level security;
alter table public.permit_reviews enable row level security;
alter table public.notifications enable row level security;

drop policy if exists permit_applications_engineer_select on public.permit_applications;
create policy permit_applications_engineer_select on public.permit_applications
  for select using (auth.uid() = engineer_id);

drop policy if exists permit_applications_engineer_insert on public.permit_applications;
create policy permit_applications_engineer_insert on public.permit_applications
  for insert with check (auth.uid() = engineer_id);

drop policy if exists permit_applications_engineer_update on public.permit_applications;
create policy permit_applications_engineer_update on public.permit_applications
  for update using (auth.uid() = engineer_id);

drop policy if exists permit_applications_authority_select on public.permit_applications;
create policy permit_applications_authority_select on public.permit_applications
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin'))
  );

drop policy if exists permit_applications_authority_update on public.permit_applications;
create policy permit_applications_authority_update on public.permit_applications
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin'))
  );

drop policy if exists permit_reviews_select_parties on public.permit_reviews;
create policy permit_reviews_select_parties on public.permit_reviews
  for select using (
    exists (select 1 from public.permit_applications a where a.id = permit_reviews.application_id and a.engineer_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin'))
  );

drop policy if exists permit_reviews_insert_authority on public.permit_reviews;
create policy permit_reviews_insert_authority on public.permit_reviews
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority','authority_admin','reviewer','admin'))
  );

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = user_id);

