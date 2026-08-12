import { parseString, denormalise } from "dxf";
import { classifyLayer, DESKTOP_GROUPS, GROUP_ORDER, MOBILE_GROUPS } from "./layers.js";
import { applyAisdSvgStyle } from "./svg-style.js";
import { robustDxfViewBox, PLAN_FRAME_GROUPS } from "./svg-viewbox.js";
import { stripFragmentItems } from "./spatial-filter.js";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function cleanMtext(value) {
  return String(value || "")
    .replace(/\\P/g, "\n")
    .replace(/\\[^\\;]*;/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

export function applyTransform(point, transforms) {
  let { x, y } = point;
  for (const t of transforms || []) {
    if (t.x != null) x += t.x;
    if (t.y != null) y += t.y;
    if (t.scaleX != null) x *= t.scaleX;
    if (t.scaleY != null) y *= t.scaleY;
    if (t.rotation != null) {
      const rad = (t.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const nx = x * cos - y * sin;
      const ny = x * sin + y * cos;
      x = nx;
      y = ny;
    }
  }
  return { x, y };
}

export function getVertices(entity) {
  if (entity.vertices?.length) {
    return entity.vertices.map((v) => applyTransform({ x: v.x, y: v.y }, entity.transforms));
  }
  if (entity.type === "LINE") {
    return [
      applyTransform({ x: entity.start?.x ?? entity.x ?? 0, y: entity.start?.y ?? entity.y ?? 0 }, entity.transforms),
      applyTransform({ x: entity.end?.x ?? 0, y: entity.end?.y ?? 0 }, entity.transforms),
    ];
  }
  if (entity.type === "CIRCLE") {
    const cx = entity.x ?? 0;
    const cy = entity.y ?? 0;
    const r = entity.r ?? 0;
    const segments = 48;
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(applyTransform({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }, entity.transforms));
    }
    return pts;
  }
  if (entity.type === "ARC") {
    const cx = entity.x ?? 0;
    const cy = entity.y ?? 0;
    const r = entity.r ?? 0;
    const start = ((entity.startAngle ?? 0) * Math.PI) / 180;
    const end = ((entity.endAngle ?? 360) * Math.PI) / 180;
    const segments = Math.max(8, Math.ceil(Math.abs(end - start) / (Math.PI / 24)));
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const a = start + ((end - start) * i) / segments;
      pts.push(applyTransform({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }, entity.transforms));
    }
    return pts;
  }
  return [];
}

export function isClosedEntity(entity) {
  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    return Boolean(entity.closed);
  }
  if (entity.type === "CIRCLE") return true;
  return false;
}

