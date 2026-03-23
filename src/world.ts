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

// Decorations
const DECOR_TILES: Tile[] = [
  [4, 7], [9, 7], [5, 3], [6, 3], [5, 4], [14, 10],
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

function generateWorld(totalRows: number, seed = 42): { grid: Tile[][]; solid: boolean[][] } {
  const rand = mulberry32(seed);
  const grid: Tile[][] = [];

  // Fill with sand
  for (let r = 0; r < totalRows; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < COLS; c++) {
      row.push(rand() < 0.15 ? [...SAND2] : [...SAND]);
    }
    grid.push(row);
  }

  // Place buildings with occasional wide-open desert stretches
  let y = 0;
  while (y < totalRows - 10) {
    // ~10% chance of a wide open desert section
    if (rand() < 0.10) {
      const desertRows = 8 + Math.floor(rand() * 10); // 8-18 rows of open sand
      y += desertRows;
      continue;
    }

    const hasLeft = rand() < 0.88;
    const leftWidth = hasLeft ? (3 + Math.floor(rand() * (MAX_BUILDING_WIDTH - 2))) : 0;
    const leftType: 'purple' | 'green' = rand() < 0.65 ? 'purple' : 'green';

    const hasRight = rand() < 0.88;
    const maxRight = Math.min(MAX_BUILDING_WIDTH, COLS - leftWidth - MIN_ROAD_WIDTH);
    const rightWidth = hasRight && maxRight >= 3 ? (3 + Math.floor(rand() * (maxRight - 2))) : 0;
    const rightType: 'purple' | 'green' = rand() < 0.65 ? 'purple' : 'green';
    const rightStart = COLS - rightWidth;

    const extraBody = Math.floor(rand() * 6) + 1; // 1-6 extra body rows = longer buildings

    if (y + 8 + extraBody >= totalRows) break;

    if (hasLeft && leftWidth >= 3) {
      placeBuilding(grid, y, 0, leftWidth, extraBody, leftType);
    }
    if (hasRight && rightWidth >= 3) {
      placeBuilding(grid, y, rightStart, rightWidth, extraBody, rightType);
    }

    const chunkH = (leftType === 'purple' || rightType === 'purple') ? 5 : 3;
    const gap = Math.floor(rand() * 2);
    y += chunkH + extraBody + gap;
  }

  // Scatter decorations
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if ((t[0] === 10 || t[0] === 11) && t[1] === 3 && rand() < 0.025) {
        const decor = DECOR_TILES[Math.floor(rand() * DECOR_TILES.length)];
        grid[r][c] = [...decor];
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

  return { grid, solid };
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

// Generate world
const WORLD_ROWS_COUNT = 200;
const worldData = generateWorld(WORLD_ROWS_COUNT);
const WORLD_PATTERN = worldData.grid;

// Stamp start area (bottom of initial view) and end area (reached after scrolling)
const AREA_W = 14;
const AREA_H = 8;
const AREA_COL = Math.floor((COLS - AREA_W) / 2);

export const START_AREA = { row: 19, col: AREA_COL, w: AREA_W, h: AREA_H };
export const END_AREA   = { row: 120, col: AREA_COL, w: AREA_W, h: AREA_H };

placeArea(WORLD_PATTERN, START_AREA.row, START_AREA.col, AREA_W, AREA_H);
placeArea(WORLD_PATTERN, END_AREA.row, END_AREA.col, AREA_W, AREA_H);

// Clear buildings around the areas (2-tile margin of sand)
function clearAroundArea(grid: Tile[][], areaRow: number, areaCol: number, aw: number, ah: number): void {
  const margin = 2;
  for (let r = areaRow - margin; r < areaRow + ah + margin; r++) {
    for (let c = areaCol - margin; c < areaCol + aw + margin; c++) {
      const gr = ((r % WORLD_ROWS_COUNT) + WORLD_ROWS_COUNT) % WORLD_ROWS_COUNT;
      if (c < 0 || c >= COLS) continue;
      // Don't overwrite the area itself
      if (r >= areaRow && r < areaRow + ah && c >= areaCol && c < areaCol + aw) continue;
      grid[gr][c] = [...SAND];
    }
  }
}
clearAroundArea(WORLD_PATTERN, START_AREA.row, START_AREA.col, AREA_W, AREA_H);
clearAroundArea(WORLD_PATTERN, END_AREA.row, END_AREA.col, AREA_W, AREA_H);

// Build collision map after areas are placed
const SOLID_MAP = worldData.solid;
// Rebuild solid map to account for area stamps
for (let r = 0; r < WORLD_ROWS_COUNT; r++) {
  for (let c = 0; c < COLS; c++) {
    SOLID_MAP[r][c] = isSolidTile(WORLD_PATTERN[r][c]);
  }
}

export const WORLD_ROWS = WORLD_PATTERN.length;

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

    for (let c = 0; c < COLS; c++) {
      drawTile(ctx, row[c][0], row[c][1], c * TILE_SIZE, dy);
    }
  }
}
