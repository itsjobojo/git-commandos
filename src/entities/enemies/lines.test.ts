import { describe, expect, it } from 'vitest';
import { AI_BRO_LINES } from './ai-bro-lines';
import { RECRUITER_HUNCHES, RECRUITER_OPENERS } from './recruiter-lines';
import { INTERN_LINES } from './intern-lines';

/**
 * Dialogue is the one part of this game that gets edited casually, and both
 * ways it goes wrong are invisible in a diff: a line long enough to wrap into a
 * paragraph, and a line that quietly gives two archetypes the same voice.
 *
 * Neither breaks anything. They just make the game worse, months later, with
 * nobody able to say when.
 */

/**
 * A bubble wraps at `MAX_WIDTH` 430px minus 18px padding either side, drawn in
 * 26px monospace — about 25 characters a line (see `render/bubble.ts`). This
 * ceiling allows a second line and refuses a third: twenty-five bros shouting
 * paragraphs buries the fight the dialogue is meant to be decorating.
 */
const MAX_BUBBLE_CHARS = 34;

const CASTS = {
  bro: AI_BRO_LINES,
  'recruiter opener': RECRUITER_OPENERS,
  'recruiter hunch': RECRUITER_HUNCHES,
  intern: INTERN_LINES,
} as const;

describe('every line fits its bubble', () => {
  for (const [cast, lines] of Object.entries(CASTS)) {
    it(`${cast}`, () => {
      const tooLong = lines.filter((l) => l.length > MAX_BUBBLE_CHARS);
      expect(tooLong, `shorten or cut: ${tooLong.join(' / ')}`).toEqual([]);
    });
  }
});

describe('the casts stay distinct', () => {
  it('never gives the same line to two archetypes', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [cast, lines] of Object.entries(CASTS)) {
      for (const line of lines) {
        const key = line.toLowerCase();
        const owner = seen.get(key);
        // The Recruiter's two lists are one character speaking in two moods.
        if (owner && !(owner.startsWith('recruiter') && cast.startsWith('recruiter'))) {
          clashes.push(`"${line}" — ${owner} and ${cast}`);
        }
        seen.set(key, cast);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('lets only the Intern ask for five minutes', () => {
    // Three archetypes you are meant to tell apart by behaviour all asked for
    // five minutes, which made them sound like one enemy with three models.
    for (const [cast, lines] of Object.entries(CASTS)) {
      const asks = lines.filter((l) => /five minutes/i.test(l));
      if (cast === 'intern') continue;
      expect(asks, `${cast} should not ask for five minutes`).toEqual([]);
    }
    expect(INTERN_LINES.some((l) => /five minutes/i.test(l))).toBe(true);
  });

  it('has no duplicates inside a single cast', () => {
    for (const [cast, lines] of Object.entries(CASTS)) {
      expect(new Set(lines.map((l) => l.toLowerCase())).size, cast).toBe(lines.length);
    }
  });
});

describe('there are enough lines to not repeat immediately', () => {
  it('gives every cast a workable pool', () => {
    // The Recruiter respawns throughout a run while a bro herd passes once, so
    // a thin opener list is heard far more often than its size suggests.
    expect(AI_BRO_LINES.length).toBeGreaterThanOrEqual(40);
    expect(RECRUITER_OPENERS.length).toBeGreaterThanOrEqual(15);
    expect(RECRUITER_HUNCHES.length).toBeGreaterThanOrEqual(5);
    expect(INTERN_LINES.length).toBeGreaterThanOrEqual(8);
  });
});
