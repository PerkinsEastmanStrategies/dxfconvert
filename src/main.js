import "./styles.css";
import { convertDxfToAisdSvg } from "./dxf-converter.js";
import { GROUP_LABELS } from "./layers.js";
import { FLOOR_LEVELS, getFloorLevel } from "./floor-levels.js";
import { loadAisdSchools, suggestFilename } from "./schools.js";
import {
  buildRoomInventory,
  roomInventoryFilename,
  roomInventoryToCsv,
} from "./room-inventory.js";
import {
  formatBytes,
  loadSupabaseConfig,
  replaceRoomSchedule,
  replaceRoomSchedulesBatch,
  saveSupabaseKey,
  SUPABASE_BUCKET,
  uploadSvgToSupabase,
  upsertFloorPlanManifest,
} from "./supabase-upload.js";
import {
  batchRoomScheduleTemplateFilename,
  buildBatchRoomScheduleTemplateCsv,
  buildRoomScheduleTemplateCsv,
  cafmIdsFromInventory,
  roomScheduleTemplateFilename,
  validateRoomScheduleCsv,
} from "./room-schedule.js";
import { normalizeOutputFilename, toMobileFilename } from "./layers.js";

const els = {
  dxfInput: document.getElementById("dxf-input"),
  dxfFileStatus: document.getElementById("dxf-file-status"),
  fileName: document.getElementById("file-name"),
  schoolSearch: document.getElementById("school-search"),
  schoolOptions: document.getElementById("school-options"),
  schoolMeta: document.getElementById("school-meta"),
  floorSelect: document.getElementById("floor-select"),
  convertBtn: document.getElementById("convert-btn"),
  saveBtn: document.getElementById("save-btn"),
  downloadBtn: document.getElementById("download-btn"),
  downloadCsvBtn: document.getElementById("download-csv-btn"),
  status: document.getElementById("status"),
  inventorySummary: document.getElementById("inventory-summary"),
  layerTable: document.getElementById("layer-table"),
  previewDesktop: document.getElementById("preview-desktop"),
  previewMobile: document.getElementById("preview-mobile"),
  metaDesktop: document.getElementById("meta-desktop"),
  metaMobile: document.getElementById("meta-mobile"),
  supabaseKey: document.getElementById("supabase-key"),
  saveConfigBtn: document.getElementById("save-config-btn"),
  scheduleSupabaseKey: document.getElementById("schedule-supabase-key"),
  saveScheduleConfigBtn: document.getElementById("save-schedule-config-btn"),
  scheduleSharedContext: document.getElementById("schedule-shared-context"),
  downloadBatchTemplateBtn: document.getElementById("download-batch-template-btn"),
  batchScheduleCsvInput: document.getElementById("batch-schedule-csv-input"),
  uploadBatchScheduleBtn: document.getElementById("upload-batch-schedule-btn"),
  batchScheduleFileStatus: document.getElementById("batch-schedule-file-status"),
  batchScheduleStatus: document.getElementById("batch-schedule-status"),
  scheduleSchoolSearch: document.getElementById("schedule-school-search"),
  scheduleSchoolOptions: document.getElementById("schedule-school-options"),
  scheduleSchoolMeta: document.getElementById("schedule-school-meta"),
  scheduleDxfInput: document.getElementById("schedule-dxf-input"),
  scheduleDxfStatus: document.getElementById("schedule-dxf-status"),
  downloadScheduleTemplateBtn: document.getElementById("download-schedule-template-btn"),
  scheduleCsvInput: document.getElementById("schedule-csv-input"),
  uploadScheduleBtn: document.getElementById("upload-schedule-btn"),
  scheduleCsvFileStatus: document.getElementById("schedule-csv-file-status"),
  scheduleStatus: document.getElementById("schedule-status"),
};

/** @type {{ desktop?: string, mobile?: string, layers?: Array<{layer:string,count:number,group:string}>, inventory?: ReturnType<typeof buildRoomInventory>, dxfText?: string } | null} */
let result = null;

/** @type {Array<{ id: string, campusId: string, name: string, displayName: string, schoolClass: string }>} */
let schools = [];

/** @type {{ id: string, campusId: string, name: string, displayName: string, schoolClass: string } | null} */
let selectedSchool = null;

