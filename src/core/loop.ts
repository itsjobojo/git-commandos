import { TICK_RATE } from '../constants';

export type UpdateFn = (dt: number) => void;
export type RenderFn = (alpha: number) => void;

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;

  constructor(
    private update: UpdateFn,
    private render: RenderFn
  ) {}

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick(time: number): void {
    if (!this.running) return;

    const delta = Math.min((time - this.lastTime) / 1000, 0.1); // cap at 100ms
    this.lastTime = time;
    this.accumulator += delta;

    while (this.accumulator >= TICK_RATE) {
      this.update(TICK_RATE);
      this.accumulator -= TICK_RATE;
    }

    this.render(this.accumulator / TICK_RATE);
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }
}
