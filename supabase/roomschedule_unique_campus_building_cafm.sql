-- Allow the same CAFM_ID in different buildings on one campus.
-- Unique key becomes (campus_id, building_label, cafm_id).
-- Run once in the Supabase SQL editor if roomschedule already exists.
--
-- Blank Building Label is stored as '' (not NULL) so two blank-building
-- rows with the same CAFM_ID still collide.

update public.roomschedule
set building_label = ''
where building_label is null;

alter table public.roomschedule
  alter column building_label set default '';

alter table public.roomschedule
  alter column building_label set not null;

alter table public.roomschedule
  drop constraint if exists roomschedule_campus_cafm_unique;

alter table public.roomschedule
  drop constraint if exists roomschedule_campus_building_cafm_unique;

alter table public.roomschedule
  add constraint roomschedule_campus_building_cafm_unique
  unique (campus_id, building_label, cafm_id);
