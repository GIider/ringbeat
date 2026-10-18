// Bot players: simulate a human with a given reaction speed / weaknesses on a chart, using the real Game
// logic (headless, no DOM or audio). Used by scripts/bench.mjs to measure song difficulty.
import { headlessGame } from './replay.js';

// Seeded PRNG so benchmark output is reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const BASE = { sigma: 0, bias: 0, minGap: 0, laneMiss: null, densityPenalty: 0, holdSigma: 0, holdDrop: 0, chordMiss: 0,
  stray: 0, fatigue: 0, rollGap: null };

// Skill ladder: timing jitter (ms) and the fastest repeat rate the player's fingers/reactions sustain (ms between presses).
const geo = (a, b, i, n) => Math.round(a * Math.pow(b / a, i / (n - 1)));
export const LADDER = [
  ...Array.from({ length: 8 }, (_, i) => ({ name: 'L' + (i + 1), sigma: geo(100, 14, i, 8), minGap: geo(220, 45, i, 8) })),
// stray: chance per note of an extra press that matches no note (sloppier players mash more); fatigue: timing
// jitter grows by this share per minute played.
].map(p => ({ ...BASE, ...p, holdSigma: p.sigma * 1.5, stray: 0.006 * p.sigma / 100, fatigue: 0.12 }));

const MID = LADDER[2];
// Mid-skill players with one specific weakness; compared against the generalist MID to derive weakness tags.
export const SPECIALISTS = [
  { ...MID, name: 'holds', tag: 'holds', holdSigma: 110, holdDrop: 0.35 },
  { ...MID, name: 'speed', tag: 'speed', minGap: 190, densityPenalty: 0.5 },
  { ...MID, name: 'doubles', tag: 'doubles', chordMiss: 0.5 },
  { ...MID, name: 'rolls', tag: 'rolls', rollGap: 190 },
  { ...MID, name: 'stamina', tag: 'stamina', fatigue: 0.6 },
  { ...MID, name: 'leftLane', tag: 'left lane', laneMiss: { first: 0.4 } },
  { ...MID, name: 'rightLane', tag: 'right lane', laneMiss: { last: 0.4 } },
];

// Decide when the bot presses / releases each note. Pure and seeded: returns [{ t, type, lane }] sorted by song time.
export function planBot(chart, profile, seed = 1) {
  const p = { ...BASE, ...profile };
  const rnd = mulberry32(seed);
  const c = chart, notes = chart.notes;
  const ev = [];
  let lastPress = -Infinity;
  const lastInLane = new Array(c.lanes).fill(-Infinity);
  const CROSS = 0.55; // alternating lanes (hands) can be played faster than repeating one lane
  const sorted = notes.slice().sort((a, b) => a.time - b.time);
  const times = sorted.map(n => n.time);
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    if (p.minGap && !n.isRoll) { // too fast to keep up: same-lane repeats are the limiter, other lanes get a shorter gap
      const same = (n.time - lastInLane[n.lane]) * 1000, any = (n.time - lastPress) * 1000;
      if (same > 1e-3 && same < p.minGap) continue;
      if (any > 1e-3 && any < p.minGap * CROSS) continue;
    }
    let miss = 0;
    if (p.laneMiss) {
      if (p.laneMiss[n.lane] != null) miss = Math.max(miss, p.laneMiss[n.lane]);
      if (n.lane === 0 && p.laneMiss.first != null) miss = Math.max(miss, p.laneMiss.first);
      if (n.lane === c.lanes - 1 && p.laneMiss.last != null) miss = Math.max(miss, p.laneMiss.last);
    }
    if (p.chordMiss) {
      const near = (i > 0 && sorted[i - 1].lane !== n.lane && n.time - sorted[i - 1].time < 0.1) ||
                   (i + 1 < sorted.length && sorted[i + 1].lane !== n.lane && sorted[i + 1].time - n.time < 0.1);
      if (near) miss = Math.max(miss, p.chordMiss);
    }
    if (miss && rnd() < miss) continue;
    let sigma = p.sigma * (1 + p.fatigue * n.time / 60);
    if (p.densityPenalty) {
      let cnt = 0;
      for (let j = i; j >= 0 && times[j] > n.time - 1; j--) cnt++;
      sigma *= 1 + p.densityPenalty * Math.max(0, cnt - 2) / 4;
    }
    const t = n.time + (p.bias + gauss(rnd) * sigma) / 1000;
    lastPress = n.time;
    lastInLane[n.lane] = n.time;
    // A stray press shortly after this note, in a lane with no note nearby (breaks FC like a real ghost tap).
    if (p.stray && rnd() < p.stray) {
      const lane = Math.floor(rnd() * c.lanes), st = n.time + 0.2 + rnd() * 0.15;
      if (!sorted.some(m => m.lane === lane && st > m.time - 0.25 && st < m.time + m.duration + 0.25)) {
        ev.push({ t: st, type: 'press', lane });
        ev.push({ t: st + 0.04, type: 'release', lane });
      }
    }
    if (n.isRoll) { // mash: one press per tick the fingers can keep up with
      let last = -Infinity;
      for (const o of n.ticks) {
        const tt = n.time + o;
        const rg = p.rollGap ?? p.minGap;
        if (rg && (tt - last) * 1000 < rg) continue;
        last = tt;
        ev.push({ t: tt + (p.bias + gauss(rnd) * p.sigma) / 1000, type: 'press', lane: n.lane });
      }
      continue;
    }
    ev.push({ t, type: 'press', lane: n.lane });
    if (n.isHold) {
      let rt = n.time + n.duration + gauss(rnd) * p.holdSigma / 1000;
      if (p.holdDrop && rnd() < p.holdDrop) rt = n.time + n.duration * (0.3 + 0.5 * rnd());
      // A finger must be lifted before the same lane's next note can be pressed.
      const next = sorted.find(m => m.lane === n.lane && m.time > n.time);
      if (next) rt = Math.min(rt, next.time - 0.1);
      ev.push({ t: Math.max(rt, t + 0.03), type: 'release', lane: n.lane });
    }
  }
  ev.sort((a, b) => a.t - b.t || (a.type === 'release' ? -1 : 1));

  return ev;
}

