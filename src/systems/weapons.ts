export type WeaponId = 'pistol' | 'smg' | 'shotgun';

export interface WeaponSpec {
  readonly id: WeaponId;
  readonly name: string;
  /** Seconds between shots. */
  readonly fireInterval: number;
  readonly speed: number;
  readonly damage: number;
  /** Radians of random deviation per pellet. */
  readonly spread: number;
  /** Projectiles per trigger pull. */
  readonly pellets: number;
  readonly recoil: number;
  /** null = never runs out. Only the starting pistol is infinite. */
  readonly ammo: number | null;
  readonly tint: number;
}

/**
 * Three weapons with genuinely different jobs, not three fire rates.
 *
 * The pistol is deliberately slow: it's the floor the other two are measured
 * against, and it makes finding anything else feel like a real upgrade. Both
 * upgrades are finite, so the question is always "is this fight worth the
 * ammo, or do I run it" — which is the same question the whole game asks.
 */
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: {
    id: 'pistol',
    name: 'Sidearm',
    fireInterval: 0.42,
    speed: 32,
    damage: 1,
    spread: 0.012,
    pellets: 1,
    recoil: 1.1,
    ammo: null,
    tint: 0xfde047,
  },
  smg: {
    id: 'smg',
    name: 'Machine Gun',
    // Fast enough to feel like a hose, loose enough that range costs you.
    fireInterval: 0.075,
    speed: 36,
    damage: 1,
    spread: 0.075,
    pellets: 1,
    recoil: 0.7,
    ammo: 160,
    tint: 0xfbbf24,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    // Slow, brutal up close, useless at distance. The panic button.
    fireInterval: 0.72,
    speed: 28,
    damage: 2,
    spread: 0.14,
    pellets: 7,
    recoil: 4.2,
    ammo: 28,
    tint: 0xfb923c,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'shotgun'];

/**
 * What the player is holding and how much is left in it.
 *
 * Running dry drops you back to the pistol rather than leaving you unarmed —
 * being unable to shoot at all during an extraction would be a dead end, not a
 * difficulty spike.
 */
export class Loadout {
  private current: WeaponId = 'pistol';
  private rounds = 0;

  get weapon(): WeaponSpec {
    return WEAPONS[this.current];
  }

  get id(): WeaponId {
    return this.current;
  }

  /** null when the held weapon has infinite ammo. */
  get ammo(): number | null {
    return this.weapon.ammo === null ? null : this.rounds;
  }

  get maxAmmo(): number | null {
    return this.weapon.ammo;
  }

  /** Picking up the weapon you already hold tops it back up. */
  equip(id: WeaponId): void {
    this.current = id;
    this.rounds = WEAPONS[id].ammo ?? 0;
  }

  /**
   * Loose ammo. Topping up what you're already holding is the common case;
   * finding shells for something you don't have hands you the weapon with that
   * partial load, so a drop is never a dead pickup.
   */
  addAmmo(id: WeaponId, rounds: number): void {
    const max = WEAPONS[id].ammo;
    if (max === null) return;
    if (this.current === id) {
      this.rounds = Math.min(max, this.rounds + rounds);
      return;
    }
    this.current = id;
    this.rounds = Math.min(max, rounds);
  }

  /** @returns true if the weapon ran dry on this shot. */
  spendRound(): boolean {
    if (this.weapon.ammo === null) return false;
    this.rounds = Math.max(0, this.rounds - 1);
    if (this.rounds > 0) return false;
    this.current = 'pistol';
    this.rounds = 0;
    return true;
  }
}
