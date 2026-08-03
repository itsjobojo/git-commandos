import { Time, updateTimeScale } from './time';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const MAX_STEPS = 5;

/**
 * Fixed-timestep loop with interpolated rendering.
 *
 * Simulation always advances in 1/60s steps so movement, collision and enemy
 * timing are frame-rate independent and reproducible. Rendering happens once
 * per animation frame with an `alpha` in [0,1) for interpolating between the
 * previous and current sim state.
 */
export class Loop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;

  /** Smoothed frames-per-second, for the debug overlay. */
  fps = 0;

  constructor(
    private readonly fixed: (dt: number) => void,
    private readonly render: (alpha: number, realDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    let realDt = (now - this.last) / 1000;
    this.last = now;
    // A backgrounded tab hands back a huge delta; clamp rather than fast-forward.
    if (realDt > MAX_FRAME) realDt = MAX_FRAME;
    this.fps += (1 / Math.max(realDt, 1e-4) - this.fps) * 0.1;

    updateTimeScale(realDt);
    this.acc += realDt * Time.scale;

    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      Time.elapsed += STEP;
      this.fixed(STEP);
      this.acc -= STEP;
      steps++;
    }
    // Bailed on the step cap — drop the backlog instead of spiralling.
    if (steps === MAX_STEPS) this.acc = 0;

    this.render(this.acc / STEP, realDt);
  };
}