/** @type {{ id: string, campusId: string, name: string, displayName: string, schoolClass: string } | null} */
let scheduleSelectedSchool = null;

/** When true, school/floor changes rewrite the filename field. */
let autoFilename = true;

function setStatus(message, type = "info") {
  els.status.textContent = message;
  els.status.dataset.type = type;
}

function setScheduleStatus(message, type = "info") {
  els.scheduleStatus.textContent = message;
  els.scheduleStatus.dataset.type = type;
}

function setBatchScheduleStatus(message, type = "info") {
  els.batchScheduleStatus.textContent = message;
  els.batchScheduleStatus.dataset.type = type;
}

function loadConfigIntoForm() {
  const key = loadSupabaseConfig().supabaseKey;
  els.supabaseKey.value = key;
  els.scheduleSupabaseKey.value = key;
}

function syncSupabaseKeyInputs(source) {
  const value = source.value;
  if (source !== els.supabaseKey) els.supabaseKey.value = value;
  if (source !== els.scheduleSupabaseKey) els.scheduleSupabaseKey.value = value;
}

function getSupabaseKey() {
  return (els.scheduleSupabaseKey.value || els.supabaseKey.value || "").trim();
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tabId;
  });
  if (tabId === "room-schedule") {
    syncScheduleFromFloorPlans();
    updateScheduleSharedContext();
  }
}

/** Carry Floor plans school into Room schedule whenever that tab opens. */
function syncScheduleFromFloorPlans() {
  if (!selectedSchool) return;
  scheduleSelectedSchool = selectedSchool;
  els.scheduleSchoolSearch.value = selectedSchool.displayName;
  updateScheduleSchoolMeta();
}

function getActiveScheduleSchool() {
  return scheduleSelectedSchool || selectedSchool;
}

/**
 * DXF source for CAFM IDs: optional schedule override, then converted inventory/text,
 * then Floor plans file input.
 * @returns {Promise<{ inventory: ReturnType<typeof buildRoomInventory> | null, label: string }>}
 */
async function resolveScheduleDxfSource() {
  const override = els.scheduleDxfInput.files?.[0];
  if (override) {
    const dxfText = await readFileAsText(override);
    return {
      inventory: buildRoomInventory(dxfText),
      label: `override DXF (${override.name})`,
    };
  }

  if (result?.inventory) {
    const floorFile = els.dxfInput.files?.[0];
    return {
      inventory: result.inventory,
      label: floorFile ? `Floor plans DXF (${floorFile.name})` : "Floor plans conversion",
    };
  }

  if (result?.dxfText) {
    const floorFile = els.dxfInput.files?.[0];
    return {
      inventory: buildRoomInventory(result.dxfText),
      label: floorFile ? `Floor plans DXF (${floorFile.name})` : "Floor plans DXF",
    };
  }

  const floorFile = els.dxfInput.files?.[0];
  if (floorFile) {
    const dxfText = await readFileAsText(floorFile);
    return {
      inventory: buildRoomInventory(dxfText),
      label: `Floor plans DXF (${floorFile.name})`,
    };
  }

  return { inventory: null, label: "" };
}

function updateScheduleSharedContext() {
  const school = getActiveScheduleSchool();
  const floorFile = els.dxfInput.files?.[0];
  const override = els.scheduleDxfInput.files?.[0];
  const parts = [];

  if (school) {
    parts.push(`School: ${school.displayName} (NAME "${school.name}")`);
  } else {
    parts.push("School: not selected yet");
  }

  if (override) {
    parts.push(`DXF: ${override.name} (schedule override)`);
  } else if (floorFile) {
    parts.push(`DXF: ${floorFile.name} (from Floor plans)`);
  } else if (result?.inventory || result?.dxfText) {
    parts.push("DXF: loaded from last Floor plans conversion");
  } else {
    parts.push("DXF: none loaded — choose one on Floor plans or use Override DXF");
  }

  els.scheduleSharedContext.textContent = parts.join(" · ");
}

