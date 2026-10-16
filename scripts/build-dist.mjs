// Stage the runtime files (no build step needed) into dist/ for deployment. Usage: npm run build
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeVersion } from './version-lib.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
for (const p of ['index.html', 'style.css', 'src', 'assets']) cpSync(resolve(ROOT, p), resolve(DIST, p), { recursive: true });
const build = process.env.BUILD_NUMBER || '0';
if (!/^\d+$/.test(build)) throw new Error('BUILD_NUMBER must be a number, got ' + build);
const { version } = computeVersion(ROOT);
let commit = (process.env.GITHUB_SHA || '').slice(0, 7).toLowerCase();
if (!commit) {
  try { commit = execSync('git rev-parse --short=7 HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { commit = ''; }
}
if (commit && !/^[0-9a-f]{7}$/.test(commit)) throw new Error('GITHUB_SHA must be a hex commit hash, got ' + process.env.GITHUB_SHA);
const info = { number: Number(build), commit: commit || 'dev', date: new Date().toISOString().slice(0, 10) };
const base = readFileSync(resolve(ROOT, 'src/version.js'), 'utf8');
const stamped = base
  .replace(/export const VERSION = [^;]*;/, `export const VERSION = '${version}';`)
  .replace(/export const BUILD = \{[^}]*\};/, `export const BUILD = ${JSON.stringify(info)};`);
if (!stamped.includes(`'${version}'`) || !stamped.includes(info.date)) throw new Error('failed to stamp src/version.js');
writeFileSync(resolve(DIST, 'src/version.js'), stamped);
console.log('version', version);
console.log('staged ->', DIST);
