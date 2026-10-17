// Cloud save: optional online profile (GitHub sign-in) that syncs settings, favourites, my songs, scores and stats
// between devices through the Ringbeat API (server/, see docs/CLOUD.md). localStorage stays the source of truth: when
// signed out nothing here touches the network (except the leaderboard snapshot), and a failed sync just tries again
// later. Requests are few on purpose (docs/CLOUD.md › Requests): one POST /sync does a whole round, it only goes out
// when something changed or the last pull is old, and never while a song is playing.
// Storage, fetch, the clock and the timeout are injectable so the logic is testable without a browser.
import { mergeShared, sameShared, sharedKey, cleanName } from './cloudmerge.js';

// The deployed Worker (no trailing slash). Empty = online profiles are not offered. `ringbeat.api` in localStorage
// overrides it for local development (e.g. http://localhost:8787).
export const API_BASE = 'https://ringbeat-api.mail-9ae.workers.dev';
export const CLOUD_KEY = 'ringbeat.cloud.v1';
export const DEVICE_KEY = 'ringbeat.device.v1';
export const BOARDS_KEY = 'ringbeat.boards.v1';
export const RUN_BATCH = 50;
const MAX_OUTBOX = 500;
const BODY_BUDGET = 280_000;       // a POST /sync body stays under the API's limit (300 000)
const MAX_REPLAY = 250_000;        // the API's limit for one encoded input log; a longer one goes up as unranked history
const MAX_OUTBOX_REPLAYS = 1_000_000; // replay characters kept waiting; older runs drop theirs (they stay unranked)
const KEEPALIVE_MAX = 60_000;      // browsers drop keepalive bodies over 64 KB
export const PULL_EVERY = 10 * 60e3;   // the tab coming back pulls only when the last sync is older than this
export const PUSH_EVERY = 10 * 60e3;   // new scores, stats and runs wait at most this long (or until the tab is hidden)
export const SHARED_DELAY = 30e3;      // settings, favourites and my songs: changes come in bursts
export const BOARD_TOP = 10;   // runs per board in the snapshot and in a sync's answer (the server's BOARD_TOP)
export const BOARDS_TTL = 30e3;   // the leaderboard snapshot (the server patches it as runs rank; fetched when a screen asks)
export const RANKS_TTL = 10 * 60e3;    // the stats screen's overview of the player's ranks
export const SYNC_COOLDOWN = 30e3;     // the Sync button: once per this, counted from the last sync or press
const BUSY_RETRY = 5e3;
const DEVICE_OVERLAP = 5 * 60e3;       // re-ask for slots a little older than the last pull (writes in flight)

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
function browserStorage() {
  try { return window.localStorage; } catch { return memoryStorage(); }
}
const isNum = v => typeof v === 'number' && isFinite(v);
const randomId = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => (b % 36).toString(36)).join('');
// Short fingerprint of a text (FNV-1a), for "did this change since the last upload?".
const fingerprint = s => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + ':' + s.length;
};
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// A timer that doesn't keep Node (the tests) alive; a plain setTimeout in the browser.
const defaultTimer = (f, ms) => { const t = setTimeout(f, ms); if (t && t.unref) t.unref(); return t; };

class HttpError extends Error {
  constructor(status) { super('HTTP ' + status); this.status = status; }
}

// Ranks cached before the answer's rows carried fc/ap/mods/dev keep their rank and total but lose the stale rows.
function freshRanks(ranks) {
  for (const k of Object.values(ranks)) {
    if (!k || typeof k !== 'object') continue;
    const rows = [k.near, k.top].flatMap(a => (Array.isArray(a) ? a : []));
    if (rows.some(r => !r || typeof r.fc !== 'boolean')) { delete k.near; delete k.top; }
  }
  return ranks;
}

