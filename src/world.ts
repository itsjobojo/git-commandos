import { drawTile } from './core/assets';
import { CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE } from './constants';

type Tile = [number, number];

const COLS = Math.ceil(CANVAS_WIDTH / TILE_SIZE);
const MAX_BUILDING_WIDTH = 7; // max tiles per side
const MIN_ROAD_WIDTH = 8; // minimum sand tiles between buildings

// Sand ground
const SAND: Tile = [10, 3];
const SAND2: Tile = [11, 3];

// Purple building chunk (3 cols × 5 rows)
const PURPLE_L: Tile[] = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
const PURPLE_M: Tile[] = [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]];
const PURPLE_R: Tile[] = [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]];

// Green building chunk (3 cols × 3 rows)
const GREEN_L: Tile[] = [[5, 0], [5, 1], [5, 2]];
const GREEN_M: Tile[] = [[6, 0], [6, 1], [6, 2]];
const GREEN_R: Tile[] = [[7, 0], [7, 1], [7, 2]];

// Bridge tiles (connect buildings across the road)
const BRIDGE_PURPLE: Tile = [4, 2];
const BRIDGE_GREEN:  Tile = [9, 2];

// Door tile (placed at bottom of bridges)
const DOOR_TILE: Tile = [5, 4]; // tile_0077

// Decorations (opaque — replace sand tile)
const DECOR_TILES: Tile[] = [
  [4, 7], [9, 7], [5, 3], [6, 3], [14, 10],
];

// Overlay decorations (transparent bg — drawn on top of sand)
const OVERLAY_TILES: Tile[] = [
  [4, 4], // tile_0076 — rocks
  [9, 4], // tile_0081 — plant/cactus
];

// Area pad 9-patch tiles (walkable)
const AREA_TL: Tile = [10, 5];
const AREA_T:  Tile = [11, 5];
const AREA_TR: Tile = [12, 5];
const AREA_L:  Tile = [10, 6];
const AREA_F:  Tile = [11, 6];
const AREA_R:  Tile = [12, 6];
const AREA_BL: Tile = [10, 7];
const AREA_B:  Tile = [11, 7];
const AREA_BR: Tile = [12, 7];

const AREA_TILES: Tile[] = [
  AREA_TL, AREA_T, AREA_TR,
  AREA_L, AREA_F, AREA_R,
  AREA_BL, AREA_B, AREA_BR,
];

