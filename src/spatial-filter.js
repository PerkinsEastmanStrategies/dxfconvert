/**
 * Drop leftover CAD fragments that sit far from any real room.
 *
 * CAFM_SPACE is the source of truth for the occupied plan. Walls, doors,
 * fixtures, and labels are kept only if they sit near at least one room.
 * That preserves detached buildings (A / B) without keeping dashes in
 * the empty campus around them.
 */

/**
 * @param {{x:number,y:number}[]} points
 * @returns {{ minX:number, minY:number, maxX:number, maxY:number, width:number, height:number } | null}
 */
export function boundsFromPoints(points) {
  if (!points?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function expandBounds(bounds, pad) {
  return {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  };
}

function intersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function centroid(bounds) {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function pointInBounds(point, bounds) {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function nearAnyCatchment(bounds, catchments) {
  return catchments.some((room) => intersects(bounds, room));
}

function mostlyNearRooms(points, catchments) {
  if (!points.length) return false;
  let near = 0;
  for (const point of points) {
    if (catchments.some((room) => pointInBounds(point, room))) near += 1;
  }
  return near >= Math.max(1, Math.ceil(points.length * 0.5));
}

/**
 * Keep CAFM_SPACE clusters (including multi-building campuses) and drop
 * isolated leftover room polygons far from the rest of the plan.
 */
function keepSpaceClusters(spaceItems) {
  if (spaceItems.length <= 2) return new Set(spaceItems.map((_, i) => i));

  const sizes = spaceItems.map((s) => Math.max(s.bounds.width, s.bounds.height));
  const typical = Math.max(median(sizes), 1);
  const linkDist = typical * 12;

  const cents = spaceItems.map((s) => centroid(s.bounds));
  const visited = new Set();
  const keep = new Set();

  for (let i = 0; i < spaceItems.length; i++) {
    if (visited.has(i)) continue;
    const stack = [i];
    const cluster = [];
    visited.add(i);
    while (stack.length) {
      const cur = stack.pop();
      cluster.push(cur);
      for (let j = 0; j < spaceItems.length; j++) {
        if (visited.has(j)) continue;
        if (dist(cents[cur], cents[j]) <= linkDist) {
          visited.add(j);
          stack.push(j);
        }
      }
    }

    const clusterArea = cluster.reduce((sum, idx) => {
      const b = spaceItems[idx].bounds;
      return sum + Math.max(b.width * b.height, 1);
    }, 0);

    // Keep any cluster with 2+ rooms, or a single sizable space (standalone building).
    if (cluster.length >= 2 || clusterArea >= typical * typical * 0.25) {
      for (const idx of cluster) keep.add(idx);
    }
  }

  return keep.size ? keep : new Set(spaceItems.map((_, i) => i));
}

/**
 * @param {Array<{ entity: object, group: string|null, points: Array<{x:number,y:number}> }>} items
 */
export function stripFragmentItems(items) {
  const spaces = [];
  for (const item of items) {
    if (item.group !== "CAFM_SPACE") continue;
    const bounds = boundsFromPoints(item.points);
    if (bounds) spaces.push({ item, bounds });
  }

  if (!spaces.length) {
    return { kept: items, stripped: 0 };
  }

  const keptSpaceIdx = keepSpaceClusters(spaces);
  const keptSpaces = spaces.filter((_, i) => keptSpaceIdx.has(i));

  const sizes = keptSpaces.map((s) => Math.max(s.bounds.width, s.bounds.height));
  const typical = Math.max(percentile(sizes, 0.6), median(sizes), 1);
  const campusW = Math.max(...keptSpaces.map((s) => s.bounds.maxX)) - Math.min(...keptSpaces.map((s) => s.bounds.minX));
  const campusH = Math.max(...keptSpaces.map((s) => s.bounds.maxY)) - Math.min(...keptSpaces.map((s) => s.bounds.minY));
  const campusSpan = Math.max(campusW, campusH, 1);
  // Exterior walls / door swings sit just outside the room polygon.
  const pad = Math.max(typical * 1.1, campusSpan * 0.02);
  const maxEntitySpan = Math.max(typical * 20, campusSpan * 0.45);
  const catchments = keptSpaces.map((s) => expandBounds(s.bounds, pad));
  const keptSpaceSet = new Set(keptSpaces.map((s) => s.item));

  const kept = [];
  let stripped = 0;

  for (const item of items) {
    if (item.group === "CAFM_SPACE") {
      if (keptSpaceSet.has(item)) kept.push(item);
      else stripped += 1;
      continue;
    }

    const bounds = boundsFromPoints(item.points);
    if (!bounds) {
      stripped += 1;
      continue;
    }

    const span = Math.max(bounds.width, bounds.height);
    const keep =
      span > maxEntitySpan
        ? mostlyNearRooms(item.points, catchments)
        : nearAnyCatchment(bounds, catchments);

    if (keep) kept.push(item);
    else stripped += 1;
  }

  return { kept, stripped };
}
