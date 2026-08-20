/**
 * School list from AISD ESA geojson (`public/data/aisd-schools.geojson`).
 * Names / campus IDs match what the survey app uses for floor-plan lookup.
 */

function titleCase(name) {
  return name
    .toLowerCase()
    .split(/[\s-/]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function formatDisplayName(name, cls) {
  const titled = titleCase(name.replace(/\//g, " / "));
  if (cls === "ELEM") {
    if (/elementary|k-\d|4-6/i.test(titled)) return titled;
    return `${titled} Elementary`;
  }
  if (cls === "MID") {
    if (/middle/i.test(titled)) return titled;
    return `${titled} Middle School`;
  }
  if (cls === "HIGH") {
    if (/high|echs|sywl|lasa/i.test(titled)) return titled;
    return `${titled} High School`;
  }
  return titled;
}

function schoolIdFromName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** CLASS → filename suffix used in floor-plan naming. */
export function classToFilenameSuffix(cls) {
  switch ((cls || "").toUpperCase()) {
    case "ELEM":
      return "ES";
    case "MID":
      return "MS";
    case "HIGH":
      return "HS";
    case "ALT ED 1":
    case "ALT ED 2":
      return "ALT";
    case "ATHLETIC":
      return "ATH";
    case "DISTRICT":
      return "DIST";
    default:
      return "ES";
  }
}

/**
 * Suggested SVG filename: `ALLISON ES L1.svg`
 * @param {{ name: string, schoolClass: string }} school
 * @param {{ shortLabel: string }} floor
 */
export function suggestFilename(school, floor) {
  if (!school || !floor) return "";
  const suffix = classToFilenameSuffix(school.schoolClass);
  return `${school.name} ${suffix} ${floor.shortLabel}.svg`;
}

/**
 * @param {object} geojson
 * @returns {Array<{ id: string, campusId: string, name: string, displayName: string, schoolClass: string }>}
 */
export function parseAisdSchools(geojson) {
  if (!geojson?.features?.length) return [];

  return geojson.features
    .filter((f) => f.properties?.CLASS && f.properties.CLASS !== "DISTRICT")
    .map((f) => {
      const name = String(f.properties.NAME || "").trim();
      const schoolClass = String(f.properties.CLASS || "").trim();
      return {
        id: schoolIdFromName(name),
        campusId: String(f.properties.CAMPUS_ID ?? "").trim(),
        name,
        displayName: formatDisplayName(name, schoolClass),
        schoolClass,
      };
    })
    .filter((s) => s.name)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

let cachedSchools = null;

export async function loadAisdSchools() {
  if (cachedSchools) return cachedSchools;
  const response = await fetch("/data/aisd-schools.geojson");
  if (!response.ok) {
    throw new Error(`Could not load school list (${response.status}).`);
  }
  const geojson = await response.json();
  cachedSchools = parseAisdSchools(geojson);
  return cachedSchools;
}
