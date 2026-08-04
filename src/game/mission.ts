import { DEFAULT_RULES, type GitContext, type Rules, type StagedFile } from '../net/protocol';

/**
 * A mission is the game's view of a git operation: what's at stake, how long
 * the extraction takes, how big the map is, and the seed that makes all of it
 * reproducible.
 *
 * Everything downstream reads `Mission`, never `GitContext` — so sandbox mode
 * is not a special case threaded through the game, it's just a Mission built
 * from fake data.
 */
/**
 * Hits you can take before the run is lost, under the `health` rule.
 *
 * Lives here rather than in `game.ts` so the briefing can quote the real number
 * without importing the thing that imports it. Four was tuned when `health` was
 * a niche opt-in and nothing else could kill you; as the default it has to
 * absorb a recruiter burst plus the crate you drop with every hit.
 */
export const MAX_HP = 7;

/**
 * Linear multiplier on every arena, applied to the tuned cell counts below.
 *
 * `√3`, because "three times bigger" is about the ground you cover, not the
 * length of one side: this is 3× the footprint, roughly 1.7× the walk from
 * spawn to pad. Tripling the *side* instead would be nine times the city — a
 * long trudge through blocks nothing is happening in, which is the opposite of
 * what a bigger map is for.
 *
 * It scales the result rather than the formula so the two knobs underneath it
 * (lines added, file count) keep their tuned relationship to each other, and so
 * there is exactly one number to change if this turns out too big or too small.
 * Corridor and room widths are solved as fractions of the arena (see
 * `solveRadii`), so a scaled map is a grander version of the same place, not
 * the same streets stranded in more rock.
 */
export const ARENA_SCALE = Math.sqrt(3);

export interface Mission {
  /**
   * Drives the map, the spawns and the dialogue. Rolled fresh on every deploy,
   * so no two runs are the same place — see `freshSeed`.
   */
  seed: string;
  sandbox: boolean;
  command: string;
  difficulty: 'basic' | 'extreme';
  music: boolean;
  /** What a run can cost you — set by CLI flags, see cli/rules.mjs. */
  rules: Rules;

  repo: string;
  branch: string;
  commitMessage: string;
  files: StagedFile[];
  linesAdded: number;

  /** Seconds you must hold the extraction pad. */
  holdSeconds: number;
  /** Arena size in cells — stands in for chunk count until M5. */
  arenaCells: number;
}

const SANDBOX_FILES: StagedFile[] = [
  { name: 'src/core/loop.ts', added: 48, removed: 3 },
  { name: 'src/entities/player.ts', added: 132, removed: 17 },
  { name: 'src/world/grid.ts', added: 96, removed: 0 },
  { name: 'README.md', added: 12, removed: 4 },
];

/**
 * The one place entropy enters the game.
 *
 * Everything downstream is seeded and reproducible — the map, the spawns, the
 * loot rolls, the dialogue all derive from this string, so a single run is
 * internally consistent and can be replayed exactly given the seed. What
 * changed is that the seed is no longer a pure function of the commit.
 *
 * It used to be `branch:commitMessage`, which meant one commit had one world
 * forever: lose a run, re-stage, run it again, and you were handed the same map
 * you had just failed. Deploying twice should not be the same journey twice.
 * The commit still names the seed, so a world is still recognisably that
 * commit's — it is just a new one each time you deploy.
 *
 * `Math.random` is deliberate here and nowhere else. The rule against it holds
 * for gameplay code, which must take an `Rng` so a run stays reproducible; this
 * runs once, before the run exists, to decide which run it is going to be.
 */
function freshSeed(label: string): string {
  const when = Date.now().toString(36);
  const noise = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${label}:${when}:${noise}`;
}

export function buildMission(ctx: GitContext | null): Mission {
  if (!ctx) {
    return {
      seed: freshSeed('sandbox'),
      sandbox: true,
      command: 'play',
      difficulty: 'basic',
      music: true,
      rules: DEFAULT_RULES,
      repo: 'sandbox',
      branch: 'detached',
      commitMessage: 'sandbox run — no real git state',
      files: SANDBOX_FILES,
      linesAdded: SANDBOX_FILES.reduce((n, f) => n + f.added, 0),
      holdSeconds: 6,
      // Same formula a real commit gets, rather than a hardcoded 44 — otherwise
      // the sandbox is not a sample of the thing it exists to preview.
      arenaCells: Math.round(clamp(34 + SANDBOX_FILES.length * 2.8, 44, 72) * ARENA_SCALE),
    };
  }

  return {
    seed: freshSeed(`${ctx.branch}:${ctx.commitMessage}`),
    sandbox: false,
    command: ctx.command,
    difficulty: ctx.difficulty,
    music: ctx.music,
    rules: ctx.rules,
    repo: ctx.repo,
    branch: ctx.branch,
    commitMessage: ctx.commitMessage,
    files: ctx.files,
    linesAdded: ctx.linesAdded,
    // A one-line fix is a smash-and-grab; a 400-line refactor is a long, ugly
    // haul. This is the mechanic that argues for committing more often.
    holdSeconds: clamp(4 + ctx.linesAdded / 55, 4, 14),
    // Two separate knobs. Lines added set how grand the map is; the number of
    // files sets how long the route through it is. The floor is what keeps
    // those from fighting: a fifteen-file commit carves a route roughly three
    // times the length a one-file commit does, and it needs somewhere to put
    // it — on a small arena the branches have nowhere to go and the walk folds
    // back on itself instead of exploring.
    arenaCells: Math.round(
      clamp(Math.max(36 + ctx.linesAdded / 12, 34 + ctx.files.length * 2.8), 44, 72) * ARENA_SCALE,
    ),
  };
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
