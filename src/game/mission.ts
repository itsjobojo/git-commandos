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
export interface Mission {
  /** Same commit message → same map, same spawns, same bro dialogue. */
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

export function buildMission(ctx: GitContext | null): Mission {
  if (!ctx) {
    return {
      seed: 'sandbox',
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
      arenaCells: 44,
    };
  }

  return {
    seed: `${ctx.branch}:${ctx.commitMessage}`,
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
    arenaCells: Math.round(clamp(36 + ctx.linesAdded / 12, 36, 72)),
  };
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
