/**
 * Apply AISD-ESA floor plan display styling (matches lib/floor-plan-style.ts).
 */
export function applyAisdSvgStyle(svgText) {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svgText;
  }

  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== "svg") return svgText;
    if (doc.querySelector("parsererror")) return svgText;

    const ns = "http://www.w3.org/2000/svg";
    const planSize = readPlanSize(svg);

    for (const old of Array.from(svg.querySelectorAll("style"))) {
      old.remove();
    }

    const style = doc.createElementNS(ns, "style");
    style.setAttribute("data-aisd-plan-style", "1");
    style.textContent = `
      svg { background: #ffffff !important; }
      path, line, polyline, polygon, circle, ellipse,
      rect:not([data-aisd-plan-backdrop]) {
        fill: none !important;
        stroke: #000000 !important;
        stroke-opacity: 1 !important;
        fill-opacity: 1 !important;
        color: #000000 !important;
      }
      rect[data-aisd-plan-backdrop] {
        fill: #ffffff !important;
        stroke: none !important;
      }
      text, tspan {
        fill: #000000 !important;
        stroke: none !important;
        fill-opacity: 1 !important;
      }
      #CAFM_ID text, #CAFM_ID tspan {
        fill: #000000 !important;
        stroke: none !important;
      }
    `;
    svg.insertBefore(style, svg.firstChild);

    const vb = readViewBox(svg);
    if (vb) {
      const backdrop = doc.createElementNS(ns, "rect");
      backdrop.setAttribute("data-aisd-plan-backdrop", "1");
      backdrop.setAttribute("x", String(vb.x));
      backdrop.setAttribute("y", String(vb.y));
      backdrop.setAttribute("width", String(vb.width));
      backdrop.setAttribute("height", String(vb.height));
      backdrop.setAttribute("fill", "#ffffff");
      backdrop.setAttribute("stroke", "none");
      svg.insertBefore(backdrop, style.nextSibling);
    }

    svg.setAttribute("style", "background:#ffffff");

    for (const el of Array.from(
      svg.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect"),
    )) {
      if (el.getAttribute("data-aisd-plan-backdrop")) continue;
      schemaizeShape(el, planSize);
    }

    for (const el of Array.from(svg.querySelectorAll("text, tspan"))) {
      el.setAttribute("fill", "#000000");
      el.setAttribute("stroke", "none");
    }

    return new XMLSerializer().serializeToString(doc);
  } catch {
    return svgText;
  }
}

function readViewBox(svg) {
  const raw = svg.getAttribute("viewBox");
  if (raw) {
    const parts = raw.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  }
  const width = parseFloat(svg.getAttribute("width") ?? "");
  const height = parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height };
  }
  return null;
}

function readPlanSize(svg) {
  const vb = readViewBox(svg);
  if (vb) return Math.max(vb.width, vb.height, 1);
  return 1000;
}

function schemaizeShape(el, planSize) {
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "#000000");
  el.setAttribute("stroke-opacity", "1");
  el.setAttribute("fill-opacity", "1");
  thickenStroke(el, planSize);
}

function thickenStroke(el, planSize) {
  let n = parseFloat(el.getAttribute("stroke-width") ?? "");
  if (!Number.isFinite(n) || n <= 0) n = planSize * 0.0006;
  const target = planSize * 0.0018;
  const next = Math.max(n * 2.5, target);
  el.setAttribute("stroke-width", String(Number(next.toFixed(4))));
}
