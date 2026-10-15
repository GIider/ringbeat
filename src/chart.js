// Chart generation: parsed RTTTL song -> timed, lane-assigned notes.

export const HOLD_MIN_SEC = 0.45;   // notes at least this long become holds
export const MIN_GAP_SEC = 0.09;    // closer consecutive notes are unplayable; drop the later one
export const LANE_MODE = 'quantile'; // 'quantile' | 'contour' (no UI yet)
const HOLD_TAIL_GAP = 0.05;         // keep a hold's tail this far from the next note in its lane
const MIN_HOLD_SEC = 0.15;          // a hold shortened below this becomes a tap

const DIFFICULTY = {
  easy:   { lanes: 3, minDur: 0.18, beatsOrHoldsOnly: true },
  normal: { lanes: 4, minDur: 0.12 },
  hard:   { lanes: 4, minDur: 0 },
};

// Equal-count quantile split of pitches. Same pitch always maps to the same lane.
export function assignLanesQuantile(midis, lanes) {
  const counts = new Map();
  for (const m of midis) counts.set(m, (counts.get(m) || 0) + 1);
  const uniq = [...counts.keys()].sort((a, b) => a - b);
  const laneOf = new Map();
  if (uniq.length <= lanes) {
    // Fewer pitches than lanes: spread the pitches evenly across the lane set.
    uniq.forEach((p, i) => laneOf.set(p,
      uniq.length === 1 ? Math.floor((lanes - 1) / 2) : Math.round(i * (lanes - 1) / (uniq.length - 1))));
  } else {
    // Place each pitch by the midpoint of its share of the sorted note list.
    let cum = 0;
    for (const p of uniq) {
      const c = counts.get(p);
      laneOf.set(p, Math.min(lanes - 1, Math.floor(((cum + c / 2) / midis.length) * lanes)));
      cum += c;
    }
  }
  return midis.map(m => laneOf.get(m));
}

// Contour mode: same pitch -> same lane, up -> right, down -> left (clamped).
export function assignLanesContour(midis, lanes) {
  let lane = Math.floor((lanes - 1) / 2), prev = null;
  return midis.map(m => {
    if (prev !== null) lane = Math.max(0, Math.min(lanes - 1, lane + Math.sign(m - prev)));
    prev = m;
    return lane;
  });
}

export function generateChart(song, opts = {}) {
  const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  const lanes = opts.lanes || diff.lanes;
  const beatLen = 60 / song.bpm;
  const pitched = song.notes.filter(n => !n.isRest);
  const firstBeat = pitched[0].startBeat; // chart time 0 == first sounding note

  let notes = pitched.map(n => ({
    time: (n.startBeat - firstBeat) * beatLen,
    duration: n.durBeat * beatLen,
    midi: n.midi,
    onBeat: Number.isInteger(n.startBeat),
  }));

  // Difficulty filter
  notes = notes.filter(n => {
    if (n.duration < diff.minDur) return false;
    if (diff.beatsOrHoldsOnly && !n.onBeat && n.duration < HOLD_MIN_SEC) return false;
    return true;
  });
  // Safety rule against unplayable bursts
  const kept = [];
  for (const n of notes) {
    if (kept.length && n.time - kept[kept.length - 1].time < MIN_GAP_SEC) continue;
    kept.push(n);
  }
  if (!kept.length) throw new Error('No playable notes at this difficulty');

  // Lanes are computed from the *remaining* notes so they stay balanced.
  const midis = kept.map(n => n.midi);
  const laneList = LANE_MODE === 'contour' ? assignLanesContour(midis, lanes) : assignLanesQuantile(midis, lanes);

  const nextInLane = new Array(lanes).fill(null);
  const out = new Array(kept.length);
  for (let i = kept.length - 1; i >= 0; i--) { // backwards so we know the next note in each lane
    const n = kept[i], lane = laneList[i];
    let duration = n.duration;
    let isHold = duration >= HOLD_MIN_SEC;
    if (isHold && nextInLane[lane] !== null) {
      duration = Math.min(duration, nextInLane[lane] - n.time - HOLD_TAIL_GAP);
      if (duration < MIN_HOLD_SEC) { isHold = false; duration = n.duration; }
    }
    nextInLane[lane] = n.time;
    out[i] = { id: i, time: n.time, duration, lane, midi: n.midi, isHold, hit: false, judged: false };
  }
  return {
    notes: out,
    lanes,
    length: Math.max(...out.map(n => n.time + n.duration)),
    bpm: song.bpm,
    beatLen,
    firstBeat, // beat-grid offset so ticks stay aligned with the song's beats
  };
}
