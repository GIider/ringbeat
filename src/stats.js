// Lifetime player stats (playtime, runs, notes, lifetime score, play-day streak), persisted in localStorage.
// Grade counts are not stored here: they are derived from the highscores (gradeTally), so the two can never drift.
// Storage and the clock are injectable so the logic is testable and survives blocked storage.

export const STATS_KEY = 'ringbeat.stats.v1';
export const DIFFS = ['normal', 'hard'];
export const GRADES = ['S', 'A', 'B', 'C', 'D'];

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
function browserStorage() {
  try { return window.localStorage; } catch { return memoryStorage(); }
}

const isNum = v => typeof v === 'number' && isFinite(v);
const n0 = v => (isNum(v) && v >= 0 ? v : 0);
const pad2 = n => String(n).padStart(2, '0');
// Local calendar day, e.g. "2026-10-16".
export const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nextDay = key => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + 1).getTime()); };

function blank() {
  return {
    playtime: 0, runs: 0, finished: 0, failed: 0, quits: 0, restarts: 0, score: 0, bestCombo: 0,
    notes: { perfect: 0, great: 0, good: 0, miss: 0 }, ghosts: 0, fcRuns: 0, apRuns: 0, moddedRuns: 0, customRuns: 0,
    byDiff: Object.fromEntries(DIFFS.map(d => [d, { runs: 0, playtime: 0 }])),
    firstPlayed: 0, lastPlayed: 0, lastDay: '', daysPlayed: 0, streak: 0, bestStreak: 0, backfilled: false,
  };
}
function clean(raw) {
  const s = blank();
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(s)) if (typeof s[k] === 'number') s[k] = n0(raw[k]);
  for (const k of Object.keys(s.notes)) s.notes[k] = n0(raw.notes && raw.notes[k]);
  for (const d of DIFFS) {
    const b = raw.byDiff && raw.byDiff[d];
    s.byDiff[d] = { runs: n0(b && b.runs), playtime: n0(b && b.playtime) };
  }
  s.lastDay = typeof raw.lastDay === 'string' && /^\d{4}-\d\d-\d\d$/.test(raw.lastDay) ? raw.lastDay : '';
  s.backfilled = raw.backfilled === true;
  return s;
}

