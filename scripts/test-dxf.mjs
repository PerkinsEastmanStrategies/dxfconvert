import { readFileSync } from "fs";
import { denormalise, parseString } from "dxf";
import { classifyLayer } from "../src/layers.js";
import { convertDxfToAisdSvg } from "../src/dxf-converter.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/test-dxf.mjs <path-to-dxf>");
  process.exit(1);
}

const dxfText = readFileSync(path, "utf8");
const entities = denormalise(parseString(dxfText));
const layers = new Map();

for (const entity of entities) {
  const layer = (entity.layer || "0").trim();
  const group = classifyLayer(layer) || "UNMATCHED";
  if (!layers.has(layer)) layers.set(layer, { count: 0, group });
  layers.get(layer).count += 1;
}

console.log("Total entities:", entities.length);
console.log("Layers:");
for (const [layer, info] of [...layers.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${layer} (${info.count}) -> ${info.group}`);
}

const desktop = convertDxfToAisdSvg(dxfText, "desktop");
const mobile = convertDxfToAisdSvg(dxfText, "mobile");
console.log("Desktop kept:", desktop.entityCount, "bytes:", desktop.svg.length);
console.log("Mobile kept:", mobile.entityCount, "bytes:", mobile.svg.length);
