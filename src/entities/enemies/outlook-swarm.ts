import { Enemy } from './enemy';
import { CANVAS_HEIGHT } from '../../constants';
import { outlookOrganizerSprite } from '../../core/assets';
import { OutlookInvite } from '../outlook-invite';
import { MEETING_NAMES } from '../../systems/announcements';

export class OutlookSwarm extends Enemy {
  private sineOffset = 0;
  private baseX: number;
  private baseY: number;
  private orbitSpeed: number;
  private orbitRadius: number;
  pendingInvites: OutlookInvite[] = [];

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.baseY = y;
    this.width = 16;
    this.height = 16;
    this.hp = 5;
    this.maxHp = 5;
    this.scoreValue = 300;
    this.tier = 'mid';
    this.vy = 15;
    this.sineOffset = Math.random() * Math.PI * 2;
    this.orbitSpeed = 1.5 + Math.random() * 1.5;
    this.orbitRadius = 25 + Math.random() * 20;
    this.fireTimer = 1 + Math.random();
  }

  ai(dt: number, playerX: number, playerY: number): void {
    this.sineOffset += dt * this.orbitSpeed;
    this.baseY += 10 * dt;

    this.x = this.baseX + Math.sin(this.sineOffset) * this.orbitRadius;
    this.y = this.baseY + Math.cos(this.sineOffset * 0.7) * (this.orbitRadius * 0.5);

    this.vx = Math.cos(this.sineOffset) * this.orbitRadius * this.orbitSpeed;

    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      // Burst of 3 invites with spread
      for (let i = 0; i < 3; i++) {
        this.spawnInvite(playerX + (i - 1) * 30, playerY);
      }
      this.fireTimer = 1.5 + Math.random() * 1.5;
    }

    if (this.baseY > CANVAS_HEIGHT + 40) {
      this.active = false;
    }
  }

  private spawnInvite(playerX: number, playerY: number): void {
    const name = MEETING_NAMES[Math.floor(Math.random() * MEETING_NAMES.length)];
    const invite = new OutlookInvite(
      this.x + this.width / 2 - 8,
      this.y + this.height,
      name,
    );
    const dx = playerX - invite.x;
    const dy = playerY - invite.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 45;
    invite.vx = (dx / dist) * speed;
    invite.vy = (dy / dist) * speed;
    this.pendingInvites.push(invite);
  }

  update(dt: number): void {
    void dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const rx = Math.round(this.x);
    const ry = Math.round(this.y);

    if (this.flashTimer > 0) {
      ctx.save();
      ctx.drawImage(outlookOrganizerSprite, rx, ry, this.width, this.height);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx, ry, this.width, this.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    } else {
      ctx.drawImage(outlookOrganizerSprite, rx, ry, this.width, this.height);
    }
  }
}
