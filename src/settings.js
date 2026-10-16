// Persisted user settings (localStorage may be blocked; everything degrades to defaults).
import { sanitizeBindings } from './gamepad.js';
import { normalize as normalizeMods } from './mods.js';
import { defaultSeen } from './changelog.js';

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
  backing: typeof raw.backing === 'boolean' ? raw.backing : false, // off for new players; saved choices are kept
  preview: raw.preview !== false,
  idleGags: raw.idleGags !== false,
  juice: raw.juice !== false,       // extra hit/miss/combo feedback (visual + sound)
  haptics: raw.haptics !== false,   // vibration on supporting devices (needs juice)
  calibration: num(raw.calibration, -0.5, 0.5, 0),
  difficulty: ['normal', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'normal',
  view: {
    sort: ['diff-asc', 'diff-desc', 'title', 'bpm', 'length'].includes(raw.view && raw.view.sort) ? raw.view.sort : 'diff-asc',
    category: ['all', 'classical', 'pop', 'dance', 'ndw', 'screen', 'videogame', 'folk', 'custom'].includes(raw.view && raw.view.category) ? raw.view.category : 'all',
  },
  lastSongId: typeof raw.lastSongId === 'string' ? raw.lastSongId : '',
  // Existing players (who already picked a song) are not shown the tutorial.
  tutorialDone: raw.tutorialDone === true || (typeof raw.lastSongId === 'string' && raw.lastSongId !== ''),
  customRtttl: typeof raw.customRtttl === 'string' ? raw.customRtttl.slice(0, 4000)
    : typeof raw.lastSong === 'string' ? raw.lastSong.slice(0, 4000) : '', // migrate v1 "lastSong"
  padBindings: sanitizeBindings(raw.padBindings),
  mods: normalizeMods(raw.mods),
  // Changelog versions read in Messages; before the Inbox existed, everything but the newest counts as read.
  msgSeen: Array.isArray(raw.msgSeen) ? raw.msgSeen.filter(v => typeof v === 'string').slice(0, 100) : defaultSeen(),
};

export function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export { num };
