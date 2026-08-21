/**
 * Room schedule CSV — same columns as the ESA Google Sheet used by
 * room-neighborhood-lookup.ts (school_name, CAFM_ID, Name, …).
 */

export const ROOM_SCHEDULE_HEADERS = [
  "school_name",
  "CAFM_ID",
  "Name",
  "Neighborhood",
  "Area",
  "Program Type",
  "SF Deviation",
  "Room Name Unsure",
];

/** @typedef {{
 *   school_name: string,
 *   cafm_id: string,
 *   name: string,
 *   neighborhood: string,
 *   area: string,
 *   program_type: string,
 *   sf_deviation: string,
 *   room_name_unsure: string,
 * }} RoomScheduleRow */

/**
 * @param {string} schoolName Geojson NAME (e.g. LANGFORD)
 * @param {{ cafmIds?: string[], blankExtraRows?: number }} [options]
 */
export function buildRoomScheduleTemplateCsv(schoolName, options = {}) {
  const name = String(schoolName || "").trim();
  const cafmIds = uniqueSortedIds(options.cafmIds || []);
  const blankExtraRows =
    typeof options.blankExtraRows === "number"
      ? options.blankExtraRows
      : cafmIds.length > 0
        ? 0
        : 25;

  const header = ROOM_SCHEDULE_HEADERS.join(",");
  const lines = [header];

  for (const cafmId of cafmIds) {
    lines.push(`${escapeCsvField(name)},${escapeCsvField(cafmId)},,,,,,`);
  }
  for (let i = 0; i < blankExtraRows; i += 1) {
    lines.push(`${escapeCsvField(name)},,,,,,,`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Unique CAFM_ID values from a room inventory (DXF labels).
 * @param {{ rows?: Array<Record<string, string | number>> } | null | undefined} inventory
 * @returns {string[]}
 */
export function cafmIdsFromInventory(inventory) {
  if (!inventory?.rows?.length) return [];
  return uniqueSortedIds(
    inventory.rows
      .map((row) => String(row.room_id ?? "").trim())
      .filter(Boolean),
  );
}

/** @param {string[]} ids */
function uniqueSortedIds(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    const key = id.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  return out;
}

/** @param {string} schoolName */
export function roomScheduleTemplateFilename(schoolName) {
  const safe = String(schoolName || "school")
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_");
  return `${safe || "school"}_room_schedule.csv`;
}

/**
 * Parse a CSV string into a matrix (handles quotes).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

/**
 * Validate headers + school_name values.
 * - Single-school mode: pass `{ school }` — every row must match that geojson NAME.
 * - Batch mode: pass `{ schools }` — each school_name must match a geojson NAME exactly.
 *
 * @param {string} csvText
 * @param {{
 *   school?: { name: string, campusId: string },
 *   schools?: Array<{ name: string, campusId: string }>,
 * }} options
 * @returns {{
 *   rows: Array<RoomScheduleRow & { campus_id: string }>,
 *   errors: string[],
 *   schoolCount: number,
 * }}
 */
export function validateRoomScheduleCsv(csvText, options = {}) {
  /** @type {string[]} */
  const errors = [];
  const singleSchool = options.school ?? null;
  const schoolList = options.schools ?? (singleSchool ? [singleSchool] : []);

  if (!schoolList.length) {
    errors.push("School list is not loaded.");
    return { rows: [], errors, schoolCount: 0 };
  }

  if (singleSchool && !String(singleSchool.name || "").trim()) {
    errors.push("Select a school before uploading a room schedule.");
    return { rows: [], errors, schoolCount: 0 };
  }

  /** @type {Map<string, { name: string, campusId: string }>} */
  const byName = new Map();
  for (const s of schoolList) {
    const name = String(s.name || "").trim();
    if (name) byName.set(name, s);
  }

  const matrix = parseCsv(csvText);
  if (matrix.length < 1) {
    errors.push("CSV is empty.");
    return { rows: [], errors, schoolCount: 0 };
  }

  const header = matrix[0].map((h) => String(h).trim());
  const headerErrors = validateHeaders(header);
  if (headerErrors.length) {
    errors.push(...headerErrors);
    return { rows: [], errors, schoolCount: 0 };
  }

  const idx = Object.fromEntries(
    ROOM_SCHEDULE_HEADERS.map((h) => [h, header.findIndex((x) => normHeader(x) === normHeader(h))]),
  );

  /** @type {Array<RoomScheduleRow & { campus_id: string }>} */
  const rows = [];
  /** @type {Set<string>} */
  const seenSchoolCafm = new Set();
  /** @type {Set<string>} */
  const schoolsSeen = new Set();
  /** @type {Set<string>} */
  const unknownSchools = new Set();

  for (let r = 1; r < matrix.length; r += 1) {
    const line = matrix[r];
    const lineNo = r + 1;
    const get = (key) => String(line[idx[key]] ?? "").trim();

    const schoolName = get("school_name");
    const cafmId = get("CAFM_ID");
    const name = get("Name");
    const neighborhood = get("Neighborhood");
    const area = get("Area");
    const programType = get("Program Type");
    const sfDeviation = get("SF Deviation");
    const roomNameUnsure = get("Room Name Unsure");

    const allEmpty =
      !schoolName &&
      !cafmId &&
      !name &&
      !neighborhood &&
      !area &&
      !programType &&
      !sfDeviation &&
      !roomNameUnsure;
    if (allEmpty) continue;

    if (!schoolName) {
      errors.push(`Row ${lineNo}: school_name is required.`);
      continue;
    }

    if (singleSchool && schoolName !== singleSchool.name) {
      errors.push(
        `Row ${lineNo}: school_name "${schoolName}" does not match selected school "${singleSchool.name}" (must match the geojson NAME exactly).`,
      );
      continue;
    }

    const matched = byName.get(schoolName);
    if (!matched) {
      if (!unknownSchools.has(schoolName)) {
        unknownSchools.add(schoolName);
        errors.push(
          `school_name "${schoolName}" is not in the geojson school list (must match NAME exactly).`,
        );
      }
      continue;
    }

    if (!cafmId) {
      errors.push(`Row ${lineNo}: CAFM_ID is required.`);
      continue;
    }

    const cafmKey = `${matched.campusId}::${cafmId.toUpperCase()}`;
    if (seenSchoolCafm.has(cafmKey)) {
      errors.push(
        `Row ${lineNo}: duplicate CAFM_ID "${cafmId}" for school "${schoolName}".`,
      );
      continue;
    }
    seenSchoolCafm.add(cafmKey);
    schoolsSeen.add(schoolName);

    rows.push({
      school_name: schoolName,
      campus_id: matched.campusId,
      cafm_id: cafmId,
      name,
      neighborhood,
      area,
      program_type: programType,
      sf_deviation: sfDeviation,
      room_name_unsure: roomNameUnsure,
    });
  }

  if (!errors.length && rows.length === 0) {
    errors.push("No data rows found. Fill in at least one room (CAFM_ID) before uploading.");
  }

  return { rows, errors, schoolCount: schoolsSeen.size };
}

/**
 * Blank multi-school template (headers + a few empty rows).
 * @param {number} [blankRows]
 */
export function buildBatchRoomScheduleTemplateCsv(blankRows = 15) {
  const header = ROOM_SCHEDULE_HEADERS.join(",");
  const lines = [header];
  for (let i = 0; i < blankRows; i += 1) {
    lines.push(",,,,,,,");
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function batchRoomScheduleTemplateFilename() {
  return "aisd_room_schedule_batch.csv";
}

/**
 * @param {string[]} header
 * @returns {string[]}
 */
function validateHeaders(header) {
  const errors = [];
  const found = new Set(header.map(normHeader).filter(Boolean));
  const missing = ROOM_SCHEDULE_HEADERS.filter((h) => !found.has(normHeader(h)));
  const unexpected = header
    .map((h) => String(h).trim())
    .filter(Boolean)
    .filter((h) => !ROOM_SCHEDULE_HEADERS.some((expected) => normHeader(expected) === normHeader(h)));

  if (missing.length) {
    errors.push(
      `CSV headers do not match the template. Missing: ${missing.join(", ")}. Expected: ${ROOM_SCHEDULE_HEADERS.join(", ")}.`,
    );
  }
  if (unexpected.length) {
    errors.push(`Unexpected CSV column(s): ${unexpected.join(", ")}.`);
  }
  if (header.length !== ROOM_SCHEDULE_HEADERS.length && !missing.length && !unexpected.length) {
    errors.push(
      `CSV must have exactly ${ROOM_SCHEDULE_HEADERS.length} columns in this order: ${ROOM_SCHEDULE_HEADERS.join(", ")}.`,
    );
  }
  return errors;
}

/** @param {string} value */
function normHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** @param {string} value */
function escapeCsvField(value) {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