export function createStats(storage = browserStorage(), now = () => Date.now()) {
  let data = null, stored = false;
  const load = () => {
    if (data) return data;
    let raw = null;
    try { raw = JSON.parse(storage.getItem(STATS_KEY)); } catch { /* corrupt -> start clean */ }
    stored = !!(raw && typeof raw === 'object');
    data = clean(raw);
    return data;
  };
  const persist = () => { try { storage.setItem(STATS_KEY, JSON.stringify(data)); stored = true; } catch { /* ignore */ } };
  // A run on a new calendar day extends the streak (consecutive days) or restarts it.
  const touchDay = () => {
    const d = load(), t = now(), key = dayKey(t);
    if (!d.firstPlayed) d.firstPlayed = t;
    d.lastPlayed = t;
    if (d.lastDay === key) return;
    d.streak = d.lastDay && nextDay(d.lastDay) === key ? d.streak + 1 : 1;
    d.bestStreak = Math.max(d.bestStreak, d.streak);
    d.daysPlayed++;
    d.lastDay = key;
  };

  return {
    get: () => structuredClone(load()),
    // Seconds of song time actually played (pauses excluded), committed in chunks by the caller.
    addPlaytime(sec, diff) {
      if (!isNum(sec) || sec <= 0) return;
      const d = load();
      d.playtime += sec;
      if (d.byDiff[diff]) d.byDiff[diff].playtime += sec;
      persist();
    },
    // A run that reached the results screen (or ended by Sudden death).
    recordRun({ diff, result, custom = false, modded = false }) {
      if (!result || !isNum(result.score)) return;
      const d = load();
      touchDay();
      d.runs++;
      if (d.byDiff[diff]) d.byDiff[diff].runs++;
      if (result.failed) d.failed++; else d.finished++;
      d.score += Math.max(0, Math.round(result.score));
      d.bestCombo = Math.max(d.bestCombo, n0(result.maxCombo));
      for (const k of Object.keys(d.notes)) d.notes[k] += n0(result.counts && result.counts[k]);
      d.ghosts += n0(result.ghosts);
      if (result.fc && !result.failed) d.fcRuns++;
      if (result.ap && !result.failed) d.apRuns++;
      if (modded) d.moddedRuns++;
      if (custom) d.customRuns++;
      persist();
    },
    // A run left early: 'quit' (back to the menu) or 'restart'.
    recordAbort(kind) {
      const d = load();
      touchDay();
      if (kind === 'restart') d.restarts++; else d.quits++;
      persist();
    },
    // One-time import from existing highscores, for players who had scores before stats existed.
    // Lower bounds only (the top runs are all that was kept); playtime and note totals start at 0.
    backfill(entries) {
      load();
      if (stored) return false;
      const d = data, days = new Set();
      for (const e of entries) {
        d.runs += e.plays; d.finished += e.plays;
        if (d.byDiff[e.diff]) d.byDiff[e.diff].runs += e.plays;
        if (e.fc) d.fcRuns++;
        if (e.ap) d.apRuns++;
        for (const r of e.top) {
          d.score += n0(r.score);
          d.bestCombo = Math.max(d.bestCombo, n0(r.maxCombo));
          if (r.date > 0) {
            days.add(dayKey(r.date));
            d.firstPlayed = d.firstPlayed ? Math.min(d.firstPlayed, r.date) : r.date;
            d.lastPlayed = Math.max(d.lastPlayed, r.date);
          }
        }
      }
      d.daysPlayed = days.size;
      d.backfilled = entries.length > 0;
      persist();
      return d.backfilled;
    },
    clear() {
      data = blank();
      try { storage.removeItem(STATS_KEY); } catch { /* ignore */ }
      persist(); // keep an (empty) record so old highscores are not backfilled again
    },
  };
}

// The streak as of today: it only survives while the last play was today or yesterday.
export function currentStreak(s, now = Date.now()) {
  if (!s.lastDay) return 0;
  const today = dayKey(now);
  return s.lastDay === today || nextDay(s.lastDay) === today ? s.streak : 0;
}

// Best grade per song, for one difficulty or across all of them ('all'). entries: scores.all().
// -> { S, A, B, C, D, fc, ap, played }
export function gradeTally(entries, diff = 'all') {
  const songs = new Map();
  for (const e of entries) {
    if (diff !== 'all' && e.diff !== diff) continue;
    const g = e.best && GRADES.indexOf(e.best.grade);
    const s = songs.get(e.id) || { g: Infinity, fc: false, ap: false };
    if (g >= 0) s.g = Math.min(s.g, g);
    s.fc ||= !!e.fc; s.ap ||= !!e.ap;
    songs.set(e.id, s);
  }
  const t = { S: 0, A: 0, B: 0, C: 0, D: 0, fc: 0, ap: 0, played: songs.size };
  for (const s of songs.values()) {
    if (s.g !== Infinity) t[GRADES[s.g]]++;
    if (s.fc) t.fc++;
    if (s.ap) t.ap++;
  }
  return t;
}

// Most-played songs (plays summed across difficulties), most first, ties by id -> [{ id, plays }].
export function topSongs(entries, limit = 5) {
  const plays = new Map();
  for (const e of entries) plays.set(e.id, (plays.get(e.id) || 0) + e.plays);
  return [...plays].filter(([, p]) => p > 0).map(([id, p]) => ({ id, plays: p }))
    .sort((a, b) => b.plays - a.plays || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
}

// The most-played song across difficulties -> { id, plays } or null.
export function favourite(entries) {
  return topSongs(entries, 1)[0] || null;
}

// 45 -> "45s", 760 -> "12m 40s", 11220 -> "3h 07m".
export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s < 60) return s + 's';
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad2(Math.floor(s / 60) % 60)}m`;
}
