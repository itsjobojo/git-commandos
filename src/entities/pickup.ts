import { Entity } from './entity';
import { CANVAS_HEIGHT } from '../constants';
import { drawWeapon, weaponSprites } from '../core/assets';
import { WeaponType } from '../weapons';

export type PickupType = 'health' | 'revert' | 'stash' | 'cherry-pick' | 'ammo' | 'weapon';

export class Pickup extends Entity {
  type: PickupType;
  weaponType?: WeaponType;
  private bobTimer = 0;
  private baseY: number;

  constructor(x: number, y: number, type: PickupType, weaponType?: WeaponType) {
    super();
    this.x = x;
    this.y = y;
    this.baseY = y;
    this.type = type;
    this.weaponType = weaponType;
    this.width = 24;
    this.height = 24;
    this.vy = 15;
  }

  update(dt: number): void {
    this.bobTimer += dt * 4;
    this.baseY += this.vy * dt;
    this.y = this.baseY + Math.sin(this.bobTimer) * 3;

    if (this.y > CANVAS_HEIGHT + 30) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const rx = Math.round(this.x);
    const ry = Math.round(this.y);

    if (this.type === 'weapon' && this.weaponType) {
      // Draw weapon sprite
      const sprite = weaponSprites[this.weaponType];
      if (sprite) {
        ctx.drawImage(sprite, rx, ry, 24, 24);
      }
      return;
    }

    // Original pickup sprites
    let col: number;
    let row: number;
    switch (this.type) {
      case 'health': col = 8; row = 0; break;
      case 'revert': col = 9; row = 0; break;
      case 'stash': col = 8; row = 1; break;
      case 'cherry-pick': col = 9; row = 1; break;
      case 'ammo': col = 8; row = 1; break;
      default: col = 8; row = 1; break;
    }
    drawWeapon(ctx, col, row, rx, ry);
  }
}
