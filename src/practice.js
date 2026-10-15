// Training helpers: pure transforms of a generated chart. Both return a new chart with cloned notes.

const MIN_HOLD_SEC = 0.15;
const TAIL_GAP = 0.05;
const MIN_ROLL_TICKS = 3;
const ROLL_TAIL_SEC = 0.05;

// Keep notes starting in [a, b) (chart seconds) and shift them so `a` becomes time 0.
// Holds crossing `b` are clipped (or become taps when too short). The beat grid offset follows the shift.
export function sliceChart(chart, a, b) {
  const bEnd = b;
  const notes = [];
  for (const n of chart.notes) {
    if (n.time < a - 1e-9 || n.time >= b - 1e-9) continue;
    let { duration, isHold, isRoll, ticks, goal } = n;
    if (isHold && n.time + duration > b) {
      duration = b - n.time - TAIL_GAP;
      if (duration < MIN_HOLD_SEC) { isHold = false; duration = n.duration; }
    }
    if (isRoll && n.time + duration > b) { // keep the ticks that fit; too few left -> a plain tap
      ticks = ticks.filter(o => n.time + o < b - TAIL_GAP);
      if (ticks.length >= MIN_ROLL_TICKS) {
        duration = ticks[ticks.length - 1] + ROLL_TAIL_SEC;
        goal = Math.min(goal, ticks.length);
      } else { isRoll = false; ticks = undefined; goal = undefined; duration = 0.12; }
    }
    notes.push({ ...n, id: notes.length, time: n.time - a, duration, isHold, isRoll, ticks, goal,
      hit: false, judged: false });
  }
  if (!notes.length) throw new Error('No notes in the selected section');
  const backing = (chart.backing || [])
    .filter(b => b.time >= a - 1e-9 && b.time < bEnd - 1e-9)
    .map(b => ({ ...b, time: b.time - a }));
  return {
    ...chart,
    notes,
    backing,
    length: Math.max(...notes.map(n => n.time + n.duration)),
    firstBeat: chart.firstBeat + a / chart.beatLen,
  };
}

// Play at `speed` x (0.5 = half speed). Times shrink by 1/speed; pitch is unchanged (notes are synthesized).
export function scaleChart(chart, speed) {
  if (!(speed > 0)) throw new Error('Invalid speed');
  const k = 1 / speed;
  return {
    ...chart,
    notes: chart.notes.map(n => ({ ...n, time: n.time * k, duration: n.duration * k,
      ...(n.ticks && { ticks: n.ticks.map(o => o * k) }) })),
    backing: (chart.backing || []).map(n => ({ ...n, time: n.time * k, duration: n.duration * k })),
    length: chart.length * k,
    bpm: chart.bpm * speed,
    beatLen: chart.beatLen * k,
  };
}
