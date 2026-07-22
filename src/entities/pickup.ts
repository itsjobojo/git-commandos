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

    // Ammo has no dedicated sheet cell — draw a distinct crate with an "A" glyph
    // so it doesn't collide visually with the stash sprite.
    if (this.type === 'ammo') {
      this.renderAmmo(ctx, rx, ry);
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
      default: col = 8; row = 1; break;
    }
    drawWeapon(ctx, col, row, rx, ry);
  }

  private renderAmmo(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
    // Centered 16x16 crate within the 24x24 pickup box.
    const bx = rx + 4;
    const by = ry + 4;
    ctx.fillStyle = '#6b5b2e'; // olive ammo crate
    ctx.fillRect(bx, by, 16, 16);
    ctx.fillStyle = '#3a3116'; // darker border
    ctx.fillRect(bx, by, 16, 2);
    ctx.fillRect(bx, by + 14, 16, 2);
    ctx.fillStyle = '#f5c542'; // gold "A"
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', bx + 8, by + 9);
  }
}
