// Regenerates the README screenshots in docs/screenshots/ from the ?demo=<kind> states.
// Usage: npm run screenshots   (needs `npx playwright install chromium` once)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// desktop = full phone artwork; compact (<600px wide) = bare LCD, as on a real phone
const views = {
  desktop: { width: 900, height: 1100 },
  compact: { width: 480, height: 800 },
};
// [demo state, view] pairs used by the README
const shots = [['select', 'desktop'], ['play', 'desktop'], ['play', 'compact']];
const outDir = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
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
    viewport, deviceScaleFactor: 2,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
   });
   for (const kind of kinds) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${kind}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/index.html?demo=${kind}`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
    const name = `${kind}-${view}.png`;
    await page.screenshot({ path: outDir + name });
    await page.close();
    console.log('wrote docs/screenshots/' + name);
   }
   await ctx.close();
  }
  if (errors.length) console.log('page errors:', errors.join(' | '));
  code = errors.length ? 1 : 0;
} catch (e) {
  console.error('screenshots failed:', e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}
process.exit(code);
