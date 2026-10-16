// Derives the version from git + the changelog. Usage: node scripts/version-lib.mjs  (prints e.g. 1.4.7)
// major.minor = newest changelog entry; patch = commits since the commit that added that entry.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

export function computeVersion(root = ROOT, changelogPath = 'src/changelog.js') {
  const src = execFileSync('node', ['-e', `import(${JSON.stringify(pathToFileURL(resolve(root, changelogPath)).href)}).then(m => console.log(m.MESSAGES[0].version))`]).toString().trim();
  if (!/^\d+\.\d+$/.test(src)) throw new Error('newest changelog version must be major.minor, got ' + src);
  try {
    const first = git(root, 'log', '-S' + `version: '${src}'`, '--format=%H', '--reverse', '--', changelogPath).split('\n')[0];
    if (!first) return { minor: src, patch: 0, version: src + '.0', exact: false };
    const patch = Number(git(root, 'rev-list', '--count', first + '..HEAD'));
    return { minor: src, patch, version: src + '.' + patch, exact: true };
  } catch {
    return { minor: src, patch: 0, version: src + '.0', exact: false };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(computeVersion().version);
