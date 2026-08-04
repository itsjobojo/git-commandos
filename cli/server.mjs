import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = normalize(join(__dirname, '..', 'dist'));

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ogg':  'audio/ogg',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Launch the game in a browser, send config over WebSocket, wait for result.
 * Returns a Promise that resolves with the game result message.
 */
export function launchGame(config) {
  return new Promise(async (resolve, reject) => {
    // A published install always ships a built dist/. Running from a clone
    // does not, and "404 Not found" in a browser tab is a poor way to learn it.
    if (!existsSync(join(DIST_DIR, 'index.html'))) {
      reject(new Error(
        'The game is not built — dist/index.html is missing.\n' +
        '  Run `pnpm build` (from a clone) or reinstall with `npm install -g git-commandos`.',
      ));
      return;
    }

    const server = createServer((req, res) => {
      let filePath = req.url === '/' ? '/index.html' : req.url;
      // Strip query strings
      filePath = filePath.split('?')[0];
      const fullPath = normalize(join(DIST_DIR, decodeURIComponent(filePath)));
      // The server is short-lived and local, but it is still a server pointed
      // at someone's machine: nothing outside dist/ is ever ours to serve.
      if (fullPath !== DIST_DIR && !fullPath.startsWith(DIST_DIR + sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      try {
        const data = readFileSync(fullPath);
        const ext = extname(fullPath);
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          // Always serve fresh — prevents the browser from caching a stale
          // index.html that points to an old (renamed) JS bundle.
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    const wss = new WebSocketServer({ server });
    let resolved = false;

    function finish(msg) {
      if (resolved) return;
      resolved = true;
      server.close(() => {});
      resolve(msg);
    }

    wss.on('connection', (ws) => {
      // Send init config to the game
      ws.send(JSON.stringify({ type: 'init', ...config }));

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'result') {
            ws.close();
            finish(msg);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        // Browser closed without sending a result — treat as abort (no-op)
        finish({
          type: 'result',
          outcome: 'abort',
          payload: { survivingFiles: [], lostFiles: [] },
        });
      });
    });

    // Any free port, loopback only — a WebSocket message from this server
    // decides what happens to the user's staged files, so it is not something
    // to expose to the network.
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const url = `http://localhost:${port}`;
      console.log(`\n  🎮 Game server running at ${url}\n`);
      // GCMDS_NO_OPEN lets tests and CI drive the protocol without hijacking
      // the user's browser.
      if (process.env.GCMDS_NO_OPEN) {
        console.log(`  Open ${url} in your browser to play.\n`);
        return;
      }
      try {
        const open = (await import('open')).default;
        await open(url);
      } catch {
        console.log(`  Open ${url} in your browser to play.\n`);
      }
    });

    server.on('error', reject);
  });
}