function mapScheduleRowsToDb(rows) {
  return rows.map((row) => ({
    campusId: row.campus_id,
    schoolName: row.school_name,
    cafmId: row.cafm_id,
    name: row.name,
    neighborhood: row.neighborhood,
    area: row.area,
    programType: row.program_type,
    sfDeviation: row.sf_deviation,
    roomNameUnsure: row.room_name_unsure,
  }));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function populateFloorSelect() {
  els.floorSelect.innerHTML =
    `<option value="">Select floor…</option>` +
    FLOOR_LEVELS.map(
      (f) => `<option value="${f.id}">${escapeHtml(f.fullLabel)} (${f.shortLabel})</option>`,
    ).join("");
}

function populateSchoolOptions(list) {
  const optionsHtml = list
    .map(
      (s) =>
        `<option value="${escapeHtml(s.displayName)}" data-campus-id="${escapeHtml(s.campusId)}"></option>`,
    )
    .join("");
  els.schoolOptions.innerHTML = optionsHtml;
  els.scheduleSchoolOptions.innerHTML = optionsHtml;
}

function findSchoolFromSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    schools.find((s) => s.displayName.toLowerCase() === q) ||
    schools.find((s) => s.name.toLowerCase() === q) ||
    schools.find((s) => s.displayName.toLowerCase().includes(q)) ||
    schools.find((s) => s.name.toLowerCase().includes(q)) ||
    null
  );
}

function updateSchoolMeta() {
  if (!selectedSchool) {
    els.schoolMeta.textContent = "";
    return;
  }
  els.schoolMeta.textContent = `${selectedSchool.displayName} · campus ${selectedSchool.campusId} · ${selectedSchool.schoolClass}`;
}

function updateScheduleSchoolMeta() {
  if (!scheduleSelectedSchool) {
    els.scheduleSchoolMeta.textContent = "";
    return;
  }
  els.scheduleSchoolMeta.textContent = `${scheduleSelectedSchool.displayName} · geojson NAME "${scheduleSelectedSchool.name}" · campus ${scheduleSelectedSchool.campusId}`;
}

function syncSuggestedFilename() {
  if (!autoFilename) return;
  const floor = getFloorLevel(els.floorSelect.value);
  if (!selectedSchool || !floor) return;
  els.fileName.value = suggestFilename(selectedSchool, floor);
}

function onSchoolSearchChange() {
  selectedSchool = findSchoolFromSearch(els.schoolSearch.value);
  updateSchoolMeta();
  syncSuggestedFilename();
  // Keep Room schedule school aligned with Floor plans selection.
  if (selectedSchool) {
    scheduleSelectedSchool = selectedSchool;
    els.scheduleSchoolSearch.value = selectedSchool.displayName;
    updateScheduleSchoolMeta();
  }
  updateScheduleSharedContext();
}

function onScheduleSchoolSearchChange() {
  scheduleSelectedSchool = findSchoolFromSearch(els.scheduleSchoolSearch.value);
  updateScheduleSchoolMeta();
  updateScheduleSharedContext();
}

function onFloorChange() {
  syncSuggestedFilename();
}

async function initSchools() {
  try {
    schools = await loadAisdSchools();
    populateSchoolOptions(schools);
    setStatus(`Loaded ${schools.length} schools from geojson.`, "info");
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "Could not load schools.", "error");
  }
}

function suggestedFilenameFromDxf(file) {
  if (!file?.name) return "";
  return normalizeOutputFilename(file.name.replace(/\.dxf$/i, " ES.svg"));
}

function renderLayerTable(layers) {
  if (!layers?.length) {
    els.layerTable.innerHTML = `<tr><td colspan="3">No layers detected yet.</td></tr>`;
    return;
  }

  els.layerTable.innerHTML = layers
    .map(({ layer, count, group }) => {
      const label = GROUP_LABELS[group] || group;
      const kept = group !== "UNMATCHED";
      return `<tr class="${kept ? "kept" : "ignored"}">
        <td>${escapeHtml(layer)}</td>
        <td>${count.toLocaleString()}</td>
        <td>${escapeHtml(label)}</td>
      </tr>`;
    })
    .join("");
}

