/**
 * An irregular radial outline — a splat rather than a circle.
 *
 * Pure maths, no Three.js: the same profile drives both the mesh and the
 * containment test, so what you see is exactly what you're standing in. A
 * circle read as a UI element pasted onto the floor; a lopsided blob reads as
 * something that landed there.
 */
export class BlobProfile {
  /** Radius at each evenly-spaced angle, starting at +X and going toward +Z. */
  readonly radii: readonly number[];

  constructor(
    readonly baseRadius: number,
    radii: readonly number[],
  ) {
    this.radii = radii;
  }

  /**
   * @param wobble 0 = a circle, 1 = wildly lopsided.
   * @param lobes  how many bulges around the perimeter.
   */
  static generate(
    baseRadius: number,
    rng: { range: (a: number, b: number) => number },
    segments = 40,
    wobble = 0.3,
    lobes = 3,
  ): BlobProfile {
    // Two offset sine lobes plus jitter: smooth and closed (the profile must
    // wrap seamlessly), but never symmetrical.
    const phase = rng.range(0, Math.PI * 2);
    const phase2 = rng.range(0, Math.PI * 2);
    const lobeB = Math.max(2, Math.round(lobes * rng.range(1.4, 2.2)));

    const radii: number[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const shape =
        Math.sin(angle * lobes + phase) * 0.62 + Math.sin(angle * lobeB + phase2) * 0.38;
      const jitter = rng.range(-0.06, 0.06);
      radii.push(baseRadius * (1 + shape * wobble + jitter));
    }
    return new BlobProfile(baseRadius, radii);
  }

  get segments(): number {
    return this.radii.length;
  }

  /** Longest reach, for culling and label placement. */
  get maxRadius(): number {
    return Math.max(...this.radii);
  }

  /** Interpolated radius at an arbitrary angle. */
  radiusAt(angle: number): number {
    const n = this.radii.length;
    const twoPi = Math.PI * 2;
    let a = angle % twoPi;
    if (a < 0) a += twoPi;
    const t = (a / twoPi) * n;
    const i = Math.floor(t);
    const frac = t - i;
    const r0 = this.radii[i % n];
    const r1 = this.radii[(i + 1) % n];
    return r0 + (r1 - r0) * frac;
  }

  /** Is this offset from the blob's centre inside it? */
  contains(dx: number, dz: number): boolean {
    const distance = Math.hypot(dx, dz);
    if (distance > this.maxRadius) return false;
    return distance <= this.radiusAt(Math.atan2(dz, dx));
  }

  /** Points around the outline, for building geometry. */
  points(scale = 1): Array<{ x: number; z: number }> {
    return this.radii.map((r, i) => {
      const angle = (i / this.radii.length) * Math.PI * 2;
      return { x: Math.cos(angle) * r * scale, z: Math.sin(angle) * r * scale };
    });
  }
}
