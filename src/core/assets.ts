const loading: Promise<void>[] = [];

function loadImg(path: string): HTMLImageElement {
  const img = new Image();
  img.src = path;
  loading.push(
    new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load: ${path}`));
    })
  );
  return img;
}

// ── Logo ──
export const logoImg = loadImg('/images/logo.png');

// ── Tilemaps ──
export const tilesTilemap = loadImg('/sprites/tilemap.png');       // 16x16 tiles, 18 cols, 13 rows, 1px spacing
export const weaponsTilemap = loadImg('/sprites/weapons_tilemap.png'); // 24x24 tiles, 10 cols, 4 rows, 1px spacing
export const playersTilemap = loadImg('/sprites/players_tilemap.png'); // 24x24 tiles, 4 cols, 4 rows, 1px spacing
export const enemiesTilemap = loadImg('/sprites/enemies_tilemap.png'); // 24x24 tiles, 4 cols, 4 rows, 1px spacing

// ── Individual enemy PNGs (16x16) ──
export const enemySprites: HTMLImageElement[] = [
  'tile_0085', 'tile_0086', 'tile_0087', 'tile_0088',
  'tile_0096', 'tile_0097', 'tile_0098',
  'tile_0109', 'tile_0111', 'tile_0112',
].map(n => loadImg(`/sprites/enemies/${n}.png`));

// Dedicated sprite for the outlook organizer (not in general pool)
export const outlookOrganizerSprite = loadImg('/sprites/enemies/tile_0099.png');

// Outlook icon for invite objects
export const outlookIconImg = loadImg('/sprites/outlook.png');

// Bullet and knife sprites
export const bulletSprite = loadImg('/sprites/bullet.png');
export const knifeSprite = loadImg('/sprites/knife.png');

// Weapon sprites (for pickups + HUD)
export const weaponSprites: Record<string, HTMLImageElement> = {
  pistol: loadImg('/sprites/weapon_pistol.png'),
  smg: loadImg('/sprites/weapon_smg.png'),
  machinegun: loadImg('/sprites/weapon_machinegun.png'),
  shotgun: loadImg('/sprites/weapon_shotgun.png'),
};

// ── Tilemap helpers ──

/** Draw a 16x16 tile from the Tiles tilemap */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  dx: number,
  dy: number
): void {
  const sx = col * 17; // 16px + 1px spacing
  const sy = row * 17;
  ctx.drawImage(tilesTilemap, sx, sy, 16, 16, dx, dy, 16, 16);
}

/** Draw a 24x24 sprite from a character tilemap (players/enemies) */
export function drawChar(
  ctx: CanvasRenderingContext2D,
  tilemap: HTMLImageElement,
  col: number,
  row: number,
  dx: number,
  dy: number
): void {
  const sx = col * 25; // 24px + 1px spacing
  const sy = row * 25;
  ctx.drawImage(tilemap, sx, sy, 24, 24, dx, dy, 24, 24);
}

/** Draw a 24x24 weapon/projectile sprite */
export function drawWeapon(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  dx: number,
  dy: number
): void {
  const sx = col * 25;
  const sy = row * 25;
  ctx.drawImage(weaponsTilemap, sx, sy, 24, 24, dx, dy, 24, 24);
}

// ── Direction helpers ──
// Player/enemy tilemap layout: row 0 = char1, row 2 = char2
// Within each character: col 0=down, 1=left, 2=right, 3=up
// Idle row, walk row alternate

// Only use col 1 (left) and col 2 (right) — avoid col 0 and col 3
export function dirCol(vx: number, _vy: number): number {
  if (vx < 0) return 1;
  if (vx > 0) return 2;
  return 2;
}

export function waitForAssets(): Promise<void> {
  return Promise.all(loading).then(() => {});
}
