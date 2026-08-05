import { readFileSync, writeFileSync } from "fs";
import { convertDxfToAisdSvg } from "../src/dxf-converter.js";

const path = process.argv[2] || "C:/Users/p.davis/Downloads/GORZYCHI MS L1.dxf";
const dxfText = readFileSync(path, "utf8");

for (const mode of ["desktop", "mobile"]) {
  const result = convertDxfToAisdSvg(dxfText, mode);
  const match = result.svg.match(/viewBox="([^"]+)"/);
  console.log(mode, "viewBox:", match?.[1]);
  console.log(mode, "bytes:", result.svg.length);
  writeFileSync(`./tmp-${mode}.svg`, result.svg);
}
