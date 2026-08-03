import { Group, Mesh, MeshBasicMaterial, RingGeometry, Scene } from 'three';
import { Crate } from '../entities/crate';
import { PALETTE } from '../render/palette';
import type { Player } from '../entities/player';
import type { Intent } from '../core/input';
import type { CargoLedger, CrateRecord } from './cargo-ledger';
import type { Spot } from '../world/arena';
import type { Grid } from '../world/grid';
import type { StashRule } from '../net/protocol';

const PICKUP_RADIUS = 1.5;
const STASH_RADIUS = 2.6;
/** Vertical gap between crates on the player's back. */
const STACK_SPACING = 0.42;

export interface CarryEvents {
  onPickup?: (record: CrateRecord) => void;
  onDrop?: (record: CrateRecord) => void;
  onDecayed?: (record: CrateRecord) => void;
  onStash?: (record: CrateRecord) => void;
}

/**
 * The spatial half of cargo: where crates are, picking them up, setting them
 * down, and the stash cache.
 *
 * Every decision about what a file's *state* is delegates to `CargoLedger` —
 * this system moves bodies around, it does not decide what survives. Keeping
 * that line sharp is what makes the ledger testable in isolation.
 */
export class CarrySystem {
  readonly crates: Crate[] = [];
  readonly stashPos: Spot | null;
  private readonly stashMarker: Group | null = null;
  /** Crates that start on the player's back — attached on the first update,
   *  since the constructor has no player to attach them to. */
  private readonly pendingAttach: Crate[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly ledger: CargoLedger,
    private readonly grid: Grid,
    spots: Spot[],
    stashRule: StashRule,
    stashSpot: Spot | null,
    private readonly events: CarryEvents = {},
  ) {
    const maxAdded = Math.max(1, ...ledger.crates.map((c) => c.added));

    ledger.crates.forEach((record, i) => {
      const crate = new Crate(record, record.added / maxAdded);
      const spot = spots[i] ?? spots[spots.length - 1] ?? { x: 0, z: 0 };
      crate.setPosition(spot.x, spot.z);
      this.crates.push(crate);
      if (record.state === 'carried') this.pendingAttach.push(crate);
      else scene.add(crate.group);
    });

    this.stashPos = stashRule === 'off' ? null : stashSpot;
    if (this.stashPos) {
      this.stashMarker = createStashMarker();
      this.stashMarker.position.set(this.stashPos.x, 0.06, this.stashPos.z);
      scene.add(this.stashMarker);
    }
  }

  /** @returns crates that decayed away this step. */
  update(dt: number, player: Player, intent: Intent): CrateRecord[] {
    for (const crate of this.pendingAttach) this.attach(crate, player);
    this.pendingAttach.length = 0;

    for (const crate of this.crates) crate.tick(dt);

    // Auto-pickup on contact. Recovering a crate that's bleeding out should
    // never come down to whether you also remembered to press a key.
    for (const crate of this.crates) {
      const state = crate.record.state;
      if (state !== 'world' && state !== 'dropped') continue;
      if (Math.hypot(player.x - crate.x, player.z - crate.z) > PICKUP_RADIUS) continue;
      if (this.ledger.pickUp(crate.record.name)) {
        this.attach(crate, player);
        this.events.onPickup?.(crate.record);
      }
    }

    if (intent.drop) this.dropNewest(player);
    if (intent.interact) this.useStash(player);

    const expired = this.ledger.tick(dt);
    for (const record of expired) {
      const crate = this.crateFor(record);
      if (crate) crate.group.visible = false;
      this.events.onDecayed?.(record);
    }

    player.carrying = this.ledger.carriedCount;
    this.restack(player);
    return expired;
  }

  /** A hit knocks the newest crate loose. @returns it, or null if empty-handed. */
  knockLoose(player: Player): CrateRecord | null {
    const record = this.ledger.dropNewest();
    if (!record) return null;
    this.detach(record, player);
    this.events.onDrop?.(record);
    return record;
  }

  private dropNewest(player: Player): void {
    const carried = this.ledger.carried;
    if (carried.length === 0) return;
    const newest = carried.reduce((a, b) => (a.carrySeq > b.carrySeq ? a : b));
    if (this.ledger.dropByName(newest.name)) {
      this.detach(newest, player);
      this.events.onDrop?.(newest);
    }
  }

