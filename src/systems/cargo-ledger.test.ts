import { describe, expect, it } from 'vitest';
import { CargoLedger, PICKUP_LOCKOUT_SECONDS } from './cargo-ledger';
import { DEFAULT_RULES, type Rules, type StagedFile } from '../net/protocol';

/**
 * These are the most important tests in the repo. The ledger decides which of
 * the user's files get committed, unstaged or deleted — every case below maps
 * to a real thing that can happen to someone's work.
 */

const FILES: StagedFile[] = [
  { name: 'src/a.ts', added: 10, removed: 1 },
  { name: 'src/b.ts', added: 20, removed: 2 },
  { name: 'src/c.ts', added: 30, removed: 3 },
];

const rules = (over: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, ...over });

const ledger = (over: Partial<Rules> = {}, startCarrying = 0): CargoLedger =>
  new CargoLedger(FILES, { rules: rules(over), startCarrying });

describe('allLost — the run is over', () => {
  /** Drop everything carried and let it all decay away. */
  const wipe = (l: CargoLedger): void => {
    while (l.dropNewest()) {
      /* keep knocking crates loose */
    }
    l.tick(9999);
  };

  it('is false at the start', () => {
    expect(ledger().allLost).toBe(false);
    expect(ledger({}, FILES.length).allLost).toBe(false);
  });

  it('is false while a crate is still on the map', () => {
    const l = ledger();
    expect(l.allLost).toBe(false);
  });

  it('is false while a dropped crate is still recoverable', () => {
    const l = ledger({}, FILES.length);
    l.dropNewest();
    expect(l.find('src/c.ts')!.state).toBe('dropped');
    expect(l.allLost).toBe(false);
  });

  it('is true once every crate has decayed', () => {
    const l = ledger({}, FILES.length);
    wipe(l);
    expect(l.crates.every((c) => c.state === 'lost')).toBe(true);
    expect(l.allLost).toBe(true);
  });

  it('is false if even one crate is stashed', () => {
    const l = ledger({}, FILES.length);
    l.stash('src/a.ts');
    wipe(l);
    expect(l.find('src/a.ts')!.state).toBe('stashed');
    expect(l.allLost).toBe(false);
  });

  it('is false for a mission with no files at all', () => {
    // Nothing was ever at stake, so an empty diff must not insta-fail.
    expect(new CargoLedger([], { rules: rules(), startCarrying: 0 }).allLost).toBe(false);
  });
});

describe('collecting and carrying', () => {
  it('starts every crate on the map unless told otherwise', () => {
    const l = ledger();
    expect(l.crates.map((c) => c.state)).toEqual(['world', 'world', 'world']);
    expect(l.carriedCount).toBe(0);
  });

  it('picks crates up off the map', () => {
    const l = ledger();
    expect(l.pickUp('src/b.ts')).toBe(true);
    expect(l.carriedCount).toBe(1);
    expect(l.find('src/b.ts')!.state).toBe('carried');
  });

  it('refuses to pick up an unknown or already-lost crate', () => {
    const l = ledger();
    expect(l.pickUp('nope.ts')).toBe(false);
    l.pickUp('src/a.ts');
    l.dropNewest();
    l.tick(999);
    expect(l.find('src/a.ts')!.state).toBe('lost');
    expect(l.pickUp('src/a.ts')).toBe(false);
  });
});

describe('taking a hit', () => {
  it('drops the most recently collected crate', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.pickUp('src/c.ts');
    expect(l.dropNewest()!.name).toBe('src/c.ts');
    expect(l.find('src/a.ts')!.state).toBe('carried');
  });

  it('does nothing when empty-handed', () => {
    expect(ledger().dropNewest()).toBeNull();
  });

  it('starts the decay clock on the dropped crate', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    const dropped = l.dropNewest()!;
    expect(dropped.decay).toBe(l.decaySeconds);
  });
});

describe('pickup lockout', () => {
  it('refuses to re-collect a crate the instant it is knocked loose', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.dropNewest();
    // The crate lands at your feet, inside your own pickup radius. Without the
    // lockout this succeeds and a hit costs nothing.
    expect(l.pickUp('src/a.ts')).toBe(false);
    expect(l.find('src/a.ts')!.state).toBe('dropped');
  });

  it('allows recovery once the lockout elapses', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.dropNewest();
    l.tick(PICKUP_LOCKOUT_SECONDS + 0.01);
    expect(l.pickUp('src/a.ts')).toBe(true);
  });

  it('applies to deliberate drops too, so Q cannot be spammed', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.dropByName('src/a.ts');
    expect(l.pickUp('src/a.ts')).toBe(false);
  });

  it('does not block picking up crates that were never dropped', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.dropNewest();
    expect(l.pickUp('src/b.ts')).toBe(true);
  });
});

