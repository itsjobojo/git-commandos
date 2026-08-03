import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';

/**
 * The meeting invite: a 3D build of the Outlook icon.
 *
 * Layered the way the real mark is, because that layering is what makes it
 * recognisable in silhouette from a camera 26 units up — the calendar panel
 * behind, the envelope across the bottom, and the rounded "O" tile standing
 * proud of both at the front left. Each is its own mesh at its own depth
 * rather than one flat billboard, so the thing has a readable profile when it
 * banks and leans.
 *
 * NOTE ON LICENCE. This is Microsoft's registered trademark, reproduced at the
 * project owner's explicit direction. It is the one thing in the repository
 * that is not CC0, so it is deliberately isolated in this single file and
 * recorded in ASSETS.md. If this package is ever published, that is the
 * decision to revisit first — `git log` this file for the unbranded envelope
 * that used to be here, which drops straight back in.
 */

/** Sampled from the official icon artwork. */
const NAVY = 0x0a2767;
const DEEP = 0x0364b8;
const MID = 0x0078d4;
const LIGHT = 0x28a8ea;
const BRIGHT = 0x50d9ff;
const TILE_TOP = 0x1784d9;
const TILE_BOTTOM = 0x0a63c9;

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

let cachedCalendar: CanvasTexture | null = null;
let cachedTile: CanvasTexture | null = null;

function finish(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

/**
 * The calendar panel: a 3×3 block of blues, brightest at the top right, under
 * a solid header band. Drawn once and shared — the boss's second phase can put
 * a lot of these on screen at once.
 */
function calendarTexture(): CanvasTexture {
  if (cachedCalendar) return cachedCalendar;

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = hex(DEEP);
  ctx.fillRect(0, 0, 192, 192);
  // Header band across the top.
  ctx.fillStyle = hex(NAVY);
  ctx.fillRect(0, 0, 192, 40);

  const cells = [
    [MID, LIGHT, BRIGHT],
    [DEEP, MID, LIGHT],
    [0x14447d, DEEP, MID],
  ];
  const size = 60;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      ctx.fillStyle = hex(cells[row][col]);
      ctx.fillRect(3 + col * (size + 3), 46 + row * (size - 14 + 3), size, size - 14);
    }
  }

  cachedCalendar = finish(canvas);
  return cachedCalendar;
}

/** The "O" tile: vertical gradient, white ring, generous rounded corners. */
function tileTexture(): CanvasTexture {
  if (cachedTile) return cachedTile;

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, 96, 192);
  gradient.addColorStop(0, hex(TILE_TOP));
  gradient.addColorStop(1, hex(TILE_BOTTOM));

  const r = 26;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(192, 0, 192, 192, r);
  ctx.arcTo(192, 192, 0, 192, r);
  ctx.arcTo(0, 192, 0, 0, r);
  ctx.arcTo(0, 0, 192, 0, r);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // The O is noticeably taller than it is wide, which is most of what makes it
  // read as the mark rather than as a generic ring.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.ellipse(96, 96, 40, 54, 0, 0, Math.PI * 2);
  ctx.stroke();

  cachedTile = finish(canvas);
  return cachedTile;
}

let cachedIcon: CanvasTexture | null = null;

/**
 * The whole icon as one flat sprite on a transparent field, for the invites the
 * swarm actually fires at you.
 *
 * The projectiles are the signature image of this fight — a fan of Outlook
 * icons sweeping across the street — and they are drawn from a pooled
 * `InstancedMesh`, so they get a texture rather than the layered geometry the
 * mini-boss is built from. One quad, one draw call, however many are in flight.
 */
