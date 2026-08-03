import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

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
    const server = createServer((req, res) => {
      let filePath = req.url === '/' ? '/index.html' : req.url;
      // Strip query strings
      filePath = filePath.split('?')[0];
      const fullPath = join(DIST_DIR, filePath);
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

    // Find an available port
    server.listen(0, async () => {
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
