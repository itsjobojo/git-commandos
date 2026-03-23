import { Entity } from './entity';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';
import { outlookIconImg } from '../core/assets';

export class OutlookInvite extends Entity {
  meetingName: string;
  private bobOffset = Math.random() * Math.PI * 2;

  constructor(x: number, y: number, meetingName: string) {
    super();
    this.x = x;
    this.y = y;
    this.width = 16;
    this.height = 16;
    this.meetingName = meetingName;
  }

  update(dt: number): void {
    this.bobOffset += dt * 3;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (
      this.y > CANVAS_HEIGHT + 30 ||
      this.y < -30 ||
      this.x < -30 ||
      this.x > CANVAS_WIDTH + 30
    ) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const rx = Math.round(this.x);
    const ry = Math.round(this.y + Math.sin(this.bobOffset) * 2);
    ctx.drawImage(outlookIconImg, rx, ry, this.width, this.height);
  }
}
