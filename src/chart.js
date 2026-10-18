// Chart generation: parsed RTTTL song -> timed, lane-assigned notes.

export const HOLD_MIN_SEC = 0.45;   // notes at least this long become holds
export const MIN_GAP_SEC = 0.09;    // closer consecutive notes are unplayable; drop the later one
export const LANE_MODE = 'quantile'; // 'quantile' | 'contour' (no UI yet)
const HOLD_TAIL_GAP = 0.05;         // keep a hold's tail this far from the next note in its lane
const MIN_HOLD_SEC = 0.15;          // a hold shortened below this becomes a tap
export const SHORT_HOLD_SEC = 0.2;  // dotted-then-short notes at least this long become short holds
const LEAP_SEMITONES = 7;           // double notes: a leap at least this big (Hard only)
const TRIPLE_GAP_SEC = 0.25;        // the other lanes must be free this long around a triple
const TRIPLE_SPACING_SEC = 4;       // at most one triple per this many seconds
const DOUBLE_GAP_SEC = 0.1;         // keep the partner lane free this long around a double
export const ROLL_MIN_NOTES = 4;    // a run of this many same-pitch notes...
export const ROLL_MAX_SPACING = 0.26; // ...each starting within this many seconds of the last becomes a roll
export const ROLL_TAIL_SEC = 0.05;  // presses are accepted this long after the last tick
export const ROLL_MAX_HZ = 9;       // the press rate a roll can ask for (goal = span * this, at most one per tick)

const MIN_KEPT = 30;                // below this many playable notes, thin by spacing instead
const MIN_KEPT_FRAC = 0.25;         // ...or below this share of the song's pitched notes

