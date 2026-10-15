// Song library: built-in songs plus the user's custom (pasted / shared) song, with derived metadata.
import { parseRTTTL } from './rtttl.js';
import { generateChart } from './chart.js';
import { SONGS } from './songs.js';

export const DIFFICULTIES = ['easy', 'normal', 'hard'];

// Bot-measured difficulty ({songId: {diff: {rating, tags}}}, from scripts/bench.mjs); set once at startup.
let measured = {};
export function setMeasured(data) { measured = data && typeof data === 'object' ? data : {}; }
// Stars 1..5 from a bot rating 1..10.
const starsFromRating = r => Math.max(1, Math.min(5, Math.round(r / 1.4)));

// Difficulty rating 1..5 from the chart's note density (notes per second).
export function starsFor(chart) {
  const density = chart.notes.length / Math.max(1, chart.length);
  return Math.max(1, Math.min(5, Math.round(0.8 + density * 0.9)));
}

// Small stable string hash -> base36 (ids for custom songs, so scores follow the melody).
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Build a library entry; returns null if the RTTTL cannot be parsed or charted.
export function makeEntry({ id, title, tag, rtttl }) {
  let song;
  try { song = parseRTTTL(rtttl); } catch { return null; }
  const stars = {}, notes = {}, rating = {}, tags = {};
  let length = 0;
  for (const d of DIFFICULTIES) {
    try {
      const c = generateChart(song, { difficulty: d });
      const m = measured[id] && measured[id][d];
      if (m && typeof m.rating === 'number') {
        rating[d] = m.rating; tags[d] = Array.isArray(m.tags) ? m.tags : [];
        stars[d] = starsFromRating(m.rating);
      } else stars[d] = starsFor(c);
      notes[d] = c.notes.length;
      length = Math.max(length, c.length);
    } catch { stars[d] = 0; notes[d] = 0; }
  }
  if (!length) return null;
  return {
    id, rtttl, tag: tag || '', song,
    title: title || song.name || 'Untitled',
    bpm: song.bpm, length, stars, notes, rating, tags,
  };
}

export function buildLibrary() {
  return SONGS.map(makeEntry).filter(Boolean);
}

export function customEntry(rtttl) {
  const e = makeEntry({ id: 'custom:' + hashString(rtttl.trim()), tag: 'Custom', rtttl: rtttl.trim() });
  return e;
}

export function formatLength(sec) {
  const s = Math.round(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
