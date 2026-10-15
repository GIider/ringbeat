// Chart generation: parsed RTTTL song -> timed, lane-assigned notes.

export const HOLD_MIN_SEC = 0.45;   // notes at least this long become holds
export const MIN_GAP_SEC = 0.09;    // closer consecutive notes are unplayable; drop the later one
export const LANE_MODE = 'quantile'; // 'quantile' | 'contour' (no UI yet)
const HOLD_TAIL_GAP = 0.05;         // keep a hold's tail this far from the next note in its lane
const MIN_HOLD_SEC = 0.15;          // a hold shortened below this becomes a tap
export const SHORT_HOLD_SEC = 0.2;  // dotted-then-short notes at least this long become short holds
export const PHRASE_REST_BEATS = 1; // a rest this long (in beats) ends a phrase
const PHRASE_MAX_BEATS = 16;        // ...and so does running this long without one (4 bars of 4/4)
const POWER_PERCENTILE = 0.85;      // power notes: phrase peaks at or above this pitch percentile
const LEAP_SEMITONES = 7;           // double notes: a leap at least this big (Hard only)
const DOUBLE_GAP_SEC = 0.1;         // keep the partner lane free this long around a double

const MIN_KEPT = 30;                // below this many playable notes, thin by spacing instead
const MIN_KEPT_FRAC = 0.25;         // ...or below this share of the song's pitched notes

const DIFFICULTY = {
  easy:   { lanes: 3, minDur: 0.18, minGap: 0.35, beatsOrHoldsOnly: true },
  normal: { lanes: 4, minDur: 0.12, minGap: 0.20, shortHolds: true },
  hard:   { lanes: 4, minDur: 0, shortHolds: true, doubles: true },
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

  // Phrases are split by rests of PHRASE_REST_BEATS or more. A dotted note followed by a much shorter one
  // (dotted quarter -> eighth) is a long-short rhythm, which may become a short hold.
  let notes = [], phrase = 0, restBeats = 0, phraseBeat = 0;
  const restPhrases = new Set(); // phrases that start right after a rest (these get the accent)
  song.notes.forEach((n, i) => {
    if (n.isRest) { restBeats += n.durBeat; return; }
    if (notes.length) {
      const afterRest = restBeats >= PHRASE_REST_BEATS;
      if (afterRest || n.startBeat - phraseBeat >= PHRASE_MAX_BEATS) {
        phrase++; phraseBeat = n.startBeat;
        if (afterRest) restPhrases.add(phrase);
      }
    }
    restBeats = 0;
    const next = song.notes[i + 1];
    notes.push({
      time: (n.startBeat - firstBeat) * beatLen,
      duration: n.durBeat * beatLen,
      midi: n.midi,
      onBeat: Number.isInteger(n.startBeat),
      phrase,
      dottedShort: !!(n.dotted && next && !next.isRest && next.durBeat <= n.durBeat / 3 + 1e-9),
    });
  });

  // Difficulty filter
  // Rejected notes are not playable but still sound: the game auto-plays them as backing notes.
  const backing = [];
  const all = notes;
  notes = notes.filter(n => {
    const ok = n.duration >= diff.minDur && !(diff.beatsOrHoldsOnly && !n.onBeat && n.duration < HOLD_MIN_SEC);
    if (!ok) backing.push({ time: n.time, duration: n.duration, midi: n.midi });
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
      if (last && (n.time - last.time < diff.minGap || dup)) {
        backing.push({ time: n.time, duration: n.duration, midi: n.midi });
      } else notes.push(n);
    }
  }
  // Safety rule against unplayable bursts
  const kept = [];
  for (const n of notes) {
    if (kept.length && n.time - kept[kept.length - 1].time < MIN_GAP_SEC) {
      backing.push({ time: n.time, duration: n.duration, midi: n.midi });
      continue;
    }
    kept.push(n);
  }
  backing.sort((a, b) => a.time - b.time);
  if (!kept.length) throw new Error('No playable notes at this difficulty');

  // Lanes are computed from the *remaining* notes so they stay balanced.
  const midis = kept.map(n => n.midi);
  const laneList = LANE_MODE === 'contour' ? assignLanesContour(midis, lanes) : assignLanesQuantile(midis, lanes);

  // Phrase accents (first note after a long rest) and power notes (phrase peaks in the top pitch band).
  const sortedMidi = midis.slice().sort((a, b) => a - b);
  const powerMin = sortedMidi[Math.min(sortedMidi.length - 1, Math.floor(sortedMidi.length * POWER_PERCENTILE))];
  const phraseMin = new Map(), seenPhrase = new Set();
  for (const n of kept) phraseMin.set(n.phrase, Math.min(phraseMin.get(n.phrase) ?? Infinity, n.midi));
  const accent = kept.map(n => {
    const first = !seenPhrase.has(n.phrase) && restPhrases.has(n.phrase);
    seenPhrase.add(n.phrase);
    return first;
  });
  const power = kept.map((n, i) => {
    const prev = kept[i - 1], next = kept[i + 1];
    return n.midi >= powerMin && n.midi > phraseMin.get(n.phrase) &&
      (!prev || prev.phrase !== n.phrase || n.midi > prev.midi) &&
      (!next || next.phrase !== n.phrase || n.midi >= next.midi);
  });

  const nextInLane = new Array(lanes).fill(null);
  const out = new Array(kept.length);
  for (let i = kept.length - 1; i >= 0; i--) { // backwards so we know the next note in each lane
    const n = kept[i], lane = laneList[i];
    let duration = n.duration;
    const long = duration >= HOLD_MIN_SEC;
    let isHold = long || (diff.shortHolds && n.dottedShort && duration >= SHORT_HOLD_SEC);
    if (isHold && nextInLane[lane] !== null) {
      duration = Math.min(duration, nextInLane[lane] - n.time - HOLD_TAIL_GAP);
      if (duration < (long ? MIN_HOLD_SEC : SHORT_HOLD_SEC)) { isHold = false; duration = n.duration; }
    }
    nextInLane[lane] = n.time;
    out[i] = { id: i, time: n.time, duration, lane, midi: n.midi, isHold, hit: false, judged: false,
      phrase: n.phrase, accent: accent[i], power: power[i] };
  }

  // Double notes (Hard): after a leap, the landing note gets an octave-below partner in the neighbouring lane.
  if (diff.doubles) {
    const byLane = Array.from({ length: lanes }, () => []);
    out.forEach(n => byLane[n.lane].push(n));
    const extra = [];
    let lastDouble = -2;
    for (let i = 1; i < kept.length; i++) {
      const n = out[i], prev = kept[i - 1];
      if (Math.abs(n.midi - prev.midi) < LEAP_SEMITONES || i - 1 === lastDouble) continue;
      if (n.time - (prev.time + prev.duration) > 0.05) continue; // only legato leaps
      const free = l => l >= 0 && l < lanes && !byLane[l].some(m =>
        m.time < n.time + DOUBLE_GAP_SEC && m.time + (m.isHold ? m.duration : 0) > n.time - DOUBLE_GAP_SEC);
      const lane = [n.lane - 1, n.lane + 1].find(free);
      if (lane === undefined) continue;
      const partner = { id: 0, time: n.time, duration: Math.min(n.duration, 0.5), lane, midi: n.midi - 12,
        isHold: false, hit: false, judged: false, phrase: n.phrase, accent: false, power: false };
      n.chordLane = lane; // renderer draws a bridge; each note is still judged on its own
      partner.chordLane = n.lane;
      byLane[lane].push(partner);
      extra.push(partner);
      lastDouble = i;
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
