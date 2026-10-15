// First-run tutorial: hand-authored mini-charts played through the normal game loop.

const BPM = 100;
const LANE_MIDI = [60, 64, 67, 72]; // C E G C — a major arpeggio, one pitch per lane

// notes: [beat, lane, durationInBeats]; holds are >= 1 beat (0.6 s at 100 BPM, above HOLD_MIN_SEC)
export const STAGES = [
  {
    id: 'tap', title: 'Tap notes',
    text: 'A note falls toward the glowing line. Press its lane key just as it touches the line.',
    notes: [[0, 0, 0.25], [2, 1, 0.25], [4, 2, 0.25], [6, 3, 0.25]],
    maxMiss: 0,
  },
  {
    id: 'timing', title: 'Timing',
    text: 'The closer to the line, the better: PERFECT, GREAT, GOOD. Too early or late is a MISS. The meter at the bottom shows if you are early (left) or late (right).',
    notes: [[0, 1, 0.25], [1, 2, 0.25], [2, 0, 0.25], [3, 3, 0.25], [4, 1, 0.25], [5, 2, 0.25], [6, 0, 0.25], [7, 3, 0.25]],
    maxMiss: 0, minGreatPct: 50,
  },
  {
    id: 'hold', title: 'Hold notes',
    text: 'Long notes have a tail. Press and HOLD the key until the tail reaches the line, then release.',
    notes: [[0, 0, 2], [3, 3, 2], [6, 1, 3]],
    maxMiss: 0,
  },
  {
    id: 'mix', title: 'Combo',
    text: 'Chain hits to build a combo — every 10 raises your score multiplier. A miss resets it. Esc / Start pauses, R restarts.',
    notes: [[0, 0, 0.5], [1, 1, 0.5], [2, 2, 0.5], [3, 3, 2], [5.5, 2, 0.5], [6.5, 1, 0.5], [7.5, 0, 2],
      [10, 1, 0.5], [11, 2, 0.5], [12, 3, 0.5], [13, 0, 0.5], [14, 1, 2]],
    maxMiss: 0,
  },
];

export function buildStageChart(stage) {
  const beatLen = 60 / BPM;
  const notes = stage.notes.map(([beat, lane, dur], id) => ({
    id, lane, midi: LANE_MIDI[lane],
    time: beat * beatLen, duration: dur * beatLen,
    isHold: dur >= 1, hit: false, judged: false,
  }));
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
  const parts = [stage.maxMiss === 0 ? 'no misses' : `at most ${stage.maxMiss} miss${stage.maxMiss > 1 ? 'es' : ''}`];
  if (stage.minGreatPct) parts.push(`${stage.minGreatPct}% PERFECT or GREAT`);
  return 'Goal: ' + parts.join(', ');
}

export function failReason(stage, results) {
  const c = results.counts;
  if (c.miss > stage.maxMiss) return `${c.miss} miss${c.miss > 1 ? 'es' : ''}`;
  return `only ${Math.round(greatPct(c))}% PERFECT or GREAT`;
}