// scores / stats / mysongs: the stores from scores.js, stats.js, mysongs.js.
// prefs: { sharedSettings, applyShared } from settings.js.
// devLogin: sign in through the local API's GitHub-free /auth/dev/start (npm run dev:cloud).
// isBusy: true while a song is playing or paused; no sync starts then.
// debug: called with every request ({ why, method, path, body, sent, status, received, ms, response, error }) and every
// sync that was held back ({ why, skipped }); the `?dev` request log (netdebug.js). Leave it out and nothing is measured.
export function createCloud({ scores, stats, mysongs, prefs, apiBase = API_BASE, devLogin = false, storage = browserStorage(),
  fetch = (...a) => globalThis.fetch(...a), now = () => Date.now(), gameVersion = '', isBusy = () => false,
  timeoutMs = 8000, setTimer = defaultTimer, clearTimer = id => clearTimeout(id), debug = null }) {
  let st;
  try { st = JSON.parse(storage.getItem(CLOUD_KEY)) || {}; } catch { st = {}; }
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  st = {
    token: typeof st.token === 'string' ? st.token : '',
    profile: st.profile && typeof st.profile === 'object' ? st.profile : null,
    syncedAt: isNum(st.syncedAt) ? st.syncedAt : 0,
    resetAt: isNum(st.resetAt) ? st.resetAt : 0,     // newest "reset scores & stats" this device knows of
    resetSeen: isNum(st.resetSeen) ? st.resetSeen : 0, // ...and the newest one applied to this device's data
    devices: obj(st.devices),                          // other devices' {scores, stats, updated}
    devicesAt: isNum(st.devicesAt) ? st.devicesAt : 0, // server time of the last pull of those
    outbox: Array.isArray(st.outbox) ? st.outbox : [], // finished runs not uploaded yet
    backfilled: st.backfilled === true,                // this device's old top runs went up once
    sharedRev: Number.isInteger(st.sharedRev) ? st.sharedRev : 0, // the shared document's revision last seen
    sharedHash: typeof st.sharedHash === 'string' ? st.sharedHash : '', // fingerprint of it as last synced
    deviceHash: typeof st.deviceHash === 'string' ? st.deviceHash : '', // ...of this device's slot as last uploaded
    ranks: freshRanks(obj(st.ranks)),                  // 'songId|diff' -> { rank, total, near?, top?, at }: the world rank last seen
    myRanks: st.myRanks && Array.isArray(st.myRanks.rows) && isNum(st.myRanks.at) ? st.myRanks : { at: 0, rows: [] }, // every board the player is on
    rules: isNum(st.rules) ? st.rules : 0,             // the API's RULES at the last answer
    pendingProfile: obj(st.pendingProfile),            // { displayName?, public? } waiting for the next push
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

  async function request(method, path, body, { keepalive = false, auth = true, why = '' } = {}) {
    const text = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const log = debug && { why, method, path, keepalive, body: text === undefined ? null : JSON.parse(text), sent: text ? text.length : 0, t0: Date.now() };
    const done = (extra) => { if (log) { const { t0, ...e } = log; debug({ ...e, ms: Date.now() - t0, ...extra }); } };
    if (offline()) { done({ skipped: 'offline' }); throw new HttpError(0); }
    const signal = timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    let res;
    try {
      res = await fetch(apiBase + path, {
        method, keepalive, ...(signal && { signal }),
        // No Authorization or Content-Type on public reads: a simple request needs no CORS preflight.
        headers: { ...(auth && st.token && { Authorization: 'Bearer ' + st.token }), ...(text !== undefined && { 'Content-Type': 'application/json' }) },
        ...(text !== undefined && { body: text }),
      });
    } catch (e) { done({ error: String(e && (e.name === 'TimeoutError' ? 'timed out' : e.message || e)) }); throw e; }
    if (res.status === 401 && st.token) { forget(); emit('signedout'); }
    if (!res.ok) { done({ status: res.status }); throw new HttpError(res.status); }
    if (res.status === 204) { done({ status: 204, received: 0 }); return null; }
    if (!log) return res.json();
    const reply = await res.text();
    done({ status: res.status, received: reply.length, response: JSON.parse(reply) });
    return JSON.parse(reply);
  }

  // Back to signed out on this device. The device keeps its own data; the other devices' numbers leave the view.
  function forget() {
    Object.assign(st, { token: '', profile: null, syncedAt: 0, devices: {}, devicesAt: 0, outbox: [], backfilled: false,
      sharedRev: 0, sharedHash: '', deviceHash: '', ranks: {}, myRanks: { at: 0, rows: [] }, pendingProfile: {} });
    persist();
    showRemote();
    clearTimer(timer); timer = 0;
  }

  const localShared = () => ({ ...prefs.sharedSettings(), ...mysongs.shared(), resetAt: st.resetAt });
  const sharedPrint = doc => fingerprint(sharedKey(doc));
  const deviceDoc = () => ({ v: 1, scores: scores.own(), stats: stats.own() });
  const devicePrint = doc => fingerprint(JSON.stringify(doc));
  const sharedDirty = () => sharedPrint(localShared()) !== st.sharedHash;
  const profileDirty = () => Object.keys(st.pendingProfile).length > 0;
  const dirty = () => st.outbox.length > 0 || sharedDirty() || profileDirty() || devicePrint(deviceDoc()) !== st.deviceHash;
  // The profile as the server has it, with this device's changes still waiting on top.
  const showProfile = server => {
    const p = st.pendingProfile;
    const next = { ...server, ...(p.displayName && { name: p.displayName }), ...('public' in p && { public: p.public }) };
    if (JSON.stringify(next) === JSON.stringify(st.profile)) return;
    st.profile = next;
    emit('profile');
  };
  // A rename or the opt-out: shown at once, sent with the next push (within SHARED_DELAY).
  function changeProfile(change) {
    if (!st.token) throw new HttpError(401);
    st.pendingProfile = { ...st.pendingProfile, ...change };
    showProfile(st.profile);
    persist();
    kick(SHARED_DELAY);
    return st.profile;
  }

  // This device's top runs, once per sign-in: the first upload for players who played before signing in.
  function backfillRuns() {
    if (st.backfilled) return;
    const own = scores.own();
    for (const [songId, diffs] of Object.entries(own)) {
      for (const [diff, e] of Object.entries(diffs)) {
        const r = e.top[0]; // only the best run per board can change a leaderboard
        if (r) queue({ clientRunId: runId(songId, diff, r.date), songId, diff, ...r, playedAt: r.date, gameVersion: '' });
      }
    }
    st.backfilled = true;
    persist();
  }

  // The same run gets the same id from queueRun and the backfill, so the API stores it once.
  const runId = (songId, diff, playedAt) => `${deviceId}:${songId}:${diff}:${playedAt}`;

  // Runs from the outbox's first `sending` entries are in a request right now: they stay.
  let sending = 0;
  function queue(run) {
    const { date, ...rest } = run;
    if (rest.replay && rest.replay.length > MAX_REPLAY) delete rest.replay; // the API would drop it anyway
    // A better run on the same board replaces the ones still waiting: only the best can rank.
    st.outbox = st.outbox.filter((r, i) => i < sending || r.songId !== rest.songId || r.diff !== rest.diff || r.score > rest.score);
    st.outbox.push(rest);
    if (st.outbox.length > MAX_OUTBOX) st.outbox.splice(0, st.outbox.length - MAX_OUTBOX);
    let chars = st.outbox.reduce((n, r) => n + (r.replay ? r.replay.length : 0), 0);
    for (const r of st.outbox) {
      if (chars <= MAX_OUTBOX_REPLAYS) break;
      if (r.replay) { chars -= r.replay.length; delete r.replay; }
    }
  }
  // The runs for one request, in the `room` the other parts of its body leave. A first run that doesn't fit next to
  // them waits for the next request, which carries nothing else (`alone`).
  function takeBatch(room, alone) {
    let n = 0, chars = 0;
    while (n < Math.min(RUN_BATCH, st.outbox.length)) {
      const len = JSON.stringify(st.outbox[n]).length + 1;
      if (chars + len > room && (n > 0 || !alone)) break;
      chars += len; n++;
    }
    return st.outbox.slice(0, n);
  }

  // A reset deletes the player's runs on the server: what still waits to go up, and the ranks seen so far, go too.
  // The first `sending` outbox entries are in a request right now and stay (the server drops them if they are old).
  function dropOnlineRuns() {
    st.outbox.splice(sending);
    st.ranks = {};
    st.myRanks = { at: 0, rows: [] };
  }

  // Takes the answer's shared document (the server's merge of what this device sent with what it had). -> changed parts.
  function applySharedDoc(remote, changed) {
    const merged = mergeShared(localShared(), remote); // this device may have changed things while the request ran
    if (prefs.applyShared(merged)) changed.add('settings');
    if (mysongs.applyShared(merged)) changed.add('songs');
    st.resetAt = merged.resetAt;
    if (st.resetAt > st.resetSeen) {
      // Scores and stats were reset on another device: this device's own numbers go too.
      scores.clear(); stats.clear(); dropOnlineRuns();
      st.resetSeen = st.resetAt;
      changed.add('progress');
    }
    // Nothing newer here than on the server: remember the document as applied, so a store that tidies values on the
    // way in doesn't look like a fresh change. Otherwise the server's copy, and the difference goes up next time.
    st.sharedHash = sameShared(merged, remote) ? sharedPrint(localShared()) : sharedPrint(remote);
  }

  // One round through POST /sync: push what changed, pull what other devices wrote (`pull`), upload the outbox.
  // -> { ok, changed: Set('settings' | 'songs' | 'progress'), verdicts: { clientRunId: { verified, score? } } }
  async function round({ pull = true, keepalive = false, why = '', wantRanks = false } = {}) {
    const changed = new Set(), verdicts = {};
    let first = true;
    do {
      const shared = localShared(), dev = deviceDoc();
      const sendShared = sharedPrint(shared) !== st.sharedHash, devPrint = devicePrint(dev);
      const sendDevice = devPrint !== st.deviceHash;
      const sendProfile = first && profileDirty() ? { ...st.pendingProfile } : null;
      const fixed = (sendShared ? JSON.stringify(shared).length : 0) + (sendDevice ? JSON.stringify(dev).length : 0)
        + (sendProfile ? JSON.stringify(sendProfile).length : 0);
      const batch = takeBatch(BODY_BUDGET - fixed - 1000, fixed === 0);
      const askDevices = first && pull;
      const askRanks = first && wantRanks;
      if (!sendShared && !sendDevice && !sendProfile && !batch.length && !askDevices && !askRanks) break;
      const body = {
        deviceId,
        ...((pull || sendShared) && { sharedRev: st.sharedRev }),
        ...(sendShared && { shared, stampAt: now() }),
        ...(sendDevice && { device: { ...dev, updated: now() } }),
        ...(sendProfile && { profile: sendProfile }),
        ...(askDevices && { devicesSince: st.devicesAt ? Math.max(0, st.devicesAt - DEVICE_OVERLAP) : 0 }),
        ...(batch.length && { runs: batch }),
        ...(askRanks && { wantRanks: true }),
      };
      const text = JSON.stringify(body);
      setNet(sendShared || sendDevice || sendProfile || batch.length ? 'send' : 'recv');
      sending = batch.length;
      let r;
      try { r = await request('POST', '/sync', text, { keepalive: keepalive && text.length <= KEEPALIVE_MAX, why: first ? why : why + ' (more runs)' }); }
      catch (e) {
        // Refused for its size or shape: the runs lose their replays, then themselves, so they can't block the queue.
        if (batch.length && e && (e.status === 400 || e.status === 413)) {
          if (batch.some(b => b.replay)) for (const b of batch) delete b.replay;
          else st.outbox.shift();
          persist();
        }
        throw e;
      }
      finally { sending = 0; }
      if (isNum(r.rules)) st.rules = r.rules;
      if (r.shared) {
        st.sharedRev = r.shared.rev;
        const remote = r.shared.doc || (sendShared ? shared : null);
        if (remote) applySharedDoc(remote, changed);
      }
      if (sendDevice) st.deviceHash = devPrint;
      // Sent and taken (or refused): no longer waiting, unless it changed again while the request ran.
      if (sendProfile && JSON.stringify(sendProfile) === JSON.stringify(st.pendingProfile)) st.pendingProfile = {};
      if (r.profile) showProfile(r.profile);
      if (r.deviceIds) {
        const devices = {};
        for (const id of r.deviceIds) {
          if (id === deviceId) continue;
          const d = (r.devices && r.devices[id]) || st.devices[id];
          if (d && typeof d === 'object') devices[id] = d;
        }
        if (JSON.stringify(devices) !== JSON.stringify(st.devices)) changed.add('progress');
        st.devices = devices;
        // A device this one never got the slot of: ask for everything next time.
        st.devicesAt = r.deviceIds.every(id => id === deviceId || devices[id]) ? r.at : 0;
        showRemote();
      }
      for (const v of r.runs || []) verdicts[v.clientRunId] = v;
      for (const [key, v] of Object.entries(r.ranks || {})) {
        st.ranks[key] = { rank: v.rank, total: v.total, near: v.near, top: v.top, at: now() };
        if (!Array.isArray(r.myRanks)) patchRanked(key, v);
      }
      if (Array.isArray(r.myRanks)) st.myRanks = { at: now(), rows: r.myRanks };
      if (batch.length) st.outbox.splice(0, batch.length);
      if (pull && first) st.syncedAt = now();
      persist();
      first = false;
      if (pull) backfillRuns(); // after the first answer, so a reset from another device is applied first
    } while (st.outbox.length);
    return { ok: true, changed, verdicts };
  }

  // A run just ranked: the answer already says where the player stands, so the ranks overview and the board snapshot
  // are edited to match instead of being fetched again.
  function patchRanked(key, v) {
    const me = (v.near || []).find(n => n.me);
    if (!me) { st.myRanks.at = 0; return; } // no score to patch with: ask again
    const cut = key.lastIndexOf('|'), songId = key.slice(0, cut), diff = key.slice(cut + 1);
    if (st.myRanks.at) { // never fetched: a partial list would pass for the whole one
      const rows = st.myRanks.rows.filter(r => r.songId !== songId || r.diff !== diff);
      rows.push({ songId, diff, score: me.score, rank: v.rank, total: v.total });
      rows.sort((a, b) => a.rank / a.total - b.rank / b.total || (a.songId < b.songId ? -1 : 1));
      st.myRanks.rows = rows.slice(0, 500);
    }
    if (!boards.value) return;
    if (Array.isArray(v.top)) boards.value.boards[key] = v.top; // the server's own top, no guessing
    else patchGuess(key, me, v.total);
    try { storage.setItem(BOARDS_KEY, JSON.stringify({ at: boards.at, value: boards.value })); } catch { /* ignore */ }
  }
  function patchGuess(key, me, total) {
    const top = boards.value.boards[key];
    if (!top) return;
    const next = top.filter(r => r.name !== me.name);
    const { me: _, ...row } = me; // keeps the FC/AP/mods/DEV fields of the answer's row
    next.push({ accuracy: 0, maxCombo: 0, mods: [], ...row, playedAt: now() });
    next.sort((a, b) => b.score - a.score);
    boards.value.boards[key] = next.slice(0, BOARD_TOP).map((r, i) => ({ ...r, rank: i + 1, total }));
  }

  // What the connection is doing, for the status bar: 'idle', 'send' or 'recv' (a request is out), 'error' (the last round failed).
  let net = 'idle';
  const setNet = n => { if (n !== net) { net = n; emit({ net }); } };

  // Failures back off (1, 2, 4 … 30 minutes; "slow down" starts at 5) instead of retrying on every trigger.
  let backoffUntil = 0, backoffMs = 0;
  const failed = e => {
    if (e && e.status === 401) return; // signed out already
    backoffMs = Math.min(30 * 60e3, Math.max(e && e.status === 429 ? 5 * 60e3 : 60e3, backoffMs * 2));
    backoffUntil = now() + backoffMs;
  };

  // Every round goes through one queue: a sync, the results screen's submit and the hide flush never overlap.
  let chain = Promise.resolve();
  const enqueue = opts => {
    const p = chain.then(() => round(opts)).then(r => { backoffMs = 0; backoffUntil = 0; setNet('idle'); return r; },
      e => { failed(e); setNet(e && e.status === 401 ? 'idle' : 'error'); return { ok: false, changed: new Set(), verdicts: {} }; });
    chain = p;
    return p.then(r => { if (r.changed.size) emit({ synced: r.changed }); return r; });
  };
  let pulling = null, pressedAt = -Infinity, ranksLoading = false;

  // The one timer: fires at the earliest time something asked for, waits out a song and a backoff.
  let timer = 0, timerAt = 0, wantPull = false, lastNote = '';
  // A held-back sync, for the request log (the busy retry repeats every few seconds: logged once).
  const note = (why, skipped) => {
    if (!debug || lastNote === why + skipped) return;
    lastNote = why + skipped;
    debug({ why, skipped });
  };
  function kick(ms) {
    if (!st.token || !apiBase) return;
    const at = now() + ms;
    if (timer && timerAt <= at) return;
    clearTimer(timer);
    timerAt = at;
    timer = setTimer(fire, ms);
  }
  function fire() {
    timer = 0;
    if (!st.token) return;
    if (isBusy()) { note('push', 'a song is playing'); kick(BUSY_RETRY); return; }
    if (now() < backoffUntil) { note('push', 'backing off'); kick(backoffUntil - now()); return; }
    if (wantPull) cloud.sync('tab back');
    else if (dirty()) enqueue({ pull: false, why: 'push' });
  }

  const boards = { value: null, at: -Infinity, failedAt: -Infinity, loading: null };
  try {
    const b = JSON.parse(storage.getItem(BOARDS_KEY));
    if (b && isNum(b.at) && b.value && typeof b.value.boards === 'object') Object.assign(boards, { value: b.value, at: b.at });
  } catch { /* ignore */ }

  const cloud = {
    deviceId,
    available: () => !!apiBase,
    signedIn: () => !!st.token,
    profile: () => st.profile,
    // Signed in with the developer flag (set by hand in D1): shows the Admin app in the menu.
    isDev: () => !!(st.token && st.profile && st.profile.dev),
    lastSync: () => st.syncedAt,
    pendingRuns: () => st.outbox.length,
    // 'off' signed out (or no API), else 'idle' | 'send' | 'recv' | 'error'.
    netState: () => (st.token && apiBase ? net : 'off'),
    // 'synced' after a sync that changed something (with the Set of what), 'signedin', 'signedout', 'profile',
    // { net } when netState() changes.
    onChange: f => listeners.push(f),
    signInUrl: returnTo => apiBase + (devLogin ? '/auth/dev/start' : '/auth/github/start') + '?return=' + encodeURIComponent(returnTo),

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

    // A full round now: start of the game, the Sync button, after signing in. Ignores the backoff.
    sync(why = 'sync') {
      clearTimer(timer); timer = 0; wantPull = false; lastNote = '';
      if (!st.token || !apiBase) return Promise.resolve({ ok: false, changed: new Set() });
      if (!pulling) pulling = enqueue({ pull: true, why }).finally(() => { pulling = null; });
      return pulling;
    },
    // The Sync button: a full round, at most once per SYNC_COOLDOWN (counted from the last sync too, so a press right
    // after the game started waits). -> sync()'s answer, or { ok: true, cooling: true } without a request.
    syncNow() {
      if (cloud.syncCooldown() > 0) { note('Sync button', 'cooling down'); return Promise.resolve({ ok: true, changed: new Set(), cooling: true }); }
      pressedAt = now();
      return cloud.sync('Sync button');
    },
    // Milliseconds until the Sync button works again (0 = now).
    syncCooldown: () => (st.token ? Math.max(0, Math.max(st.syncedAt, pressedAt) + SYNC_COOLDOWN - now()) : 0),
    // The tab is back: pull only when the last sync is old.
    wake() {
      if (!st.token || !apiBase) return;
      if (now() - st.syncedAt < PULL_EVERY) { note('tab back', `synced ${Math.round((now() - st.syncedAt) / 1000)} s ago`); return; }
      if (now() < backoffUntil) { note('tab back', 'backing off'); return; }
      if (isBusy()) { wantPull = true; note('tab back', 'a song is playing'); kick(BUSY_RETRY); return; }
      cloud.sync('tab back');
    },
    // Something local may have changed (a save, a run, a song edit): a push later, only if anything differs.
    // Settings, favourites and songs go up within SHARED_DELAY; scores, stats and runs within PUSH_EVERY.
    schedule(ms) {
      if (!st.token || !apiBase) return;
      if (isNum(ms)) { kick(ms); return; }
      lastNote = '';
      if (sharedDirty()) kick(SHARED_DELAY);
      else if (!timer && dirty()) kick(PUSH_EVERY); // a timer already waiting checks everything when it fires
    },
    // The page is going away or hidden: push what changed (no answer needed to merge, but taken when it comes).
    flush() {
      if (!st.token || !apiBase || !dirty()) return;
      if (now() < backoffUntil) { note('tab hidden', 'backing off'); return; }
      enqueue({ pull: false, keepalive: true, why: 'tab hidden' });
    },

    // A finished run, for the leaderboards. Pass the result with the `date` the scores store recorded it under. `play`
    // makes it rankable: { replay (replay.js encodeLog), rules, loadout (the mods as played), rtttl (custom songs) };
    // the API re-plays it and ranks its own score. It goes up with the next push, or now with submit(). -> its id.
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
      kick(PUSH_EVERY);
      return id;
    },
    // Upload waiting runs (and whatever else changed) now: a new best wants its world rank. One request; the rank comes
    // back with it (rank()). -> the verdicts, { clientRunId: { verified, score? } }, {} on failure.
    async submit() {
      if (!st.token || !apiBase) return {};
      const r = await enqueue({ pull: false, why: 'new best' });
      if (!r.ok) cloud.schedule(PUSH_EVERY);
      return r.verdicts;
    },
    // The world rank last seen for a song and difficulty: { rank, total, at } or null. No request.
    // A newer snapshot that has the player in its top overrides the rank and total last seen.
    rank(songId, diff) {
      const key = songId + '|' + diff, k = st.ranks[key];
      if (!k) return null;
      const v = boards.value, me = (k.near || []).find(n => n.me);
      const row = me && v && v.boards && v.rules === st.rules && boards.at > k.at && (v.boards[key] || []).find(r => r.name === me.name);
      return row ? { ...k, rank: row.rank, total: row.total } : k;
    },
    // The players around the player on one board, from the sync that ranked their run: [{ rank, name, score, grade,
    // me? }] or null. No request.
    // The world top runs as the sync that ranked the player's run saw them, or null.
    // Only while fresh; after that the snapshot is as good.
    rankTop(songId, diff) {
      const k = st.ranks[songId + '|' + diff];
      return k && k.top && now() - k.at < BOARDS_TTL ? k.top : null;
    },
    rankNear: (songId, diff) => (st.ranks[songId + '|' + diff] || {}).near || null,
    // The player's rank on every board they are on, for the stats screen: { rows: [{ songId, diff, score, rank, total }],
    // at, loading }. Served from the last answer; asks (one sync, with whatever else is waiting) only when it is older
    // than `max` and nothing is on its way. `onChange({ranks:true})` fires when it arrives.
    myRanks({ max = RANKS_TTL } = {}) {
      const stale = !st.myRanks.at || now() - st.myRanks.at >= max; // 0: never asked, or a run just ranked
      if (stale && st.token && apiBase && !ranksLoading && now() >= backoffUntil) {
        ranksLoading = true;
        enqueue({ pull: false, why: 'ranks', wantRanks: true }).then(r => { ranksLoading = false; if (r.ok) emit({ ranks: true }); });
      }
      return { rows: st.myRanks.rows, at: st.myRanks.at, loading: ranksLoading };
    },
    // The API's RULES at its last answer (0 = no answer yet).
    serverRules: () => st.rules,

    // The world top runs of one song and difficulty, from the leaderboard snapshot (one request for every song, kept
    // for BOARDS_TTL; `onFresh(view)` is called again if a newer snapshot arrives). Needs a sign-in: signed out sends no request. -> { rules, runs: [{ rank, total, name, score, grade, accuracy, maxCombo, fc,
    // ap, mods, playedAt }] } or null.
    async board(songId, diff, onFresh) {
      if (!apiBase || !st.token) return null;
      const t = now();
      if (t - boards.at >= BOARDS_TTL && t - boards.failedAt >= 60e3 && !boards.loading) {
        boards.loading = request('GET', '/boards', undefined, { auth: false, why: 'boards' }).then(v => {
          if (!v || typeof v.boards !== 'object') throw new Error('bad boards');
          Object.assign(boards, { value: v, at: now() });
          try { storage.setItem(BOARDS_KEY, JSON.stringify({ at: boards.at, value: v })); } catch { /* ignore */ }
        }).catch(() => { boards.failedAt = now(); }).finally(() => { boards.loading = null; });
      }
      if (boards.loading && !boards.value) await boards.loading; // an old snapshot shows while a new one loads
      const view = () => boards.value ? { rules: boards.value.rules, runs: boards.value.boards[songId + '|' + diff] || [] } : null;
      // An old snapshot is answered at once; `onFresh` gets the view again when the load in flight lands.
      if (onFresh && boards.loading && boards.value) boards.loading.then(() => { if (boards.value) onFresh(view()); });
      return view();
    },
    // Where a score would land, from the snapshot alone (no request): { rank, total } for the top 10, else null. A guess:
    // the snapshot is up to 25 minutes old, so the answer to submit() has the last word.
    guessRank(songId, diff, score) {
      const v = boards.value, key = songId + '|' + diff;
      if (!st.token || !v || v.rules !== st.rules || !v.boards) return null;
      const rows = v.boards[key] || [], known = st.ranks[key];
      const rank = rows.filter(r => r.score >= score).length + 1; // a tie goes to the earlier run
      if (rank > BOARD_TOP) return null;
      return { rank, total: known ? known.total : (rows.length ? rows[0].total : 0) + 1 };
    },
    // On leaderboards or not; goes up with the next push. -> the profile as shown.
    setPublic: on => changeProfile({ public: !!on }),

    // Scores and stats were reset on this device: every device resets on its next sync.
    markReset() {
      if (!st.token) return; // a reset while signed out stays on this device
      st.resetAt = st.resetSeen = now();
      dropOnlineRuns();
      persist();
      showRemote();
      kick(500);
    },

    // A new player name, checked here as the API checks it (a bad one throws { status: 400 }); goes up with the next
    // push. -> the profile as shown.
    rename(name) {
      const clean = cleanName(name);
      if (!clean) throw new HttpError(400);
      return changeProfile({ displayName: clean });
    },
    async signOut() {
      // What still waits (a rename, runs, scores) goes up first: it would be lost with the token.
      if (dirty()) await enqueue({ pull: false, why: 'sign out' });
      try { await request('POST', '/auth/logout', undefined, { why: 'sign out' }); } catch { /* signed out locally either way */ }
      forget();
      emit('signedout');
    },
    // Everything the server stores about the player (GDPR export); what still waits goes up first so the file is current.
    async exportData() {
      if (dirty()) await enqueue({ pull: false, why: 'export' });
      return request('GET', '/me/export', undefined, { why: 'export' });
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
