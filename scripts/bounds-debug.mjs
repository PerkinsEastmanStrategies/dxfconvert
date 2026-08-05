import { readFileSync } from "fs";
import { denormalise, parseString } from "dxf";
import { classifyLayer, DESKTOP_GROUPS, MOBILE_GROUPS } from "../src/layers.js";

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
      x = x * cos - y * sin;
      y = x * sin + y * cos;
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
  return entity.type === "TEXT" || entity.type === "MTEXT"
    ? [applyTransform({ x: entity.x ?? 0, y: entity.y ?? 0 }, entity.transforms)]
    : [];
}

const path = process.argv[2];
const dxfText = readFileSync(path, "utf8");
const entities = denormalise(parseString(dxfText));

for (const mode of ["desktop", "mobile"]) {
  const allowed = mode === "mobile" ? MOBILE_GROUPS : DESKTOP_GROUPS;
  const filtered = entities.filter((e) => {
    const g = classifyLayer(e.layer);
    return g && allowed.has(g);
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const xs = [];
  for (const e of filtered) {
    for (const p of getVertices(e)) {
      xs.push(p.x);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  xs.sort((a, b) => a - b);
  const p1 = xs[Math.floor(xs.length * 0.01)];
  const p99 = xs[Math.floor(xs.length * 0.99)];
  console.log(mode, { minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY, p1, p99 });
}
