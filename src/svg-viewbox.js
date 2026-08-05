/** @typedef {{ x: number, y: number, width: number, height: number }} SvgViewBox */

/** Room boundaries + labels define the visible plan extent for both exports. */
export const PLAN_FRAME_GROUPS = new Set(["CAFM_SPACE", "CAFM_ID"]);
export const PLAN_FRAME_GROUP_IDS = ["#CAFM_SPACE", "#CAFM_ID"];

export const DESKTOP_FRAME_GROUP_IDS = PLAN_FRAME_GROUP_IDS;
export const MOBILE_FRAME_GROUP_IDS = PLAN_FRAME_GROUP_IDS;
export const DESKTOP_FRAME_GROUPS = PLAN_FRAME_GROUPS;
export const MOBILE_FRAME_GROUPS = PLAN_FRAME_GROUPS;

/**
 * Convert a getBBox result (DXF-local coords inside the Y-flipped plan group)
 * into an SVG root viewBox.
 */
function flippedLocalBoundsToViewBox(local, paddingRatio = 0.04) {
  const padX = Math.max(local.width, 1) * paddingRatio;
  const padY = Math.max(local.height, 1) * paddingRatio;
  const dxfMinX = local.x - padX;
  const dxfMaxX = local.x + local.width + padX;
  const dxfMinY = local.y - padY;
  const dxfMaxY = local.y + local.height + padY;

  return {
    x: dxfMinX,
    y: -dxfMaxY,
    width: Math.max(dxfMaxX - dxfMinX, 1),
    height: Math.max(dxfMaxY - dxfMinY, 1),
  };
}

/**
 * @param {DOMRect[]} boxes
 */
function unionBoxes(boxes) {
  if (!boxes.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

/**
 * @param {SVGSVGElement} svgElement
 * @param {number} [paddingRatio]
 * @param {string[]} [groupIds]
 * @returns {SvgViewBox | null}
 */
export function getTightSvgViewBox(
  svgElement,
  paddingRatio = 0.04,
  groupIds = PLAN_FRAME_GROUP_IDS,
) {
  if (typeof document === "undefined") return null;

  const mount = document.createElement("div");
  mount.style.cssText =
    "position:fixed;left:-10000px;top:0;width:2400px;height:2400px;overflow:hidden;visibility:hidden;pointer-events:none;";
  const clone = svgElement.cloneNode(true);
  clone.setAttribute("width", "2400");
  clone.setAttribute("height", "2400");
  mount.appendChild(clone);
  document.body.appendChild(mount);

  try {
    const boxes = [];

    for (const id of groupIds) {
      const group = clone.querySelector(id);
      if (!group) continue;
      try {
        const bbox = group.getBBox();
        if (bbox.width > 0 && bbox.height > 0) boxes.push(bbox);
      } catch {
        /* skip */
      }
    }

    const bounds = unionBoxes(boxes);
    if (!bounds) return null;

    return flippedLocalBoundsToViewBox(bounds, paddingRatio);
  } catch {
    return null;
  } finally {
    document.body.removeChild(mount);
  }
}

/**
 * @param {SVGSVGElement} svgElement
 * @param {SvgViewBox} viewBox
 */
export function applySvgViewBox(svgElement, viewBox) {
  svgElement.setAttribute(
    "viewBox",
    `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
  );
}

/**
 * @param {SVGSVGElement} svgElement
 * @param {number} [paddingRatio]
 * @param {string[]} [groupIds]
 */
export function fitSvgElementToContent(
  svgElement,
  paddingRatio = 0.04,
  groupIds = PLAN_FRAME_GROUP_IDS,
) {
  const tight = getTightSvgViewBox(svgElement, paddingRatio, groupIds);
  if (!tight) return false;

  applySvgViewBox(svgElement, tight);

  const backdrop = svgElement.querySelector("[data-aisd-plan-backdrop]");
  if (backdrop) {
    backdrop.setAttribute("x", String(tight.x));
    backdrop.setAttribute("y", String(tight.y));
    backdrop.setAttribute("width", String(tight.width));
    backdrop.setAttribute("height", String(tight.height));
  }

  return true;
}

/**
 * @param {Array<{x:number,y:number}>} points
 */
export function robustDxfViewBox(points, paddingRatio = 0.04) {
  if (!points.length) {
    return { x: 0, y: 0, width: 1000, height: 1000 };
  }

  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const minX = percentile(xs, 0.005);
  const maxX = percentile(xs, 0.995);
  const minY = percentile(ys, 0.005);
  const maxY = percentile(ys, 0.995);

  const padX = Math.max(maxX - minX, 1) * paddingRatio;
  const padY = Math.max(maxY - minY, 1) * paddingRatio;

  return {
    x: minX - padX,
    y: -(maxY + padY),
    width: Math.max(maxX - minX + padX * 2, 1),
    height: Math.max(maxY - minY + padY * 2, 1),
  };
}

/** @param {number[]} sorted */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}
