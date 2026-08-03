import { Entity } from './entity';
import { Input } from '../core/input';
import { Projectile } from './projectile';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PLAYER_SPEED,
  PLAYER_SIZE,
} from '../constants';
import { soldierWeaponImg, soldierStandImg, drawSoldier } from '../core/assets';
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
  onMountain = false;

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

    this.walking = this.vx !== 0 || this.vy !== 0;
    if (this.walking) {
      this.walkTimer += dt * 8;
      // Rotate the sprite toward the movement direction (source art faces right).
      this.angle = Math.atan2(this.vy, this.vx);
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
  }
}
