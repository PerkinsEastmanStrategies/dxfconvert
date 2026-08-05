/** Layer name → AISD-ESA SVG group classification. */

export const GROUP_ORDER = ["WALLS", "CAFM_SPACE", "DOORS", "FIXTURES", "CAFM_ID"];

export const MOBILE_GROUPS = new Set(["CAFM_SPACE", "CAFM_ID"]);

export const DESKTOP_GROUPS = new Set([...MOBILE_GROUPS, "WALLS", "DOORS", "FIXTURES"]);

export const GROUP_LABELS = {
  WALLS: "Exterior walls",
  CAFM_SPACE: "Room boundaries (CAFM_SPACE)",
  CAFM_ID: "Room labels (CAFM_ID)",
  DOORS: "Doors",
  FIXTURES: "Bathroom / plumbing fixtures",
  IGNORED: "Stripped (not exported)",
  UNMATCHED: "Unmatched (not exported)",
};

/**
 * @param {string} layerName
 * @returns {"CAFM_ID"|"CAFM_SPACE"|"WALLS"|"DOORS"|"FIXTURES"|null}
 */
export function classifyLayer(layerName) {
  const raw = (layerName || "0").trim();
  const n = raw.toUpperCase().replace(/[\s_-]+/g, "_");

  if (/^CAFM_ID$/.test(n) || n === "CAFMID") return "CAFM_ID";
  if (/^CAFM_SPACE$/.test(n) || n === "SPACE" || n === "CAFMSPACE") return "CAFM_SPACE";

  if (isDoorLayer(n, raw)) return "DOORS";
  if (isFixtureLayer(n, raw)) return "FIXTURES";
  if (isWallLayer(n, raw)) return "WALLS";

  return null;
}

function isDoorLayer(n, raw) {
  return (
    /\bDOOR\b/.test(n) ||
    /^A_DOOR/.test(n) ||
    /^I_DOOR/.test(n) ||
    /^S_DOOR/.test(n) ||
    /DOOR_SWING/.test(n) ||
    /DR_SWING/.test(n) ||
    /\bDR\b/.test(n)
  );
}

function isFixtureLayer(n, raw) {
  return (
    /^P_FIXT$/.test(n) ||
    /FIXTURE/.test(n) ||
    /PLUMB/.test(n) ||
    /TOILET/.test(n) ||
    /URINAL/.test(n) ||
    /RESTROOM/.test(n) ||
    /SANITARY/.test(n) ||
    /\bWC\b/.test(n) ||
    /LAVATORY/.test(n) ||
    /\bSINK\b/.test(n) ||
    /WATER_CLOSET/.test(n) ||
    /BATH/.test(n)
  );
}

function isWallLayer(n, raw) {
  if (/INTERIOR|PARTITION|FURN|CASEWORK|HATCH|GRID|DIM|ANNO|TEXT|LABEL|SYMB|DOOR|WINDOW|FIXTURE|PLUMB|EQUIP|FURN/.test(n)) {
    return false;
  }

  return (
    /EXTERIOR.*WALL/.test(n) ||
    /EXT.*WALL/.test(n) ||
    /WALL_EXT/.test(n) ||
    /^A_WALL/.test(n) ||
    /^I_WALL/.test(n) ||
    /^S_WALL/.test(n) ||
    /^WALL$/.test(n) ||
    /^WALLS$/.test(n) ||
    /\bWALL\b/.test(n)
  );
}

/**
 * @param {import('dxf').denormalise} entities
 * @param {"desktop"|"mobile"} mode
 */
export function filterEntitiesByMode(entities, mode) {
  const allowedGroups = mode === "mobile" ? MOBILE_GROUPS : DESKTOP_GROUPS;

  return entities.filter((entity) => {
    const group = classifyLayer(entity.layer);
    return group != null && allowedGroups.has(group);
  });
}

/**
 * Summarize all layers in a DXF for the UI.
 * @param {Array<{layer?: string}>} entities
 */
export function summarizeLayers(entities) {
  /** @type {Map<string, { count: number, group: string }>} */
  const map = new Map();

  for (const entity of entities) {
    const layer = (entity.layer || "0").trim();
    const group = classifyLayer(layer);
    const key = layer;
    const existing = map.get(key) || { count: 0, group: group || "UNMATCHED" };
    existing.count += 1;
    map.set(key, existing);
  }

  return [...map.entries()]
    .map(([layer, info]) => ({ layer, ...info }))
    .sort((a, b) => a.layer.localeCompare(b.layer, undefined, { sensitivity: "base" }));
}

export function toMobileFilename(filename) {
  const trimmed = filename.trim();
  if (!trimmed) return trimmed;
  if (/\.mobile\.svg$/i.test(trimmed)) return trimmed;
  if (/\.svg$/i.test(trimmed)) return trimmed.replace(/\.svg$/i, ".mobile.svg");
  return `${trimmed}.mobile.svg`;
}

export function normalizeOutputFilename(name) {
  let base = name.trim();
  if (!base) return "";
  base = base.replace(/\.(svg|dxf)$/i, "");
  if (!/\.svg$/i.test(base)) base = `${base}.svg`;
  return base;
}