// Solid tile check — sand, decorations, and area pads are walkable
function isSolidTile(t: Tile): boolean {
  // Sand tiles
  if ((t[0] === 10 || t[0] === 11) && t[1] === 3) return false;
  // Decoration tiles (walkable)
  for (const d of DECOR_TILES) {
    if (t[0] === d[0] && t[1] === d[1]) return false;
  }
  // Area pad tiles (walkable)
  for (const a of AREA_TILES) {
    if (t[0] === a[0] && t[1] === a[1]) return false;
  }
  return true;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Door portal: enter the door at the mountain base, land on the body, walk to the
 *  exit hole on the body, then drop back to the field road tile. */
export interface DoorPortal {
  doorRow: number; doorCol: number;     // entry door at the base (road-facing edge)
  entryRow: number; entryCol: number;   // where the player lands on the body
  exitRow: number; exitCol: number;     // exit hole on the body (near the top)
  fieldRow: number; fieldCol: number;   // road tile to drop to when exiting
  bodyTile: Tile;                       // original body tile under the door (to restore on use)
  used?: boolean;                       // once you exit the hole, the door is spent — no re-entry
}

function generateWorld(totalRows: number, seed = 42): { grid: Tile[][]; overlay: (Tile | null)[][]; solid: boolean[][]; doorPortals: DoorPortal[] } {
  const rand = mulberry32(seed);
  const grid: Tile[][] = [];
  const overlay: (Tile | null)[][] = [];
  const doorPortals: DoorPortal[] = [];

  // Fill with sand
  for (let r = 0; r < totalRows; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < COLS; c++) {
      row.push(rand() < 0.15 ? [...SAND2] : [...SAND]);
    }
    grid.push(row);
    overlay.push(new Array(COLS).fill(null));
  }

  // Place buildings with occasional wide-open desert stretches
  // Track previous building's last body row and width for vertical bridges
  let prevLeftBodyEnd = -1; // row AFTER the last body row
  let prevLeftWidth = 0;
  let prevLeftType: 'purple' | 'green' = 'purple';
  let prevRightBodyEnd = -1;
  let prevRightStart = 0;
  let prevRightType: 'purple' | 'green' = 'purple';

  let y = 0;
  while (y < totalRows - 10) {
    // ~5% chance of a wide open desert section
    if (rand() < 0.05) {
      const desertRows = 5 + Math.floor(rand() * 6);
      y += desertRows;
      // Reset bridge tracking on desert gaps
      prevLeftBodyEnd = -1;
      prevRightBodyEnd = -1;
      continue;
    }

    const hasLeft = rand() < 0.96;
    const leftWidth = hasLeft ? (3 + Math.floor(rand() * (MAX_BUILDING_WIDTH - 2))) : 0;
    const leftType: 'purple' | 'green' = rand() < 0.65 ? 'purple' : 'green';

    const hasRight = rand() < 0.96;
    const maxRight = Math.min(MAX_BUILDING_WIDTH, COLS - leftWidth - MIN_ROAD_WIDTH);
    const rightWidth = hasRight && maxRight >= 3 ? (3 + Math.floor(rand() * (maxRight - 2))) : 0;
    const rightType: 'purple' | 'green' = rand() < 0.65 ? 'purple' : 'green';
    const rightStart = COLS - rightWidth;

    const extraBody = Math.floor(rand() * 8) + 2; // 2-9 extra body rows

    if (y + 8 + extraBody >= totalRows) break;

    if (hasLeft && leftWidth >= 3) {
      // Vertical bridge from prev body end to this building's first body row
      const nextLeftBodyStart = y + 1;
      const leftBridgeCol = Math.min(prevLeftWidth, leftWidth) - 1;
      const leftHasBridge = prevLeftBodyEnd >= 0 && nextLeftBodyStart > prevLeftBodyEnd
          && leftBridgeCol >= 0 && leftBridgeCol < leftWidth && leftBridgeCol < prevLeftWidth
          && rand() < 0.92;
      if (leftHasBridge) {
        const bridgeTile = prevLeftType === 'purple' ? BRIDGE_PURPLE : BRIDGE_GREEN;
        for (let r = prevLeftBodyEnd; r < nextLeftBodyStart; r++) {
          if (r >= 0 && r < totalRows) {
            grid[r][leftBridgeCol] = [...bridgeTile];
          }
        }
      }
      placeBuilding(grid, y, 0, leftWidth, extraBody, leftType);
      // ~1 in 3 left buildings get a door: enter at the base, land on the body,
      // walk to the exit hole near the top, drop back to the field.
      if (rand() < 0.34) {
        const doorRow = y + (leftType === 'purple' ? 5 : 3) + extraBody - 1; // bottom row
        const col = leftWidth - 1;                                // road-facing edge col
        const entryRow = (leftType === 'purple' ? y + 2 : y + 1) + extraBody; // lowest body row
        const exitRow = y + 1;                                    // top body row
        const fieldCol = leftWidth;                               // road tile beside mountain
        if (doorRow >= 0 && doorRow < totalRows && col >= 0
            && entryRow < totalRows && exitRow < totalRows && fieldCol < COLS
            && isBuildingBodyTile(grid[entryRow][col]) && isBuildingBodyTile(grid[exitRow][col])
            && !isSolidTile(grid[exitRow][fieldCol])) {
          const bodyTile: Tile = [...grid[doorRow][col]];
          grid[doorRow][col] = [...DOOR_TILE];
          if (doorRow + 1 < totalRows) grid[doorRow + 1][col] = [...SAND];
          doorPortals.push({
            doorRow, doorCol: col,
            entryRow, entryCol: col,
            exitRow, exitCol: col,
            fieldRow: exitRow, fieldCol,
            bodyTile,
          });
        }
      }
      // 2nd tier: smaller building stacked on top (~40% chance, needs width >= 5)
      if (leftWidth >= 5 && extraBody >= 2 && rand() < 0.65) {
        const tier2Width = leftWidth - 2;
        const tier2Extra = Math.max(0, extraBody - 2);
        const tier2Type = leftType;
        const tier2Row = y + 1; // on top of body area
        placeBuilding(grid, tier2Row, 0, tier2Width, tier2Extra, tier2Type);
      }
      // Body rows: y+1 through y+1+extraBody (inclusive)
      prevLeftBodyEnd = y + 1 + extraBody + 1;
      prevLeftWidth = leftWidth;
      prevLeftType = leftType;
    } else {
      prevLeftBodyEnd = -1;
    }

    if (hasRight && rightWidth >= 3) {
      // Vertical bridge from prev body end to this building's first body row
      const nextRightBodyStart = y + 1;
      // Bridge column must be inside both buildings
      const rightBridgeCol = Math.max(rightStart, prevRightStart); // innermost shared column
      const rightHasBridge = prevRightBodyEnd >= 0 && nextRightBodyStart > prevRightBodyEnd
          && rightBridgeCol >= rightStart && rightBridgeCol >= prevRightStart
          && rand() < 0.92;
      if (rightHasBridge) {
        const bridgeTile = prevRightType === 'purple' ? BRIDGE_PURPLE : BRIDGE_GREEN;
        for (let r = prevRightBodyEnd; r < nextRightBodyStart; r++) {
          if (r >= 0 && r < totalRows) {
            grid[r][rightBridgeCol] = [...bridgeTile];
          }
        }
      }
      placeBuilding(grid, y, rightStart, rightWidth, extraBody, rightType);
      // ~1 in 3 right buildings get a door: enter at the base, land on the body,
      // walk to the exit hole near the top, drop back to the field.
      if (rand() < 0.34) {
        const doorRow = y + (rightType === 'purple' ? 5 : 3) + extraBody - 1; // bottom row
        const col = rightStart;                                   // road-facing edge col
        const entryRow = (rightType === 'purple' ? y + 2 : y + 1) + extraBody; // lowest body row
        const exitRow = y + 1;                                    // top body row
        const fieldCol = rightStart - 1;                          // road tile beside mountain
        if (doorRow >= 0 && doorRow < totalRows && col < COLS
            && entryRow < totalRows && exitRow < totalRows && fieldCol >= 0
            && isBuildingBodyTile(grid[entryRow][col]) && isBuildingBodyTile(grid[exitRow][col])
            && !isSolidTile(grid[exitRow][fieldCol])) {
          const bodyTile: Tile = [...grid[doorRow][col]];
          grid[doorRow][col] = [...DOOR_TILE];
          if (doorRow + 1 < totalRows) grid[doorRow + 1][col] = [...SAND];
          doorPortals.push({
            doorRow, doorCol: col,
            entryRow, entryCol: col,
            exitRow, exitCol: col,
            fieldRow: exitRow, fieldCol,
            bodyTile,
          });
        }
      }
      // 2nd tier on right
      if (rightWidth >= 5 && extraBody >= 2 && rand() < 0.65) {
        const tier2Width = rightWidth - 2;
        const tier2Extra = Math.max(0, extraBody - 2);
        const tier2Type = rightType;
        const tier2Start = COLS - tier2Width; // pushed to the right edge
        const tier2Row = y + 1;
        placeBuilding(grid, tier2Row, tier2Start, tier2Width, tier2Extra, tier2Type);
      }
      prevRightBodyEnd = y + 1 + extraBody + 1;
      prevRightStart = rightStart;
      prevRightType = rightType;
    } else {
      prevRightBodyEnd = -1;
    }

    const chunkH = (leftType === 'purple' || rightType === 'purple') ? 5 : 3;
    const gap = Math.floor(rand() * 2);
    y += chunkH + extraBody + gap;
  }

  // Scatter decorations
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if ((t[0] === 10 || t[0] === 11) && t[1] === 3 && rand() < 0.07) {
        const roll = rand();
        if (roll < 0.4) {
          // Overlay decoration (transparent bg, drawn on top of sand)
          const ov = OVERLAY_TILES[Math.floor(rand() * OVERLAY_TILES.length)];
          overlay[r][c] = [...ov];
        } else {
          // Opaque decoration (replaces sand)
          const decor = DECOR_TILES[Math.floor(rand() * DECOR_TILES.length)];
          grid[r][c] = [...decor];
        }
      }
    }
  }

  // Build collision map
  const solid: boolean[][] = [];
  for (let r = 0; r < totalRows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < COLS; c++) {
      row.push(isSolidTile(grid[r][c]));
    }
    solid.push(row);
  }

  return { grid, overlay, solid, doorPortals };
}

