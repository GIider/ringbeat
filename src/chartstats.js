// Per-chart statistics of a library entry (note counts by kind, density, rating) for the chart explorer page. Pure, no DOM.
import { generateChart, HOLD_MIN_SEC } from './chart.js';

// The most notes inside any one-second window; `times` is sorted.
export function peakPerSecond(times) {
  let best = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] > 1) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

// Stats of the song's chart.
export function chartStats(e) {
  const c = generateChart(e.song, { difficulty: e.chart });
  const rolls = c.notes.filter(n => n.isRoll);
  const holds = c.notes.filter(n => n.isHold);
  const chords = k => new Set(c.notes.filter(n => n.chordLanes?.length === k).map(n => n.time)).size; // 1 = doubles, 2 = triples
  return {
    id: e.id, title: e.title, tag: e.tag, category: e.category,
    bpm: Math.round(e.bpm), length: Math.round(c.length), notes: c.notes.length, backing: c.backing.length,
    taps: c.notes.length - holds.length - rolls.length,
    holds: holds.length, shortHolds: holds.filter(n => n.duration < HOLD_MIN_SEC).length,
    rolls: rolls.length, rollTicks: rolls.reduce((s, n) => s + n.ticks.length, 0),
    doubles: chords(1), triples: chords(2),
    nps: Math.round(10 * c.notes.length / Math.max(1, c.length)) / 10, peak: peakPerSecond(c.notes.map(n => n.time)),
    rating: e.rating?.[e.chart] ?? null, stars: e.stars?.[e.chart] ?? 0, tags: e.tags?.[e.chart] ?? [], estimated: !!e.estimated,
    lanes: Array.from({ length: c.lanes }, (_, l) => c.notes.filter(n => n.lane === l).length),
  };
}
