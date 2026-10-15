// Dev server reachable from the local network. Usage: npm start [-- <port>]  (or PORT=9000 npm start)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) throw Object.assign(new Error('forbidden'), { code: 403 });
    if (!(await stat(file)).isFile()) throw Object.assign(new Error('not found'), { code: 404 });
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    const code = e.code === 403 ? 403 : 404;
    res.writeHead(code, { 'Content-Type': 'text/plain' });
    res.end(code === 403 ? 'Forbidden' : 'Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Ringbeat dev server:\n  http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces()))
    for (const a of addrs || [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}`);
});
