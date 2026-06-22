import { CANVAS_WIDTH, CANVAS_HEIGHT, SCALE } from '../constants';

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = CANVAS_WIDTH * SCALE;
    this.canvas.height = CANVAS_HEIGHT * SCALE;
    this.canvas.style.width = '100vmin';
    this.canvas.style.height = '100vmin';

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(): void {
    // Reset transform and apply game scale every frame.
    // Canvas buffer is SCALE× larger so text renders at native resolution;
    // imageSmoothingEnabled stays false so sprites remain pixel-perfect.
    this.ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    this.ctx.fillStyle = '#0f0f23';
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
}
