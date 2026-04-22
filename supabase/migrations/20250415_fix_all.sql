-- Migration: Fix All Issues (AOI, Reports, Storage, Notifications)
-- Created: 2025-04-15

-- 1. AOI Boundary Table
create table if not exists public.aoi_boundaries (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Islamabad AOI',
  boundary jsonb not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS for AOI
alter table public.aoi_boundaries enable row level security;

-- Allow public read access to AOI boundaries
drop policy if exists "aoi_boundaries_read_public" on public.aoi_boundaries;
create policy "aoi_boundaries_read_public" on public.aoi_boundaries
  for select using (true);

-- 2. Enhanced Reports Workflow
-- Update reports table to include status and compliance info if not exists
do $$ 
begin 
  if not exists (select 1 from information_schema.columns where table_name='reports' and column_name='status') then
    alter table public.reports add column status text not null default 'pending';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='reports' and column_name='compliance_checklist') then
    alter table public.reports add column compliance_checklist jsonb default '{}'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='reports' and column_name='reviewer_id') then
    alter table public.reports add column reviewer_id uuid references auth.users(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_name='reports' and column_name='reviewer_comments') then
    alter table public.reports add column reviewer_comments text;
  end if;
end $$;

-- 3. Storage RLS Policies (Fix for Issue 2)
-- Ensure buckets exist
insert into storage.buckets (id, name, public) 
values ('ifc_uploads', 'ifc_uploads', false),
       ('reports', 'reports', false),
       ('models', 'models', true) 
on conflict (id) do update set public = excluded.public;

-- Policy for ifc_uploads: authenticated users can read/write their own files
drop policy if exists "ifc_uploads_policy" on storage.objects;
create policy "ifc_uploads_policy" on storage.objects
  for all to authenticated
  using (bucket_id = 'ifc_uploads' and (auth.uid() = owner))
  with check (bucket_id = 'ifc_uploads' and (auth.uid() = owner));

-- Policy for reports: authenticated users can upload, CDA can read all
drop policy if exists "reports_read_cda" on storage.objects;
create policy "reports_read_cda" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reports' 
    and (
      auth.uid() = owner 
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('authority', 'admin'))
    )
  );

drop policy if exists "reports_insert_own" on storage.objects;
create policy "reports_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reports' and (auth.uid() = owner));

-- Policy for models: public read
drop policy if exists "models_public_read" on storage.objects;
create policy "models_public_read" on storage.objects
  for select using (bucket_id = 'models');

-- 4. Chat Metadata for Attachments (Issue 4)
-- Update chat_messages to include metadata for file attachments
do $$ 
begin 
  if not exists (select 1 from information_schema.columns where table_name='chat_messages' and column_name='metadata') then
    alter table public.chat_messages add column metadata jsonb default '{}'::jsonb;
  end if;
end $$;

-- 5. Performance Indexes
create index if not exists idx_reports_status on public.reports(status);
create index if not exists idx_chat_messages_metadata on public.chat_messages using gin(metadata);

-- 6. Trigger for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_aoi_updated_at
  before update on public.aoi_boundaries
  for each row execute function public.handle_updated_at();
