import type { Outcome, RunResult, Rules, StagedFile } from '../net/protocol';

/**
 * THE FILE LEDGER.
 *
 * This module is the single authority on what happens to the user's real work.
 * Nothing else in the codebase may decide that a file is lost, saved or
 * stashed — everything goes through here, and `result()` is the only function
 * that produces the lists the CLI acts on.
 *
 * It is deliberately pure: no Three.js, no DOM, no world coordinates, no
 * randomness. Crate positions and meshes live in `carry.ts`. That separation
 * exists so this file can be tested exhaustively, because a bug here unstages
 * or deletes work that someone did not agree to lose.
 */

export type CrateState =
  /** Sitting on the map, not yet collected. */
  | 'world'
  /** On the player's back. */
  | 'carried'
  /** Knocked loose and decaying — recoverable until the timer runs out. */
  | 'dropped'
  /** Deposited at the stash cache. */
  | 'stashed'
  /** Decayed away. Terminal. */
  | 'lost';

export interface CrateRecord {
  readonly name: string;
  readonly added: number;
  readonly removed: number;
  state: CrateState;
  /** Seconds left before a dropped crate is lost. Only meaningful when dropped. */
  decay: number;
  /**
   * Seconds before a just-dropped crate can be collected again.
   *
   * Without this a hit costs nothing: the crate lands at your feet, inside
   * your own pickup radius, and is re-collected on the very next step. The
   * lockout is what makes losing cargo an actual setback.
   */
  lockout: number;
  /** Order the crate was picked up in — drops take the most recent first. */
  carrySeq: number;
}

export interface LedgerOptions {
  rules: Rules;
  /** How long a dropped crate survives before it is gone for good. */
  decaySeconds?: number;
  /** Crates the player starts holding. The rest spawn on the map. */
  startCarrying?: number;
}

const DEFAULT_DECAY_SECONDS = 12;
/** Extreme mode deletes files, so it gets half the grace period. */
const EXTREME_DECAY_MULTIPLIER = 0.5;
/** Grace period before a dropped crate can be scooped back up. */
export const PICKUP_LOCKOUT_SECONDS = 1;

export class CargoLedger {
  readonly crates: CrateRecord[];
  readonly decaySeconds: number;
  private readonly rules: Rules;
  private seq = 0;

  constructor(files: StagedFile[], options: LedgerOptions) {
    this.rules = options.rules;
    const base = options.decaySeconds ?? DEFAULT_DECAY_SECONDS;
    this.decaySeconds = this.rules.loss === 'delete' ? base * EXTREME_DECAY_MULTIPLIER : base;

    const startCarrying = options.startCarrying ?? 0;
    this.crates = files.map((f, i) => ({
      name: f.name,
      added: f.added,
      removed: f.removed,
      state: i < startCarrying ? ('carried' as CrateState) : ('world' as CrateState),
      decay: 0,
      lockout: 0,
      carrySeq: i < startCarrying ? this.seq++ : -1,
    }));
  }

  get carried(): CrateRecord[] {
    return this.crates.filter((c) => c.state === 'carried');
  }

  get carriedCount(): number {
    let n = 0;
    for (const c of this.crates) if (c.state === 'carried') n++;
    return n;
  }

  get dropped(): CrateRecord[] {
    return this.crates.filter((c) => c.state === 'dropped');
  }

  get stashed(): CrateRecord[] {
    return this.crates.filter((c) => c.state === 'stashed');
  }

  get lost(): CrateRecord[] {
    return this.crates.filter((c) => c.state === 'lost');
  }

  find(name: string): CrateRecord | undefined {
    return this.crates.find((c) => c.name === name);
  }

  /** Collect a crate off the map or off the ground. Terminal states can't be picked up. */
  pickUp(name: string): boolean {
    const crate = this.find(name);
    if (!crate) return false;
    if (crate.state !== 'world' && crate.state !== 'dropped' && crate.state !== 'stashed') {
      return false;
    }
    if (crate.lockout > 0) return false;
    crate.state = 'carried';
    crate.decay = 0;
    crate.lockout = 0;
    crate.carrySeq = this.seq++;
    return true;
  }

  /**
   * Knock the most recently picked-up crate loose — what a hit does.
   * Last-in-first-out so the crate you just risked your neck for is the one
   * you lose, which is the version that stings and the version that reads.
   *
   * @returns the dropped crate, or null if you were empty-handed.
   */
  dropNewest(): CrateRecord | null {
    let newest: CrateRecord | null = null;
    for (const c of this.crates) {
      if (c.state !== 'carried') continue;
      if (!newest || c.carrySeq > newest.carrySeq) newest = c;
    }
    if (!newest) return null;
    newest.state = 'dropped';
    newest.decay = this.decaySeconds;
    newest.lockout = PICKUP_LOCKOUT_SECONDS;
    return newest;
  }

  /** Deliberately set a crate down (the Q key). Same decay clock as a hit. */
  dropByName(name: string): CrateRecord | null {
    const crate = this.find(name);
    if (!crate || crate.state !== 'carried') return null;
    crate.state = 'dropped';
    crate.decay = this.decaySeconds;
    crate.lockout = PICKUP_LOCKOUT_SECONDS;
    return crate;
  }

  /** Deposit a carried crate at the stash cache. */
  stash(name: string): boolean {
    if (this.rules.stash === 'off') return false;
    const crate = this.find(name);
    if (!crate || crate.state !== 'carried') return false;
    crate.state = 'stashed';
    crate.decay = 0;
    return true;
  }

  /**
   * Advance decay timers.
   * @returns crates that ran out this step — they are now lost for good.
   */
  tick(dt: number): CrateRecord[] {
    const expired: CrateRecord[] = [];
    for (const crate of this.crates) {
      if (crate.state !== 'dropped') continue;
      if (crate.lockout > 0) crate.lockout = Math.max(0, crate.lockout - dt);
      crate.decay -= dt;
      if (crate.decay <= 0) {
        crate.decay = 0;
        crate.state = 'lost';
        expired.push(crate);
      }
    }
    return expired;
  }

  /**
   * The final word: which files the CLI commits, unstages/deletes, and leaves
   * staged.
   *
   * - A win commits what you were carrying when the hold completed.
   * - `stash: 'run'` treats the cache as a safe deposit — stashed crates ship
   *   with the commit even though you weren't holding them.
   * - `stash: 'persist'` treats it as an actual `git stash` — those files are
   *   deliberately held out of this commit and stay staged for next time,
   *   surviving even a failed run.
   * - Anything else — still on the map, lying on the ground, or decayed — is
   *   lost, and the loss rule decides whether that means unstaged or deleted.
   */
  result(outcome: Outcome): RunResult {
    const persist = this.rules.stash === 'persist';
    const surviving: string[] = [];
    const stashed: string[] = [];
    const lost: string[] = [];

    for (const crate of this.crates) {
      if (crate.state === 'stashed') {
        if (persist) {
          stashed.push(crate.name);
          continue;
        }
        // 'run': a safe deposit box — it ships if you make it out.
        if (outcome === 'win') surviving.push(crate.name);
        else lost.push(crate.name);
        continue;
      }

      if (outcome === 'win' && crate.state === 'carried') {
        surviving.push(crate.name);
      } else {
        lost.push(crate.name);
      }
    }

    return { surviving, lost, stashed };
  }
}