// Play one chart. The chart is cloned (Game mutates notes). Returns Game.results().
export function runBot(chart, profile, seed = 1) {
  const notes = chart.notes.map(n => ({ ...n }));
  const c = { ...chart, notes };
  const ev = planBot(c, profile, seed);
  const g = headlessGame();
  let result = null;
  g.onFinish = r => { result = r; };
  g.start(c, { leadIn: 1, backing: false });

  const at = t => g.songStart + t;
  for (const e of ev) {
    g.update(e.t);
    if (e.type === 'press') g.press(e.lane, at(e.t));
    else g.release(e.lane, at(e.t));
  }
  for (let t = 0; !result && t < c.length + 3; t += 0.05) g.update(t);
  g.stop();
  return result || g.results();
}

// Run a profile `runs` times -> { fcRate, apRate, acc, grades }.
export function measureProfile(chart, profile, runs = 30, seed = 1) {
  let fc = 0, ap = 0, acc = 0;
  const grades = {};
  for (let r = 0; r < runs; r++) {
    const res = runBot(chart, profile, seed * 7919 + r * 104729 + 13);
    if (res.fc) fc++;
    if (res.ap) ap++;
    acc += res.accuracy;
    grades[res.grade] = (grades[res.grade] || 0) + 1;
  }
  return { fcRate: fc / runs, apRate: ap / runs, acc: acc / runs, grades };
}

// Changing this (or anything that moves ratings, e.g. chart.js, LADDER) means bumping CALC_VERSION below.
const RATING_STRETCH = 1.8;

// Bumped whenever a change to chart.js / bot.js moves ratings; stored ratings of custom songs from an older version are ignored.
export const CALC_VERSION = 2;

// Full difficulty measurement for a chart, as a generator: yields the progress (0..1) after each simulated profile and
// returns the result. measureChart runs it to the end synchronously, measureChartAsync yields to the UI in between.
// rating (1..10) = 1 + 9 * 1.8 * (ladder position where bots start full-combo-ing at least half the time / ladder size).
// nps = notes per second, acc = accuracy of the mid-skill bot. tags = weaknesses that hurt a mid-skill bot.
function* measureSteps(chart, { runs = 30, seed = 1 } = {}) {
  // Weaknesses that cost a mid-skill bot noticeable accuracy. A tag needs the chart to actually contain the
  // feature, and lane tags only count for a lane carrying at least 40 % of the notes.
  const n = chart.notes.length || 1;
  const laneShare = l => chart.notes.filter(x => x.lane === l).length / n;
  const has = {
    holds: chart.notes.some(x => x.isHold), rolls: chart.notes.some(x => x.isRoll),
    doubles: chart.notes.some(x => x.chordLanes),
    speed: chart.length > 0 && n / chart.length >= 2.5, stamina: chart.length >= 60,
    'left lane': laneShare(0) >= 0.4, 'right lane': laneShare(chart.lanes - 1) >= 0.4,
  };
  const specialists = SPECIALISTS.filter(s => has[s.tag]);
  const total = LADDER.length + 1 + specialists.length;
  let done = 0;
  const ladder = [];
  for (const p of LADDER) { ladder.push(measureProfile(chart, p, runs, seed)); yield ++done / total; }
  // Skill needed = where the FC rate crosses 50 % along the ladder (linear interpolation, 0 = below L1, N = above the top).
  let x = LADDER.length;
  for (let i = 0; i < ladder.length; i++) {
    if (ladder[i].fcRate >= 0.5) {
      const prev = i ? ladder[i - 1].fcRate : 0;
      x = i + (i ? (0.5 - prev) / (ladder[i].fcRate - prev) - 1 : 0) + (i ? 0 : 0);
      break;
    }
  }
  // The catalogue's hardest charts need about 5/9 of the ladder, so stretch that range to fill 1..10.
  const rating = Math.min(10, Math.round((1 + 9 * RATING_STRETCH * x / LADDER.length) * 10) / 10);
  const base = measureProfile(chart, MID, runs, seed);
  yield ++done / total;
  const drops = [];
  for (const s of specialists) { drops.push({ tag: s.tag, drop: base.acc - measureProfile(chart, s, runs, seed).acc }); yield ++done / total; }
  const tags = drops
    .filter(x => x.drop >= 5)
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 2)
    .map(x => x.tag);
  const fc = {};
  LADDER.forEach((p, i) => { fc[p.name] = Math.round(ladder[i].fcRate * 100) / 100; });
  return { rating, fc, tags, nps: Math.round(10 * n / Math.max(1, chart.length)) / 10,
    acc: Math.round(base.acc * 10) / 10 };
}

export function measureChart(chart, opts) {
  const it = measureSteps(chart, opts);
  for (let r = it.next(); ; r = it.next()) if (r.done) return r.value;
}

// Same result as measureChart, but hands the thread back between simulated profiles and reports progress (0..1).
// `isCancelled` is polled between steps; a cancelled measurement resolves to null.
export async function measureChartAsync(chart, opts, onProgress = () => {}, isCancelled = () => false) {
  const it = measureSteps(chart, opts);
  for (let r = it.next(); ; r = it.next()) {
    if (r.done) return r.value;
    onProgress(r.value);
    await new Promise(res => setTimeout(res, 0));
    if (isCancelled()) return null;
  }
}
