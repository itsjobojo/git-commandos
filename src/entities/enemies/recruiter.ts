import { Enemy } from './enemy';
import { CANVAS_HEIGHT } from '../../constants';
import { Projectile } from '../projectile';
import { enemySprites } from '../../core/assets';

export class Recruiter extends Enemy {
  private sineOffset = 0;
  private baseX = 0;
  private sprite: HTMLImageElement;

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.width = 16;
    this.height = 16;
    this.hp = 2;
    this.maxHp = 2;
    this.scoreValue = 100;
    this.tier = 'grunt';
    this.vy = 30;
    this.sineOffset = Math.random() * Math.PI * 2;
    this.fireTimer = 1 + Math.random() * 2;
    this.sprite = enemySprites[Math.floor(Math.random() * enemySprites.length)];
  }

  ai(dt: number, _playerX: number, _playerY: number): void {
    this.sineOffset += dt * 3;
    this.x = this.baseX + Math.sin(this.sineOffset) * 30;
    this.y += this.vy * dt;
    this.vx = Math.cos(this.sineOffset) * 30;

    this.fireTimer -= dt;

    if (this.y > CANVAS_HEIGHT + 20) {
      this.active = false;
    }
  }

  canFire(): boolean {
    return this.fireTimer <= 0;
  }

  fire(playerX: number, playerY: number): Projectile {
    this.fireTimer = 2 + Math.random();
    const bullet = new Projectile();
    bullet.x = this.x + this.width / 2 - bullet.width / 2;
    bullet.y = this.y + this.height;
    bullet.owner = 'enemy';
    bullet.spriteRow = 2;
    bullet.hitboxPadding = 9;

    const dx = playerX - bullet.x;
    const dy = playerY - bullet.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = 80;
    bullet.vx = (dx / dist) * speed;
    bullet.vy = (dy / dist) * speed;
    return bullet;
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
