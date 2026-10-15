// Persisted user settings (localStorage may be blocked; everything degrades to defaults).
import { sanitizeBindings } from './gamepad.js';

const STORE_KEY = 'ringbeat.v1';

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

const raw = load();
export const settings = {
  volume: num(raw.volume, 0, 1, 0.7),
  voice: raw.voice === 'smooth' ? 'smooth' : 'buzzer',
  scrollTime: num(raw.scrollTime, 1, 2.5, 1.6),
  backing: raw.backing !== false,
  preview: raw.preview !== false,
  calibration: num(raw.calibration, -0.5, 0.5, 0),
  difficulty: ['easy', 'normal', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'normal',
  view: {
    sort: ['default', 'diff-asc', 'diff-desc', 'title', 'bpm', 'length'].includes(raw.view && raw.view.sort) ? raw.view.sort : 'default',
    category: ['all', 'classical', 'pop', 'videogame', 'folk', 'original', 'custom'].includes(raw.view && raw.view.category) ? raw.view.category : 'all',
    filter: ['all', 'unplayed', 'nofc'].includes(raw.view && raw.view.filter) ? raw.view.filter : 'all',
  },
  lastSongId: typeof raw.lastSongId === 'string' ? raw.lastSongId : '',
  // Existing players (who already picked a song) are not shown the tutorial.
  tutorialDone: raw.tutorialDone === true || (typeof raw.lastSongId === 'string' && raw.lastSongId !== ''),
  customRtttl: typeof raw.customRtttl === 'string' ? raw.customRtttl.slice(0, 4000)
    : typeof raw.lastSong === 'string' ? raw.lastSong.slice(0, 4000) : '', // migrate v1 "lastSong"
  padBindings: sanitizeBindings(raw.padBindings),
  training: {
    speed: num(raw.training && raw.training.speed, 0.5, 1.5, 1),
    loop: !!(raw.training && raw.training.loop),
    a: num(raw.training && raw.training.a, 0, 0.9, 0),
    b: num(raw.training && raw.training.b, 0.1, 1, 1),
  },
};
if (settings.training.b <= settings.training.a + 0.05) { settings.training.a = 0; settings.training.b = 1; }

export function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export { num };
