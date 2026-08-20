-- AISD ESA floor-plan manifest (replaces / supplements the Google Sheet).
-- Run this once in the Supabase SQL editor for project mgflyiwrzcmxxuxpfotk.
--
-- The DXF converter upserts a row when uploading SVGs.
-- ESA can later read this table instead of (or as a fallback to) the Sheet.

create table if not exists public.floor_plan_manifest (
  id bigint generated always as identity primary key,
  campus_id text not null,
  school_name text not null,
  school_class text,
  floor_level_id text not null,
  floor_label text not null,
  filename text not null,
  mobile_filename text,
  updated_at timestamptz not null default now(),
  constraint floor_plan_manifest_campus_floor_unique unique (campus_id, floor_level_id)
);

comment on table public.floor_plan_manifest is
  'Maps AISD campus + floor level to SVG filenames in the floor-plans storage bucket.';

create index if not exists floor_plan_manifest_school_name_idx
  on public.floor_plan_manifest (school_name);

-- Allow the survey app (anon key) to read; converter uses service_role to write.
alter table public.floor_plan_manifest enable row level security;

drop policy if exists "Public read floor_plan_manifest" on public.floor_plan_manifest;
create policy "Public read floor_plan_manifest"
  on public.floor_plan_manifest
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Service role full access floor_plan_manifest" on public.floor_plan_manifest;
create policy "Service role full access floor_plan_manifest"
  on public.floor_plan_manifest
  for all
  to service_role
  using (true)
  with check (true);
