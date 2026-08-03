/**
 * The extraction pad — the commit itself.
 *
 * Standing on it advances a hold timer ("writing commit object"). Stepping off
 * *pauses* the timer rather than resetting it: the tension should come from
 * enemies escalating while you're pinned, not from a punishing restart.
 */
export class Extraction {
  /** 0..1 */
  progress = 0;
  inside = false;
  complete = false;

  /** Fires once when the player first steps onto the pad. */
  onFirstEntry?: () => void;
  private everEntered = false;

  constructor(
    readonly x: number,
    readonly z: number,
    readonly radius: number,
    readonly holdSeconds: number,
  ) {}

  contains(px: number, pz: number): boolean {
    const dx = px - this.x;
    const dz = pz - this.z;
    return dx * dx + dz * dz <= this.radius * this.radius;
  }

  /** @returns true on the step the hold completes. */
  update(dt: number, px: number, pz: number): boolean {
    if (this.complete) return false;

    this.inside = this.contains(px, pz);
    if (this.inside && !this.everEntered) {
      this.everEntered = true;
      this.onFirstEntry?.();
    }

    if (this.inside) {
      this.progress = Math.min(1, this.progress + dt / this.holdSeconds);
      if (this.progress >= 1) {
        this.complete = true;
        return true;
      }
    }
    return false;
  }

  get secondsRemaining(): number {
    return Math.max(0, (1 - this.progress) * this.holdSeconds);
  }
}
