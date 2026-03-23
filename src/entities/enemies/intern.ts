import { Enemy } from './enemy';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../../constants';
import { enemySprites } from '../../core/assets';

export class Intern extends Enemy {
  private dirChangeTimer = 0;
  private sprite: HTMLImageElement;

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.width = 16;
    this.height = 16;
    this.hp = 1;
    this.maxHp = 1;
    this.scoreValue = 50;
    this.tier = 'grunt';
    this.sprite = enemySprites[Math.floor(Math.random() * enemySprites.length)];
    this.pickRandomDirection();
  }

  private pickRandomDirection(): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 30;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed + 20;
    this.dirChangeTimer = 0.5 + Math.random() * 1.0;
  }

  ai(dt: number): void {
    this.dirChangeTimer -= dt;
    if (this.dirChangeTimer <= 0) {
      this.pickRandomDirection();
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); }
    if (this.x + this.width > CANVAS_WIDTH) { this.x = CANVAS_WIDTH - this.width; this.vx = -Math.abs(this.vx); }

    if (this.y > CANVAS_HEIGHT + 20) {
      this.active = false;
    }
  }

  update(dt: number): void {
    void dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const rx = Math.round(this.x);
    const ry = Math.round(this.y);

    if (this.flashTimer > 0) {
      ctx.save();
      ctx.drawImage(this.sprite, rx, ry, this.width, this.height);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx, ry, this.width, this.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    } else {
      ctx.drawImage(this.sprite, rx, ry, this.width, this.height);
    }
  }
}
