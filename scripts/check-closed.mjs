import { readFileSync } from "fs";
import { convertDxfToAisdSvg } from "../src/dxf-converter.js";

const dxfText = readFileSync(process.argv[2], "utf8");
const { svg } = convertDxfToAisdSvg(dxfText, "mobile");
const block = svg.match(/<g id="CAFM_SPACE">[\s\S]*?<\/g>/)?.[0] ?? "";
const paths = block.match(/<path[^>]+>/g) ?? [];
const withZ = paths.filter((p) => / d="[^"]*Z"/.test(p)).length;
console.log(`CAFM_SPACE paths: ${paths.length}, closed with Z: ${withZ}`);
if (paths[0]) console.log("sample:", paths[0].slice(0, 150));
