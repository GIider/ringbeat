// Training helpers: pure transforms of a generated chart. Both return a new chart with cloned notes.

const MIN_HOLD_SEC = 0.15;
const TAIL_GAP = 0.05;

// Keep notes starting in [a, b) (chart seconds) and shift them so `a` becomes time 0.
// Holds crossing `b` are clipped (or become taps when too short). The beat grid offset follows the shift.
export function sliceChart(chart, a, b) {
  const notes = [];
  for (const n of chart.notes) {
    if (n.time < a - 1e-9 || n.time >= b - 1e-9) continue;
    let { duration, isHold } = n;
    if (isHold && n.time + duration > b) {
      duration = b - n.time - TAIL_GAP;
      if (duration < MIN_HOLD_SEC) { isHold = false; duration = n.duration; }
    }
    notes.push({ ...n, id: notes.length, time: n.time - a, duration, isHold,
      hit: false, judged: false });
  }
  if (!notes.length) throw new Error('No notes in the selected section');
  return {
    ...chart,
    notes,
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
    notes: chart.notes.map(n => ({ ...n, time: n.time * k, duration: n.duration * k })),
    length: chart.length * k,
    bpm: chart.bpm * speed,
    beatLen: chart.beatLen * k,
  };
}
