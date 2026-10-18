// First-run tutorial: hand-authored mini-charts played through the normal game loop.

import { ROLL_TAIL_SEC } from './chart.js';

const BPM = 100;
const LANE_MIDI = [60, 64, 67, 72]; // C E G C — a major arpeggio, one pitch per lane

// notes: [beat, lane, durationInBeats, extras?]; holds are >= 1 beat (0.6 s at 100 BPM, above HOLD_MIN_SEC)
// extras: { roll: n } mash roll of n ticks (an eighth apart), { chord: [lane, ...] } adds partner taps in those lanes at the same time.
export const STAGES = [
  {
    id: 'tap', title: 'Tap notes', demo: ['tap'],
    text: 'Hit the lane as the note touches the line. Closer scores higher: PERFECT, GREAT, GOOD. Too early or late is a MISS.',
    notes: [[0, 0, 0.25], [2, 1, 0.25], [4, 2, 0.25], [6, 3, 0.25],
      [8, 1, 0.25], [9, 2, 0.25], [10, 0, 0.25], [11, 3, 0.25]],
  },
  {
    id: 'hold', title: 'Hold notes', demo: ['hold'],
    text: 'Long notes have a tail. HOLD the lane until the tail reaches the line, then release.',
    notes: [[0, 0, 2], [3, 3, 2], [6, 1, 3]],
  },
  {
    id: 'roll', title: 'Roll notes', demo: ['roll'],
    text: 'A ROLL is a bar of fast ticks. Mash the lane while it passes the line.',
    notes: [[0, 1, 0, { roll: 8 }], [5, 2, 0, { roll: 8 }], [10, 0, 0, { roll: 10 }]],
  },
  {
    id: 'chain', title: 'Doubles and triples', demo: ['double', 'triple'],
    text: 'Notes joined by a bridge fall together: hit all their lanes at once.',
    notes: [
      [0, 1, 0.5, { chord: [0] }], [1.5, 2, 0.5, { chord: [1] }], [3, 3, 0.5, { chord: [2] }],
      [5, 1, 0.5, { chord: [0, 2] }], [7, 2, 0.5, { chord: [1, 3] }],
    ],
  },
];

// Tiny lane diagrams for the lesson cards: four faint lanes, a hit line, and the note shape being taught.
const LANE_X = [10, 26, 42, 58];
const note = (lane, y, w = 10) => `<rect x="${LANE_X[lane] - w / 2}" y="${y}" width="${w}" height="5"/>`;
const DEMOS = {
  tap: () => note(0, 8) + note(2, 18) + note(1, 28),
  hold: () => `<rect x="${LANE_X[1] - 2}" y="4" width="4" height="22" opacity=".5"/>` + note(1, 26),
  roll: () => `<rect x="${LANE_X[2] - 6}" y="6" width="12" height="22" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    [9, 13, 17, 21, 25].map(y => `<rect x="${LANE_X[2] - 3}" y="${y}" width="6" height="2"/>`).join(''),
  double: () => `<rect x="${LANE_X[1]}" y="14" width="${LANE_X[2] - LANE_X[1]}" height="2" opacity=".6"/>` + note(1, 12) + note(2, 12),
  triple: () => `<rect x="${LANE_X[0]}" y="14" width="${LANE_X[2] - LANE_X[0]}" height="2" opacity=".6"/>` + note(0, 12) + note(1, 12) + note(2, 12),
};
export function stageDemoHTML(stage) {
  if (!stage.demo) return '';
  const svg = d => `<svg viewBox="0 0 68 38" aria-hidden="true" fill="currentColor">` +
    LANE_X.map(x => `<rect x="${x - 0.5}" y="0" width="1" height="38" opacity=".2"/>`).join('') +
    `<rect x="0" y="33" width="68" height="1.5" opacity=".7"/>${DEMOS[d]()}</svg>`;
  return `<div class="tut-demo">${stage.demo.map(svg).join('')}</div>`;
}

export function buildStageChart(stage) {
  const beatLen = 60 / BPM;
  const notes = [];
  for (const [beat, lane, dur, x = {}] of stage.notes) {
    const n = {
      id: 0, lane, midi: LANE_MIDI[lane],
      time: beat * beatLen, duration: dur * beatLen,
      isHold: dur >= 1, hit: false, judged: false,
    };
    if (x.roll) {
      n.isRoll = true; n.isHold = false;
      n.ticks = Array.from({ length: x.roll }, (_, k) => k * 0.5 * beatLen);
      n.duration = n.ticks[x.roll - 1] + ROLL_TAIL_SEC;
      n.tickDur = 0.12;
      n.goal = Math.max(3, Math.round(x.roll * 0.6)); // tutorial rolls ask for a bit over half the ticks
      n.rollHits = 0;
    }
    notes.push(n);
    if (x.chord) {
      const all = [lane, ...x.chord].sort((p, q) => p - q);
      n.chordLanes = all.filter(l => l !== lane);
      for (const l of x.chord) notes.push({ ...n, id: 0, lane: l, midi: LANE_MIDI[l], chordLanes: all.filter(m => m !== l) });
    }
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((n, id) => { n.id = id; });
  return {
    notes, lanes: 4, bpm: BPM, beatLen, firstBeat: 0,
    length: Math.max(...notes.map(n => n.time + n.duration)),
  };
}
