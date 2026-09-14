-- Add Building Label to an existing roomschedule table.
-- Run once in the Supabase SQL editor if the table was already created.

alter table public.roomschedule
  add column if not exists building_label text;

comment on column public.roomschedule.building_label is
  'Building label from room schedule CSV (Building Label column). Blank is stored as empty string.';

-- After adding this column on an existing table, run
-- roomschedule_unique_campus_building_cafm.sql so uniqueness is
-- (campus_id, building_label, cafm_id) instead of (campus_id, cafm_id).