export function outlookIconTexture(): CanvasTexture {
  if (cachedIcon) return cachedIcon;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // --- Calendar panel, back right -----------------------------------------
  ctx.fillStyle = hex(DEEP);
  ctx.fillRect(36, 4, 86, 18);
  const cells = [
    [MID, LIGHT, BRIGHT],
    [DEEP, MID, LIGHT],
    [0x14447d, DEEP, MID],
  ];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      ctx.fillStyle = hex(cells[row][col]);
      ctx.fillRect(36 + col * 28.7, 22 + row * 25.3, 28.7, 25.3);
    }
  }

  // --- Envelope, across the bottom ----------------------------------------
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, fill: number): void => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fillStyle = hex(fill);
    ctx.fill();
  };
  ctx.fillStyle = hex(0x1490df);
  ctx.fillRect(16, 60, 106, 58);
  tri(16, 60, 69, 104, 122, 60, NAVY); // the open inner fold
  tri(16, 60, 69, 104, 16, 118, LIGHT); // near flap, left
  tri(122, 60, 69, 104, 122, 118, MID); // near flap, right

  // --- The "O" tile, front left -------------------------------------------
  const gradient = ctx.createLinearGradient(2, 26, 62, 92);
  gradient.addColorStop(0, hex(TILE_TOP));
  gradient.addColorStop(1, hex(TILE_BOTTOM));
  const r = 10;
  ctx.beginPath();
  ctx.moveTo(2 + r, 26);
  ctx.arcTo(62, 26, 62, 92, r);
  ctx.arcTo(62, 92, 2, 92, r);
  ctx.arcTo(2, 92, 2, 26, r);
  ctx.arcTo(2, 26, 62, 26, r);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(32, 59, 13, 18, 0, 0, Math.PI * 2);
  ctx.stroke();

  cachedIcon = finish(canvas);
  return cachedIcon;
}

/** The envelope's V, from the two top corners down to a point. */
function createFlap(width: number, height: number): BufferGeometry {
  const hw = width / 2;
  const hh = height / 2;
  const geometry = new BufferGeometry();
  const positions = new Float32Array([-hw, hh, 0, hw, hh, 0, 0, -hh * 0.55, 0]);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A box that carries a texture on its +Z face only, and a flat colour elsewhere. */
function facedBox(
  width: number,
  height: number,
  depth: number,
  map: CanvasTexture,
  side: number,
  emissive: number,
): Mesh {
  const plain = () => new MeshStandardMaterial({ color: side, roughness: 0.55 });
  const mesh = new Mesh(new BoxGeometry(width, height, depth), [
    plain(),
    plain(),
    plain(),
    plain(),
    new MeshStandardMaterial({
      map,
      roughness: 0.5,
      emissiveMap: map,
      emissive: 0xffffff,
      emissiveIntensity: emissive,
    }),
    plain(),
  ]);
  mesh.castShadow = true;
  return mesh;
}

export interface InviteMesh {
  group: Group;
  /** The "O" tile, so callers can animate it independently. */
  card: Mesh;
  /** Drives the wounded pulse on the mini-boss. */
  glow: MeshStandardMaterial;
}

/**
 * @param scale 1 is roughly a 1.7-unit-wide invite.
 * @param emissive how hot it glows; projectiles want more than the boss does,
 * because a bullet has to stay visible against the ground it crosses.
 */
export function createInviteMesh(scale = 1, emissive = 0.3): InviteMesh {
  const group = new Group();

  const w = 1.7 * scale;
  const h = 1.55 * scale;
  const d = 0.16 * scale;

  // 1. Calendar panel, back layer, offset right the way the icon is composed.
  const panel = facedBox(w * 0.66, h * 0.8, d, calendarTexture(), DEEP, emissive * 0.8);
  panel.position.set(w * 0.16, h * 0.1, -d * 0.9);

  // 2. Envelope across the bottom, in front of the panel.
  const envelopeMaterial = new MeshStandardMaterial({
    color: LIGHT,
    emissive: LIGHT,
    emissiveIntensity: emissive,
    roughness: 0.45,
    flatShading: true,
  });
  const envelope = new Mesh(new BoxGeometry(w * 0.86, h * 0.44, d), envelopeMaterial);
  envelope.position.set(w * 0.06, -h * 0.3, 0);
  envelope.castShadow = true;

  // The dark inner fold. Just proud of the envelope face so it never z-fights.
  const flap = new Mesh(
    createFlap(w * 0.86, h * 0.44),
    new MeshStandardMaterial({
      color: NAVY,
      emissive: NAVY,
      emissiveIntensity: emissive * 0.35,
      roughness: 0.5,
      side: 2, // DoubleSide — a single-thickness fold, seen from either face.
      flatShading: true,
    }),
  );
  flap.position.set(w * 0.06, -h * 0.3, d * 0.52);

  // 3. The "O" tile, front left, standing clear of everything behind it.
  const tile = facedBox(w * 0.5, h * 0.53, d * 1.4, tileTexture(), TILE_BOTTOM, emissive);
  tile.position.set(-w * 0.26, -h * 0.02, d * 1.5);

  group.add(panel, envelope, flap, tile);
  return { group, card: tile, glow: envelopeMaterial };
}
