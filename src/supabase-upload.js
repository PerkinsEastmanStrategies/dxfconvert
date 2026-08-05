import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "aisd-dxfconvert-supabase-key";

export const SUPABASE_URL = "https://mgflyiwrzcmxxuxpfotk.supabase.co";
export const SUPABASE_BUCKET = "floor-plans";

/** @typedef {{ supabaseUrl: string, bucket: string, supabaseKey: string }} SupabaseConfig */

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
function createSupabaseClient(config) {
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

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
