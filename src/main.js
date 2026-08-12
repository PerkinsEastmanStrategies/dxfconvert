import "./styles.css";
import { convertDxfToAisdSvg } from "./dxf-converter.js";
import { GROUP_LABELS } from "./layers.js";
import {
  buildRoomInventory,
  roomInventoryFilename,
  roomInventoryToCsv,
} from "./room-inventory.js";
import {
  formatBytes,
  loadSupabaseConfig,
  saveSupabaseKey,
  SUPABASE_BUCKET,
  uploadSvgToSupabase,
} from "./supabase-upload.js";
import { normalizeOutputFilename, toMobileFilename } from "./layers.js";

const els = {
  dxfInput: document.getElementById("dxf-input"),
  fileName: document.getElementById("file-name"),
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
};

/** @type {{ desktop?: string, mobile?: string, layers?: Array<{layer:string,count:number,group:string}>, inventory?: ReturnType<typeof buildRoomInventory>, dxfText?: string } | null} */
let result = null;

function setStatus(message, type = "info") {
  els.status.textContent = message;
  els.status.dataset.type = type;
}

function loadConfigIntoForm() {
  els.supabaseKey.value = loadSupabaseConfig().supabaseKey;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      els.fileName.value = suggestedFilenameFromDxf(file);
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

async function handleSave() {
  if (!result) return;

  const base = normalizeOutputFilename(els.fileName.value);
  if (!base) {
    setStatus("Enter an output file name before saving.", "error");
    return;
  }

  const supabaseKey = els.supabaseKey.value.trim();
  if (!supabaseKey) {
    setStatus("Add your Supabase service role key before uploading.", "error");
    return;
  }

  saveSupabaseKey(supabaseKey);
  const config = loadSupabaseConfig();
  config.supabaseKey = supabaseKey;
  els.saveBtn.disabled = true;
  setStatus("Uploading to Supabase…");

  try {
    const mobileName = toMobileFilename(base);
    const [desktopUpload, mobileUpload] = await Promise.all([
      uploadSvgToSupabase(config, base, result.desktop),
      uploadSvgToSupabase(config, mobileName, result.mobile),
    ]);

    setStatus(
      `Saved ${base} and ${mobileName} to Supabase bucket "${SUPABASE_BUCKET}".`,
      "success",
    );
    console.info("Uploaded:", desktopUpload.publicUrl, mobileUpload.publicUrl);
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "Upload failed.", "error");
  } finally {
    els.saveBtn.disabled = false;
  }
}

els.dxfInput.addEventListener("change", () => {
  const file = els.dxfInput.files?.[0];
  if (file && !els.fileName.value.trim()) {
    els.fileName.value = suggestedFilenameFromDxf(file);
  }
});

els.convertBtn.addEventListener("click", handleConvert);
els.downloadBtn.addEventListener("click", handleDownload);
els.downloadCsvBtn.addEventListener("click", handleDownloadCsv);
els.saveBtn.addEventListener("click", handleSave);
els.saveConfigBtn.addEventListener("click", () => {
  saveSupabaseKey(els.supabaseKey.value.trim());
  setStatus("Service role key saved in this browser.", "success");
});

loadConfigIntoForm();
els.saveBtn.disabled = true;
els.downloadBtn.disabled = true;
els.downloadCsvBtn.disabled = true;
