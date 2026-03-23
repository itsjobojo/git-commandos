import { Entity } from './entity';

export class Particle extends Entity {
  timer = 0.4;

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.width = 16;
    this.height = 16;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const progress = 1 - this.timer / 0.4; // 0 → 1
    const blink = Math.floor(progress * 12) % 2 === 0;
    if (!blink) return;

    const alpha = Math.max(0, this.timer / 0.4);
    const radius = 4 + progress * 8;
    const cx = Math.round(this.x + this.width / 2);
    const cy = Math.round(this.y + this.height / 2);

    ctx.save();
    ctx.globalAlpha = alpha * 0.8;

    // White flash core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Orange-red expanding ring
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
