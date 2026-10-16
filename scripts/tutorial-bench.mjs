// Measures each tutorial lesson: play time, note density, and how bots of different skill fare (avg misses / PERFECT+GREAT share).
// Usage: npm run bench:tutorial [-- --runs 200]
import { STAGES, buildStageChart } from '../src/tutorial.js';
import { LADDER, runBot } from '../src/bot.js';

const ri = process.argv.indexOf('--runs');
const runs = ri > 0 ? Math.max(1, +process.argv[ri + 1] || 200) : 200;
const LEAD_IN = 1.5, END_PADDING = 0.6; // as in main.js startRun / game.js
const PLAYERS = [0, 2, 4, 6].map(i => LADDER[i]); // beginner .. good

const rows = [];
let total = 0;
for (const st of STAGES) {
  const chart = buildStageChart(st);
  const hits = chart.notes.length;
  const secs = LEAD_IN + chart.length + END_PADDING;
  total += secs;
  const row = { lesson: st.id, notes: hits, 'sec': +secs.toFixed(1), 'notes/s': +(hits / chart.length).toFixed(2) };
  for (const p of PLAYERS) {
    let miss = 0, good = 0;
    for (let r = 0; r < runs; r++) {
      const c = runBot(chart, p, 7919 + r * 104729 + 13).counts;
      miss += c.miss;
      good += c.perfect + c.great;
    }
    row[p.name + ' miss'] = +(miss / runs).toFixed(1);
    row[p.name + ' P/G%'] = Math.round(100 * good / (runs * hits));
  }
  rows.push(row);
}
console.table(rows);
console.log(`all lessons, one run each: ${total.toFixed(0)} s (play time only, cards excluded)`);
console.log(`(${runs} bot runs per cell; ${PLAYERS.map(p => `${p.name} = ${p.sigma} ms jitter`).join(', ')}; miss = avg misses per run)`);
