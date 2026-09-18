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

/** Same threshold the ESA app uses when a path has no Z but first/last vertices meet. */
function pointsLoopClosed(points) {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return distanceSquared(first.x, first.y, last.x, last.y) < 4;
}

function pointInPolygon(x, y, points) {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function extractSpaces(entities) {
  /** @type {Array<{ index: number, layer: string, points: {x:number,y:number}[], bbox: ReturnType<typeof bboxFromPoints>, area: number, centroid: {x:number,y:number}, flaggedClosed: boolean, looped: boolean, closedForMatch: boolean }>} */
  const spaces = [];

  for (const entity of entities) {
    if (classifyLayer(entity.layer) !== "CAFM_SPACE") continue;

    const points = getVertices(entity);
    if (points.length < 3) continue;

    const bbox = bboxFromPoints(points);
    if (bbox.width <= 0 || bbox.height <= 0) continue;

    const flaggedClosed = isClosedEntity(entity);
    const looped = pointsLoopClosed(points);
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
      flaggedClosed,
      looped,
      closedForMatch: flaggedClosed || looped,
    });
  }

  return spaces;
}

/**
 * Match CAFM_ID labels to CAFM_SPACE the way the ESA app does (point-in-polygon,
 * then bbox, then nearest). Anything that is not a true polygon hit is flagged
 * as not findable on the floor plan.
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
  const claimedSpaceIndexes = new Set();

  /** @type {Array<Record<string, string | number>>} */
  const rows = labels.map((label) => {
    const inPolygon = spaces
      .filter((space) => space.closedForMatch && pointInPolygon(label.x, label.y, space.points))
      .sort((a, b) => a.area - b.area);
    const inBBox = spaces
      .filter((space) => pointInBBox(label.x, label.y, space.bbox))
      .sort((a, b) => a.area - b.area);

    let matchStatus = "unmatched_label";
    let issue = "No CAFM_SPACE polygon contains this label. ESA will not select this room.";
    let findable = "no";
    let space = inPolygon[0] ?? null;
    let inPolygonHit = "no";

    if (space) {
      inPolygonHit = "yes";
      claimedSpaceIndexes.add(space.index);
      if (!space.flaggedClosed) {
        matchStatus = "unclosed_loop";
        issue =
          "Polyline loops but is not flagged Closed in CAD. ESA may miss it; close the space in Revit/CAD.";
        findable = "no";
      } else {
        matchStatus = "matched";
        issue = "";
        findable = "yes";
      }
    } else if (inBBox[0]) {
      space = inBBox[0];
      claimedSpaceIndexes.add(space.index);
      matchStatus = "bbox_only";
      issue =
        "Label sits in this space's bounding box but not inside the polygon (L-shape, overlap, or label on a wall). ESA will not select this room.";
      findable = "no";
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
        claimedSpaceIndexes.add(space.index);
        matchStatus = "nearest";
        issue =
          "Label is not inside any space polygon. ESA will not treat this as a selectable room if other rooms matched.";
        findable = "no";
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
      findable,
      issue,
      in_polygon: inPolygonHit,
      closed: space ? (space.flaggedClosed ? "yes" : "no") : "",
      space_index: space?.index ?? "",
      space_centroid_x: space ? round(space.centroid.x) : "",
      space_centroid_y: space ? round(space.centroid.y) : "",
      space_area: space ? round(space.area) : "",
      space_vertices: space?.points.length ?? "",
      space_layer: space?.layer ?? "",
    };
  });

  const idsOnSpace = new Map();
  for (const row of rows) {
    if (!row.space_index || !row.room_id) continue;
    const list = idsOnSpace.get(row.space_index) ?? [];
    list.push(row);
    idsOnSpace.set(row.space_index, list);
  }
  for (const group of idsOnSpace.values()) {
    const uniqueIds = [...new Set(group.map((row) => String(row.room_id)))];
    if (uniqueIds.length < 2) continue;
    const keeper = group.find((row) => row.findable === "yes") ?? group[0];
    for (const row of group) {
      if (row === keeper) continue;
      row.match_status = "shared_space";
      row.findable = "no";
      row.issue = `Shares a polygon with ${uniqueIds.filter((id) => id !== String(row.room_id)).join(", ")}. ESA keeps one room per space.`;
    }
  }

  const keptDuplicateIds = new Set();
  for (const row of rows) {
    const id = String(row.room_id || "");
    if (!id || (roomIdCounts.get(id) || 0) < 2) continue;
    if (row.findable === "yes" && !keptDuplicateIds.has(id)) {
      keptDuplicateIds.add(id);
      row.issue = "Duplicate room number on this floor. This is the copy ESA can keep.";
      continue;
    }
    row.findable = "no";
    row.match_status = String(row.match_status).startsWith("duplicate")
      ? row.match_status
      : `duplicate_${row.match_status}`;
    row.issue = `Duplicate of ${id}. ESA keeps only one selectable room with this number.`;
  }

  for (const space of spaces) {
    if (claimedSpaceIndexes.has(space.index)) continue;
    const unclosed = !space.flaggedClosed;
    rows.push({
      room_id: "",
      label_x: "",
      label_y: "",
      label_layer: "",
      label_type: "",
      full_label: "",
      match_status: unclosed ? "unclosed_space" : "orphan_space",
      findable: "no",
      issue: unclosed
        ? "CAFM_SPACE polyline is not closed. ESA cannot use it as a selectable room."
        : "Closed space has no CAFM_ID label inside it.",
      in_polygon: "no",
      closed: space.flaggedClosed ? "yes" : "no",
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
      if (value === "unclosed_loop") return 1;
      if (value === "bbox_only") return 2;
      if (value === "nearest") return 3;
      if (String(value).startsWith("duplicate") || value === "shared_space") return 4;
      if (value === "unmatched_label") return 5;
      if (value === "unclosed_space") return 6;
      return 7;
    };
    const byFindable = Number(a.findable === "yes") - Number(b.findable === "yes");
    if (byFindable !== 0) return -byFindable;
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
  const bboxOnly = rows.filter((row) => row.match_status === "bbox_only").length;
  const sharedSpaces = rows.filter((row) => row.match_status === "shared_space").length;
  const unclosedSpaces = rows.filter(
    (row) => row.match_status === "unclosed_space" || row.match_status === "unclosed_loop",
  ).length;
  const orphanSpaces = rows.filter((row) => row.match_status === "orphan_space").length;
  const findable = rows.filter((row) => row.findable === "yes").length;
  const issueRows = rows.filter((row) => row.findable === "no" && row.issue);
  const issues = issueRows.map((row) => ({
    roomId: String(row.room_id || "").trim(),
    status: String(row.match_status),
    detail: String(row.issue),
  }));

  return {
    rows,
    issues,
    previewSpaces: spaces.map((space) => ({
      index: space.index,
      points: space.points,
    })),
    summary: {
      labelCount: labels.length,
      spaceCount: spaces.length,
      matched,
      nearest,
      unmatchedLabels,
      duplicateLabels,
      bboxOnly,
      sharedSpaces,
      unclosedSpaces,
      orphanSpaces,
      findable,
      notFindable: issueRows.filter((row) => row.room_id).length,
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
  "findable",
  "issue",
  "in_polygon",
  "closed",
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

/**
 * Polygons for the converter preview: same join ESA uses, colored findable vs not.
 * @param {ReturnType<typeof buildRoomInventory> | null | undefined} inventory
 */
export function previewOverlaysFromInventory(inventory) {
  if (!inventory?.rows?.length) return [];

  const pointsByIndex = new Map(
    (inventory.previewSpaces ?? []).map((space) => [space.index, space.points]),
  );

  const areas = (inventory.previewSpaces ?? []).map((space) => {
    const xs = space.points.map((p) => p.x);
    const ys = space.points.map((p) => p.y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  });
  const typical = areas.length ? areas.sort((a, b) => a - b)[Math.floor(areas.length / 2)] : 20;
  const hotspot = Math.max(typical * 0.12, 8);

  /** @type {Map<string, { findable: boolean, points: {x:number,y:number}[], labels: Array<{ id: string, x: number, y: number, issue: string }> }>} */
  const byKey = new Map();

  for (const row of inventory.rows) {
    const spaceIndex = Number(row.space_index);
    const points =
      Number.isFinite(spaceIndex) && pointsByIndex.has(spaceIndex)
        ? pointsByIndex.get(spaceIndex)
        : row.room_id
          ? hotspotPoints(Number(row.label_x), Number(row.label_y), hotspot)
          : null;
    if (!points?.length) continue;

    const key = Number.isFinite(spaceIndex) ? `space:${spaceIndex}` : `label:${row.room_id}:${row.label_x}:${row.label_y}`;
    const current = byKey.get(key) ?? {
      findable: true,
      points,
      labels: [],
    };
    if (row.findable !== "yes") current.findable = false;
    if (row.room_id) {
      current.labels.push({
        id: String(row.room_id),
        x: Number(row.label_x) || current.points[0].x,
        y: Number(row.label_y) || current.points[0].y,
        issue: String(row.issue || ""),
      });
    }
    byKey.set(key, current);
  }

  return [...byKey.values()];
}

function hotspotPoints(x, y, half) {
  return [
    { x: x - half, y: y - half },
    { x: x + half, y: y - half },
    { x: x + half, y: y + half },
    { x: x - half, y: y + half },
  ];
}