function placeBuilding(
  grid: Tile[][],
  startRow: number,
  startCol: number,
  width: number,
  extraBody: number,
  type: 'purple' | 'green',
): void {
  const isP = type === 'purple';
  const colsL = isP ? PURPLE_L : GREEN_L;
  const colsM = isP ? PURPLE_M : GREEN_M;
  const colsR = isP ? PURPLE_R : GREEN_R;
  const h = isP ? 5 : 3;

  let row = startRow;

  for (let tileRow = 0; tileRow < h; tileRow++) {
    const repeats = (tileRow === 1) ? (1 + extraBody) : 1;

    for (let rep = 0; rep < repeats; rep++) {
      if (row >= grid.length) return;

      for (let c = startCol; c < startCol + width && c < COLS; c++) {
        const local = c - startCol;
        const last = width - 1;

        let tile: Tile;
        if (local === 0) {
          tile = [...colsL[tileRow]];
        } else if (local === last) {
          tile = [...colsR[tileRow]];
        } else {
          tile = [...colsM[tileRow]];
        }
        grid[row][c] = tile;
      }
      row++;
    }
  }
}

/** Stamp a 9-patch rectangular area onto the grid */
function placeArea(grid: Tile[][], startRow: number, startCol: number, w: number, h: number): void {
  for (let r = 0; r < h; r++) {
    const gr = startRow + r;
    if (gr < 0 || gr >= grid.length) continue;
    for (let c = 0; c < w; c++) {
      const gc = startCol + c;
      if (gc < 0 || gc >= COLS) continue;

      let tile: Tile;
      const isTop = r === 0;
      const isBot = r === h - 1;
      const isLeft = c === 0;
      const isRight = c === w - 1;

      if (isTop && isLeft)       tile = [...AREA_TL];
      else if (isTop && isRight) tile = [...AREA_TR];
      else if (isTop)            tile = [...AREA_T];
      else if (isBot && isLeft)  tile = [...AREA_BL];
      else if (isBot && isRight) tile = [...AREA_BR];
      else if (isBot)            tile = [...AREA_B];
      else if (isLeft)           tile = [...AREA_L];
      else if (isRight)          tile = [...AREA_R];
      else                       tile = [...AREA_F];

      grid[gr][gc] = tile;
    }
  }
}

