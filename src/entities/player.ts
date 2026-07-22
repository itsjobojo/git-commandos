import { Entity } from './entity';
import { Input } from '../core/input';
import { Projectile } from './projectile';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PLAYER_SPEED,
  PLAYER_SIZE,
} from '../constants';
import { soldierWeaponImg, soldierStandImg, drawSoldier, knifeSprite } from '../core/assets';
import { WeaponType, WEAPONS } from '../weapons';

export class Player extends Entity {
  hp = 5;
  maxHp = 5;
  fireCooldown = 0;
  invincibleTimer = 0;
  score = 0;
  streak = 0;
  gitRevertCharges = 3;
  ammo = 30;
  weapon: WeaponType = 'pistol';
  meleeCooldown = 0;
  meleeTimer = 0;
  onMountain = false;

  facing: number = 3; // 0=down, 1=left, 2=right, 3=up — kept for melee direction
  angle: number = -Math.PI / 2; // visual rotation; source faces RIGHT, -PI/2 = up
  private walkTimer = 0;
  private walking = false;

  constructor() {
    super();
    this.width = PLAYER_SIZE;
    this.height = PLAYER_SIZE;
    this.x = CANVAS_WIDTH / 2 - this.width / 2;
    this.y = CANVAS_HEIGHT - 40;
  }

  update(dt: number): void {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
    if (this.meleeTimer > 0) this.meleeTimer -= dt;

    this.walking = this.vx !== 0 || this.vy !== 0;
    if (this.walking) {
      this.walkTimer += dt * 8;
      // Only tilt left/right — vertical movement keeps sprite facing up
      this.angle = Math.atan2(this.vy, this.vx);
      // 4-dir facing for melee box
      const ax = Math.abs(this.vx), ay = Math.abs(this.vy);
      if (ay >= ax) this.facing = this.vy < 0 ? 3 : 0;
      else this.facing = this.vx < 0 ? 1 : 2;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < 0) this.x = 0;
    if (this.x + this.width > CANVAS_WIDTH) this.x = CANVAS_WIDTH - this.width;
    if (this.y < 0) this.y = 0;
    if (this.y + this.height > CANVAS_HEIGHT) this.y = CANVAS_HEIGHT - this.height;
  }

  handleInput(input: Input): void {
    this.vx = 0;
    this.vy = 0;
    if (input.left) this.vx = -PLAYER_SPEED;
    if (input.right) this.vx = PLAYER_SPEED;
    if (input.up) this.vy = -PLAYER_SPEED;
    if (input.down) this.vy = PLAYER_SPEED;

    if (this.vx !== 0 && this.vy !== 0) {
      this.vx *= 0.707;
      this.vy *= 0.707;
    }
  }

  /** Smaller centered box used only for *incoming* damage — lets edge pixels graze. */
  getHurtBounds(): { x: number; y: number; w: number; h: number } {
    const size = 14;
    const inset = (this.width - size) / 2;
    return { x: this.x + inset, y: this.y + inset, w: size, h: size };
  }

  canFire(): boolean {
    return this.fireCooldown <= 0;
  }

  hasAmmo(): boolean {
    // The pistol is the infinite fallback weapon — always has ammo.
    return this.weapon === 'pistol' || this.ammo > 0;
  }

  /** Fire current weapon — returns array of projectiles.
   *  baseAngle defaults to straight up (-PI/2). */
  fire(baseAngle: number = -Math.PI / 2): Projectile[] {
    const def = WEAPONS[this.weapon];
    this.fireCooldown = def.fireRate;

    // Pistol has infinite ammo; other weapons consume it and revert to pistol when empty.
    if (this.weapon !== 'pistol') {
      this.ammo--;
      if (this.ammo <= 0) {
        this.weapon = 'pistol';
        this.ammo = 0;
      }
    }

    const bullets: Projectile[] = [];
    // Spawn from the muzzle: player center pushed out along the firing direction
    const muzzle = this.width / 2 + 4;
    const cx = this.x + this.width / 2 + Math.cos(baseAngle) * muzzle;
    const cy = this.y + this.height / 2 + Math.sin(baseAngle) * muzzle;

    for (let i = 0; i < def.spread; i++) {
      const bullet = new Projectile();
      bullet.owner = 'player';
      bullet.damage = def.damage;

      // Calculate spread angle
      let angle = baseAngle;
      if (def.spread > 1) {
        // Evenly distribute across the cone
        const t = (i / (def.spread - 1)) - 0.5; // -0.5 to 0.5
        angle += t * def.spreadAngle;
      } else if (def.spreadAngle > 0) {
        // Single bullet with random jitter (SMG)
        angle += (Math.random() - 0.5) * def.spreadAngle;
      }

      bullet.vx = Math.cos(angle) * def.bulletSpeed;
      bullet.vy = Math.sin(angle) * def.bulletSpeed;
      bullet.x = cx - bullet.width / 2;
      bullet.y = cy;
      bullets.push(bullet);
    }

    return bullets;
  }

  canMelee(): boolean {
    return this.meleeCooldown <= 0;
  }

  melee(): void {
    this.meleeCooldown = 0.4;
    this.meleeTimer = 0.2;
  }

  getMeleeBox(): { x: number; y: number; w: number; h: number } | null {
    if (this.meleeTimer <= 0) return null;
    const reach = 18;
    switch (this.facing) {
      case 3: return { x: this.x - 2, y: this.y - reach, w: this.width + 4, h: reach };
      case 0: return { x: this.x - 2, y: this.y + this.height, w: this.width + 4, h: reach };
      case 1: return { x: this.x - reach, y: this.y - 2, w: reach, h: this.height + 4 };
      case 2: return { x: this.x + this.width, y: this.y - 2, w: reach, h: this.height + 4 };
    }
    return null;
  }

  /** Apply damage. Returns true if the hit landed, false if ignored (i-frames). */
  takeDamage(amount: number): boolean {
    if (this.invincibleTimer > 0) return false;
    this.hp -= amount;
    this.invincibleTimer = 1.0;
    this.streak = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.active = false;
    }
    return true;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.invincibleTimer > 0 && Math.floor(this.invincibleTimer * 10) % 2 === 0) {
      return;
    }

    const cx = Math.round(this.x + this.width / 2);
    const cy = Math.round(this.y + this.height / 2);
    const weaponImg = soldierWeaponImg[this.weapon];
    const img = this.walking && Math.floor(this.walkTimer) % 2 === 1 ? soldierStandImg : weaponImg;
    drawSoldier(ctx, img, cx, cy, this.angle);

    if (this.meleeTimer > 0) {
      this.renderMelee(ctx);
    }
  }

  private renderMelee(ctx: CanvasRenderingContext2D): void {
    const box = this.getMeleeBox();
    if (!box) return;

    ctx.save();
    ctx.globalAlpha = Math.min(1, this.meleeTimer * 8);

    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const size = 16;

    const angles = [Math.PI, Math.PI * 0.5, -Math.PI * 0.5, 0];
    ctx.translate(cx, cy);
    ctx.rotate(angles[this.facing]);
    ctx.drawImage(knifeSprite, -size / 2, -size / 2, size, size);

    ctx.restore();
  }
}
