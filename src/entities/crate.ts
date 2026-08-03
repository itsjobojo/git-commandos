import type { Group } from 'three';
import { Entity } from './entity';
import { createCrateVisual, type CrateVisual } from '../render/crate';
import type { CrateRecord } from '../systems/cargo-ledger';

/**
 * A crate in the world. State lives in the ledger — this is only its body:
 * where it is, what it looks like, and how it bobs.
 */
export class Crate extends Entity {
  radius = 0.75;
  readonly visual: CrateVisual;
  /** Ground height offset, animated for the idle bob and the drop bounce. */
  private bob = 0;
  private bounce = 0;

  constructor(
    readonly record: CrateRecord,
    /** 0..1, relative diff size — drives crate scale. */
    weight: number,
  ) {
    super();
    this.visual = createCrateVisual(record.name, weight);
    this.object = this.visual.group;
  }

  get group(): Group {
    return this.visual.group;
  }

  /** Kick the crate into a small arc when it's knocked loose. */
  launch(): void {
    this.bounce = 1;
  }

  tick(dt: number): void {
    this.bob += dt;
    if (this.bounce > 0) this.bounce = Math.max(0, this.bounce - dt * 2.4);
  }

  /** @param decayT 0 = fresh or not decaying, 1 = about to expire. */
  syncCrate(alpha: number, decayT: number): void {
    const hop = Math.sin(this.bounce * Math.PI) * 0.9;
    const idle = Math.sin(this.bob * 2) * 0.06;
    super.syncObject(alpha, 0.42 + idle + hop);
    this.group.rotation.y = this.bob * 0.5;
    this.visual.setDecay(decayT);
  }
}