describe('decay', () => {
  it('loses a dropped crate only once the timer expires', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.dropNewest();

    expect(l.tick(l.decaySeconds - 0.1)).toEqual([]);
    expect(l.find('src/a.ts')!.state).toBe('dropped');

    const expired = l.tick(0.2);
    expect(expired.map((c) => c.name)).toEqual(['src/a.ts']);
    expect(l.find('src/a.ts')!.state).toBe('lost');
  });

  it('lets a recovered crate reset its clock and survive', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.dropNewest();
    l.tick(l.decaySeconds - 0.5);
    expect(l.pickUp('src/a.ts')).toBe(true);

    l.tick(999);
    expect(l.find('src/a.ts')!.state).toBe('carried');
    expect(l.result('win').surviving).toContain('src/a.ts');
  });

  it('halves the grace period when the loss rule deletes files', () => {
    const normal = ledger({ loss: 'unstage' });
    const extreme = ledger({ loss: 'delete' });
    expect(extreme.decaySeconds).toBe(normal.decaySeconds / 2);
  });

  it('does not decay carried or stashed crates', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.pickUp('src/b.ts');
    l.stash('src/b.ts');
    expect(l.tick(999)).toEqual([]);
    expect(l.find('src/a.ts')!.state).toBe('carried');
    expect(l.find('src/b.ts')!.state).toBe('stashed');
  });
});

describe('result — win', () => {
  it('commits what you carried out and loses the rest', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.pickUp('src/b.ts');
    l.dropNewest(); // b knocked loose
    l.tick(999); // and left to decay

    const r = l.result('win');
    expect(r.surviving).toEqual(['src/a.ts']);
    expect(r.lost.sort()).toEqual(['src/b.ts', 'src/c.ts']);
    expect(r.stashed).toEqual([]);
  });

  it('counts a crate still lying on the ground as lost, decayed or not', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.dropNewest();
    // Still recoverable at the moment of extraction — but you left without it.
    expect(l.find('src/a.ts')!.state).toBe('dropped');
    expect(l.result('win').lost).toContain('src/a.ts');
  });

  it('never reports a file as both surviving and lost', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.pickUp('src/b.ts');
    l.stash('src/b.ts');
    l.pickUp('src/c.ts');
    l.dropNewest();

    const r = l.result('win');
    const all = [...r.surviving, ...r.lost, ...r.stashed];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(FILES.map((f) => f.name).sort());
  });
});

describe('result — loss', () => {
  it('loses everything, including what you were carrying', () => {
    const l = ledger();
    l.pickUp('src/a.ts');
    l.pickUp('src/b.ts');

    const r = l.result('loss');
    expect(r.surviving).toEqual([]);
    expect(r.lost.sort()).toEqual(FILES.map((f) => f.name).sort());
  });
});

describe('stash rules', () => {
  it("'run' ships stashed crates with the commit on a win", () => {
    const l = ledger({ stash: 'run' });
    l.pickUp('src/a.ts');
    l.stash('src/a.ts');

    const r = l.result('win');
    expect(r.surviving).toContain('src/a.ts');
    expect(r.stashed).toEqual([]);
  });

  it("'run' still loses stashed crates if the run is lost", () => {
    const l = ledger({ stash: 'run' });
    l.pickUp('src/a.ts');
    l.stash('src/a.ts');
    expect(l.result('loss').lost).toContain('src/a.ts');
  });

  it("'persist' holds stashed crates out of the commit and keeps them staged", () => {
    const l = ledger({ stash: 'persist' });
    l.pickUp('src/a.ts');
    l.stash('src/a.ts');
    l.pickUp('src/b.ts');

    const r = l.result('win');
    expect(r.surviving).toEqual(['src/b.ts']);
    expect(r.stashed).toEqual(['src/a.ts']);
    expect(r.lost).toEqual(['src/c.ts']);
  });

  it("'persist' keeps stashed crates staged even when the run is lost", () => {
    const l = ledger({ stash: 'persist' });
    l.pickUp('src/a.ts');
    l.stash('src/a.ts');

    const r = l.result('loss');
    expect(r.stashed).toEqual(['src/a.ts']);
    expect(r.lost).not.toContain('src/a.ts');
  });

  it("'off' refuses to stash at all", () => {
    const l = ledger({ stash: 'off' });
    l.pickUp('src/a.ts');
    expect(l.stash('src/a.ts')).toBe(false);
    expect(l.find('src/a.ts')!.state).toBe('carried');
  });
});

describe('invariants', () => {
  const outcomes = ['win', 'loss'] as const;
  const stashRules = ['run', 'persist', 'off'] as const;

  it('always accounts for every file exactly once, in every rule combination', () => {
    for (const stash of stashRules) {
      for (const outcome of outcomes) {
        const l = ledger({ stash });
        l.pickUp('src/a.ts');
        l.pickUp('src/b.ts');
        l.stash('src/b.ts');
        l.pickUp('src/c.ts');
        l.dropNewest();
        l.tick(3);

        const r = l.result(outcome);
        const all = [...r.surviving, ...r.lost, ...r.stashed].sort();
        expect(all, `stash=${stash} outcome=${outcome}`).toEqual(
          FILES.map((f) => f.name).sort(),
        );
      }
    }
  });

  it('never lists a surviving file as lost', () => {
    const l = ledger();
    for (const f of FILES) l.pickUp(f.name);
    const r = l.result('win');
    for (const name of r.surviving) expect(r.lost).not.toContain(name);
  });
});