// Mutable world state — regenerated by initWorld()
const AREA_W = 14;
const AREA_H = 8;
const AREA_COL = Math.floor((COLS - AREA_W) / 2);

// Row placement of the start/finish pads. The camera scrolls the whole world
// (gameRows) before the finish wraps back on-screen, so the scroll distance to
// the finish is (gameRows - (END_AREA_ROW - START_AREA_ROW)) rows.
export const START_AREA_ROW = 19;
export const END_AREA_ROW = 40;
export const SCROLL_ROWS_TO_END = END_AREA_ROW - START_AREA_ROW;

export const START_AREA = { row: START_AREA_ROW, col: AREA_COL, w: AREA_W, h: AREA_H };
// Finish pad spans the full width so it reads as a finish line and can't be dodged.
export const END_AREA   = { row: END_AREA_ROW, col: 0, w: COLS, h: AREA_H };

let WORLD_PATTERN: Tile[][] = [];
let WORLD_OVERLAY: (Tile | null)[][] = [];
let WORLD_DOOR_PORTALS: DoorPortal[] = [];
let SOLID_MAP: boolean[][] = [];

export let WORLD_ROWS = 0;

function clearAroundArea(grid: Tile[][], areaRow: number, areaCol: number, aw: number, ah: number, totalRows: number): void {
  const margin = 2;
  for (let r = areaRow - margin; r < areaRow + ah + margin; r++) {
    for (let c = areaCol - margin; c < areaCol + aw + margin; c++) {
      const gr = ((r % totalRows) + totalRows) % totalRows;
      if (c < 0 || c >= COLS) continue;
      if (r >= areaRow && r < areaRow + ah && c >= areaCol && c < areaCol + aw) continue;
      grid[gr][c] = [...SAND];
    }
  }
}

