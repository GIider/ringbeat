// Dev server reachable from the local network. Usage: npm start [-- <port>]  (or PORT=9000 npm start)
// `npm run dev` adds live reload: the page reloads whenever a file under the project changes.
// `--cloud` (npm run dev:cloud) also points the game at the local API on port 8787 with its GitHub-free sign-in;
// `?api=prod` on the page skips that.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const DEV = args.includes('--dev');
const CLOUD = args.includes('--cloud');
const PORT = Number(args.find(a => /^\d+$/.test(a)) || process.env.PORT || 8000);
const clients = new Set();
const LOCAL_API = '<script>if (!/[?&]api=prod\\b/.test(location.search)) try { localStorage.setItem("ringbeat.api", location.protocol + "//" + location.hostname + ":8787"); localStorage.setItem("ringbeat.devlogin", "1"); } catch {}</script>';
const RELOAD = '<script>new EventSource("/__reload").onmessage = () => location.reload();</script>';
if (DEV) {
  let timer;
  watch(ROOT, { recursive: true }, (_, name) => {
    if (!name || /(^|[\\/])(node_modules|\.git|\.wrangler|dist)([\\/]|$)/.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { for (const c of clients) c.write('data: reload\n\n'); }, 80);
  });
}
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
    if (DEV && path === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 500\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) throw Object.assign(new Error('forbidden'), { code: 403 });
    if (!(await stat(file)).isFile()) throw Object.assign(new Error('not found'), { code: 404 });
    let body = await readFile(file);
    if (DEV && extname(file) === '.html') body = Buffer.from(body.toString().replace('</body>', (CLOUD ? LOCAL_API : '') + RELOAD + '</body>'));
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
  console.log(`Ringbeat ${DEV ? 'dev server (live reload)' : 'server'}${CLOUD ? ', local API on :8787' : ''}:\n  http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces()))
    for (const a of addrs || [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}`);
});
