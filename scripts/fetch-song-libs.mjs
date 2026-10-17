// Downloads the song libraries credited in the README into song-libs/ (gitignored) so new songs can be picked from
// them without re-downloading. Usage: npm run songs:fetch [-- --force]  (--force re-downloads and re-extracts / pulls)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LIBS = join(ROOT, 'song-libs');
const FORCE = process.argv.includes('--force');
const PICAXE = ['rtttl', 'rtttl2', 'rtttl3', 'rtttl_tv', 'rtttl_xmas'];
const FLIPPER = 'https://github.com/neverfa11ing/FlipperMusicRTTTL';

await mkdir(join(LIBS, 'zips'), { recursive: true });
await mkdir(join(LIBS, 'picaxe'), { recursive: true });

for (const name of PICAXE) {
  const dir = join(LIBS, 'picaxe', name);
  if (existsSync(dir) && !FORCE) { console.log(`cached   picaxe/${name}`); continue; }
  const res = await fetch(`http://picaxe.com/downloads/${name}.zip`);
  if (!res.ok) throw new Error(`${name}.zip: HTTP ${res.status}`);
  const zip = join(LIBS, 'zips', `${name}.zip`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  await rm(dir, { recursive: true, force: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir], { stdio: 'inherit' });
  console.log(`fetched  picaxe/${name}`);
}

const flipper = join(LIBS, 'FlipperMusicRTTTL');
if (!existsSync(flipper)) {
  execFileSync('git', ['clone', '--depth', '1', FLIPPER, flipper], { stdio: 'inherit' });
  console.log('fetched  FlipperMusicRTTTL');
} else if (FORCE) {
  execFileSync('git', ['-C', flipper, 'pull', '--ff-only'], { stdio: 'inherit' });
  console.log('updated  FlipperMusicRTTTL');
} else {
  console.log('cached   FlipperMusicRTTTL');
}

// The clone carries the 10k song archive as a zip; unpack it next to the clone so pulls keep the clone clean.
const archive = join(flipper, 'Unsorted 10k Song Archive.zip');
const archiveDir = join(LIBS, 'flipper-10k');
if (existsSync(archiveDir) && !FORCE) {
  console.log('cached   flipper-10k');
} else {
  await rm(archiveDir, { recursive: true, force: true });
  execFileSync('unzip', ['-q', '-o', archive, '-d', archiveDir], { stdio: 'inherit' });
  console.log('fetched  flipper-10k');
}
