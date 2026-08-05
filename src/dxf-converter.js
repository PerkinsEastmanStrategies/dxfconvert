import { parseString, denormalise } from "dxf";
import { classifyLayer, DESKTOP_GROUPS, GROUP_ORDER, MOBILE_GROUPS } from "./layers.js";
import { applyAisdSvgStyle } from "./svg-style.js";
import { robustDxfViewBox, PLAN_FRAME_GROUPS } from "./svg-viewbox.js";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanMtext(value) {
  return String(value || "")
    .replace(/\\P/g, "\n")
    .replace(/\\[^\\;]*;/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

function applyTransform(point, transforms) {
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

function getVertices(entity) {
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

function isClosedEntity(entity) {
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

function textElement(entity) {
  const label = cleanMtext(entity.string);
  if (!label) return null;

  const pt = applyTransform({ x: entity.x ?? 0, y: entity.y ?? 0 }, entity.transforms);
  const size = entity.textHeight || entity.nominalTextHeight || 12;
  const rotation = entity.rotation ?? 0;
  const lines = label.split("\n");
  const tspans = lines
    .map((line, i) => `<tspan x="${pt.x}" dy="${i === 0 ? 0 : size * 1.2}">${escapeXml(line)}</tspan>`)
    .join("");

  return `<text x="${pt.x}" y="${pt.y}" font-size="${size}" fill="#000000" stroke="none" transform="rotate(${-rotation} ${pt.x} ${pt.y})">${tspans}</text>`;
}

function entityToSvg(entity) {
  if (entity.type === "TEXT" || entity.type === "MTEXT") return textElement(entity);
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

  for (const entity of entities) {
    const group = classifyLayer(entity.layer);
    if (!group) continue;

    const rendered = entityToSvg(entity);
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
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
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

  const filtered = entities.filter((entity) => {
    const group = classifyLayer(entity.layer);
    return group != null && allowed.has(group);
  });

  return {
    svg: buildAisdSvg(filtered, mode),
    entityCount: filtered.length,
    totalEntities: entities.length,
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
