// Stage the runtime files (no build step needed) into dist/ for deployment. Usage: npm run build
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
for (const p of ['index.html', 'style.css', 'src', 'assets']) cpSync(resolve(ROOT, p), resolve(DIST, p), { recursive: true });
const build = process.env.BUILD_NUMBER;
if (build) {
  if (!/^\d+$/.test(build)) throw new Error('BUILD_NUMBER must be a number, got ' + build);
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version.split('.').slice(0, 2).join('.') + '.' + build;
  writeFileSync(resolve(DIST, 'src/version.js'), `// Stamped by scripts/build-dist.mjs\nexport const VERSION = '${version}';\n`);
  console.log('version', version);
}
console.log('staged ->', DIST);
