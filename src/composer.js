// Nokia-Composer style note editor: pure state + operations, no DOM. Serialises to / from RTTTL.
import { parseRTTTL } from './rtttl.js';

export const DURATIONS = [1, 2, 4, 8, 16, 32];
export const MAX_NOTES = 1100; // worst-case token "32c#.7," is 7 chars, so 1100 notes + header stays under MAX_RTTTL (8000)
export const KEY_NOTES = { 1: 'c', 2: 'd', 3: 'e', 4: 'f', 5: 'g', 6: 'a', 7: 'b' };
export const REPEAT_MS = 600; // pressing the same key again within this window cycles the octave of that note
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

export const cleanName = s => String(s || '').replace(/[:,\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);

export function create() {
  return { name: '', bpm: 120, notes: [], cursor: 0, pen: { dur: 4, oct: 5 }, last: { key: '', at: 0 } };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const prev = s => (s.cursor > 0 ? s.notes[s.cursor - 1] : null);

function insert(s, note) {
  if (s.notes.length >= MAX_NOTES) return false;
  s.notes.splice(s.cursor, 0, note);
  s.cursor++;
  return true;
}

// Keypad press: 1..7 notes, 0 rest. Repeating the same key quickly re-pitches the note just entered (octave 4..7).
export function pressNote(s, key, now = 0) {
  const k = String(key);
  const same = s.last.key === k && now - s.last.at <= REPEAT_MS && prev(s);
  s.last = { key: k, at: now };
  if (same) {
    const n = prev(s);
    if (n.p !== 'p') { n.oct = n.oct >= 7 ? 4 : n.oct + 1; s.pen.oct = n.oct; }
    return true;
  }
  if (k === '0') return insert(s, { p: 'p', sharp: false, dur: s.pen.dur, dotted: false, oct: s.pen.oct });
  const p = KEY_NOTES[k];
  if (!p) return false;
  return insert(s, { p, sharp: false, dur: s.pen.dur, dotted: false, oct: s.pen.oct });
}

// Modifiers act on the note before the cursor (and become the default for the next ones).
export function toggleSharp(s) {
  const n = prev(s);
  if (!n || n.p === 'p' || n.p === 'e' || n.p === 'b') return false; // no e#/b# in RTTTL
  n.sharp = !n.sharp; return true;
}
export function toggleDot(s) { const n = prev(s); if (!n) return false; n.dotted = !n.dotted; return true; }
export function changeDur(s, dir) {
  const n = prev(s);
  const cur = n ? n.dur : s.pen.dur;
  const i = clamp(DURATIONS.indexOf(cur) + (dir > 0 ? 1 : -1), 0, DURATIONS.length - 1);
  s.pen.dur = DURATIONS[i];
  if (n) n.dur = DURATIONS[i];
  return DURATIONS[i];
}
export function changeOct(s, dir) {
  const n = prev(s);
  const cur = n && n.p !== 'p' ? n.oct : s.pen.oct;
  const o = clamp(cur + (dir > 0 ? 1 : -1), 4, 7);
  s.pen.oct = o;
  if (n && n.p !== 'p') n.oct = o;
  return o;
}
export function changeBpm(s, dir) { s.bpm = clamp(s.bpm + (dir > 0 ? 5 : -5), 40, 250); return s.bpm; }

export function move(s, dir) { s.cursor = clamp(s.cursor + (dir > 0 ? 1 : -1), 0, s.notes.length); return s.cursor; }
export function backspace(s) { if (s.cursor === 0) return false; s.notes.splice(s.cursor - 1, 1); s.cursor--; s.last = { key: '', at: 0 }; return true; }
export function clear(s) { s.notes = []; s.cursor = 0; s.last = { key: '', at: 0 }; }

export function noteLabel(n) { return n.p === 'p' ? 'rest' : (n.p + (n.sharp ? '#' : '')).toUpperCase() + n.oct; }
export function midiOf(n) {
  if (n.p === 'p') return 0;
  return 12 * (n.oct + 1) + NAMES.indexOf(n.p + (n.sharp ? '#' : ''));
}

export function toRTTTL(s) {
  const toks = s.notes.map(n => n.p === 'p'
    ? `${n.dur}p${n.dotted ? '.' : ''}`
    : `${n.dur}${n.p}${n.sharp ? '#' : ''}${n.dotted ? '.' : ''}${n.oct}`);
  return `${cleanName(s.name)}:d=4,o=5,b=${s.bpm}:${toks.join(',')}`;
}

// Returns a composer state, or throws like parseRTTTL.
export function fromRTTTL(text) {
  const song = parseRTTTL(text);
  const s = create();
  s.name = cleanName(song.name);
  s.bpm = clamp(Math.round(song.bpm / 5) * 5, 40, 250);
  for (const n of song.notes.slice(0, MAX_NOTES)) {
    let dur = 4, dotted = false;
    for (const d of DURATIONS) {
      if (Math.abs(4 / d - n.durBeat) < 1e-6) { dur = d; dotted = false; break; }
      if (Math.abs(4 / d * 1.5 - n.durBeat) < 1e-6) { dur = d; dotted = true; break; }
    }
    if (n.isRest) { s.notes.push({ p: 'p', sharp: false, dur, dotted, oct: 5 }); continue; }
    const name = NAMES[n.midi % 12];
    s.notes.push({ p: name[0], sharp: name.length > 1, dur, dotted, oct: Math.floor(n.midi / 12) - 1 });
  }
  s.cursor = s.notes.length;
  return s;
}

// Scroll-key / d-pad pitch: moves the note before the cursor one scale step (c d e f g a b, crossing octaves).
export function stepPitch(s, dir) {
  const n = prev(s);
  if (!n || n.p === 'p') return false;
  let i = 'cdefgab'.indexOf(n.p) + (dir > 0 ? 1 : -1), o = n.oct;
  if (i > 6) { i = 0; o++; } else if (i < 0) { i = 6; o--; }
  if (o < 4 || o > 7) return false;
  n.p = 'cdefgab'[i]; n.oct = o; s.pen.oct = o;
  if (n.p === 'e' || n.p === 'b') n.sharp = false;
  return true;
}

// Controller fallback: append a copy of the previous note (or a plain pen note) to be tuned with stepPitch.
export function addNote(s) {
  const n = prev(s);
  const base = n && n.p !== 'p' ? { ...n } : { p: 'c', sharp: false, dur: s.pen.dur, dotted: false, oct: s.pen.oct };
  return insert(s, base);
}
export function addRest(s) { return insert(s, { p: 'p', sharp: false, dur: s.pen.dur, dotted: false, oct: s.pen.oct }); }
