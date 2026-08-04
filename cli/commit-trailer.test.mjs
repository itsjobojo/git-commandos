import { describe, expect, it } from 'vitest';
import { buildTrailer, stampCommitMessage } from './commit-trailer.mjs';

/**
 * This is the only part of the CLI that edits the user's commit message, so the
 * things worth asserting are the ones that would quietly corrupt it: the
 * message surviving intact, the footer not stacking, and stats being optional
 * rather than printed as zeroes.
 */

const RULES = { loss: 'unstage', death: 'health', stash: 'run' };
const STATS = { seconds: 102, hitsTaken: 2, hpRemaining: 5, hpMax: 7, kills: 11, recovered: 1 };
const run = (over = {}) => ({
  surviving: ['a.ts', 'b.ts'],
  lost: [],
  stashed: [],
  rules: RULES,
  stats: STATS,
  ...over,
});

describe('stampCommitMessage', () => {
  it('leaves the typed message untouched at the top', () => {
    const out = stampCommitMessage('fix the thing', run());
    expect(out.startsWith('fix the thing\n\n')).toBe(true);
  });

  it('keeps a multi-paragraph message whole', () => {
    const message = 'subject line\n\nbody paragraph explaining why.';
    expect(stampCommitMessage(message, run()).startsWith(`${message}\n\n`)).toBe(true);
  });

  it('never stacks two footers', () => {
    const once = stampCommitMessage('fix', run());
    expect(stampCommitMessage(once, run())).toBe(once);
  });
});

describe('buildTrailer', () => {
  it('names the tool, so the commit says where it came from', () => {
    expect(buildTrailer(run())).toContain('Committed with Git Commandos');
  });

  it('reports the run', () => {
    const out = buildTrailer(run());
    expect(out).toContain('1m 42s');
    expect(out).toContain('11 hostiles down');
    expect(out).toContain('2 hits taken');
    expect(out).toContain('5/7 HP');
    expect(out).toContain('1 crate recovered');
  });

  it('omits the run line entirely when the game sent no stats', () => {
    // An older build. Printing "0 hostiles down · 0s" would be a lie about the
    // run rather than an obviously missing field.
    const out = buildTrailer(run({ stats: undefined }));
    expect(out).not.toContain('Run    ');
    expect(out).not.toContain('0 hostiles');
    expect(out).toContain('Committed with Git Commandos');
  });

  it('drops the HP column when health is not the death rule', () => {
    const out = buildTrailer(run({ rules: { ...RULES, death: 'cargo' } }));
    expect(out).not.toContain('HP');
  });

  it('counts the cargo both ways', () => {
    const out = buildTrailer(run({ surviving: ['a.ts'], lost: ['b.ts', 'c.ts'] }));
    expect(out).toContain('1 extracted · 2 lost');
  });

  it('commends a spotless run differently from a costly one', () => {
    const clean = buildTrailer(run({ stats: { ...STATS, hitsTaken: 0 } }));
    const costly = buildTrailer(run({ lost: ['b.ts'] }));
    expect(clean).toContain('Not a scratch on you');
    expect(costly).toContain('lost 1 file getting here');
    expect(clean).not.toBe(costly);
  });

  it('credits extreme mode for what it actually risks', () => {
    const out = buildTrailer(run({ rules: { ...RULES, loss: 'delete' } }));
    expect(out).toContain('extreme mode');
    expect(out).toContain('lost files deleted');
  });

  it('says one file, not 1 files', () => {
    expect(buildTrailer(run({ surviving: ['a.ts'] }))).toContain('1 file carried');
  });
});
