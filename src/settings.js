// Persisted user settings (localStorage may be blocked; everything degrades to defaults).
import { sanitizeBindings } from './gamepad.js';
import { normalize as normalizeMods } from './mods.js';
import { defaultSeen } from './changelog.js';
import { LANGS, detect } from './i18n.js';
import { SYNCED_SETTINGS } from './cloudmerge.js';

const STORE_KEY = 'ringbeat.v1';

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

// Any stored object -> the full, sanitized settings.
function fromRaw(raw) {
  return {
  volume: num(raw.volume, 0, 1, 0.7),
  // '' = follow the browser language until the player picks one in Settings
  lang: LANGS[raw.lang] ? raw.lang : '',
  voice: raw.voice === 'smooth' ? 'smooth' : 'buzzer',
  scrollTime: num(raw.scrollTime, 1, 2.5, 1.6),
  backing: typeof raw.backing === 'boolean' ? raw.backing : false, // off for new players; saved choices are kept
  rollAudio: raw.rollAudio === true, // first press of a roll plays the song's real notes (scoring still follows mashing)
  preview: raw.preview !== false,
  idleGags: raw.idleGags !== false,
  juice: raw.juice !== false,       // extra hit/miss/combo feedback (visual + sound)
  haptics: raw.haptics !== false,   // vibration on supporting devices (needs juice)
  comboPopup: raw.comboPopup !== false, // 50-combo milestones: "N COMBO" banner, frame flash and shake (the chirp always plays)
  calibration: num(raw.calibration, -0.5, 0.5, 0),
  difficulty: ['normal', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'normal',
  view: {
    sort: ['diff-asc', 'diff-desc', 'title', 'bpm', 'length', 'fav'].includes(raw.view && raw.view.sort) ? raw.view.sort : 'diff-asc',
    category: ['all', 'classical', 'pop', 'dance', 'ndw', 'screen', 'videogame', 'folk', 'custom', 'favorites'].includes(raw.view && raw.view.category) ? raw.view.category : 'all',
  },
  favorites: Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(v => typeof v === 'string' && v && v.length <= 200))].slice(0, 500) : [],
  lastSongId: typeof raw.lastSongId === 'string' ? raw.lastSongId : '',
  // Existing players (who already picked a song) are not shown the tutorial.
  tutorialDone: raw.tutorialDone === true || (typeof raw.lastSongId === 'string' && raw.lastSongId !== ''),
  tutorialLessons: Math.floor(num(raw.tutorialLessons, 0, 99, 0)), // tutorial lessons played so far (replays can jump to any of them)
  loginAsked: raw.loginAsked === true, // the post-tutorial "play online?" prompt was shown (this device only)
  customRtttl: typeof raw.customRtttl === 'string' ? raw.customRtttl.slice(0, 4000)
    : typeof raw.lastSong === 'string' ? raw.lastSong.slice(0, 4000) : '', // migrate v1 "lastSong"
  padBindings: sanitizeBindings(raw.padBindings),
  mods: normalizeMods(raw.mods),
  // Changelog versions read in Messages; before the Inbox existed, everything but the newest counts as read.
  msgSeen: Array.isArray(raw.msgSeen) ? raw.msgSeen.filter(v => typeof v === 'string').slice(0, 100) : defaultSeen(),
  };
}

const raw = load();
export const settings = fromRaw(raw);

// For cloud sync: when each synced setting last changed (ms) and the favourite marks as {id: {on, t}}, so devices can
// merge them (cloudmerge.js). Kept beside the settings in the same storage entry; stamped by saveSettings.
const isNum = v => typeof v === 'number' && isFinite(v);
const stamps = {};
if (raw._t && typeof raw._t === 'object') for (const k of SYNCED_SETTINGS) if (isNum(raw._t[k])) stamps[k] = raw._t[k];
const favMarks = {};
if (raw._fav && typeof raw._fav === 'object') {
  for (const [id, f] of Object.entries(raw._fav)) if (f && isNum(f.t)) favMarks[id] = { on: f.on === true, t: f.t };
}
for (const id of settings.favorites) if (!favMarks[id] || !favMarks[id].on) favMarks[id] = { on: true, t: 0 };
const text = v => JSON.stringify(v);
let saved = Object.fromEntries(SYNCED_SETTINGS.map(k => [k, text(settings[k])]));

// The language to show: the saved choice, else the browser's.
export const effectiveLang = () => settings.lang || detect(typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : []);

// Called after every save (cloud sync schedules an upload).
const saveListeners = [];
export const onSave = f => saveListeners.push(f);

export function saveSettings(now = Date.now()) {
  for (const k of SYNCED_SETTINGS) {
    const v = text(settings[k]);
    if (v !== saved[k]) { stamps[k] = now; saved[k] = v; }
  }
  const favs = new Set(settings.favorites);
  for (const id of favs) if (!favMarks[id] || !favMarks[id].on) favMarks[id] = { on: true, t: now };
  for (const [id, f] of Object.entries(favMarks)) if (f.on && !favs.has(id)) favMarks[id] = { on: false, t: now };
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...settings, _t: stamps, _fav: favMarks })); } catch { /* ignore */ }
  for (const f of saveListeners) f();
}

// The synced part, as the cloud's shared document holds it.
export function sharedSettings() {
  return {
    settings: structuredClone(Object.fromEntries(SYNCED_SETTINGS.map(k => [k, settings[k]]))),
    settingsT: { ...stamps },
    favorites: structuredClone(favMarks),
  };
}

// Takes a merged shared document's settings and favourites (sanitized like stored ones) without re-stamping them.
// -> true when anything changed.
export function applyShared(doc) {
  const before = text(sharedSettings());
  const next = fromRaw({ ...settings, ...(doc.settings || {}) });
  for (const k of SYNCED_SETTINGS) settings[k] = next[k];
  Object.assign(stamps, doc.settingsT || {});
  for (const [id, f] of Object.entries(doc.favorites || {})) favMarks[id] = { on: !!f.on, t: f.t };
  // Keep the local order; favourites new to this device go last.
  const on = Object.keys(favMarks).filter(id => favMarks[id].on);
  settings.favorites = [...settings.favorites.filter(id => on.includes(id)), ...on.filter(id => !settings.favorites.includes(id))].slice(0, 500);
  saved = Object.fromEntries(SYNCED_SETTINGS.map(k => [k, text(settings[k])]));
  if (text(sharedSettings()) === before) return false;
  saveSettings();
  return true;
}

export { num };
