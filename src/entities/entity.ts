import type { Object3D } from 'three';

let nextId = 1;

/**
 * Everything that exists on the ground plane. Deliberately shallow — behaviour
 * lives in systems, not in an inheritance chain. The only thing subclasses add
 * is state; the only thing they override is `tick`.
 *
 * `px`/`pz` hold the previous fixed-step position so rendering can interpolate
 * between steps and stay smooth above 60Hz.
 */
export abstract class Entity {
  readonly id = nextId++;

  x = 0;
  z = 0;
  px = 0;
  pz = 0;
  vx = 0;
  vz = 0;

  radius = 0.5;
  /** Facing, radians, 0 = +X. */
  yaw = 0;
  alive = true;

  object?: Object3D;

  setPosition(x: number, z: number): void {
    this.x = this.px = x;
    this.z = this.pz = z;
  }

  /** Call at the start of each fixed step, before integrating. */
  savePrevious(): void {
    this.px = this.x;
    this.pz = this.z;
  }

  /** Write the interpolated transform into the attached Object3D. */
  syncObject(alpha: number, y = 0): void {
    if (!this.object) return;
    this.object.position.set(
      this.px + (this.x - this.px) * alpha,
      y,
      this.pz + (this.z - this.pz) * alpha,
    );
  }

  distanceTo(other: Entity): number {
    return Math.hypot(other.x - this.x, other.z - this.z);
  }

  overlaps(other: Entity): boolean {
    const r = this.radius + other.radius;
    const dx = other.x - this.x;
    const dz = other.z - this.z;
    return dx * dx + dz * dz <= r * r;
  }

  abstract tick(dt: number): void;
}

/** Shortest signed angular difference, for smooth turning. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
