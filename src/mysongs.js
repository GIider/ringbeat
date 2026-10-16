// "My Songs": the player's saved custom songs. Storage is injectable like scores.js; storage failures degrade to memory.
import { customEntry } from './library.js';
import { parseRTTTL } from './rtttl.js';
import { cleanRating } from './customrating.js';

export const MYSONGS_KEY = 'ringbeat.songs.v1';
export const MYSONGS_GONE_KEY = 'ringbeat.songs.gone.v1'; // deleted uid -> when, so deletes reach other devices
export const MAX_SONGS = 30;
export const MAX_STORED = 100; // a cloud merge never drops songs, so the list may grow past MAX_SONGS
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
  let songs = null, gone = null;
  const save = () => { try { storage.setItem(MYSONGS_KEY, JSON.stringify(songs)); } catch { /* ignore */ } };
  const loadGone = () => {
    if (gone) return gone;
    gone = {};
    try {
      const raw = JSON.parse(storage.getItem(MYSONGS_GONE_KEY));
      if (raw && typeof raw === 'object') for (const [uid, t] of Object.entries(raw)) if (isNum(t)) gone[uid] = t;
    } catch { /* ignore */ }
    return gone;
  };
  const saveGone = () => { try { storage.setItem(MYSONGS_GONE_KEY, JSON.stringify(gone)); } catch { /* ignore */ } };
  const cleanSong = r => (r && typeof r.rtttl === 'string' && isValidRtttl(r.rtttl.trim())
    ? { uid: typeof r.uid === 'string' ? r.uid : newUid(), name: cleanName(r.name) || 'Untitled', rtttl: r.rtttl.trim(), updated: isNum(r.updated) ? r.updated : 0, rating: cleanRating(r.rating) }
    : null);
  const load = () => {
    if (songs) return songs;
    songs = [];
    try {
      const raw = JSON.parse(storage.getItem(MYSONGS_KEY));
      if (Array.isArray(raw)) {
        for (const r of raw) {
          const s = cleanSong(r);
          if (!s) continue;
          songs.push(s);
          if (songs.length >= MAX_STORED) break;
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
    add(name, rtttl, now = Date.now(), rating = null) {
      const l = load();
      rtttl = String(rtttl || '').trim();
      if (l.length >= MAX_SONGS || !isValidRtttl(rtttl)) return null;
      const s = { uid: newUid(), name: cleanName(name) || 'Untitled', rtttl, updated: now, rating: cleanRating(rating) };
      l.push(s); save();
      return s;
    },
    update(uid, patch, now = Date.now()) {
      const s = api.get(uid);
      if (!s) return null;
      if (patch.rtttl !== undefined) {
        const r = String(patch.rtttl).trim();
        if (!isValidRtttl(r)) return null;
        if (r !== s.rtttl) s.rating = null; // a measured rating belongs to the exact melody
        s.rtttl = r;
      }
      if (patch.name !== undefined) s.name = cleanName(patch.name) || s.name;
      s.updated = now; save();
      return s;
    },
    // Stores a rating for the song (null clears it). Does not touch `updated`: it is not an edit.
    setRating(uid, rating) {
      const s = api.get(uid);
      if (!s) return null;
      s.rating = cleanRating(rating); save();
      return s;
    },
    remove(uid, now = Date.now()) {
      const l = load(), i = l.findIndex(s => s.uid === uid);
      if (i < 0) return false;
      l.splice(i, 1); save();
      loadGone()[uid] = now; saveGone();
      return true;
    },
    // For cloud sync: the songs as {uid: song} plus the deletes ({uid: time}).
    shared() {
      const out = {};
      for (const { uid, name, rtttl, updated, rating } of load()) out[uid] = { name, rtttl, updated, rating };
      return { songs: out, gone: { ...loadGone() } };
    },
    // Takes a merged shared document's songs. Local order is kept; songs new to this device go last (oldest first).
    // -> true when anything changed.
    applyShared(doc) {
      const before = JSON.stringify(api.shared());
      const incoming = doc.songs || {};
      const next = [];
      for (const s of load()) if (incoming[s.uid]) next.push(cleanSong({ uid: s.uid, ...incoming[s.uid] }));
      const fresh = Object.keys(incoming).filter(uid => !load().some(s => s.uid === uid))
        .sort((a, b) => (incoming[a].updated || 0) - (incoming[b].updated || 0));
      for (const uid of fresh) next.push(cleanSong({ uid, ...incoming[uid] }));
      songs = next.filter(Boolean).slice(0, MAX_STORED);
      gone = { ...loadGone(), ...(doc.gone || {}) };
      if (JSON.stringify(api.shared()) === before) return false;
      save(); saveGone();
      return true;
    },
    duplicate(uid) {
      const s = api.get(uid);
      return s ? api.add(cleanName(s.name + ' 2'), s.rtttl) : null;
    },
    exportJSON: () => JSON.stringify({ v: 1, songs: load().map(({ name, rtttl, rating }) => (rating ? { name, rtttl, rating } : { name, rtttl })) }, null, 1),
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
            else if (x && typeof x.rtttl === 'string') items.push({ name: x.name, rtttl: x.rtttl, rating: x.rating && { ...x.rating, imported: true } });
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
        if (api.add(name, r, undefined, it.rating)) added++; else skipped++;
      }
      return { added, skipped };
    },
  };
  return api;
}
