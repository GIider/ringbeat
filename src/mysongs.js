// "My Songs": the player's saved custom songs. Storage is injectable like scores.js; storage failures degrade to memory.
import { customEntry } from './library.js';
import { parseRTTTL } from './rtttl.js';

export const MYSONGS_KEY = 'ringbeat.songs.v1';
export const MAX_SONGS = 30;
export const MAX_RTTTL = 8000;

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
function browserStorage() {
  try { return window.localStorage; } catch { return memoryStorage(); }
}

const cleanName = s => String(s || '').replace(/[:,\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
const isNum = v => typeof v === 'number' && isFinite(v);
export const isValidRtttl = t => typeof t === 'string' && t.length > 0 && t.length <= MAX_RTTTL && !!customEntry(t);
// Human-readable reason a song cannot be saved, or '' when it can.
export function rtttlProblem(t) {
  t = String(t || '').trim();
  if (!t) return 'Nothing to save';
  if (t.length > MAX_RTTTL) return `Too long (${t.length}/${MAX_RTTTL} characters)`;
  try { parseRTTTL(t); } catch (e) { return e.message; }
  return customEntry(t) ? '' : 'No notes long enough to play';
}
const newUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// "name:d=..:notes" lines out of arbitrary text (a .rtttl/.txt file, several songs one per line).
export function splitRtttl(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.split(':').length >= 3);
}

export function createMySongs(storage = browserStorage()) {
  let songs = null;
  const save = () => { try { storage.setItem(MYSONGS_KEY, JSON.stringify(songs)); } catch { /* ignore */ } };
  const load = () => {
    if (songs) return songs;
    songs = [];
    try {
      const raw = JSON.parse(storage.getItem(MYSONGS_KEY));
      if (Array.isArray(raw)) {
        for (const r of raw) {
          if (!r || typeof r.rtttl !== 'string' || !isValidRtttl(r.rtttl)) continue;
          songs.push({ uid: typeof r.uid === 'string' ? r.uid : newUid(), name: cleanName(r.name) || 'Untitled', rtttl: r.rtttl.trim(), updated: isNum(r.updated) ? r.updated : 0 });
          if (songs.length >= MAX_SONGS) break;
        }
      }
    } catch { /* ignore */ }
    return songs;
  };

  const api = {
    list: () => load().slice(),
    get: uid => load().find(s => s.uid === uid) || null,
    count: () => load().length,
    isFull: () => load().length >= MAX_SONGS,
    // Returns the stored song, or null if invalid / library full.
    add(name, rtttl, now = Date.now()) {
      const l = load();
      rtttl = String(rtttl || '').trim();
      if (l.length >= MAX_SONGS || !isValidRtttl(rtttl)) return null;
      const s = { uid: newUid(), name: cleanName(name) || 'Untitled', rtttl, updated: now };
      l.push(s); save();
      return s;
    },
    update(uid, patch, now = Date.now()) {
      const s = api.get(uid);
      if (!s) return null;
      if (patch.rtttl !== undefined) {
        const r = String(patch.rtttl).trim();
        if (!isValidRtttl(r)) return null;
        s.rtttl = r;
      }
      if (patch.name !== undefined) s.name = cleanName(patch.name) || s.name;
      s.updated = now; save();
      return s;
    },
    remove(uid) {
      const l = load(), i = l.findIndex(s => s.uid === uid);
      if (i < 0) return false;
      l.splice(i, 1); save();
      return true;
    },
    duplicate(uid) {
      const s = api.get(uid);
      return s ? api.add(cleanName(s.name + ' 2'), s.rtttl) : null;
    },
    exportJSON: () => JSON.stringify({ v: 1, songs: load().map(({ name, rtttl }) => ({ name, rtttl })) }, null, 1),
    exportRtttl: uid => { const s = api.get(uid); return s ? s.rtttl : ''; },
    // Accepts our JSON bundle, a JSON array of strings/{name,rtttl}, or plain text with one RTTTL per line.
    // Duplicates (same melody text) are skipped. Returns {added, skipped}.
    importText(text) {
      const items = [];
      const t = String(text || '').trim();
      if (t[0] === '{' || t[0] === '[') {
        try {
          const j = JSON.parse(t);
          const arr = Array.isArray(j) ? j : Array.isArray(j.songs) ? j.songs : [];
          for (const x of arr) {
            if (typeof x === 'string') items.push({ rtttl: x });
            else if (x && typeof x.rtttl === 'string') items.push({ name: x.name, rtttl: x.rtttl });
          }
        } catch { return { added: 0, skipped: 1 }; }
      } else {
        for (const l of splitRtttl(t)) items.push({ rtttl: l });
      }
      let added = 0, skipped = 0;
      for (const it of items) {
        const r = String(it.rtttl).trim();
        if (load().some(s => s.rtttl === r)) { skipped++; continue; }
        const name = it.name || r.split(':')[0];
        if (api.add(name, r)) added++; else skipped++;
      }
      return { added, skipped };
    },
  };
  return api;
}
