// Measure difficulty of every built-in song with bot players -> src/difficulty.json.
// Usage: npm run bench [-- --runs 30]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SONGS } from '../src/songs.js';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';
import { measureChart } from '../src/bot.js';

const ri = process.argv.indexOf('--runs');
const runs = ri > 0 ? Math.max(1, +process.argv[ri + 1] || 30) : 30;

const out = {};
const rows = [];
for (const s of SONGS) {
  const song = parseRTTTL(s.rtttl);
  const chart = generateChart(song);
  const m = measureChart(chart, { runs, seed: 1 });
  out[s.id] = m;
  rows.push({ song: s.id, notes: chart.notes.length, rating: m.rating, ...m.fc, tags: m.tags.join(',') });
}
console.table(rows);
const file = fileURLToPath(new URL('../src/difficulty.json', import.meta.url));
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', file);
