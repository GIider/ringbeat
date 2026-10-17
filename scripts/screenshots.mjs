// Regenerates the README screenshots from the ?demo=<kind> states into docs/screenshots/ (git-ignored;
// override with SCREENSHOT_DIR). CI publishes them to the history-less `screenshots` branch.
// Usage: npm run screenshots   (needs `npx playwright install chromium` once)
import { chromium } from 'playwright';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// desktop = full phone artwork; compact (<600px wide) = bare LCD, as on a real phone
const views = {
  desktop: { width: 1280, height: 1100 },
  compact: { width: 480, height: 800 },
};
// [demo state, view] pairs used by the README
const shots = [
  ['menu', 'desktop'], ['select', 'desktop'], ['mods', 'desktop'], ['play', 'desktop'], ['play', 'compact'],
];
// The LCD texture makes raw PNGs huge; a 128-colour palette (when ImageMagick is installed) cuts them ~15x.
let magick = null;
for (const bin of ['magick', 'convert']) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); magick = bin; break; } catch { /* not installed */ }
}
if (!magick) console.log('ImageMagick not found: screenshots will not be palette-optimised');
// Re-encoding changes the bytes (PNG metadata) even when no pixel moved, so a shot is only
// replaced when its pixels differ from the existing file: CI seeds the dir with the published branch, so
// `git status` there shows real changes only.
// Without ImageMagick there is no pixel compare, so every shot is rewritten.
const tmp = mkdtempSync(join(tmpdir(), 'rb-shots-'));
const samePixels = (a, b) => {
  if (!magick) return false;
  const r = spawnSync(magick === 'magick' ? magick : 'compare', [...(magick === 'magick' ? ['compare'] : []), '-metric', 'AE', a, b, 'null:'], { encoding: 'utf8' }); // metric goes to stderr
  return r.status === 0 && r.stderr.trim().startsWith('0'); // status 1 = differs, 2 = error/size mismatch
};
const outDir = (process.env.SCREENSHOT_DIR ?? fileURLToPath(new URL('../docs/screenshots', import.meta.url))).replace(/\/?$/, '/');
mkdirSync(outDir, { recursive: true });

const port = 20000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
let code = 1, browser;
try {
  await new Promise(r => setTimeout(r, 500));
  browser = await chromium.launch();
  const errors = [];
  for (const [view, viewport] of Object.entries(views)) {
   const kinds = shots.filter(s => s[1] === view).map(s => s[0]);
   const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
   });
   for (const kind of kinds) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${kind}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/index.html?demo=${kind}`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
    const name = `${kind}-${view}.png`;
    const fresh = join(tmp, name);
    await page.screenshot({ path: fresh });
    if (magick) execFileSync(magick, [fresh, '-colors', '128', '-strip', 'PNG8:' + fresh]);
    await page.close();
    if (existsSync(outDir + name) && samePixels(fresh, outDir + name)) { console.log('unchanged ' + name); continue; }
    copyFileSync(fresh, outDir + name);
    console.log('wrote ' + outDir + name);
   }
   await ctx.close();
  }
  if (errors.length) console.log('page errors:', errors.join(' | '));
  code = errors.length ? 1 : 0;
} catch (e) {
  console.error('screenshots failed:', e.message);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (browser) await browser.close();
  server.kill();
}
process.exit(code);
