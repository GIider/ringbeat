// The docs: links between them resolve, and the file and script lists don't fall behind the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = p => readFileSync(join(ROOT, p), 'utf8');
const DOCS = ['README.md', ...readdirSync(join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)];

// Code blocks and inline code are not links (and their headings are not headings).
const prose = md => md.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to dashes, repeats numbered.
function anchors(md) {
  const seen = new Map(), out = new Set();
  for (const [, h] of prose(md).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = h.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

test('docs: relative links and #anchors resolve', () => {
  const broken = [];
  for (const doc of DOCS) {
    const md = read(doc);
    for (const [, target] of prose(md).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue; // http(s), mailto
      const [path, hash] = target.split('#');
      const file = path ? relative(ROOT, resolve(ROOT, dirname(doc), path)) : doc;
      if (!existsSync(join(ROOT, file))) { broken.push(`${doc}: ${target} (no such file)`); continue; }
      if (hash && file.endsWith('.md') && !anchors(read(file)).has(hash)) broken.push(`${doc}: ${target} (no such heading)`);
    }
  }
  assert.deepEqual(broken, []);
});

test('docs: every docs/*.md is linked from the docs index', () => {
  const index = read('docs/README.md');
  const missing = DOCS.filter(d => d.startsWith('docs/') && d !== 'docs/README.md')
    .filter(d => !index.includes(`](${d.slice(5)})`));
  assert.deepEqual(missing, []);
});

test('docs: ARCHITECTURE names every source file, script and test', () => {
  const arch = read('docs/ARCHITECTURE.md');
  const named = s => new RegExp(`(^|[^\\w./-])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'm').test(arch);
  const walk = dir => readdirSync(join(ROOT, dir)).flatMap(f => {
    const p = dir + '/' + f;
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });
  const missing = [
    ...walk('src').map(p => p.slice(4)), // lang/de.js
    ...readdirSync(join(ROOT, 'scripts')),
    ...readdirSync(join(ROOT, 'tests')).map(f => f.replace(/\.test\.mjs$/, '')), // the *.test.mjs line lists stems
  ].filter(name => !named(name));
  assert.deepEqual(missing, [], 'add these to the source map in docs/ARCHITECTURE.md');
});

test('docs: DEVELOPMENT lists every npm script', () => {
  const dev = read('docs/DEVELOPMENT.md');
  const { scripts } = JSON.parse(read('package.json'));
  const missing = Object.keys(scripts)
    .filter(k => !dev.includes(`npm run ${k}`) && !dev.includes(`npm ${k}`) && !dev.includes(`\`${k}\``));
  assert.deepEqual(missing, [], 'add these to the npm scripts table in docs/DEVELOPMENT.md');
});
