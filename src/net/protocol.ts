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

export interface GitContext {
  command: string;
  difficulty: 'basic' | 'extreme';
  music: boolean;
  files: StagedFile[];
  commitMessage: string;
  linesAdded: number;
  branch: string;
  repo: string;
  /** Idempotent — only the first call is sent on the wire. */
  sendResult: (outcome: Outcome, surviving: string[], lost: string[]) => void;
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
        files: normaliseFiles(msg.payload.files),
        commitMessage: msg.payload.commitMessage ?? '',
        linesAdded: msg.payload.linesAdded ?? 0,
        branch: msg.payload.branch ?? 'HEAD',
        repo: msg.payload.repo ?? '',
        sendResult(outcome, surviving, lost) {
          // Sending twice would let the CLI act on a stale result. One only.
          if (sent) return;
          sent = true;
          ws.send(
            JSON.stringify({
              type: 'result',
              outcome,
              payload: { survivingFiles: surviving, lostFiles: lost },
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
