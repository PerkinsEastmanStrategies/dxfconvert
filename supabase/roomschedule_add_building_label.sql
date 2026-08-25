-- Add Building Label to an existing roomschedule table.
-- Run once in the Supabase SQL editor if the table was already created.

alter table public.roomschedule
  add column if not exists building_label text;

comment on column public.roomschedule.building_label is
  'Building label from room schedule CSV (Building Label column).';