function pathFromPoints(points, closed = false) {
  if (points.length < 2) return null;
  let d = points.reduce((acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`), "");
  if (closed && points.length >= 3) d += "Z";
  return `<path d="${d}" fill="none" stroke="#000000" />`;
}

/** Room number only — first MTEXT/TEXT line (skip room-name subtext on line 2+). */
export function cafmRoomIdFromLabel(label) {
  return label.split("\n")[0]?.trim() ?? "";
}

/** Compensate for the root Y-flip (matrix(1,0,0,-1)) so TEXT/MTEXT reads upright like AutoCAD. */
function textRotationDegrees(entity) {
  if (entity.rotation != null && Number.isFinite(entity.rotation)) return entity.rotation;
  if (entity.xAxisX != null && entity.xAxisY != null) {
    return (Math.atan2(entity.xAxisY, entity.xAxisX) * 180) / Math.PI;
  }
  return 0;
}

function textMirrorScaleX(entity) {
  let sx = 1;
  if (entity.relScaleX != null && entity.relScaleX < 0) sx = -1;
  const mirror = entity.mirror ?? 0;
  if (mirror & 2) sx *= -1;
  return sx;
}

function textElementTransform(pt, rotationDeg, scaleX = 1) {
  const { x, y } = pt;
  const r = rotationDeg ?? 0;
  return `translate(${x},${y}) scale(${scaleX},-1) rotate(${-r}) translate(${-x},${-y})`;
}

function textElement(entity, labelIndex = 0) {
  const label = cleanMtext(entity.string);
  const roomId = cafmRoomIdFromLabel(label);
  if (!roomId) return null;

  const pt = applyTransform({ x: entity.x ?? 0, y: entity.y ?? 0 }, entity.transforms);
  const size = entity.textHeight || entity.nominalTextHeight || 12;
  const rotation = textRotationDegrees(entity);
  const scaleX = textMirrorScaleX(entity);
  const isMtext = entity.type === "MTEXT";
  const groupPrefix = isMtext ? "MTEXT" : "TEXT";
  const groupId = `${groupPrefix}${labelIndex}`;

  const textMarkup = `<text x="${pt.x}" y="${pt.y}" font-size="${size}" fill="#000000" stroke="none" transform="${textElementTransform(pt, rotation, scaleX)}"><tspan x="${pt.x}" dy="0">${escapeXml(roomId)}</tspan></text>`;

  // Match native CAFM/Serif exports — ESA parser expects TEXT/MTEXT wrapper groups.
  return `<g id="${groupId}" serif:id="${groupPrefix}">\n${textMarkup}\n</g>`;
}

function entityToSvg(entity, cafmLabelIndex) {
  if (entity.type === "TEXT" || entity.type === "MTEXT") {
    return textElement(entity, cafmLabelIndex ?? 0);
  }
  const points = getVertices(entity);
  return pathFromPoints(points, isClosedEntity(entity));
}

function collectEntityPoints(entity) {
  if (entity.type === "TEXT" || entity.type === "MTEXT") {
    const pt = applyTransform({ x: entity.x ?? 0, y: entity.y ?? 0 }, entity.transforms);
    const size = entity.textHeight || entity.nominalTextHeight || 12;
    return [
      { x: pt.x - size, y: pt.y - size },
      { x: pt.x + size * 4, y: pt.y + size },
    ];
  }
  return getVertices(entity);
}

/**
 * @param {Array<object>} entities
 * @param {"desktop"|"mobile"} mode
 */
export function buildAisdSvg(entities, mode = "desktop") {
  /** @type {Record<string, string[]>} */
  const groups = Object.fromEntries(GROUP_ORDER.map((g) => [g, []]));
  const frameGroups = PLAN_FRAME_GROUPS;
  const framePoints = [];
  let cafmLabelIndex = 0;

  for (const entity of entities) {
    const group = classifyLayer(entity.layer);
    if (!group) continue;

    const isCafmLabel =
      group === "CAFM_ID" && (entity.type === "TEXT" || entity.type === "MTEXT");
    const rendered = isCafmLabel
      ? entityToSvg(entity, cafmLabelIndex++)
      : entityToSvg(entity);
    if (!rendered) continue;

    const points = collectEntityPoints(entity);
    if (frameGroups.has(group)) framePoints.push(...points);
    groups[group].push(rendered);
  }

  const viewBox = framePoints.length
    ? robustDxfViewBox(framePoints)
    : { x: 0, y: 0, width: 1000, height: 1000 };

  const groupMarkup = GROUP_ORDER.filter((id) => groups[id]?.length)
    .map((id) => `<g id="${id}">\n${groups[id].join("\n")}\n</g>`)
    .join("\n");

  const raw = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:serif="http://www.serif.com/"
  viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
  preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
  <g stroke="#000000" fill="none" transform="matrix(1,0,0,-1,0,0)">
${groupMarkup}
  </g>
</svg>`;

  return applyAisdSvgStyle(raw);
}

/**
 * @param {string} dxfText
 * @param {"desktop"|"mobile"} mode
 */
export function convertDxfToAisdSvg(dxfText, mode) {
  const parsed = parseString(dxfText);
  const entities = denormalise(parsed);

  const allowed = mode === "mobile" ? MOBILE_GROUPS : DESKTOP_GROUPS;

  const layerFiltered = entities.filter((entity) => {
    const group = classifyLayer(entity.layer);
    return group != null && allowed.has(group);
  });

  const { kept, stripped } = stripFragmentItems(
    layerFiltered.map((entity) => ({
      entity,
      group: classifyLayer(entity.layer),
      points: collectEntityPoints(entity),
    })),
  );
  const filtered = kept.map((item) => item.entity);

  return {
    svg: buildAisdSvg(filtered, mode),
    entityCount: filtered.length,
    totalEntities: entities.length,
    strippedFragments: stripped,
    layers: summarizeFromEntities(entities),
  };
}

function summarizeFromEntities(entities) {
  const counts = new Map();
  for (const entity of entities) {
    const layer = (entity.layer || "0").trim();
    counts.set(layer, (counts.get(layer) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([layer, count]) => ({
      layer,
      count,
      group: classifyLayer(layer) || "UNMATCHED",
    }))
    .sort((a, b) => a.layer.localeCompare(b.layer, undefined, { sensitivity: "base" }));
}

export function parseDxfLayers(dxfText) {
  const parsed = parseString(dxfText);
  const entities = denormalise(parsed);
  return { entities, layers: summarizeFromEntities(entities) };
}
