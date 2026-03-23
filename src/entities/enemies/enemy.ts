import { Entity } from '../entity';

export type EnemyTier = 'grunt' | 'mid' | 'heavy' | 'boss';

export abstract class Enemy extends Entity {
  hp = 1;
  maxHp = 1;
  scoreValue = 100;
  tier: EnemyTier = 'grunt';
  fireTimer = 0;
  stateTimer = 0;
  flashTimer = 0;

  takeDamage(amount: number): void {
    this.hp -= amount;
    this.flashTimer = 0.1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.active = false;
    }
  }

  updateFlash(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer -= dt;
  }

  abstract ai(dt: number, playerX: number, playerY: number): void;
}
