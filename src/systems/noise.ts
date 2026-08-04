import type { Noise } from './awareness';

/**
 * Sounds the world made this step.
 *
 * Double-buffered on purpose: a noise emitted during step N is audible in step
 * N+1 and never in N. Otherwise "did this enemy hear that shout" depends on
 * where the shouter happens to sit in the enemy array — a stealth bug that
 * changes with spawn order and that nobody will ever reproduce on purpose. One
 * frame of latency is a cheap price for making the question order-independent
 * by construction.
 */
export class NoiseBus {
  private audible: Noise[] = [];
  private pending: Noise[] = [];

  /** What can be heard this step. */
  get current(): readonly Noise[] {
    return this.audible;
  }

  /** @param radius world units the sound carries. Walls do not stop it. */
  emit(x: number, z: number, radius: number): void {
    if (radius <= 0) return;
    this.pending.push({ x, z, radius });
  }

  /** Call once at the top of the step, before anything listens. */
  swap(): void {
    const previous = this.audible;
    this.audible = this.pending;
    previous.length = 0;
    this.pending = previous;
  }
}