export function initWorld(totalRows: number): void {
  const worldData = generateWorld(totalRows);
  WORLD_PATTERN = worldData.grid;
  WORLD_OVERLAY = worldData.overlay;
  WORLD_DOOR_PORTALS = worldData.doorPortals;
  SOLID_MAP = worldData.solid;

  START_AREA.row = START_AREA_ROW;
  END_AREA.row = END_AREA_ROW;

  placeArea(WORLD_PATTERN, START_AREA.row, START_AREA.col, START_AREA.w, START_AREA.h);
  placeArea(WORLD_PATTERN, END_AREA.row, END_AREA.col, END_AREA.w, END_AREA.h);

  clearAroundArea(WORLD_PATTERN, START_AREA.row, START_AREA.col, START_AREA.w, START_AREA.h, totalRows);
  clearAroundArea(WORLD_PATTERN, END_AREA.row, END_AREA.col, END_AREA.w, END_AREA.h, totalRows);

  // Rebuild solid map to account for area stamps
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < COLS; c++) {
      SOLID_MAP[r][c] = isSolidTile(WORLD_PATTERN[r][c]);
    }
  }

  WORLD_ROWS = totalRows;
}

// Default initialization (title screen background, standalone mode ~8 min)
initWorld(800);

/** Check if a pixel-space rectangle collides with any solid tiles */
export function collidesWithWorld(
  x: number,
  y: number,
  w: number,
  h: number,
  scrollY: number
): boolean {
  const totalHeight = WORLD_ROWS * TILE_SIZE;
  // Convert screen Y to world Y (matching render's effectiveScroll)
  const effectiveScroll = (((-scrollY) % totalHeight) + totalHeight) % totalHeight;

  // Check all tiles the rectangle overlaps
  const startCol = Math.floor(x / TILE_SIZE);
  const endCol = Math.floor((x + w - 1) / TILE_SIZE);
  const startRowPx = y + effectiveScroll;
  const endRowPx = y + h - 1 + effectiveScroll;

  for (let c = startCol; c <= endCol; c++) {
    if (c < 0 || c >= COLS) return true; // out of bounds = solid

    for (let py = startRowPx; py <= endRowPx; py += TILE_SIZE) {
      const worldRow = ((Math.floor(py / TILE_SIZE)) % WORLD_ROWS + WORLD_ROWS) % WORLD_ROWS;
      if (SOLID_MAP[worldRow][c]) return true;
    }
    // Also check the last pixel row
    const lastRow = ((Math.floor(endRowPx / TILE_SIZE)) % WORLD_ROWS + WORLD_ROWS) % WORLD_ROWS;
    if (SOLID_MAP[lastRow][c]) return true;
  }

  return false;
}

