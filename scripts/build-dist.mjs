// Stage the runtime files (no build step needed) into dist/ for deployment. Usage: npm run build
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
for (const p of ['index.html', 'style.css', 'src', 'assets']) cpSync(resolve(ROOT, p), resolve(DIST, p), { recursive: true });
console.log('staged ->', DIST);
