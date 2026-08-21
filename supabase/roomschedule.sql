-- AISD ESA room schedule (replaces / supplements the Google Sheet room CSV).
-- Run this once in the Supabase SQL editor for project mgflyiwrzcmxxuxpfotk.
--
-- The DXF converter uploads validated CSV rows for one school at a time.
-- ESA can later read this table instead of (or as a fallback to) the Sheet.

create table if not exists public.roomschedule (
  id bigint generated always as identity primary key,
  campus_id text not null,
  school_name text not null,
  cafm_id text not null,
  name text,
  neighborhood text,
  area text,
  program_type text,
  sf_deviation text,
  room_name_unsure text,
  updated_at timestamptz not null default now(),
  constraint roomschedule_campus_cafm_unique unique (campus_id, cafm_id)
);

comment on table public.roomschedule is
  'Room schedule / room-use data per campus (CAFM_ID, Name, Neighborhood, Area, Program Type, etc.).';

create index if not exists roomschedule_school_name_idx
  on public.roomschedule (school_name);

create index if not exists roomschedule_campus_id_idx
  on public.roomschedule (campus_id);

-- Allow the survey app (anon key) to read; converter uses service_role to write.
alter table public.roomschedule enable row level security;

drop policy if exists "Public read roomschedule" on public.roomschedule;
create policy "Public read roomschedule"
  on public.roomschedule
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Service role full access roomschedule" on public.roomschedule;
create policy "Service role full access roomschedule"
  on public.roomschedule
  for all
  to service_role
  using (true)
  with check (true);
