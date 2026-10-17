// Fills the LOCAL D1 with bot players whose runs were played by the game's own bot and then re-played by the Worker's
// verifyRun, so the boards look like a live one. Usage: node scripts/seed-local.mjs [--bots=40] [--songs=60] [--seed=1] [--reset]
//   --reset   only delete the bots (ids "bot-*"); your own local account is never touched.
// Writes server/.wrangler/seed.sql and applies it with `wrangler d1 execute ringbeat --local` (never --remote).
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES } from '../src/replay.js';
import { LADDER, mulberry32 } from '../src/bot.js';
import { SONGS } from '../src/songs.js';
import { verifyRun } from '../server/src/index.js';
import { played } from './lib/botrun.mjs';

const arg = (name, dflt) => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? Number(a.split('=')[1]) : dflt; };
const BOTS = arg('bots', 40), SONG_COUNT = arg('songs', 60), SEED = arg('seed', 1);
const RESET = process.argv.includes('--reset');
const SERVER = fileURLToPath(new URL('../server/', import.meta.url));
const WEEK = 7 * 24 * 3600e3;

const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const CLEAR = [
  "DELETE FROM runs WHERE user_id LIKE 'bot-%';",
  "DELETE FROM identities WHERE user_id LIKE 'bot-%';",
  "DELETE FROM users WHERE id LIKE 'bot-%';",
];
// GET /boards rebuilds the snapshot at once when its rules differ (the cron that would do it is not running locally).
const DIRTY = "UPDATE board_tops SET rules = '', dirty = 1;";
const NAMES = ['Nova', 'Pixel', 'Beep', 'Snake', 'Ringo', 'Buzz', 'Chirp', 'Tonal', 'Echo', 'Fuzz', 'Wave', 'Byte', 'Trill', 'Riff', 'Dial', 'Ping'];

const sql = [...CLEAR];
if (!RESET) {
  const rnd = mulberry32(SEED), now = Date.now();
  const bots = Array.from({ length: BOTS }, (_, i) => ({
    id: 'bot-' + String(i + 1).padStart(2, '0'),
    name: NAMES[i % NAMES.length] + (i >= NAMES.length ? '-' + (i + 1) : ''),
    skill: LADDER[Math.min(LADDER.length - 1, Math.floor(i * LADDER.length / BOTS))],
    dev: i % 17 === 0 ? 1 : 0,
  }));
  for (const b of bots) {
    sql.push(`INSERT INTO users (id, display_name, created, public, hidden, dev) VALUES (${q(b.id)}, ${q(b.name)}, ${now - 4 * WEEK}, 1, 0, ${b.dev});`);
    sql.push(`INSERT INTO identities (provider, subject, user_id, created) VALUES ('bot', ${q(b.id)}, ${q(b.id)}, ${now - 4 * WEEK});`);
  }
  // Every n-th song so the picks spread across the categories.
  const step = Math.max(1, Math.floor(SONGS.length / SONG_COUNT));
  const songs = SONGS.filter((_, i) => i % step === 0).slice(0, SONG_COUNT);
  let n = 0, invalid = 0;
  for (const song of songs) for (const diff of ['normal', 'hard']) {
    // The easiest songs are crowded, the rest less so; at least a handful of players on every board.
    const crowd = Math.max(5, Math.round(BOTS * (0.25 + 0.5 * rnd())));
    for (const b of bots.slice().sort(() => rnd() - 0.5).slice(0, crowd)) {
      const seed = Math.floor(rnd() * 1e9) + 1, at = now - Math.floor(rnd() * 3 * WEEK);
      const { run } = played(song.id, diff, b.skill, null, seed, undefined, at);
      const v = verifyRun({ songId: song.id, diff, replay: run.replay, loadout: JSON.stringify(run.loadout), rtttl: null });
      if (v.verified !== 1) { invalid++; continue; }
      sql.push(`INSERT INTO runs (user_id, client_run_id, song_id, diff, score, grade, accuracy, max_combo, fc, ap, mods, mult, game_version,
        played_at, received_at, replay, verified, rules, loadout, rtttl, flags, hidden) VALUES (${[b.id, `seed-${seed}`, song.id, diff, v.score, v.grade,
        v.accuracy, v.maxCombo, v.fc, v.ap, v.mods, v.mult, 'seed', at, at, run.replay, 1, String(RULES), JSON.stringify(run.loadout), null, v.flags, 0].map(q).join(', ')});`);
      n++;
    }
  }
  console.log(`seed: ${bots.length} bots, ${n} runs on ${songs.length} songs${invalid ? `, ${invalid} not verified (skipped)` : ''}`);
}
sql.push(DIRTY);

mkdirSync(SERVER + '.wrangler', { recursive: true });
const file = SERVER + '.wrangler/seed.sql';
writeFileSync(file, sql.join('\n') + '\n');
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'ringbeat', '--local', '--file', file], { cwd: SERVER, stdio: 'inherit' });
process.exit(r.status ?? 1);
