/**
 * The CLI ↔ game handshake.
 *
 * The CLI server sends one `init` message when the browser connects; the game
 * replies with exactly one `result`. If the browser closes without a result,
 * the CLI treats it as an abort and does nothing — which is the correct
 * failure mode for a tool that can unstage your work.
 *
 * This is the only file in `src/` that knows the wire format.
 */

export interface StagedFile {
  name: string;
  added: number;
  removed: number;
}

export type Outcome = 'win' | 'loss';

/** What happens to files you fail to extract. */
export type LossRule = 'unstage' | 'delete';

/**
 * - `cargo`   hits only knock cargo loose; you cannot be killed
 * - `health`  separate health pool; running out loses everything
 * - `fragile` hits knock cargo loose, but a hit while empty-handed kills you
 */
export type DeathRule = 'cargo' | 'health' | 'fragile';

/**
 * - `run`     the stash cache protects cargo from death, within this run only
 * - `persist` cargo left in the stash stays staged for the next run
 * - `off`     no stash cache spawns
 */
export type StashRule = 'run' | 'persist' | 'off';

export interface Rules {
  loss: LossRule;
  death: DeathRule;
  stash: StashRule;
}

export const DEFAULT_RULES: Rules = { loss: 'unstage', death: 'cargo', stash: 'run' };

export interface GitContext {
  command: string;
  difficulty: 'basic' | 'extreme';
  music: boolean;
  rules: Rules;
  files: StagedFile[];
  commitMessage: string;
  linesAdded: number;
  branch: string;
  repo: string;
  /** Idempotent — only the first call is sent on the wire. */
  sendResult: (outcome: Outcome, result: RunResult) => void;
  /**
   * Walk away without a result. The CLI sees the socket close and treats it as
   * an abort, which changes nothing — the correct way to quit a run you don't
   * want to finish.
   */
  abort: () => void;
}

export interface RunResult {
  surviving: string[];
  lost: string[];
  /** Only non-empty under `stash: 'persist'` — stays staged, never committed. */
  stashed: string[];
}

const HANDSHAKE_TIMEOUT_MS = 2000;

/**
 * Connect to the CLI WebSocket server.
 * Resolves `null` in standalone/dev mode (`pnpm dev`), where there is no
 * server and the game runs as a sandbox with no real git state.
 */
export function connectGitContext(): Promise<GitContext | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${location.host}`);
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const settle = (ctx: GitContext | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ctx);
    };

    const timeout = setTimeout(() => {
      ws.close();
      settle(null);
    }, HANDSHAKE_TIMEOUT_MS);

    ws.onmessage = (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!isInit(msg)) return;

      let sent = false;
      settle({
        command: msg.command,
        difficulty: msg.difficulty === 'extreme' ? 'extreme' : 'basic',
        music: msg.music !== false,
        rules: normaliseRules(msg.rules, msg.difficulty === 'extreme'),
        files: normaliseFiles(msg.payload.files),
        commitMessage: msg.payload.commitMessage ?? '',
        linesAdded: msg.payload.linesAdded ?? 0,
        branch: msg.payload.branch ?? 'HEAD',
        repo: msg.payload.repo ?? '',
        abort() {
          if (sent) return;
          sent = true;
          ws.close();
        },
        sendResult(outcome, result) {
          // Sending twice would let the CLI act on a stale result. One only.
          if (sent) return;
          sent = true;
          ws.send(
            JSON.stringify({
              type: 'result',
              outcome,
              payload: {
                survivingFiles: result.surviving,
                lostFiles: result.lost,
                stashedFiles: result.stashed,
              },
            }),
          );
        },
      });
    };

    ws.onerror = () => settle(null);
    ws.onclose = () => settle(null);
  });
}

interface InitMessage {
  type: 'init';
  command: string;
  difficulty?: string;
  music?: boolean;
  rules?: unknown;
  payload: {
    files: unknown;
    commitMessage?: string;
    linesAdded?: number;
    branch?: string;
    repo?: string;
  };
}

function isInit(msg: unknown): msg is InitMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'init' &&
    typeof (msg as { payload?: unknown }).payload === 'object'
  );
}

const DEATH_RULES: DeathRule[] = ['cargo', 'health', 'fragile'];
const STASH_RULES: StashRule[] = ['run', 'persist', 'off'];

/**
 * A CLI that predates the rules block sends nothing, so fall back to the
 * defaults — deriving the loss rule from the older `difficulty` field, which
 * is the one setting that already existed.
 */
function normaliseRules(raw: unknown, extreme: boolean): Rules {
  const fallback: Rules = { ...DEFAULT_RULES, loss: extreme ? 'delete' : 'unstage' };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const r = raw as Partial<Rules>;
  return {
    loss: r.loss === 'delete' || r.loss === 'unstage' ? r.loss : fallback.loss,
    death: DEATH_RULES.includes(r.death as DeathRule) ? (r.death as DeathRule) : fallback.death,
    stash: STASH_RULES.includes(r.stash as StashRule) ? (r.stash as StashRule) : fallback.stash,
  };
}

/**
 * Accepts both the old `string[]` shape and the new `{name, added, removed}[]`.
 * An older globally-installed CLI against a newer build still works — the
 * crates just all come out the same size.
 */
function normaliseFiles(raw: unknown): StagedFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): StagedFile | null => {
      if (typeof entry === 'string') return { name: entry, added: 0, removed: 0 };
      if (entry && typeof entry === 'object' && typeof (entry as StagedFile).name === 'string') {
        const f = entry as Partial<StagedFile>;
        return { name: f.name!, added: f.added ?? 0, removed: f.removed ?? 0 };
      }
      return null;
    })
    .filter((f): f is StagedFile => f !== null);
}
