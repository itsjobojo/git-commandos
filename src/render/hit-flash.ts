import { AdditiveBlending, CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial } from 'three';
import { PALETTE } from './palette';

/**
 * The bloom that says a shot connected.
 *
 * Enemies previously acknowledged damage with a 22% scale pop over 0.16s, which
 * at this camera distance is invisible — the honest read of it was "enemies
 * don't take damage", even though they did. A hit needs to be legible from
 * across the map or the whole fight stops being one.
 *
 * It is drawn rather than tinted because the humanoid materials are cached per
 * archetype and shared by every instance (see `render/humanoid.ts`), so setting
 * emissive on a hit would light up every AI bro on the map at once. A pooled
 * additive sprite is both cheaper and correctly scoped to one body.
 */
const CAPACITY = 24;

export class HitFlashes {
  readonly group = new Group();
  private readonly sprites: Sprite[] = [];
  private readonly materials: SpriteMaterial[] = [];
  private readonly elapsed = new Float32Array(CAPACITY);
  private readonly duration = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  private readonly alive = new Uint8Array(CAPACITY);
  private cursor = 0;
  private total = 0;

  constructor() {
    this.group.name = 'hit-flashes';
    const map = flashTexture();
    for (let i = 0; i < CAPACITY; i++) {
      const material = new SpriteMaterial({
        map,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        // Deliberately drawn over geometry. A hit you cannot see because a
        // wall corner clipped it is the exact problem this solves.
        depthTest: false,
      });
      const sprite = new Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 940;
      this.materials.push(material);
      this.sprites.push(sprite);
      this.group.add(sprite);
    }
  }

  /**
   * @param size world-space diameter at full expansion
   * @param seconds how long it lives — short reads as a hit, long as a death
   */
  spawn(x: number, y: number, z: number, size: number, tint: number, seconds: number): void {
    // Round-robin. A full pool overwrites the oldest rather than dropping the
    // newest: during a burst the most recent hit is the one you're looking for.
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    this.total++;

    this.sprites[slot].position.set(x, y, z);
    this.materials[slot].color.setHex(tint);
    this.elapsed[slot] = 0;
    this.duration[slot] = seconds;
    this.size[slot] = size;
    this.alive[slot] = 1;
    this.sprites[slot].visible = true;
  }

  /** @param dt real seconds — a hit should keep blooming through hitstop. */
  update(dt: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.alive[i]) continue;
      this.elapsed[i] += dt;
      const t = this.elapsed[i] / this.duration[i];
      if (t >= 1) {
        this.alive[i] = 0;
        this.sprites[i].visible = false;
        continue;
      }
      // Snaps to full size almost immediately and fades on a curve, so it
      // reads as a flash rather than an expanding bubble.
      const grow = 0.55 + Math.sqrt(t) * 0.65;
      const scale = this.size[i] * grow;
      this.sprites[i].scale.set(scale, scale, 1);
      this.materials[i].opacity = (1 - t) * (1 - t);
    }
  }

  /** Flashes currently on screen, and a running total — both for the overlay. */
  get live(): number {
    let n = 0;
    for (let i = 0; i < CAPACITY; i++) n += this.alive[i];
    return n;
  }

  get spawned(): number {
    return this.total;
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}

let texture: CanvasTexture | null = null;

/** A soft radial blob, built once and shared by every sprite in the pool. */
function flashTexture(): CanvasTexture {
  if (texture) return texture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // A hot core with a wide soft falloff — the core is what registers at a
  // glance, the falloff is what stops it looking like a hard-edged decal.
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.72)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.16)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  return texture;
}

/** Tints, kept here so the three beats of a fight read as one language. */
export const FLASH = {
  /** A round connected but the body is still up. */
  hit: PALETTE.muzzle,
  /** The round itself landing — smaller, at the point of impact. */
  spark: PALETTE.tracer,
  /** It's dead. */
  kill: PALETTE.hostile,
} as const;
