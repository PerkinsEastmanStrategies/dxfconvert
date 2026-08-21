/** Floor levels matching AISD-ESA / FacSurvey `lib/floor-plan-manifest.ts`. */

export const FLOOR_LEVELS = [
  { id: "basement", column: "Basement", shortLabel: "B", fullLabel: "Basement" },
  { id: "floor-1", column: "Floor 1", shortLabel: "L1", fullLabel: "Floor 1" },
  { id: "floor-2", column: "Floor 2", shortLabel: "L2", fullLabel: "Floor 2" },
  { id: "floor-3", column: "Floor 3", shortLabel: "L3", fullLabel: "Floor 3" },
  { id: "floor-4", column: "Floor 4", shortLabel: "L4", fullLabel: "Floor 4" },
  { id: "floor-5", column: "Floor 5", shortLabel: "L5", fullLabel: "Floor 5" },
  { id: "floor-6", column: "Floor 6", shortLabel: "L6", fullLabel: "Floor 6" },
  { id: "floor-7", column: "Floor 7", shortLabel: "L7", fullLabel: "Floor 7" },
  { id: "floor-8", column: "Floor 8", shortLabel: "L8", fullLabel: "Floor 8" },
  { id: "floor-9", column: "Floor 9", shortLabel: "L9", fullLabel: "Floor 9" },
  {
    id: "athletics",
    column: "Athletics Building",
    shortLabel: "ATH",
    fullLabel: "Athletics Building",
  },
  { id: "mezzanine", column: "Mezzanine", shortLabel: "M", fullLabel: "Mezzanine" },
];

/**
 * @param {string} floorLevelId
 */
export function getFloorLevel(floorLevelId) {
  return FLOOR_LEVELS.find((f) => f.id === floorLevelId) ?? null;
}