/** Convert a screen Y position to a world tile row */
function screenToWorldRow(screenY: number, scrollY: number): number {
  const totalHeight = WORLD_ROWS * TILE_SIZE;
  const effectiveScroll = (((-scrollY) % totalHeight) + totalHeight) % totalHeight;
  return ((Math.floor((screenY + effectiveScroll) / TILE_SIZE)) % WORLD_ROWS + WORLD_ROWS) % WORLD_ROWS;
}

/** Convert a world tile row to screen Y given current camera scroll */
export function worldRowToScreenY(row: number, scrollY: number): number {
  const totalHeight = WORLD_ROWS * TILE_SIZE;
  const effectiveScroll = (((-scrollY) % totalHeight) + totalHeight) % totalHeight;
  // The screen Y of a world row
  const worldPx = row * TILE_SIZE;
  let screenY = worldPx - effectiveScroll;
  // Handle wrapping
  if (screenY < -totalHeight / 2) screenY += totalHeight;
  if (screenY > totalHeight / 2) screenY -= totalHeight;
  return screenY;
}

// Building body tiles — the flat colored interiors where side-enemies can walk
// Purple body: rows 1-2 (cols 0-2), Green body: row 1 (cols 5-7)
function isBuildingBodyTile(t: Tile): boolean {
  // Purple body: col 0-2, row 1-2
  if (t[0] >= 0 && t[0] <= 2 && t[1] >= 1 && t[1] <= 2) return true;
  // Green body: col 5-7, row 1
  if (t[0] >= 5 && t[0] <= 7 && t[1] === 1) return true;
  // Bridge tiles
  if (t[0] === BRIDGE_PURPLE[0] && t[1] === BRIDGE_PURPLE[1]) return true;
  if (t[0] === BRIDGE_GREEN[0] && t[1] === BRIDGE_GREEN[1]) return true;
  // Door tile
  if (t[0] === DOOR_TILE[0] && t[1] === DOOR_TILE[1]) return true;
  return false;
}

/** Get the tile at a screen position */
function getTileAt(screenX: number, screenY: number, scrollY: number): Tile | null {
  const totalHeight = WORLD_ROWS * TILE_SIZE;
  const effectiveScroll = (((-scrollY) % totalHeight) + totalHeight) % totalHeight;
  const col = Math.floor(screenX / TILE_SIZE);
  if (col < 0 || col >= COLS) return null;
  const worldRow = ((Math.floor((screenY + effectiveScroll) / TILE_SIZE)) % WORLD_ROWS + WORLD_ROWS) % WORLD_ROWS;
  return WORLD_PATTERN[worldRow][col];
}

/** Check if a specific screen pixel is on a solid tile */
export function isSolidAt(screenX: number, screenY: number, scrollY: number): boolean {
  const tile = getTileAt(screenX, screenY, scrollY);
  if (!tile) return false;
  return isSolidTile(tile);
}

/** Check if a screen pixel is on a building body (purple/green fill) */
export function isBuildingBodyAt(screenX: number, screenY: number, scrollY: number): boolean {
  const tile = getTileAt(screenX, screenY, scrollY);
  if (!tile) return false;
  return isBuildingBodyTile(tile);
}

/** Check if the player is standing at/near a door; if so return that DoorPortal.
 *  Called when the player presses UP. */
