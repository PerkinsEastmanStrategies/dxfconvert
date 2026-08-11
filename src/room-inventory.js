import { parseString, denormalise } from "dxf";
import { classifyLayer, MOBILE_GROUPS } from "./layers.js";
import {
  applyTransform,
  cafmRoomIdFromLabel,
  cleanMtext,
  getVertices,
  isClosedEntity,
} from "./dxf-converter.js";

function bboxFromPoints(points) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function pointInBBox(x, y, bbox) {
  return (
    x >= bbox.x &&
    x <= bbox.x + bbox.width &&
    y >= bbox.y &&
    y <= bbox.y + bbox.height
  );
}

function distanceSquared(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function extractLabels(entities) {
  /** @type {Array<{ roomId: string, fullLabel: string, x: number, y: number, layer: string, entityType: string }>} */
  const labels = [];

  for (const entity of entities) {
    if (classifyLayer(entity.layer) !== "CAFM_ID") continue;
    if (entity.type !== "TEXT" && entity.type !== "MTEXT") continue;

    const fullLabel = cleanMtext(entity.string);
    const roomId = cafmRoomIdFromLabel(fullLabel);
    if (!roomId) continue;

    const pt = applyTransform({ x: entity.x ?? 0, y: entity.y ?? 0 }, entity.transforms);
    labels.push({
      roomId,
      fullLabel,
      x: pt.x,
      y: pt.y,
      layer: (entity.layer || "0").trim(),
      entityType: entity.type,
    });
  }

  return labels;
}

function extractSpaces(entities) {
  /** @type {Array<{ index: number, layer: string, points: {x:number,y:number}[], bbox: ReturnType<typeof bboxFromPoints>, area: number, centroid: {x:number,y:number} }>} */
  const spaces = [];

  for (const entity of entities) {
    if (classifyLayer(entity.layer) !== "CAFM_SPACE") continue;
    if (!isClosedEntity(entity)) continue;

    const points = getVertices(entity);
    if (points.length < 3) continue;

    const bbox = bboxFromPoints(points);
    if (bbox.width <= 0 || bbox.height <= 0) continue;

    spaces.push({
      index: spaces.length + 1,
      layer: (entity.layer || "0").trim(),
      points,
      bbox,
      area: bbox.width * bbox.height,
      centroid: {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      },
    });
  }

  return spaces;
}

/**
 * Match CAFM_ID labels to CAFM_SPACE boundaries (same bbox logic as the ESA survey app).
 * @param {string} dxfText
 */
export function buildRoomInventory(dxfText) {
  const entities = denormalise(parseString(dxfText)).filter((entity) => {
    const group = classifyLayer(entity.layer);
    return group != null && MOBILE_GROUPS.has(group);
  });

  const labels = extractLabels(entities);
  const spaces = extractSpaces(entities);

  const roomIdCounts = new Map();
  for (const label of labels) {
    roomIdCounts.set(label.roomId, (roomIdCounts.get(label.roomId) || 0) + 1);
  }

  /** @type {Set<number>} */
  const matchedSpaceIndexes = new Set();

  /** @type {Array<Record<string, string | number>>} */
  const rows = labels.map((label) => {
    const duplicate = (roomIdCounts.get(label.roomId) || 0) > 1;

    const containing = spaces
      .filter((space) => pointInBBox(label.x, label.y, space.bbox))
      .sort((a, b) => a.area - b.area);

    let matchStatus = "unmatched_label";
    let space = containing[0] ?? null;

    if (space) {
      matchStatus = duplicate ? "duplicate_label" : "matched";
      matchedSpaceIndexes.add(space.index);
    } else if (spaces.length > 0) {
      space =
        spaces
          .map((candidate) => ({
            candidate,
            distance: distanceSquared(
              candidate.centroid.x,
              candidate.centroid.y,
              label.x,
              label.y,
            ),
          }))
          .sort((a, b) => a.distance - b.distance || a.candidate.area - b.candidate.area)[0]
          ?.candidate ?? null;
      if (space) {
        matchStatus = duplicate ? "duplicate_label_nearest" : "nearest";
        matchedSpaceIndexes.add(space.index);
      }
    }

    return {
      room_id: label.roomId,
      label_x: round(label.x),
      label_y: round(label.y),
      label_layer: label.layer,
      label_type: label.entityType,
      full_label: label.fullLabel.replace(/\n/g, " / "),
      match_status: matchStatus,
      space_index: space?.index ?? "",
      space_centroid_x: space ? round(space.centroid.x) : "",
      space_centroid_y: space ? round(space.centroid.y) : "",
      space_area: space ? round(space.area) : "",
      space_vertices: space?.points.length ?? "",
      space_layer: space?.layer ?? "",
    };
  });

  for (const space of spaces) {
    if (matchedSpaceIndexes.has(space.index)) continue;
    rows.push({
      room_id: "",
      label_x: "",
      label_y: "",
      label_layer: "",
      label_type: "",
      full_label: "",
      match_status: "orphan_space",
      space_index: space.index,
      space_centroid_x: round(space.centroid.x),
      space_centroid_y: round(space.centroid.y),
      space_area: round(space.area),
      space_vertices: space.points.length,
      space_layer: space.layer,
    });
  }

  rows.sort((a, b) => {
    const statusOrder = (value) => {
      if (value === "matched") return 0;
      if (value === "nearest") return 1;
      if (String(value).startsWith("duplicate")) return 2;
      if (value === "unmatched_label") return 3;
      return 4;
    };
    const byStatus = statusOrder(a.match_status) - statusOrder(b.match_status);
    if (byStatus !== 0) return byStatus;
    return String(a.room_id).localeCompare(String(b.room_id), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const matched = rows.filter((row) => row.match_status === "matched").length;
  const nearest = rows.filter((row) => row.match_status === "nearest").length;
  const unmatchedLabels = rows.filter((row) => row.match_status === "unmatched_label").length;
  const duplicateLabels = rows.filter((row) =>
    String(row.match_status).startsWith("duplicate"),
  ).length;
  const orphanSpaces = rows.filter((row) => row.match_status === "orphan_space").length;

  return {
    rows,
    summary: {
      labelCount: labels.length,
      spaceCount: spaces.length,
      matched,
      nearest,
      unmatchedLabels,
      duplicateLabels,
      orphanSpaces,
    },
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const CSV_COLUMNS = [
  "room_id",
  "label_x",
  "label_y",
  "label_layer",
  "label_type",
  "full_label",
  "match_status",
  "space_index",
  "space_centroid_x",
  "space_centroid_y",
  "space_area",
  "space_vertices",
  "space_layer",
];

/**
 * @param {{ rows: Array<Record<string, string | number>>, summary: object }} inventory
 */
export function roomInventoryToCsv(inventory) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of inventory.rows) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function roomInventoryFilename(svgFilename) {
  const base = svgFilename.trim().replace(/\.(svg|dxf|csv)$/i, "");
  if (!base) return "rooms.csv";
  return `${base} rooms.csv`;
}