function showPreview(container, svgText, metaEl, label) {
  if (!svgText) {
    container.innerHTML = `<p class="placeholder">No preview</p>`;
    metaEl.textContent = "";
    return;
  }
  container.innerHTML = svgText;
  const svg = container.querySelector("svg");
  if (svg) {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
  }
  metaEl.textContent = `${label} · ${formatBytes(new Blob([svgText]).size)}`;
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function handleConvert() {
  const file = els.dxfInput.files?.[0];
  if (!file) {
    setStatus("Choose a DXF file first.", "error");
    return;
  }

  if (!selectedSchool) {
    setStatus("Select a school before converting.", "error");
    return;
  }

  if (!els.floorSelect.value) {
    setStatus("Select a floor before converting.", "error");
    return;
  }

  if (!els.fileName.value.trim()) {
    setStatus("Enter an output file name before converting.", "error");
    return;
  }

  setStatus("Converting…");
  els.convertBtn.disabled = true;

  try {
    const dxfText = await readFileAsText(file);
    const desktop = convertDxfToAisdSvg(dxfText, "desktop");
    const mobile = convertDxfToAisdSvg(dxfText, "mobile");

    const inventory = buildRoomInventory(dxfText);

    result = {
      desktop: desktop.svg,
      mobile: mobile.svg,
      layers: desktop.layers,
      inventory,
      dxfText,
    };

    if (!els.fileName.value.trim()) {
      if (selectedSchool && els.floorSelect.value) {
        syncSuggestedFilename();
      } else {
        els.fileName.value = suggestedFilenameFromDxf(file);
      }
    }

    renderLayerTable(result.layers);
    renderInventorySummary(result.inventory);
    showPreview(els.previewDesktop, result.desktop, els.metaDesktop, "Desktop SVG");
    showPreview(els.previewMobile, result.mobile, els.metaMobile, "Mobile SVG");

    els.saveBtn.disabled = false;
    els.downloadBtn.disabled = false;
    els.downloadCsvBtn.disabled = false;

    const stripped = desktop.strippedFragments ?? 0;
    const strippedNote =
      stripped > 0 ? ` Stripped ${stripped.toLocaleString()} leftover fragments.` : "";
    setStatus(
      `Converted ${desktop.entityCount.toLocaleString()} entities (desktop) / ${mobile.entityCount.toLocaleString()} (mobile) from ${desktop.totalEntities.toLocaleString()} total.${strippedNote}`,
      "success",
    );
    updateScheduleSharedContext();
  } catch (err) {
    console.error(err);
    result = null;
    renderInventorySummary(null);
    els.saveBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.downloadCsvBtn.disabled = true;
    setStatus(err instanceof Error ? err.message : "Conversion failed.", "error");
  } finally {
    els.convertBtn.disabled = false;
  }
}

function renderInventorySummary(inventory) {
  if (!inventory) {
    els.inventorySummary.textContent = "";
    return;
  }
  const { summary } = inventory;
  els.inventorySummary.textContent =
    `Room inventory: ${summary.labelCount} labels · ${summary.spaceCount} spaces · ` +
    `${summary.matched} matched · ${summary.nearest} nearest · ` +
    `${summary.unmatchedLabels} unmatched labels · ${summary.duplicateLabels} duplicate labels · ` +
    `${summary.orphanSpaces} spaces without labels. Download CSV for details.`;
}

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSvg(filename, svgText) {
  downloadTextFile(filename, svgText, "image/svg+xml");
}

function handleDownload() {
  if (!result) return;
  const base = normalizeOutputFilename(els.fileName.value);
  if (!base) {
    setStatus("Enter an output file name.", "error");
    return;
  }
  downloadSvg(base, result.desktop);
  downloadSvg(toMobileFilename(base), result.mobile);
  setStatus(`Downloaded ${base} and ${toMobileFilename(base)}.`, "success");
}

function handleDownloadCsv() {
  if (!result?.inventory) return;
  const base = normalizeOutputFilename(els.fileName.value);
  if (!base) {
    setStatus("Enter an output file name.", "error");
    return;
  }
  const csvName = roomInventoryFilename(base);
  downloadTextFile(csvName, roomInventoryToCsv(result.inventory), "text/csv");
  setStatus(`Downloaded ${csvName}.`, "success");
}

async function handleDownloadScheduleTemplate() {
  const school = getActiveScheduleSchool();
  if (!school) {
    setScheduleStatus("Select a school (on Floor plans or here) so the template can use the geojson NAME.", "error");
    return;
  }

  els.downloadScheduleTemplateBtn.disabled = true;
  setScheduleStatus("Building schedule template…");

  try {
    const { inventory, label } = await resolveScheduleDxfSource();
    if (!inventory) {
      setScheduleStatus(
        "No DXF available. Upload one on the Floor plans tab, or use Override DXF here.",
        "error",
      );
      return;
    }

    const cafmIds = cafmIdsFromInventory(inventory);
    const csv = buildRoomScheduleTemplateCsv(school.name, { cafmIds });
    const filename = roomScheduleTemplateFilename(school.name);
    downloadTextFile(filename, csv, "text/csv");

    if (cafmIds.length) {
      setScheduleStatus(
        `Downloaded ${filename} with school_name="${school.name}" and ${cafmIds.length} CAFM_ID(s) from ${label}. Fill the remaining columns, then upload.`,
        "success",
      );
    } else {
      setScheduleStatus(
        `Downloaded ${filename} with school_name="${school.name}", but no CAFM_ID labels were found in ${label}.`,
        "error",
      );
    }
  } catch (err) {
    console.error(err);
    setScheduleStatus(
      err instanceof Error ? err.message : "Could not build schedule template from DXF.",
      "error",
    );
  } finally {
    els.downloadScheduleTemplateBtn.disabled = false;
  }
}

async function handleUploadSchedule() {
  const school = getActiveScheduleSchool();
  if (!school) {
    setScheduleStatus("Select a school before uploading a room schedule.", "error");
    return;
  }

  const file = els.scheduleCsvInput.files?.[0];
  if (!file) {
    setScheduleStatus("Choose a school schedule CSV to upload.", "error");
    return;
  }

  const supabaseKey = getSupabaseKey();
  if (!supabaseKey) {
    setScheduleStatus("Add your Supabase service role key before uploading.", "error");
    return;
  }

  els.uploadScheduleBtn.disabled = true;
  setScheduleStatus("Validating CSV…");

  try {
    const csvText = await readFileAsText(file);
    const { rows, errors } = validateRoomScheduleCsv(csvText, {
      school: { name: school.name, campusId: school.campusId },
      schools,
    });

    if (errors.length) {
      const shown = errors.slice(0, 8).join(" ");
      const more = errors.length > 8 ? ` (+${errors.length - 8} more)` : "";
      setScheduleStatus(`Upload blocked: ${shown}${more}`, "error");
      return;
    }

    saveSupabaseKey(supabaseKey);
    syncSupabaseKeyInputs(els.scheduleSupabaseKey);
    const config = loadSupabaseConfig();
    config.supabaseKey = supabaseKey;

    setScheduleStatus(`Uploading ${rows.length} room(s) for ${school.name}…`);

    await replaceRoomSchedule(config, school.campusId, mapScheduleRowsToDb(rows));

    setScheduleStatus(
      `Saved ${rows.length} room(s) for ${school.name} (campus ${school.campusId}) to roomschedule.`,
      "success",
    );
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Schedule upload failed.";
    const hint = /relation .* does not exist|Could not find the table/i.test(message)
      ? " Run supabase/roomschedule.sql in the Supabase SQL editor first."
      : "";
    setScheduleStatus(`${message}${hint}`, "error");
  } finally {
    els.uploadScheduleBtn.disabled = false;
  }
}

function handleDownloadBatchTemplate() {
  const csv = buildBatchRoomScheduleTemplateCsv();
  const filename = batchRoomScheduleTemplateFilename();
  downloadTextFile(filename, csv, "text/csv");
  setBatchScheduleStatus(
    `Downloaded ${filename}. Use geojson school NAME values in school_name (e.g. LANGFORD).`,
    "success",
  );
}

async function handleUploadBatchSchedule() {
  const file = els.batchScheduleCsvInput.files?.[0];
  if (!file) {
    setBatchScheduleStatus("Choose a room schedule CSV file to upload.", "error");
    return;
  }

  if (!schools.length) {
    setBatchScheduleStatus("School list is not loaded yet. Refresh and try again.", "error");
    return;
  }

  const supabaseKey = getSupabaseKey();
  if (!supabaseKey) {
    setBatchScheduleStatus("Add your Supabase service role key before uploading.", "error");
    return;
  }

  els.uploadBatchScheduleBtn.disabled = true;
  setBatchScheduleStatus("Validating CSV…");

  try {
    const csvText = await readFileAsText(file);
    const { rows, errors, schoolCount } = validateRoomScheduleCsv(csvText, { schools });

    if (errors.length) {
      const shown = errors.slice(0, 8).join(" ");
      const more = errors.length > 8 ? ` (+${errors.length - 8} more)` : "";
      setBatchScheduleStatus(`Upload blocked: ${shown}${more}`, "error");
      return;
    }

    saveSupabaseKey(supabaseKey);
    syncSupabaseKeyInputs(els.scheduleSupabaseKey);
    const config = loadSupabaseConfig();
    config.supabaseKey = supabaseKey;

    /** @type {Map<string, ReturnType<typeof mapScheduleRowsToDb>>} */
    const byCampus = new Map();
    for (const row of mapScheduleRowsToDb(rows)) {
      const list = byCampus.get(row.campusId) || [];
      list.push(row);
      byCampus.set(row.campusId, list);
    }

    setBatchScheduleStatus(
      `Uploading ${rows.length} room(s) across ${schoolCount} school(s)…`,
    );

    await replaceRoomSchedulesBatch(config, byCampus);

    setBatchScheduleStatus(
      `Saved ${rows.length} room(s) for ${schoolCount} school(s) to roomschedule.`,
      "success",
    );
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Schedule upload failed.";
    const hint = /relation .* does not exist|Could not find the table/i.test(message)
      ? " Run supabase/roomschedule.sql in the Supabase SQL editor first."
      : "";
    setBatchScheduleStatus(`${message}${hint}`, "error");
  } finally {
    els.uploadBatchScheduleBtn.disabled = false;
  }
}

async function handleSave() {
  if (!result) return;

  if (!selectedSchool) {
    setStatus("Select a school that matches the geojson list before saving.", "error");
    return;
  }

  const floor = getFloorLevel(els.floorSelect.value);
  if (!floor) {
    setStatus("Select a floor level before saving.", "error");
    return;
  }

  const base = normalizeOutputFilename(els.fileName.value);
  if (!base) {
    setStatus("Enter an output file name before saving.", "error");
    return;
  }

  const supabaseKey = getSupabaseKey();
  if (!supabaseKey) {
    setStatus("Add your Supabase service role key before uploading.", "error");
    return;
  }

  saveSupabaseKey(supabaseKey);
  syncSupabaseKeyInputs(els.supabaseKey);
  const config = loadSupabaseConfig();
  config.supabaseKey = supabaseKey;
  els.saveBtn.disabled = true;
  setStatus("Uploading SVGs and saving school/floor metadata…");

  try {
    const mobileName = toMobileFilename(base);
    const [desktopUpload, mobileUpload] = await Promise.all([
      uploadSvgToSupabase(config, base, result.desktop),
      uploadSvgToSupabase(config, mobileName, result.mobile),
    ]);

    await upsertFloorPlanManifest(config, {
      campusId: selectedSchool.campusId,
      schoolName: selectedSchool.name,
      schoolClass: selectedSchool.schoolClass,
      floorLevelId: floor.id,
      floorLabel: floor.fullLabel,
      filename: base,
      mobileFilename: mobileName,
    });

    setStatus(
      `Saved ${base} + ${mobileName} to "${SUPABASE_BUCKET}", and recorded ${selectedSchool.name} / ${floor.fullLabel} in floor_plan_manifest.`,
      "success",
    );
    console.info("Uploaded:", desktopUpload.publicUrl, mobileUpload.publicUrl);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Upload failed.";
    const hint = /relation .* does not exist|Could not find the table/i.test(message)
      ? " Run supabase/floor_plan_manifest.sql in the Supabase SQL editor first."
      : "";
    setStatus(`${message}${hint}`, "error");
  } finally {
    els.saveBtn.disabled = false;
  }
}

els.dxfInput.addEventListener("change", () => {
  const file = els.dxfInput.files?.[0];
  if (file) {
    els.dxfFileStatus.textContent = `${file.name} loaded`;
    els.dxfFileStatus.dataset.type = "success";
    // New DXF invalidates any previous convert result.
    result = null;
    els.saveBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.downloadCsvBtn.disabled = true;
    renderInventorySummary(null);
    if (!els.fileName.value.trim()) {
      if (selectedSchool && els.floorSelect.value) syncSuggestedFilename();
      else els.fileName.value = suggestedFilenameFromDxf(file);
    }
  } else {
    els.dxfFileStatus.textContent = "No file loaded yet.";
    els.dxfFileStatus.dataset.type = "empty";
  }
  updateScheduleSharedContext();
});

els.schoolSearch.addEventListener("change", onSchoolSearchChange);
els.schoolSearch.addEventListener("input", onSchoolSearchChange);
els.scheduleSchoolSearch.addEventListener("change", onScheduleSchoolSearchChange);
els.scheduleSchoolSearch.addEventListener("input", onScheduleSchoolSearchChange);
els.floorSelect.addEventListener("change", onFloorChange);
els.fileName.addEventListener("input", () => {
  autoFilename = false;
});

els.convertBtn.addEventListener("click", handleConvert);
els.downloadBtn.addEventListener("click", handleDownload);
els.downloadCsvBtn.addEventListener("click", handleDownloadCsv);
els.downloadScheduleTemplateBtn.addEventListener("click", handleDownloadScheduleTemplate);
els.uploadScheduleBtn.addEventListener("click", handleUploadSchedule);
els.downloadBatchTemplateBtn.addEventListener("click", handleDownloadBatchTemplate);
els.uploadBatchScheduleBtn.addEventListener("click", handleUploadBatchSchedule);
els.saveBtn.addEventListener("click", handleSave);
els.saveConfigBtn.addEventListener("click", () => {
  syncSupabaseKeyInputs(els.supabaseKey);
  saveSupabaseKey(els.supabaseKey.value.trim());
  setStatus("Service role key saved in this browser.", "success");
});
els.saveScheduleConfigBtn.addEventListener("click", () => {
  syncSupabaseKeyInputs(els.scheduleSupabaseKey);
  saveSupabaseKey(els.scheduleSupabaseKey.value.trim());
  setBatchScheduleStatus("Service role key saved in this browser.", "success");
});
els.supabaseKey.addEventListener("input", () => syncSupabaseKeyInputs(els.supabaseKey));
els.scheduleSupabaseKey.addEventListener("input", () =>
  syncSupabaseKeyInputs(els.scheduleSupabaseKey),
);

els.scheduleCsvInput.addEventListener("change", () => {
  const file = els.scheduleCsvInput.files?.[0];
  if (file) {
    els.scheduleCsvFileStatus.textContent = `${file.name} loaded`;
    els.scheduleCsvFileStatus.dataset.type = "success";
  } else {
    els.scheduleCsvFileStatus.textContent = "No CSV loaded yet.";
    els.scheduleCsvFileStatus.dataset.type = "empty";
  }
});

els.batchScheduleCsvInput.addEventListener("change", () => {
  const file = els.batchScheduleCsvInput.files?.[0];
  if (file) {
    els.batchScheduleFileStatus.textContent = `${file.name} loaded`;
    els.batchScheduleFileStatus.dataset.type = "success";
  } else {
    els.batchScheduleFileStatus.textContent = "No CSV loaded yet.";
    els.batchScheduleFileStatus.dataset.type = "empty";
  }
});

els.scheduleDxfInput.addEventListener("change", () => {
  const file = els.scheduleDxfInput.files?.[0];
  if (file) {
    els.scheduleDxfStatus.textContent = `${file.name} loaded (override)`;
    els.scheduleDxfStatus.dataset.type = "success";
  } else {
    els.scheduleDxfStatus.textContent = "Using Floor plans DXF when available.";
    els.scheduleDxfStatus.dataset.type = "empty";
  }
  updateScheduleSharedContext();
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

populateFloorSelect();
loadConfigIntoForm();
void initSchools();
updateScheduleSharedContext();
els.saveBtn.disabled = true;
els.downloadBtn.disabled = true;
els.downloadCsvBtn.disabled = true;
