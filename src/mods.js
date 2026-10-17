// Modifiers: a small, sticky loadout that makes a song easier or harder (and scales the recorded score).
// Pure logic, no DOM. Mods are applied as chart transforms where possible plus a few Game options.
export const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3];
export const JUDGES = ['lenient', 'off', 'strict'];
const SPEED_MULT = { 0.5: 0.5, 0.6: 0.6, 0.7: 0.7, 0.8: 0.8, 0.9: 0.9, 1: 1, 1.1: 1.1, 1.2: 1.2, 1.3: 1.3 };
const JUDGE_SCALE = { lenient: 1.4, off: 1, strict: 0.7 };
const JUDGE_MULT = { lenient: 0.8, off: 1, strict: 1.15 };
export const HIDDEN_MULT = 1.1;
export const SUDDEN_MULT = 1.2;
export const MULT_MAX = 2;

export const DEFAULT_MODS = Object.freeze({ speed: 1, mirror: false, hidden: false, sudden: false, judge: 'off', demo: false });

// Validate a stored/foreign loadout -> a complete, fresh object (unknown keys and bad values dropped).
export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    speed: SPEEDS.includes(r.speed) ? r.speed : 1,
    mirror: r.mirror === true,
    hidden: r.hidden === true,
    sudden: r.sudden === true,
    judge: JUDGES.includes(r.judge) ? r.judge : 'off',
    demo: r.demo === true,
  };
}

export function isActive(mods) {
  const m = normalize(mods);
  return m.speed !== 1 || m.mirror || m.hidden || m.sudden || m.judge !== 'off' || m.demo;
}

// Combined score multiplier (product of the active mods, capped at ×2).
export function multiplier(mods) {
  const m = normalize(mods);
  if (m.demo) return 0; // autoplay: never scores
  const k = SPEED_MULT[m.speed] * JUDGE_MULT[m.judge] * (m.hidden ? HIDDEN_MULT : 1) * (m.sudden ? SUDDEN_MULT : 1);
  return Math.min(MULT_MAX, Math.round(k * 100) / 100);
}

// Short tags in a stable order, e.g. ['1.2x', 'HD', 'SD'] (stored on score records and shown as chips).
export function tags(mods) {
  const m = normalize(mods), t = [];
  if (m.demo) t.push('DEMO');
  if (m.speed !== 1) t.push(m.speed + 'x');
  if (m.judge === 'lenient') t.push('EZ');
  if (m.judge === 'strict') t.push('ST');
  if (m.mirror) t.push('MR');
  if (m.hidden) t.push('HD');
  if (m.sudden) t.push('SD');
  return t;
}

export function summary(mods) {
  const t = tags(mods);
  return t.length ? t.join(' ') : 'Off';
}

export const multText = mult => '×' + mult.toFixed(2);

// Play at `speed` x. Times shrink by 1/speed; pitch is unchanged (notes are synthesized).
export function scaleChart(chart, speed) {
  if (!(speed > 0)) throw new Error('Invalid speed');
  const k = 1 / speed;
  return {
    ...chart,
    notes: chart.notes.map(n => ({ ...n, time: n.time * k, duration: n.duration * k,
      ...(n.ticks && { ticks: n.ticks.map(o => o * k) }),
      ...(n.tickDur && { tickDur: n.tickDur * k }) })),
    backing: (chart.backing || []).map(n => ({ ...n, time: n.time * k, duration: n.duration * k })),
    length: chart.length * k,
    bpm: chart.bpm * speed,
    beatLen: chart.beatLen * k,
  };
}

// Chart transform. Returns the same chart when nothing applies; otherwise a new chart (notes are cloned).
export function applyChart(chart, mods) {
  const m = normalize(mods);
  let c = chart;
  if (m.speed !== 1) c = scaleChart(c, m.speed);
  if (m.mirror) {
    const last = c.lanes - 1;
    c = {
      ...c,
      notes: c.notes.map(n => ({ ...n, lane: last - n.lane,
        ...(n.chordLane !== undefined && { chordLane: last - n.chordLane }) })),
    };
    // Doubles stay consistent: both notes of a pair point at each other, and the renderer draws the bridge
    // from whichever one now has its partner on the right.
  }
  return c;
}

// Options for Game.start().
export function gameOptions(mods) {
  const m = normalize(mods);
  return { windowScale: JUDGE_SCALE[m.judge], suddenDeath: m.sudden, demo: m.demo };
}