  /**
   * E at the cache: deposit everything you're carrying, or — if you're
   * empty-handed — take it all back. Stashing has to be reversible, otherwise
   * it's a trap you can walk into and not out of.
   */
  private useStash(player: Player): void {
    if (!this.stashPos) return;
    if (Math.hypot(player.x - this.stashPos.x, player.z - this.stashPos.z) > STASH_RADIUS) return;

    if (this.ledger.carriedCount === 0) {
      for (const record of [...this.ledger.stashed]) {
        if (!this.ledger.pickUp(record.name)) continue;
        const crate = this.crateFor(record);
        if (crate) {
          crate.visual.setTint(PALETTE.crate);
          this.attach(crate, player);
        }
        this.events.onPickup?.(record);
      }
      return;
    }

    for (const record of [...this.ledger.carried]) {
      if (!this.ledger.stash(record.name)) continue;
      const crate = this.crateFor(record);
      if (crate) {
        crate.group.removeFromParent();
        // Fan the deposited crates out around the cache so the pile reads.
        const n = this.ledger.stashed.length;
        const angle = n * 1.9;
        crate.setPosition(
          this.stashPos.x + Math.cos(angle) * 0.9,
          this.stashPos.z + Math.sin(angle) * 0.9,
        );
        crate.visual.setTint(PALETTE.stash);
        this.scene.add(crate.group);
      }
      this.events.onStash?.(record);
    }
  }

  /** Move a crate's body onto the player's back. */
  private attach(crate: Crate, player: Player): void {
    crate.group.removeFromParent();
    player.cargoAnchor.add(crate.group);
  }

  /** Move a crate's body back to the ground, at the player's feet. */
  private detach(record: CrateRecord, player: Player): void {
    const crate = this.crateFor(record);
    if (!crate) return;
    crate.group.removeFromParent();
    // Fling it opposite the way you're facing — it lands behind you, which is
    // exactly where you don't want to go back to. Far enough to clear your own
    // pickup radius, so recovering it is a decision rather than a formality.
    const throwDistance = PICKUP_RADIUS + 1.1;
    let x = player.x - Math.cos(player.yaw) * throwDistance;
    let z = player.z - Math.sin(player.yaw) * throwDistance;
    // Never fling it inside a wall, where it would be unrecoverable.
    if (this.grid.isSolidWorld(x, z)) {
      x = player.x;
      z = player.z;
    }
    crate.setPosition(x, z);
    crate.launch();
    this.scene.add(crate.group);
  }

  private restack(player: Player): void {
    const carried = this.ledger.carried.slice().sort((a, b) => a.carrySeq - b.carrySeq);
    carried.forEach((record, i) => {
      const crate = this.crateFor(record);
      if (crate) crate.group.position.set(0, i * STACK_SPACING, 0);
    });
    // The anchor tilts back as the stack grows — visible weight.
    player.cargoAnchor.rotation.z = Math.min(carried.length, 6) * 0.05;
  }

  syncVisuals(alpha: number): void {
    for (const crate of this.crates) {
      const record = crate.record;
      if (record.state === 'carried') {
        crate.visual.setStowed(true);
        crate.visual.setDecay(0);
        continue;
      }
      if (record.state === 'lost') continue;
      crate.visual.setStowed(false);
      const decayT =
        record.state === 'dropped' && this.ledger.decaySeconds > 0
          ? 1 - record.decay / this.ledger.decaySeconds
          : 0;
      crate.syncCrate(alpha, decayT);
    }

    if (this.stashMarker) {
      this.stashMarker.rotation.z += 0.004;
    }
  }

  private crateFor(record: CrateRecord): Crate | undefined {
    return this.crates.find((c) => c.record === record);
  }
}

function createStashMarker(): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(STASH_RADIUS - 0.18, STASH_RADIUS, 40),
    new MeshBasicMaterial({ color: PALETTE.stash, transparent: true, opacity: 0.55 }),
  );
  ring.rotation.x = -Math.PI / 2;
  const inner = new Mesh(
    new RingGeometry(0.5, 0.66, 24),
    new MeshBasicMaterial({ color: PALETTE.stash, transparent: true, opacity: 0.8 }),
  );
  inner.rotation.x = -Math.PI / 2;
  group.add(ring, inner);
  return group;
}
