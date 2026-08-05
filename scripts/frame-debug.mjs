import { readFileSync } from "fs";
import { denormalise, parseString } from "dxf";
import { classifyLayer, DESKTOP_GROUPS, MOBILE_GROUPS } from "../src/layers.js";
import { robustDxfViewBox } from "../src/svg-viewbox.js";

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
      const ox = x;
      x = ox * cos - y * sin;
      y = ox * sin + y * cos;
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
  if (entity.type === "TEXT" || entity.type === "MTEXT") {
    const pt = applyTransform({ x: entity.x ?? 0, y: entity.y ?? 0 }, entity.transforms);
    const size = entity.textHeight || entity.nominalTextHeight || 12;
    return [{ x: pt.x - size, y: pt.y - size }, { x: pt.x + size * 4, y: pt.y + size }];
  }
  return [];
}

const dxfText = readFileSync(process.argv[2], "utf8");
const entities = denormalise(parseString(dxfText));

for (const mode of ["desktop", "mobile"]) {
  const allowed = mode === "mobile" ? MOBILE_GROUPS : DESKTOP_GROUPS;
  const filtered = entities.filter((e) => {
    const g = classifyLayer(e.layer);
    return g && allowed.has(g);
  });

  for (const groups of [
    new Set(["CAFM_SPACE", "CAFM_ID"]),
    new Set(["CAFM_SPACE", "CAFM_ID", "WALLS"]),
    new Set(["CAFM_SPACE", "CAFM_ID", "WALLS", "DOORS"]),
  ]) {
    const pts = [];
    for (const e of filtered) {
      const g = classifyLayer(e.layer);
      if (!groups.has(g)) continue;
      pts.push(...getVertices(e));
    }
    const vb = robustDxfViewBox(pts);
    console.log(mode, [...groups].join("+"), "=>", vb);
  }
}
