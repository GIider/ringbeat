// Local highscores: top runs per song + difficulty, persisted in localStorage.
// Storage is injectable (getItem/setItem/removeItem) so the logic is testable and survives blocked storage.

export const SCORES_KEY = 'ringbeat.scores.v1';
export const TOP_N = 10;

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

function browserStorage() {
  try { return window.localStorage; } catch { return memoryStorage(); }
}

const isNum = v => typeof v === 'number' && isFinite(v);
function cleanRun(r) {
  if (!r || typeof r !== 'object' || !isNum(r.score)) return null;
  return {
    score: r.score,
    grade: typeof r.grade === 'string' ? r.grade.slice(0, 2) : 'D',
    accuracy: isNum(r.accuracy) ? r.accuracy : 0,
    maxCombo: isNum(r.maxCombo) ? r.maxCombo : 0,
    fc: !!r.fc, ap: !!r.ap,
    date: isNum(r.date) ? r.date : 0,
    // Mods the run was played with (display only) and the multiplier already folded into `score`.
    ...(Array.isArray(r.mods) && r.mods.length && { mods: r.mods.filter(t => typeof t === 'string').slice(0, 6).map(t => t.slice(0, 5)) }),
    ...(isNum(r.mult) && r.mult !== 1 && { mult: r.mult }),
  };
}

// Scores data of several devices ({songId: {diff: {top, plays, fc, ap}}} each, already cleaned) -> one combined.
// Top runs are pooled (a run synced twice counts once), plays add up, FC/AP are sticky.
export function combineScores(list) {
  const out = {};
  for (const data of list) {
    if (!data || typeof data !== 'object') continue;
    for (const [id, diffs] of Object.entries(data)) {
      for (const [diff, e] of Object.entries(diffs || {})) {
        if (!e || !Array.isArray(e.top)) continue;
        const c = ((out[id] ||= {})[diff] ||= { top: [], plays: 0, fc: false, ap: false });
        c.plays += isNum(e.plays) ? e.plays : 0;
        c.fc ||= !!e.fc; c.ap ||= !!e.ap;
        for (const r of e.top) if (!c.top.some(x => x.date === r.date && x.score === r.score)) c.top.push(r);
      }
    }
  }
  for (const diffs of Object.values(out)) {
    for (const e of Object.values(diffs)) {
      e.top.sort((a, b) => b.score - a.score || a.date - b.date); // a tie ranks below the older run
      e.top.length = Math.min(e.top.length, TOP_N);
    }
  }
  return out;
}

// Raw stored scores (any shape) -> {songId: {diff: {top, plays, fc, ap}}}.
export function cleanScores(raw) {
  const data = {};
  if (!raw || typeof raw !== 'object') return data;
  for (const [id, diffs] of Object.entries(raw)) {
    if (!diffs || typeof diffs !== 'object') continue;
    for (const [diff, e] of Object.entries(diffs)) {
      const top = Array.isArray(e && e.top) ? e.top.map(cleanRun).filter(Boolean).slice(0, TOP_N) : [];
      if (!top.length) continue;
      // fc/ap are sticky per song+difficulty (survive runs falling out of the top 5); migrate from top runs.
      (data[id] ||= {})[diff] = {
        top, plays: isNum(e.plays) ? e.plays : top.length,
        fc: e.fc === true || top.some(r => r.fc), ap: e.ap === true || top.some(r => r.ap),
      };
    }
  }
  return data;
}

// With cloud sync, this store holds this device's own runs; get() / all() / record() see them combined with the
// other devices' (setRemote, combineScores).
export function createScores(storage = browserStorage()) {
  let data = null, remote = [], view = null;
  const load = () => {
    if (data) return data;
    try { data = cleanScores(JSON.parse(storage.getItem(SCORES_KEY))); } catch { data = {}; } // corrupt -> start clean
    return data;
  };
  const shown = () => (remote.length ? (view ||= combineScores([load(), ...remote])) : load());
  const persist = () => { view = null; try { storage.setItem(SCORES_KEY, JSON.stringify(data)); } catch { /* ignore */ } };

  return {
    // -> { best, top, plays, fc, ap } or null (fc/ap: ever achieved on this difficulty)
    get(songId, diff) {
      const e = shown()[songId] && shown()[songId][diff];
      return e ? { best: e.top[0], top: e.top.slice(), plays: e.plays, fc: e.fc, ap: e.ap } : null;
    },
    // Every played song + difficulty -> [{ id, diff, best, top, plays, fc, ap }] (for lifetime stats).
    all() {
      const out = [];
      for (const [id, diffs] of Object.entries(shown())) {
        for (const [diff, e] of Object.entries(diffs)) out.push({ id, diff, best: e.top[0], top: e.top.slice(), plays: e.plays, fc: e.fc, ap: e.ap });
      }
      return out;
    },
    // This device's own scores (what it uploads).
    own: () => structuredClone(load()),
    // Other devices' scores from the last sync (raw; cleaned here).
    setRemote(list) { remote = (Array.isArray(list) ? list : []).map(cleanScores); view = null; },
    // Records a finished run. -> { rank (1-based or null if outside top N), isNewBest }
    record(songId, diff, result) {
      const run = cleanRun({ ...result, date: result.date ?? Date.now() });
      if (!run) return { rank: null, isNewBest: false };
      const d = load();
      const e = ((d[songId] ||= {})[diff] ||= { top: [], plays: 0, fc: false, ap: false });
      e.plays++;
      if (run.fc) e.fc = true;
      if (run.ap) e.ap = true;
      // Stable: a tie ranks below the older run.
      let idx = e.top.findIndex(r => run.score > r.score);
      if (idx < 0) idx = e.top.length;
      e.top.splice(idx, 0, run);
      e.top.length = Math.min(e.top.length, TOP_N);
      persist();
      // The rank among every device's runs.
      if (remote.length) idx = shown()[songId][diff].top.findIndex(r => r.date === run.date && r.score === run.score);
      if (idx < 0) idx = TOP_N;
      return { rank: idx < TOP_N ? idx + 1 : null, isNewBest: idx === 0 };
    },
    clear() {
      data = {}; view = null;
      try { storage.removeItem(SCORES_KEY); } catch { /* ignore */ }
    },
  };
}
