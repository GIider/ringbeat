// Bot players: simulate a human with a given reaction speed / weaknesses on a chart, using the real Game
// logic (headless, no DOM or audio). Used by scripts/bench.mjs to measure song difficulty.
import { Game } from './game.js';

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

const BASE = { sigma: 0, bias: 0, minGap: 0, laneMiss: null, densityPenalty: 0, holdSigma: 0, holdDrop: 0, chordMiss: 0 };

// Skill ladder: timing jitter (ms) and the fastest repeat rate the player's fingers/reactions sustain (ms between presses).
export const LADDER = [
  { name: 'L1', sigma: 90, minGap: 200 },
  { name: 'L2', sigma: 65, minGap: 150 },
  { name: 'L3', sigma: 45, minGap: 115 },
  { name: 'L4', sigma: 30, minGap: 90 },
  { name: 'L5', sigma: 18, minGap: 70 },
  { name: 'L6', sigma: 8, minGap: 50 },
].map(p => ({ ...BASE, ...p, holdSigma: p.sigma * 1.5 }));

const MID = LADDER[2];
// Mid-skill players with one specific weakness; compared against the generalist MID to derive weakness tags.
export const SPECIALISTS = [
  { ...MID, name: 'holds', tag: 'holds', holdSigma: 110, holdDrop: 0.35 },
  { ...MID, name: 'speed', tag: 'speed', minGap: 190, densityPenalty: 0.5 },
  { ...MID, name: 'chords', tag: 'chords', chordMiss: 0.5 },
  { ...MID, name: 'leftLane', tag: 'left lane', laneMiss: { first: 0.4 } },
  { ...MID, name: 'rightLane', tag: 'right lane', laneMiss: { last: 0.4 } },
  { ...MID, name: 'late', tag: 'late', bias: 35 },
];

// Play one chart. The chart is cloned (Game mutates notes). Returns Game.results().
export function runBot(chart, profile, seed = 1) {
  const p = { ...BASE, ...profile };
  const rnd = mulberry32(seed);
  const notes = chart.notes.map(n => ({ ...n }));
  const c = { ...chart, notes };
  const ctx = { currentTime: 0, suspend() {}, resume() {} };
  const synth = { ctx, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} };
  const g = new Game(synth);
  let result = null;
  g.onFinish = r => { result = r; };
  g.start(c, { leadIn: 1, backing: false });

  // Decide when the bot presses / releases each note (song time, seconds).
  const ev = [];
  let lastPress = -Infinity;
  const sorted = notes.slice().sort((a, b) => a.time - b.time);
  const times = sorted.map(n => n.time);
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    if (p.minGap && n.time - lastPress > 1e-6 && (n.time - lastPress) * 1000 < p.minGap) continue; // too fast to keep up
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
    let sigma = p.sigma;
    if (p.densityPenalty) {
      let cnt = 0;
      for (let j = i; j >= 0 && times[j] > n.time - 1; j--) cnt++;
      sigma *= 1 + p.densityPenalty * Math.max(0, cnt - 2) / 4;
    }
    const t = n.time + (p.bias + gauss(rnd) * sigma) / 1000;
    lastPress = n.time;
    if (n.isRoll) { // mash: one press per tick the fingers can keep up with
      let last = -Infinity;
      for (const o of n.ticks) {
        const tt = n.time + o;
        if (p.minGap && (tt - last) * 1000 < p.minGap) continue;
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

// Full difficulty measurement for a chart.
// rating (1..10) = 1 + 9 * (expected number of failed ladder levels / ladder size), i.e. how far up the
// ladder you must climb before a bot full-combos reliably. tags = weaknesses that hurt a mid-skill bot.
export function measureChart(chart, { runs = 30, seed = 1 } = {}) {
  const ladder = LADDER.map(p => measureProfile(chart, p, runs, seed));
  const failed = ladder.reduce((s, m) => s + (1 - m.fcRate), 0);
  const rating = Math.round((1 + 9 * failed / LADDER.length) * 10) / 10;
  const base = measureProfile(chart, MID, runs, seed);
  // Up to two weaknesses that cost a mid-skill bot the most accuracy.
  const tags = SPECIALISTS
    .map(s => ({ tag: s.tag, drop: base.acc - measureProfile(chart, s, runs, seed).acc }))
    .filter(x => x.drop >= 6)
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 2)
    .map(x => x.tag);
  const fc = {};
  LADDER.forEach((p, i) => { fc[p.name] = Math.round(ladder[i].fcRate * 100) / 100; });
  return { rating, fc, tags };
}
