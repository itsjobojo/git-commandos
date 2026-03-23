import { CANVAS_WIDTH, CANVAS_HEIGHT, SCALE } from '../constants';

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.canvas.style.width = `${CANVAS_WIDTH * SCALE}px`;
    this.canvas.style.height = `${CANVAS_HEIGHT * SCALE}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(): void {
    this.ctx.fillStyle = '#0f0f23';
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
}
