export type WeaponId = 'pistol' | 'smg' | 'shotgun';

/**
 * How far in front of the player a round actually leaves the gun.
 *
 * Shared by the firing code and the aim indicator. Duplicating it would let the
 * drawn line and the fired pellet start from different places — a small desync
 * that reads as the indicator simply being wrong.
 */
export const MUZZLE_OFFSET = 0.8;

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
  /** World units a round travels before it dies. */
  readonly range: number;
  /**
   * How far the aim indicator is drawn.
   *
   * Deliberately much shorter than `range`: drawn at full lethal reach the line
   * crosses most of the screen, which stops reading as "where am I pointing"
   * and starts reading as scenery. This is a sight, not a range bar — it
   * answers where the shot is going and how wide it fans, and the weapon still
   * kills well past the end of it.
   */
  readonly sightLength: number;
  /**
   * World units at which the report is still audible. Sound ignores walls, so
   * this is the real cost of pulling the trigger: it is how much of the map you
   * just told where you are.
   */
  readonly noise: number;
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
    speed: 42,
    damage: 1,
    spread: 0.012,
    pellets: 1,
    recoil: 1.1,
    range: 34,
    // Longest sight of the three — the sidearm is the precision option, and
    // the one weapon whose line is worth following to something distant.
    sightLength: 12.5,
    // Quiet enough to clear one thing without waking the block — the sidearm's
    // compensation for being otherwise terrible.
    noise: 14,
    ammo: null,
    tint: 0xfde047,
  },
  smg: {
    id: 'smg',
    name: 'Machine Gun',
    // Fast enough to feel like a hose, loose enough that range costs you.
    fireInterval: 0.075,
    speed: 48,
    damage: 1,
    spread: 0.075,
    pellets: 1,
    recoil: 0.7,
    // Shorter reach than the sidearm: the hose is a room-clearing tool, and
    // paying for it in range is what stops it being strictly better.
    range: 30,
    sightLength: 10,
    // Matches the director's spawn ring: everything currently alive hears this.
    noise: 22,
    ammo: 160,
    tint: 0xfbbf24,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    // Slow, brutal up close, useless at distance. The panic button.
    fireInterval: 0.72,
    speed: 38,
    damage: 2,
    spread: 0.14,
    pellets: 7,
    recoil: 4.2,
    // Still the shortest reach by a distance, but no longer so short that the
    // gun is dead weight anywhere but a corridor — "useless at distance" is
    // meant to be a trade, not a reason never to pick it up.
    range: 17,
    // Stubby, and by far the widest — at 0.14 rad across seven pellets this is
    // a fat triangle at your feet, which is what a shotgun should look like.
    sightLength: 7,
    // Loudest by far, and it costs the least: you fire this when you have
    // already been found.
    noise: 26,
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
