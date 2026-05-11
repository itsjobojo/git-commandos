export interface GitFile {
  name: string;
  alive: boolean;
}

export interface CommitPayload {
  files: GitFile[];
  commitMessage: string;
  linesAdded: number;
}

export interface GitContext {
  command: string;
  difficulty: 'basic' | 'extreme';
  payload: CommitPayload;
  sendResult: (outcome: 'win' | 'loss', surviving: string[], lost: string[]) => void;
}

/**
 * Try to connect to the CLI WebSocket server.
 * Returns GitContext if running from CLI, or null if standalone (dev mode).
 */
export function connectGitContext(): Promise<GitContext | null> {
  return new Promise((resolve) => {
    // In dev mode (vite dev), there's no WebSocket server — return null
    // In CLI mode, the page is served from the same host as the WS
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${location.host}`);
    } catch {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 2000);

    ws.onmessage = (event) => {
      clearTimeout(timeout);
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init') {
          const files: GitFile[] = (msg.payload.files as string[]).map((name) => ({
            name,
            alive: true,
          }));
          const ctx: GitContext = {
            command: msg.command,
            difficulty: msg.difficulty,
            payload: {
              files,
              commitMessage: msg.payload.commitMessage,
              linesAdded: msg.payload.linesAdded ?? 0,
            },
            sendResult(outcome, surviving, lost) {
              ws.send(JSON.stringify({
                type: 'result',
                outcome,
                payload: { survivingFiles: surviving, lostFiles: lost },
              }));
            },
          };
          resolve(ctx);
        }
      } catch {
        resolve(null);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
    };
  });
}