export function checkDoorInteraction(
  screenX: number, screenY: number, w: number, h: number, scrollY: number
): DoorPortal | null {
  const playerWorldRow = screenToWorldRow(screenY + h / 2, scrollY);
  const playerCol = Math.floor((screenX + w / 2) / TILE_SIZE);

  // The door faces the road and its tile is solid, so the player stands adjacent
  // on the road. Accept a small proximity box around the door tile.
  for (const p of WORLD_DOOR_PORTALS) {
    if (p.used) continue; // spent doors don't accept you again
    if (Math.abs(p.doorCol - playerCol) <= 1 && Math.abs(p.doorRow - playerWorldRow) <= 1) {
      return p;
    }
  }
  return null;
}

/** Spend a door once the player exits through its hole: it can never be
 *  re-entered, the door tile reverts to plain building body, and its exit
 *  hole stops being drawn. */
export function consumeDoorPortal(portal: DoorPortal): void {
  portal.used = true;
  WORLD_PATTERN[portal.doorRow][portal.doorCol] = [...portal.bodyTile];
  SOLID_MAP[portal.doorRow][portal.doorCol] = isSolidTile(portal.bodyTile);
}

/** Find screen-Y spans where the left or right edge has building body tiles.
 *  Returns array of {y, h} spans in screen coords. */
export function findBuildingEdgeSpans(scrollY: number, side: 'left' | 'right'): { y: number; h: number }[] {
  const checkCol = side === 'left' ? 1 : (COLS - 2);
  const spans: { y: number; h: number }[] = [];
  let spanStart = -1;

  for (let sy = 0; sy < CANVAS_HEIGHT; sy += TILE_SIZE) {
    if (isBuildingBodyAt(checkCol * TILE_SIZE, sy, scrollY)) {
      if (spanStart < 0) spanStart = sy;
    } else {
      if (spanStart >= 0) {
        spans.push({ y: spanStart, h: sy - spanStart });
        spanStart = -1;
      }
    }
  }
  if (spanStart >= 0) {
    spans.push({ y: spanStart, h: CANVAS_HEIGHT - spanStart });
  }
  return spans;
}

export function renderWorld(ctx: CanvasRenderingContext2D, scrollY: number): void {
  const totalHeight = WORLD_ROWS * TILE_SIZE;
  const effectiveScroll = (((-scrollY) % totalHeight) + totalHeight) % totalHeight;
  const startRow = Math.floor(effectiveScroll / TILE_SIZE);
  const offsetY = -(effectiveScroll % TILE_SIZE);
  const visibleRows = Math.ceil(CANVAS_HEIGHT / TILE_SIZE) + 2;

  for (let r = 0; r < visibleRows; r++) {
    const worldRow = ((startRow + r) % WORLD_ROWS + WORLD_ROWS) % WORLD_ROWS;
    const row = WORLD_PATTERN[worldRow];
    const dy = r * TILE_SIZE + offsetY;

    const ovRow = WORLD_OVERLAY[worldRow];
    for (let c = 0; c < COLS; c++) {
      drawTile(ctx, row[c][0], row[c][1], c * TILE_SIZE, dy);
      // Draw overlay decoration on top
      const ov = ovRow[c];
      if (ov) {
        drawTile(ctx, ov[0], ov[1], c * TILE_SIZE, dy);
      }
    }

    // Draw the exit hole (top). The entrance is the DOOR tile, drawn as a normal tile.
    for (const p of WORLD_DOOR_PORTALS) {
      if (p.used) continue; // spent portal — hole is gone
      const drawHole = (holeRow: number, holeCol: number) => {
        if (holeRow !== worldRow) return;
        const bx = holeCol * TILE_SIZE + TILE_SIZE / 2;
        const by = dy + TILE_SIZE / 2;
        const radius = TILE_SIZE / 2;
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, '#000000');
        grad.addColorStop(0.6, '#1a0033');
        grad.addColorStop(1, 'rgba(40, 0, 60, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8844ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, radius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      };
      drawHole(p.exitRow, p.exitCol);
    }
  }
}