const DIFFICULTY = {
  normal: { lanes: 4, minDur: 0.12, minGap: 0.20, shortHolds: true },
  hard:   { lanes: 4, minDur: 0, minGap: 0.11, shortHolds: true, doubles: true },
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

// How many notes the two charts do not share (time, lane, type and duration all equal counts as shared). Triples
// are left out: every Hard chart has some, and they alone should not make a song play at two difficulties.
export function chartDistance(a, b) {
  const key = n => `${n.time.toFixed(3)}|${n.lane}|${n.type || ''}|${n.duration.toFixed(3)}`;
  const keys = c => new Set(c.notes.filter(n => n.chordLanes?.length !== 2).map(key));
  const A = keys(a), B = keys(b);
  let common = 0;
  for (const k of A) if (B.has(k)) common++;
  return (A.size - common) + (B.size - common);
}

export function generateChart(song, opts = {}) {
  const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  const lanes = opts.lanes || diff.lanes;
  const beatLen = 60 / song.bpm;
  const pitched = song.notes.filter(n => !n.isRest);
  const firstBeat = pitched[0].startBeat; // chart time 0 == first sounding note

  // A dotted note followed by a much shorter one (dotted quarter -> eighth) is a long-short rhythm,
  // which may become a short hold.
  let notes = [];
  song.notes.forEach((n, i) => {
    if (n.isRest) return;
    const next = song.notes[i + 1];
    notes.push({
      time: (n.startBeat - firstBeat) * beatLen,
      duration: n.durBeat * beatLen,
      midi: n.midi,
      onBeat: Number.isInteger(n.startBeat),
      dottedShort: !!(n.dotted && next && !next.isRest && next.durBeat <= n.durBeat / 3 + 1e-9),
    });
  });

  // Rolls: runs of legato same-pitch notes at a fast pace become one lane-long "mash" note. `ticks` holds the
  // member start offsets (seconds from the roll's time); the roll is scored by how many of them the player keeps up with.
  {
    const merged = [];
    for (let i = 0; i < notes.length;) {
      let j = i + 1;
      while (j < notes.length && notes[j].midi === notes[j - 1].midi &&
             notes[j].time - notes[j - 1].time <= ROLL_MAX_SPACING &&
             notes[j].time - (notes[j - 1].time + notes[j - 1].duration) < 0.03) j++;
      if (j - i >= ROLL_MIN_NOTES) {
        const first = notes[i], ticks = notes.slice(i, j).map(m => m.time - first.time);
        const span = ticks[ticks.length - 1];
        merged.push({ ...first, duration: span + ROLL_TAIL_SEC, dottedShort: false, ticks,
          tickDur: Math.min(0.12, first.duration), goal: Math.max(3, Math.min(ticks.length, Math.round((span + 0.1) * ROLL_MAX_HZ))) });
      } else merged.push(...notes.slice(i, j));
      i = j;
    }
    notes = merged;
  }

  // Difficulty filter
  // Rejected notes are not playable but still sound: the game auto-plays them as backing notes.
  const backing = [];
  const addBacking = n => {
    if (n.ticks) n.ticks.forEach(o => backing.push({ time: n.time + o, duration: n.tickDur, midi: n.midi }));
    else backing.push({ time: n.time, duration: n.duration, midi: n.midi });
  };
  const all = notes;
  notes = notes.filter(n => {
    const ok = n.ticks || (n.duration >= diff.minDur);
    if (!ok) addBacking(n);
    return ok;
  });
  // Fast songs (mostly 16ths) would lose nearly everything to the duration cutoff.
  // Fall back to thinning by spacing, and collapse immediate same-pitch repeats.
  if (diff.minGap && notes.length < Math.max(MIN_KEPT, all.length * MIN_KEPT_FRAC)) {
    backing.length = 0;
    notes = [];
    for (const n of all) {
      const last = notes[notes.length - 1];
      const dup = last && last.midi === n.midi && n.time - last.time < diff.minGap;
      if (last && !n.ticks && (n.time - last.time < diff.minGap || dup)) addBacking(n);
      else notes.push(n);
    }
  }
  // Safety rule against unplayable bursts
  const kept = [];
  for (const n of notes) {
    if (kept.length && n.time - kept[kept.length - 1].time < MIN_GAP_SEC) {
      addBacking(n);
      continue;
    }
    kept.push(n);
  }
  backing.sort((a, b) => a.time - b.time);
  if (!kept.length) throw new Error('No playable notes at this difficulty');

  // Lanes are computed from the *remaining* notes so they stay balanced.
  const midis = kept.map(n => n.midi);
  const laneList = LANE_MODE === 'contour' ? assignLanesContour(midis, lanes) : assignLanesQuantile(midis, lanes);

  const nextInLane = new Array(lanes).fill(null);
  const out = new Array(kept.length);
  for (let i = kept.length - 1; i >= 0; i--) { // backwards so we know the next note in each lane
    const n = kept[i], lane = laneList[i];
    let duration = n.duration;
    const long = !n.ticks && duration >= HOLD_MIN_SEC;
    let isHold = !n.ticks && (long || (diff.shortHolds && n.dottedShort && duration >= SHORT_HOLD_SEC));
    if (isHold && nextInLane[lane] !== null) {
      duration = Math.min(duration, nextInLane[lane] - n.time - HOLD_TAIL_GAP);
      if (duration < (long ? MIN_HOLD_SEC : SHORT_HOLD_SEC)) { isHold = false; duration = n.duration; }
    }
    nextInLane[lane] = n.time;
    out[i] = { id: i, time: n.time, duration, lane, midi: n.midi, isHold, hit: false, judged: false };
    if (n.ticks) Object.assign(out[i], { isRoll: true, ticks: n.ticks, goal: n.goal, rollHits: 0 });
  }

  // Double notes (Hard): after a leap, the landing note gets a silent partner in the neighbouring lane.
  if (diff.doubles) {
    const byLane = Array.from({ length: lanes }, () => []);
    out.forEach(n => byLane[n.lane].push(n));
    const extra = [];
    let lastDouble = -2;
    for (let i = 1; i < kept.length; i++) {
      const n = out[i], prev = kept[i - 1];
      if (n.isRoll || out[i - 1].isRoll || Math.abs(n.midi - prev.midi) < LEAP_SEMITONES || i - 1 === lastDouble) continue;
      if (n.time - (prev.time + prev.duration) > 0.05) continue; // only legato leaps
      const free = l => l >= 0 && l < lanes && !byLane[l].some(m =>
        m.time < n.time + DOUBLE_GAP_SEC && m.time + (m.isHold || m.isRoll ? m.duration : 0) > n.time - DOUBLE_GAP_SEC);
      const lane = [n.lane - 1, n.lane + 1].find(free);
      if (lane === undefined) continue;
      const partner = { id: 0, time: n.time, duration: Math.min(n.duration, 0.5), lane, midi: n.midi, silent: true,
        isHold: false, hit: false, judged: false };
      n.chordLanes = [lane]; // renderer draws a bridge; each note is still judged on its own
      partner.chordLanes = [n.lane];
      byLane[lane].push(partner);
      extra.push(partner);
      lastDouble = i;
    }
    // Triples: a strong note (downbeat or long tap) with two more free lanes gets two silent partners, at most one
    // per TRIPLE_SPACING_SEC. Everything is a plain tap judged on its own, like a double.
    let lastTriple = -Infinity;
    for (const n of out) {
      if (n.isRoll || n.isHold || n.chordLanes || n.time - lastTriple < TRIPLE_SPACING_SEC) continue;
      const beats = n.time / beatLen + firstBeat; // position on the song's beat grid
      if (!(Math.abs(beats / 4 - Math.round(beats / 4)) * 4 < 0.05 || n.duration >= HOLD_MIN_SEC)) continue;
      const free = [];
      for (let l = 0; l < lanes; l++) {
        if (l !== n.lane && !byLane[l].some(m => { const tail = m.isHold || m.isRoll ? m.duration : 0;
          return m.time < n.time + TRIPLE_GAP_SEC + tail && m.time + tail > n.time - TRIPLE_GAP_SEC; })) free.push(l);
      }
      if (free.length < 2) continue;
      free.sort((x, y) => Math.abs(x - n.lane) - Math.abs(y - n.lane) || x - y); // the two nearest lanes
      const set = free.slice(0, 2).sort((x, y) => x - y);
      const all = [n.lane, ...set].sort((x, y) => x - y);
      n.chordLanes = set;
      set.forEach(l => {
        const partner = { id: 0, time: n.time, duration: Math.min(n.duration, 0.5), lane: l, midi: n.midi, silent: true,
          isHold: false, hit: false, judged: false, chordLanes: all.filter(x => x !== l) };
        byLane[l].push(partner);
        extra.push(partner);
      });
      lastTriple = n.time;
    }
    if (extra.length) {
      out.push(...extra);
      out.sort((a, b) => a.time - b.time || a.lane - b.lane);
      out.forEach((n, i) => { n.id = i; });
    }
  }
  return {
    notes: out,
    backing,
    lanes,
    length: out.reduce((m, n) => Math.max(m, n.time + n.duration), 0),
    bpm: song.bpm,
    beatLen,
    firstBeat, // beat-grid offset so ticks stay aligned with the song's beats
  };
}
