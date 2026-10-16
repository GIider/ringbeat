// Cloud save: optional online profile (GitHub sign-in) that syncs settings, favourites, my songs, scores and stats
// between devices through the Ringbeat API (server/, see docs/CLOUD.md). localStorage stays the source of truth: when
// signed out nothing here touches the network, and a failed sync just tries again later.
// Storage, fetch and the clock are injectable so the logic is testable without a browser.
import { mergeShared, sameShared } from './cloudmerge.js';

// The deployed Worker (no trailing slash). Empty = online profiles are not offered. `ringbeat.api` in localStorage
// overrides it for local development (e.g. http://localhost:8787).
export const API_BASE = 'https://ringbeat-api.mail-9ae.workers.dev';
export const CLOUD_KEY = 'ringbeat.cloud.v1';
export const DEVICE_KEY = 'ringbeat.device.v1';
export const RUN_BATCH = 50;
const MAX_OUTBOX = 500;
const MAX_BATCH_CHARS = 250_000;   // a POST /runs body stays under the API's limit
const MAX_OUTBOX_REPLAYS = 1_000_000; // replay characters kept waiting; older runs drop theirs (they stay unranked)
const BOARD_TTL = 60e3;

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
function browserStorage() {
  try { return window.localStorage; } catch { return memoryStorage(); }
}
const isNum = v => typeof v === 'number' && isFinite(v);
const randomId = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => (b % 36).toString(36)).join('');

class HttpError extends Error {
  constructor(status) { super('HTTP ' + status); this.status = status; }
}

