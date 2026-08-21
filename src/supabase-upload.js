import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "aisd-dxfconvert-supabase-key";

export const SUPABASE_URL = "https://mgflyiwrzcmxxuxpfotk.supabase.co";
export const SUPABASE_BUCKET = "floor-plans";
export const FLOOR_PLAN_MANIFEST_TABLE = "floor_plan_manifest";
export const ROOM_SCHEDULE_TABLE = "roomschedule";

/** @typedef {{ supabaseUrl: string, bucket: string, supabaseKey: string }} SupabaseConfig */

/** @typedef {{
 *   campusId: string,
 *   schoolName: string,
 *   schoolClass?: string,
 *   floorLevelId: string,
 *   floorLabel: string,
 *   filename: string,
 *   mobileFilename: string,
 * }} FloorPlanManifestRow */

/** @typedef {{
 *   campusId: string,
 *   schoolName: string,
 *   cafmId: string,
 *   name?: string,
 *   neighborhood?: string,
 *   area?: string,
 *   programType?: string,
 *   sfDeviation?: string,
 *   roomNameUnsure?: string,
 * }} RoomScheduleDbRow */

export function loadSupabaseConfig() {
  let supabaseKey = "";

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) supabaseKey = saved;
  } catch {
    /* ignore */
  }

  return {
    supabaseUrl: SUPABASE_URL,
    bucket: SUPABASE_BUCKET,
    supabaseKey,
  };
}

/** @param {string} supabaseKey */
export function saveSupabaseKey(supabaseKey) {
  localStorage.setItem(STORAGE_KEY, supabaseKey);
}

/** @param {SupabaseConfig} config */
export function saveSupabaseConfig(config) {
  saveSupabaseKey(config.supabaseKey);
}

/** @param {SupabaseConfig} config */
export function createSupabaseClient(config) {
  if (!config.supabaseKey) {
    throw new Error("Supabase service role key is required.");
  }
  return createClient(SUPABASE_URL, config.supabaseKey);
}

/**
 * @param {SupabaseConfig} config
 * @param {string} filename
 * @param {string} svgText
 */
export async function uploadSvgToSupabase(config, filename, svgText) {
  const supabase = createSupabaseClient(config);
  const blob = new Blob([svgText], { type: "image/svg+xml" });

  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(filename, blob, {
      upsert: true,
      contentType: "image/svg+xml",
      cacheControl: "3600",
    });

  if (error) throw error;

  const publicUrl = `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeURIComponent(filename)}`;
  return { path: data.path, publicUrl };
}

/**
 * Upsert school + floor → filename so ESA can look up plans without the Google Sheet.
 * @param {SupabaseConfig} config
 * @param {FloorPlanManifestRow} row
 */
export async function upsertFloorPlanManifest(config, row) {
  const supabase = createSupabaseClient(config);

  const payload = {
    campus_id: row.campusId,
    school_name: row.schoolName,
    school_class: row.schoolClass ?? null,
    floor_level_id: row.floorLevelId,
    floor_label: row.floorLabel,
    filename: row.filename,
    mobile_filename: row.mobileFilename,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(FLOOR_PLAN_MANIFEST_TABLE)
    .upsert(payload, { onConflict: "campus_id,floor_level_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Replace all room-schedule rows for a campus with the uploaded CSV rows.
 * @param {SupabaseConfig} config
 * @param {string} campusId
 * @param {RoomScheduleDbRow[]} rows
 */
export async function replaceRoomSchedule(config, campusId, rows) {
  const supabase = createSupabaseClient(config);
  const now = new Date().toISOString();

  const { error: deleteError } = await supabase
    .from(ROOM_SCHEDULE_TABLE)
    .delete()
    .eq("campus_id", campusId);

  if (deleteError) throw deleteError;

  if (!rows.length) return [];

  const payload = rows.map((row) => ({
    campus_id: campusId,
    school_name: row.schoolName,
    cafm_id: row.cafmId,
    name: row.name || null,
    neighborhood: row.neighborhood || null,
    area: row.area || null,
    program_type: row.programType || null,
    sf_deviation: row.sfDeviation || null,
    room_name_unsure: row.roomNameUnsure || null,
    updated_at: now,
  }));

  const { data, error } = await supabase.from(ROOM_SCHEDULE_TABLE).insert(payload).select();

  if (error) throw error;
  return data ?? [];
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
