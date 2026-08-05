import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "aisd-dxfconvert-supabase";

/** @typedef {{ supabaseUrl: string, bucket: string, supabaseKey: string }} SupabaseConfig */

export function loadSupabaseConfig() {
  /** @type {SupabaseConfig} */
  let config = {
    supabaseUrl: "https://mgflyiwrzcmxxuxpfotk.supabase.co",
    bucket: "floor-plans",
    supabaseKey: "",
  };

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) config = { ...config, ...JSON.parse(saved) };
  } catch {
    /* ignore */
  }

  return config;
}

/** @param {SupabaseConfig} config */
export function saveSupabaseConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** @param {SupabaseConfig} config */
function createSupabaseClient(config) {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error("Supabase URL and key are required.");
  }
  return createClient(config.supabaseUrl, config.supabaseKey);
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
    .from(config.bucket)
    .upload(filename, blob, {
      upsert: true,
      contentType: "image/svg+xml",
      cacheControl: "3600",
    });

  if (error) throw error;

  const publicUrl = `${config.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${config.bucket}/${encodeURIComponent(filename)}`;
  return { path: data.path, publicUrl };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
