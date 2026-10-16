// First-run tutorial: hand-authored mini-charts played through the normal game loop.

import { ROLL_TAIL_SEC } from './chart.js';
import { t, tn } from './i18n.js';

const BPM = 100;
const LANE_MIDI = [60, 64, 67, 72]; // C E G C — a major arpeggio, one pitch per lane

// notes: [beat, lane, durationInBeats, extras?]; holds are >= 1 beat (0.6 s at 100 BPM, above HOLD_MIN_SEC)
// extras: { roll: n } mash roll of n ticks (an eighth apart), { slide: id, idx } member of a slide chain (follow-ups are forgiving),
//         { double: lane } adds a partner tap in that lane at the same time.
export const STAGES = [
  {
    id: 'tap', title: 'Tap notes',
    text: 'Hit the lane (key or tap) as the note touches the line.',
    notes: [[0, 0, 0.25], [2, 1, 0.25], [4, 2, 0.25], [6, 3, 0.25]],
    maxMiss: 0,
  },
  {
    id: 'timing', title: 'Timing',
    text: 'Closer to the line scores higher: PERFECT, GREAT, GOOD. Too early or late is a MISS.',
    notes: [[0, 1, 0.25], [1, 2, 0.25], [2, 0, 0.25], [3, 3, 0.25], [4, 1, 0.25], [5, 2, 0.25], [6, 0, 0.25], [7, 3, 0.25]],
    maxMiss: 0, minGreatPct: 50,
  },
  {
    id: 'hold', title: 'Hold notes',
    text: 'Long notes have a tail. HOLD the lane until the tail reaches the line, then release.',
    notes: [[0, 0, 2], [3, 3, 2], [6, 1, 3]],
    maxMiss: 0,
  },
  {
    id: 'roll', title: 'Roll notes',
    text: 'A ROLL is a bar of fast ticks. Mash the lane while it passes the line.',
    notes: [[0, 1, 0, { roll: 8 }], [5, 2, 0, { roll: 8 }], [10, 0, 0, { roll: 10 }]],
    maxMiss: 0,
  },
  {
    id: 'slide', title: 'Slides',
    text: 'Notes joined by a dotted line are a SLIDE. Hit the first on time, then sweep along.',
    notes: [
      [0, 0, 0.5, { slide: 1, idx: 0 }], [0.5, 1, 0.5, { slide: 1, idx: 1 }], [1, 2, 0.5, { slide: 1, idx: 2 }], [1.5, 3, 0.5, { slide: 1, idx: 3 }],
      [4, 3, 0.5, { slide: 2, idx: 0 }], [4.5, 2, 0.5, { slide: 2, idx: 1 }], [5, 1, 0.5, { slide: 2, idx: 2 }],
      [8, 0, 0.5, { slide: 3, idx: 0 }], [8.5, 1, 0.5, { slide: 3, idx: 1 }], [9, 2, 0.5, { slide: 3, idx: 2 }],
    ],
    maxMiss: 0,
  },
  {
    id: 'double', title: 'Double notes',
    text: 'Notes joined by a bridge fall together. Hit both lanes at once.',
    notes: [[0, 1, 0.5, { double: 0 }], [2, 2, 0.5, { double: 1 }], [4, 3, 0.5, { double: 2 }], [6, 0, 0.5],
      [7, 2, 0.5, { double: 1 }], [9, 3, 0.5, { double: 2 }]],
    maxMiss: 0,
  },
  {
    id: 'mix', title: 'Combo',
    text: 'Chain hits to build a combo: every 10 raises your multiplier, up to x1.5 at 50. A miss resets it.',
    notes: [[0, 0, 0.5], [1, 1, 0.5], [2, 2, 0.5], [3, 3, 2], [5.5, 2, 0.5], [6.5, 1, 0.5], [7.5, 0, 2],
      [10, 1, 0.5], [11, 2, 0.5], [12, 3, 0.5], [13, 0, 0.5], [14, 1, 2]],
    maxMiss: 0,
  },
];

export function buildStageChart(stage) {
  const beatLen = 60 / BPM;
  const notes = [];
  for (const [beat, lane, dur, x = {}] of stage.notes) {
    const n = {
      id: 0, lane, midi: LANE_MIDI[lane],
      time: beat * beatLen, duration: dur * beatLen,
      isHold: dur >= 1, hit: false, judged: false,
    };
    if (x.slide !== undefined) { n.slide = x.slide; n.slideIdx = x.idx; }
    if (x.roll) {
      n.isRoll = true; n.isHold = false;
      n.ticks = Array.from({ length: x.roll }, (_, k) => k * 0.5 * beatLen);
      n.duration = n.ticks[x.roll - 1] + ROLL_TAIL_SEC;
      n.tickDur = 0.12;
      n.goal = Math.max(3, Math.round(x.roll * 0.6)); // tutorial rolls ask for a bit over half the ticks
      n.rollHits = 0;
    }
    notes.push(n);
    if (x.double !== undefined) {
      n.chordLane = x.double;
      notes.push({ ...n, id: 0, lane: x.double, midi: LANE_MIDI[x.double], chordLane: lane });
    }
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((n, id) => { n.id = id; });
  return {
    notes, lanes: 4, bpm: BPM, beatLen, firstBeat: 0,
    length: Math.max(...notes.map(n => n.time + n.duration)),
  };
}

const greatPct = c => {
  const total = c.perfect + c.great + c.good + c.miss;
  return total ? (100 * (c.perfect + c.great)) / total : 0;
};

// Mastery: few enough misses and (optionally) enough PERFECT/GREAT hits.
export function stagePassed(stage, results) {
  const c = results.counts;
  return c.miss <= stage.maxMiss && greatPct(c) >= (stage.minGreatPct || 0);
}

export function goalText(stage) {
  const parts = [stage.maxMiss === 0 ? t('no misses') : tn(stage.maxMiss, 'at most {n} miss', 'at most {n} misses')];
  if (stage.minGreatPct) parts.push(t('{pct}% PERFECT or GREAT', { pct: stage.minGreatPct }));
  return t('Goal: {parts}', { parts: parts.join(', ') });
}

export function failReason(stage, results) {
  const c = results.counts;
  if (c.miss > stage.maxMiss) return tn(c.miss, '{n} miss', '{n} misses');
  return t('only {pct}% PERFECT or GREAT', { pct: Math.round(greatPct(c)) });
}
