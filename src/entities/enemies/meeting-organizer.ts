import { Enemy } from './enemy';
import { CANVAS_HEIGHT } from '../../constants';
import { drawChar, enemiesTilemap, dirCol } from '../../core/assets';

export interface SlowZone {
  x: number;
  y: number;
  w: number;
  h: number;
  timer: number;
}

export class MeetingOrganizer extends Enemy {
  private zoneTimer = 3;
  zones: SlowZone[] = [];

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.hp = 2;
    this.maxHp = 2;
    this.scoreValue = 150;
    this.tier = 'grunt';
    this.vy = 15;
  }

  ai(dt: number, _playerX: number, _playerY: number): void {
    this.y += this.vy * dt;
    this.updateFlash(dt);

    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) {
      this.zoneTimer = 3;
      this.zones.push({
        x: this.x - 8,
        y: this.y + this.height,
        w: 40,
        h: 40,
        timer: 2.5,
      });
    }

    for (const z of this.zones) {
      z.timer -= dt;
    }
    this.zones = this.zones.filter((z) => z.timer > 0);

    if (this.y > CANVAS_HEIGHT + 20) {
      this.active = false;
    }
  }

  update(dt: number): void {
    void dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Render slow zones
    for (const z of this.zones) {
      ctx.save();
      ctx.globalAlpha = 0.3 * Math.min(1, z.timer);
      ctx.fillStyle = '#f5a623';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.globalAlpha = 0.7 * Math.min(1, z.timer);
      ctx.strokeStyle = '#f5a623';
      ctx.strokeRect(z.x, z.y, z.w, z.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f5a623';
      ctx.font = '5px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SYNC', z.x + z.w / 2, z.y + z.h / 2 + 2);
      ctx.restore();
    }

    const rx = Math.round(this.x);
    const ry = Math.round(this.y);
    const col = dirCol(this.vx, this.vy);

    if (this.flashTimer > 0) {
      ctx.save();
      drawChar(ctx, enemiesTilemap, col, 2, rx, ry); // row 2 = enemy type 3
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx, ry, this.width, this.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    } else {
      drawChar(ctx, enemiesTilemap, col, 2, rx, ry);
    }
  }
}
