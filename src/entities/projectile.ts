import { Entity } from './entity';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

export class Projectile extends Entity {
  damage = 1;
  owner: 'player' | 'enemy' = 'player';
  homing = false;
  hitboxPadding = 2;

  spriteCol = 3;
  spriteRow = 2;

  constructor() {
    super();
    this.width = 4;
    this.height = 4;
  }

  getBounds() {
    return {
      x: this.x,
      y: this.y,
      w: this.width,
      h: this.height,
    };
  }

  update(dt: number): void {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (
      this.y < -30 ||
      this.y > CANVAS_HEIGHT + 30 ||
      this.x < -30 ||
      this.x > CANVAS_WIDTH + 30
    ) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const rx = Math.round(this.x);
    const ry = Math.round(this.y);

    if (this.owner === 'player') {
      // Bright yellow-white dot
      ctx.fillStyle = '#f5e6a3';
      ctx.fillRect(rx, ry, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx + 1, ry + 1, 1, 1);
    } else {
      // Red-pink dot
      ctx.fillStyle = '#e94560';
      ctx.fillRect(rx, ry, 3, 3);
      ctx.fillStyle = '#ff8899';
      ctx.fillRect(rx + 1, ry + 1, 1, 1);
    }
  }
}
