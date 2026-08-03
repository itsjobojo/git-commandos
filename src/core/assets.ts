import type { WeaponType } from '../weapons';

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
export const enemiesTilemap = loadImg('/sprites/enemies_tilemap.png'); // 24x24 tiles, 4 cols, 4 rows, 1px spacing

// ── Player sprites (Kenney Soldier 1 — all face RIGHT in source) ──
export const soldierGunImg      = loadImg('/sprites/soldier1_gun.png');
export const soldierStandImg    = loadImg('/sprites/soldier1_stand.png');
export const soldierMachineImg  = loadImg('/sprites/soldier1_machine.png');
export const soldierSilencerImg = loadImg('/sprites/soldier1_silencer.png');
export const soldierHoldImg     = loadImg('/sprites/soldier1_hold.png');

// Which soldier sprite to draw for each weapon
export const soldierWeaponImg: Record<WeaponType, HTMLImageElement> = {
  pistol: soldierGunImg,
  smg: soldierSilencerImg,
  machinegun: soldierMachineImg,
  shotgun: soldierHoldImg,
};

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

// Bullet sprite
export const bulletSprite = loadImg('/sprites/bullet.png');

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

// ── Direction helpers (used by enemies) ──
export function dirCol(vx: number, _vy: number): number {
  if (vx < 0) return 1;
  if (vx > 0) return 2;
  return 2;
}

// ── Player draw helper ──
// Source sprite faces RIGHT. angle = atan2(vy, vx) points it along movement;
// idle/default = -PI/2 (faces up).
// Rendered size — edit SOLDIER_W to resize the player (no PNG re-encoding)
const SOLDIER_W = 16;
const SOLDIER_H = Math.round(SOLDIER_W * 43 / 52); // preserves 52×43 aspect

// Pixelation: each sprite is first downsampled to PIXEL_W px wide, then scaled
// up — lower PIXEL_W = chunkier pixels. Buffers are built once and cached.
const PIXEL_W = 10;
const pixelCache = new Map<HTMLImageElement, HTMLCanvasElement>();

function pixelated(img: HTMLImageElement): HTMLCanvasElement {
  let buf = pixelCache.get(img);
  if (!buf) {
    const pw = PIXEL_W;
    const ph = Math.max(1, Math.round(pw * 43 / 52));
    buf = document.createElement('canvas');
    buf.width = pw;
    buf.height = ph;
    const bctx = buf.getContext('2d')!;
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(img, 0, 0, pw, ph);
    pixelCache.set(img, buf);
  }
  return buf;
}

export function drawSoldier(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  angle: number = -Math.PI / 2
): void {
  const buf = pixelated(img);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false; // nearest-neighbor → pixelated
  ctx.drawImage(buf, -SOLDIER_W / 2, -SOLDIER_H / 2, SOLDIER_W, SOLDIER_H);
  ctx.restore();
}

export function waitForAssets(): Promise<void> {
  return Promise.all(loading).then(() => {});
}