// scores / stats / mysongs: the stores from scores.js, stats.js, mysongs.js.
// prefs: { sharedSettings, applyShared } from settings.js.
export function createCloud({ scores, stats, mysongs, prefs, apiBase = API_BASE, storage = browserStorage(),
  fetch = (...a) => globalThis.fetch(...a), now = () => Date.now(), gameVersion = '' }) {
  let st;
  try { st = JSON.parse(storage.getItem(CLOUD_KEY)) || {}; } catch { st = {}; }
  st = {
    token: typeof st.token === 'string' ? st.token : '',
    profile: st.profile && typeof st.profile === 'object' ? st.profile : null,
    syncedAt: isNum(st.syncedAt) ? st.syncedAt : 0,
    resetAt: isNum(st.resetAt) ? st.resetAt : 0,     // newest "reset scores & stats" this device knows of
    resetSeen: isNum(st.resetSeen) ? st.resetSeen : 0, // ...and the newest one applied to this device's data
    devices: st.devices && typeof st.devices === 'object' ? st.devices : {}, // other devices' {scores, stats, updated}
    outbox: Array.isArray(st.outbox) ? st.outbox : [], // finished runs not uploaded yet
    backfilled: st.backfilled === true,                // this device's old top runs went up once
  };
  const persist = () => { try { storage.setItem(CLOUD_KEY, JSON.stringify(st)); } catch { /* ignore */ } };

  let deviceId = '';
  try { deviceId = storage.getItem(DEVICE_KEY) || ''; } catch { /* ignore */ }
  if (!/^[a-z0-9]{8,32}$/.test(deviceId)) {
    deviceId = randomId(12);
    try { storage.setItem(DEVICE_KEY, deviceId); } catch { /* ignore */ }
  }

  const listeners = [];
  const emit = what => { for (const f of listeners) f(what); };
  const showRemote = () => {
    const list = Object.values(st.devices).filter(d => d && (d.updated || 0) >= st.resetAt);
    scores.setRemote(list.map(d => d.scores));
    stats.setRemote(list.map(d => d.stats));
  };
  if (st.token) showRemote();

  async function request(method, path, body, { keepalive = false } = {}) {
    const res = await fetch(apiBase + path, {
      method, keepalive,
      headers: { ...(st.token && { Authorization: 'Bearer ' + st.token }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status === 401 && st.token) { forget(); emit('signedout'); }
    if (!res.ok) throw new HttpError(res.status);
    return res.status === 204 ? null : res.json();
  }

  // Back to signed out on this device. The device keeps its own data; the other devices' numbers leave the view.
  function forget() {
    st.token = ''; st.profile = null; st.syncedAt = 0; st.devices = {}; st.outbox = []; st.backfilled = false;
    persist();
    showRemote();
  }

  const localShared = () => ({ ...prefs.sharedSettings(), ...mysongs.shared(), resetAt: st.resetAt });
  // The first device to fill an empty profile sets the starting point: its never-changed settings and old favourite
  // marks get a time, so another device's never-changed ones (time 0) don't win a coin toss against them.
  function stampUnset(doc, t) {
    for (const k of Object.keys(doc.settings || {})) doc.settingsT[k] ||= t;
    for (const f of Object.values(doc.favorites || {})) f.t ||= t;
    return doc;
  }

  // This device's top runs, once per sign-in: the first upload for players who played before signing in.
  function backfillRuns() {
    if (st.backfilled) return;
    const own = scores.own();
    for (const [songId, diffs] of Object.entries(own)) {
      for (const [diff, e] of Object.entries(diffs)) {
        for (const r of e.top) queue({ clientRunId: runId(songId, diff, r.date), songId, diff, ...r, playedAt: r.date, gameVersion: '' });
      }
    }
    st.backfilled = true;
    persist();
  }

  // The same run gets the same id from queueRun and the backfill, so the API stores it once.
  const runId = (songId, diff, playedAt) => `${deviceId}:${songId}:${diff}:${playedAt}`;

  function queue(run) {
    const { date, ...rest } = run;
    st.outbox.push(rest);
    if (st.outbox.length > MAX_OUTBOX) st.outbox.splice(0, st.outbox.length - MAX_OUTBOX);
    let chars = st.outbox.reduce((n, r) => n + (r.replay ? r.replay.length : 0), 0);
    for (const r of st.outbox) {
      if (chars <= MAX_OUTBOX_REPLAYS) break;
      if (r.replay) { chars -= r.replay.length; delete r.replay; }
    }
  }

  // -> the API's verdicts, { clientRunId: { verified, score? } } (1 = ranked with the server's score). One upload at a
  // time: a sync and the results screen's submit both send the head of the outbox.
  let flushing = Promise.resolve();
  const flushRuns = opts => (flushing = flushing.catch(() => {}).then(() => flushOnce(opts)));
  async function flushOnce(opts) {
    const verdicts = {};
    while (st.outbox.length) {
      let n = 0, chars = 0;
      while (n < Math.min(RUN_BATCH, st.outbox.length) && (n === 0 || chars + JSON.stringify(st.outbox[n]).length < MAX_BATCH_CHARS)) {
        chars += JSON.stringify(st.outbox[n++]).length;
      }
      const batch = st.outbox.slice(0, n);
      const r = await request('POST', '/runs', { runs: batch }, opts);
      for (const v of (r && r.runs) || []) verdicts[v.clientRunId] = v;
      st.outbox.splice(0, batch.length);
      persist();
    }
    return verdicts;
  }

  const uploadOwn = opts => request('PUT', '/sync/device/' + deviceId, { doc: { v: 1, scores: scores.own(), stats: stats.own(), updated: now() } }, opts);

  let running = null;
  // One full round: pull, merge the shared document both ways, apply a reset from another device, push this device's
  // data and runs. -> { ok, changed: Set('settings' | 'songs' | 'progress') }
  async function syncOnce() {
    const changed = new Set();
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await request('GET', '/sync');
      const remote = r.shared && r.shared.doc;
      const merged = mergeShared(remote ? localShared() : stampUnset(localShared(), now()), remote);
      if (prefs.applyShared(merged)) changed.add('settings');
      if (mysongs.applyShared(merged)) changed.add('songs');
      st.resetAt = merged.resetAt;
      if (st.resetAt > st.resetSeen) {
        // Scores and stats were reset on another device: this device's own numbers go too.
        scores.clear(); stats.clear();
        st.resetSeen = st.resetAt;
        changed.add('progress');
      }
      persist();
      if (!remote || !sameShared(merged, remote)) {
        try { await request('PUT', '/sync/shared', { doc: merged, baseRev: (r.shared && r.shared.rev) || 0 }); } catch (e) {
          if (e.status === 409) continue; // another device wrote in between: merge with that and try again
          throw e;
        }
      }
      await uploadOwn();
      const devices = {};
      for (const [id, d] of Object.entries(r.devices || {})) if (id !== deviceId && d && typeof d === 'object') devices[id] = d;
      if (JSON.stringify(devices) !== JSON.stringify(st.devices)) changed.add('progress');
      st.devices = devices;
      showRemote();
      backfillRuns();
      await flushRuns();
      st.syncedAt = now();
      persist();
      return { ok: true, changed };
    }
    return { ok: false, changed };
  }

  let timer = 0;
  const boards = new Map(); // 'songId|diff' -> { at, value }
  const cloud = {
    deviceId,
    available: () => !!apiBase,
    signedIn: () => !!st.token,
    profile: () => st.profile,
    lastSync: () => st.syncedAt,
    pendingRuns: () => st.outbox.length,
    // 'synced' after a sync that changed something (with the Set of what), 'signedin', 'signedout', 'profile'.
    onChange: f => listeners.push(f),
    signInUrl: returnTo => apiBase + '/auth/github/start?return=' + encodeURIComponent(returnTo),

    // Finishes a sign-in: the API sends the browser back with #login=<one-time code>. -> true when signed in.
    async takeLoginHash(hash) {
      const m = /^#?login=([A-Za-z0-9_-]{16,128})$/.exec(String(hash || ''));
      if (!m || !apiBase) return false;
      const r = await request('POST', '/auth/exchange', { code: m[1] });
      st.token = r.token; st.profile = r.profile; st.backfilled = false;
      persist();
      emit('signedin');
      return true;
    },

    async sync() {
      clearTimeout(timer); timer = 0;
      if (!st.token || !apiBase) return { ok: false, changed: new Set() };
      if (running) return running;
      running = syncOnce().catch(() => ({ ok: false, changed: new Set() })).finally(() => { running = null; });
      const r = await running;
      if (r.changed.size) emit({ synced: r.changed });
      return r;
    },
    // A sync a little later (settings changes come in bursts).
    schedule(ms = 4000) {
      if (!st.token || !apiBase) return;
      clearTimeout(timer);
      timer = setTimeout(() => cloud.sync(), ms);
    },
    // The page is going away: push this device's data and runs, nothing that needs an answer to merge.
    flush() {
      if (!st.token || !apiBase) return;
      uploadOwn({ keepalive: true }).catch(() => {});
      flushRuns({ keepalive: true }).catch(() => {});
    },

    // A finished run, for the run history and leaderboards. Pass the result with the `date` the scores store recorded
    // it under. `play` makes it rankable: { replay (replay.js encodeLog), rules, loadout (the mods as played), rtttl
    // (custom songs) }; the API re-plays it and ranks its own score. -> the run's id (see submit).
    queueRun(songId, diff, result, mods = [], play = {}) {
      if (!st.token) return null;
      const playedAt = isNum(result.date) ? result.date : now();
      const id = runId(songId, diff, playedAt);
      queue({
        clientRunId: id, songId, diff,
        score: result.score, grade: result.grade, accuracy: result.accuracy, maxCombo: result.maxCombo,
        fc: !!result.fc, ap: !!result.ap, mods, mult: isNum(result.mult) ? result.mult : 1, playedAt, gameVersion,
        ...(play.replay && { replay: play.replay, rules: play.rules, loadout: play.loadout || null,
          ...(play.rtttl && { rtttl: play.rtttl }) }),
      });
      persist();
      return id;
    },
    // Upload waiting runs now (the results screen wants its world rank). -> the verdicts (see flushRuns), {} on failure.
    async submit() {
      if (!st.token || !apiBase) return {};
      try { return await flushRuns(); } catch { cloud.schedule(); return {}; }
    },

    // Leaderboards: the best ranked run per player, under the API's current rules. Works signed out.
    // -> { rules, runs: [{ rank, total, name, score, grade, accuracy, maxCombo, fc, ap, mods, playedAt, me? }] } or null.
    async board(songId, diff, { fresh = false } = {}) {
      if (!apiBase) return null;
      const key = songId + '|' + diff, hit = boards.get(key);
      if (!fresh && hit && now() - hit.at < BOARD_TTL) return hit.value;
      try {
        const value = await request('GET', `/board/${encodeURIComponent(songId)}/${diff}`);
        boards.set(key, { at: now(), value });
        return value;
      } catch { return hit ? hit.value : null; }
    },
    // The signed-in player's rank with the two players above and below; runs is empty when they have no ranked run.
    async around(songId, diff) {
      if (!st.token || !apiBase) return null;
      boards.delete(songId + '|' + diff); // a new run may have changed it
      try { return await request('GET', `/board/${encodeURIComponent(songId)}/${diff}/me`); } catch { return null; }
    },
    async setPublic(on) {
      const r = await request('PATCH', '/me', { public: !!on });
      st.profile = r.profile;
      persist();
      emit('profile');
      return st.profile;
    },

    // Scores and stats were reset on this device: every device resets on its next sync.
    markReset() {
      if (!st.token) return; // a reset while signed out stays on this device
      st.resetAt = st.resetSeen = now();
      persist();
      showRemote();
      cloud.schedule(500);
    },

    async rename(name) {
      const r = await request('PATCH', '/me', { displayName: name });
      st.profile = r.profile;
      persist();
      emit('profile');
      return st.profile;
    },
    async signOut() {
      try { await request('POST', '/auth/logout'); } catch { /* signed out locally either way */ }
      forget();
      emit('signedout');
    },
    // Deletes the online profile and everything stored with it. This device keeps its own data.
    async deleteAccount() {
      await request('DELETE', '/me');
      forget();
      emit('signedout');
    },
  };
  return cloud;
}
