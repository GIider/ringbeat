// Cloud save end to end: the Worker (server/src/index.js) over an in-memory SQLite stand-in for D1, and two simulated
// devices (src/cloud.js with real stores) syncing through it. GitHub is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle, playerName } from '../server/src/index.js';
import { createCloud } from '../src/cloud.js';
import { createScores } from '../src/scores.js';
import { createStats } from '../src/stats.js';
import { createMySongs } from '../src/mysongs.js';
import { SYNCED_SETTINGS } from '../src/cloudmerge.js';

const API = 'https://api.test';
const GAME = 'https://giider.github.io/ringbeat/';
const SONG_A = 'A:d=4,o=5,b=120:c,d,e,f,g,a,b,c6';

// The slice of the D1 API the Worker uses.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/migrations/0001_init.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    db,
    prepare: sql => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

function server() {
  const env = { DB: d1(), GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'secret', ALLOWED_ORIGINS: 'https://giider.github.io,http://localhost:*' };
  let clock = 1_000_000;
  const call = (path, init = {}) => handle(new Request(API + path, { ...init, headers: { Origin: 'https://giider.github.io', ...(init.headers || {}) } }), env, clock);
  return { env, call, tick: ms => { clock += ms; } };
}

// Fakes GitHub for one sign-in as `githubId` (`user`: the rest of GitHub's /user answer); returns the one-time code from
// the redirect back to the game.
async function githubSignIn(srv, githubId = 42, user = { login: 'x', name: null }) {
  const start = await srv.call('/auth/github/start?return=' + encodeURIComponent(GAME + '#s=junk'));
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://github.com/login/oauth/access_token')) {
      assert.equal(JSON.parse(init.body).client_secret, 'secret');
      return Response.json({ access_token: 'gho_x' });
    }
    if (String(url) === 'https://api.github.com/user') return Response.json({ id: githubId, email: 'x@y', ...user });
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const cb = await srv.call(`/auth/github/callback?code=abc&state=${state}`);
    assert.equal(cb.status, 302);
    const loc = cb.headers.get('Location');
    assert.ok(loc.startsWith(GAME + '#login='), loc);
    return loc.slice(GAME.length);
  } finally { globalThis.fetch = real; }
}

const mem = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

// A device: real stores on its own storage, a minimal settings stand-in, the cloud client talking to the Worker.
function device(srv, t = { now: 1000 }) {
  const storage = mem();
  const scores = createScores(storage), stats = createStats(storage, () => t.now), mysongs = createMySongs(storage);
  const prefs = {
    values: { voice: 'buzzer' }, stamps: {}, favs: {},
    set(k, v) { this.values[k] = v; this.stamps[k] = t.now; },
    sharedSettings() { return { settings: { ...this.values }, settingsT: { ...this.stamps }, favorites: structuredClone(this.favs) }; },
    applyShared(doc) {
      const before = JSON.stringify(this.sharedSettings());
      for (const k of SYNCED_SETTINGS) if (k in doc.settings) this.values[k] = doc.settings[k];
      Object.assign(this.stamps, doc.settingsT); this.favs = structuredClone(doc.favorites);
      return JSON.stringify(this.sharedSettings()) !== before;
    },
  };
  const fetch = (url, init) => srv.call(url.slice(API.length), init);
  const cloud = createCloud({ scores, stats, mysongs, prefs, apiBase: API, storage, fetch, now: () => t.now, gameVersion: '1.6.0' });
  return { storage, scores, stats, mysongs, prefs, cloud, t };
}

const result = (score, date) => ({ score, date, grade: 'A', accuracy: 0.9, maxCombo: 12, fc: false, ap: false });

test('worker: CORS only for allowed origins; unknown routes and missing tokens are refused', async () => {
  const srv = server();
  const pre = await srv.call('/sync', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://giider.github.io');
  const evil = await srv.call('/sync', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
  const local = await srv.call('/sync', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080' } });
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
  assert.equal((await srv.call('/sync')).status, 401);
  assert.equal((await srv.call('/sync', { headers: { Authorization: 'Bearer ' + 'x'.repeat(40) } })).status, 401);
  assert.equal((await srv.call('/auth/github/start?return=' + encodeURIComponent('https://evil.example/'))).status, 400);
  assert.equal((await srv.call('/auth/github/callback?code=1&state=nope')).status, 400);
});

test('worker: sign-in stores only the GitHub id; codes are single use; names are checked; delete removes everything', async () => {
  const srv = server();
  const code = (await githubSignIn(srv, 7)).slice('#login='.length);
  const ex = await srv.call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code }) });
  assert.equal(ex.status, 200);
  const { token, profile } = await ex.json();
  assert.match(profile.name, /^Player-[A-Z2-9]{4}$/);
  assert.deepEqual(profile.logins, ['github']);
  assert.equal((await srv.call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code }) })).status, 400, 'single use');
  const db = srv.env.DB.db;
  assert.deepEqual(db.prepare('SELECT provider, subject FROM identities').all().map(r => ({ ...r })), [{ provider: 'github', subject: '7' }]);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM users').all()).includes('x@y'), 'no email stored');

  const auth = { Authorization: 'Bearer ' + token };
  for (const bad of ['ab', 'x'.repeat(17), 'semi;colon', 'a!b', 'Ümlaut']) {
    assert.equal((await srv.call('/me', { method: 'PATCH', headers: auth, body: JSON.stringify({ displayName: bad }) })).status, 400, bad);
  }
  const ok = await srv.call('/me', { method: 'PATCH', headers: auth, body: JSON.stringify({ displayName: 'Ring  Master' }) });
  assert.equal((await ok.json()).profile.name, 'Ring Master');

  // Signing in again with the same GitHub account finds the same profile.
  const code2 = (await githubSignIn(srv, 7)).slice('#login='.length);
  const again = await (await srv.call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code: code2 }) })).json();
  assert.equal(again.profile.id, profile.id);

  assert.equal((await srv.call('/me', { method: 'DELETE', headers: auth })).status, 204);
  for (const t of ['users', 'identities', 'sessions', 'shared_docs', 'device_slots', 'runs']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
});

test('worker: the GitHub display name (else the login) becomes the first player name, cleaned up', async () => {
  assert.equal(playerName('Jürgen Weiß'), 'Jurgen Weiss');
  assert.equal(playerName('  Ana  María  López-García  '), 'Ana Maria');
  assert.equal(playerName('Some Very Long Name Here'), 'Some Very Long');
  assert.equal(playerName('ab cdefghijklmn x'), 'ab cdefghijklmn');
  assert.equal(playerName('Supercalifragilistic'), 'Supercalifragili');
  assert.equal(playerName('--neo--'), 'neo');
  for (const bad of [null, '', 'Jo', '李小龙', '🎵🎵🎵']) assert.equal(playerName(bad), '', String(bad));

  const srv = server();
  const exchange = async hash => (await (await srv.call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code: hash.slice(7) }) })).json()).profile;
  assert.equal((await exchange(await githubSignIn(srv, 1, { login: 'octo-cat', name: 'Mona Lisa Octocat' }))).name, 'Mona Lisa');
  assert.equal((await exchange(await githubSignIn(srv, 2, { login: 'octo-cat', name: '李' }))).name, 'octo-cat');
  const p3 = await exchange(await githubSignIn(srv, 3, { login: 'x', name: null }));
  assert.match(p3.name, /^Player-/);
  // A profile still on its generated name takes the GitHub name on the next sign-in; a chosen name is kept.
  assert.equal((await exchange(await githubSignIn(srv, 3, { login: 'later-name' }))).name, 'later-name');
  srv.env.DB.db.prepare("UPDATE users SET display_name = 'Mine' WHERE display_name = 'later-name'").run();
  assert.equal((await exchange(await githubSignIn(srv, 3, { login: 'other-name' }))).name, 'Mine');
});

test('worker: the shared document is guarded by its revision; runs are deduplicated and checked', async () => {
  const srv = server();
  const code = (await githubSignIn(srv)).slice('#login='.length);
  const { token } = await (await srv.call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code }) })).json();
  const h = { Authorization: 'Bearer ' + token };
  const put = (doc, baseRev) => srv.call('/sync/shared', { method: 'PUT', headers: h, body: JSON.stringify({ doc, baseRev }) });
  assert.equal((await put({ a: 1 }, 0)).status, 200);
  assert.equal((await put({ a: 2 }, 0)).status, 409);
  assert.equal((await put({ a: 2 }, 1)).status, 200);
  assert.equal((await put({ a: 3 }, 1)).status, 409);
  assert.equal((await put({ big: 'x'.repeat(260_000) }, 2)).status, 400);
  const sync = await (await srv.call('/sync', { headers: h })).json();
  assert.deepEqual(sync.shared, { doc: { a: 2 }, rev: 2 });

  const runs = [
    { clientRunId: 'r1', songId: 's', diff: 'normal', score: 10 },
    { clientRunId: 'r1', songId: 's', diff: 'normal', score: 10 },
    { clientRunId: 'r2', songId: 's', diff: 'insane', score: 10 },
    { clientRunId: 'r3', songId: 's', diff: 'hard', score: -5 },
  ];
  assert.deepEqual(await (await srv.call('/runs', { method: 'POST', headers: h, body: JSON.stringify({ runs }) })).json(), { accepted: 2 });
  assert.equal(srv.env.DB.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1);
});

test('two devices: scores, stats, settings and songs meet; runs go up once', async () => {
  const srv = server();
  const a = device(srv), b = device(srv);
  // Device A played before signing in.
  a.scores.record('s1', 'normal', result(500, 10));
  a.stats.recordRun({ diff: 'normal', result: { score: 500 } });
  a.mysongs.add('Mine', SONG_A, 900);
  a.prefs.set('voice', 'smooth');

  assert.equal(await a.cloud.takeLoginHash(await githubSignIn(srv)), true);
  assert.equal((await a.cloud.sync()).ok, true);
  assert.equal(await b.cloud.takeLoginHash(await githubSignIn(srv)), true);
  b.t.now = 2000;
  b.scores.record('s1', 'normal', result(700, 20));
  b.cloud.queueRun('s1', 'normal', result(700, 20), ['x1.2']);
  const rb = await b.cloud.sync();
  assert.ok(rb.ok && rb.changed.has('settings') && rb.changed.has('songs') && rb.changed.has('progress'));
  assert.equal(b.prefs.values.voice, 'smooth');
  assert.deepEqual(b.mysongs.list().map(s => s.name), ['Mine']);
  assert.equal(b.scores.get('s1', 'normal').best.score, 700);
  assert.equal(b.scores.get('s1', 'normal').plays, 2);
  assert.equal(b.stats.get().runs, 1);

  await a.cloud.sync();
  assert.deepEqual(a.scores.get('s1', 'normal').top.map(r => r.score), [700, 500]);
  assert.deepEqual(a.scores.own().s1.normal.top.map(r => r.score), [500], 'own data stays own');
  const runs = srv.env.DB.db.prepare('SELECT score, mods, game_version FROM runs ORDER BY score').all().map(r => ({ ...r }));
  assert.deepEqual(runs, [{ score: 500, mods: '[]', game_version: '' }, { score: 700, mods: '["x1.2"]', game_version: '1.6.0' }]);
  assert.equal(a.cloud.pendingRuns(), 0);
});

test('two devices: the first device\'s untouched settings beat the second\'s untouched ones', async () => {
  const srv = server();
  const a = device(srv), b = device(srv);
  a.prefs.values = { voice: 'smooth', juice: true }; b.prefs.values = { voice: 'buzzer', juice: false }; // never stamped
  await a.cloud.takeLoginHash(await githubSignIn(srv)); await a.cloud.sync();
  await b.cloud.takeLoginHash(await githubSignIn(srv)); await b.cloud.sync();
  assert.deepEqual(b.prefs.values, { voice: 'smooth', juice: true });
  b.t.now = 5000; b.prefs.set('voice', 'buzzer');
  await b.cloud.sync(); await a.cloud.sync();
  assert.equal(a.prefs.values.voice, 'buzzer', 'a real change still wins');
});

test('two devices: concurrent edits merge through a 409; deletes travel; a reset reaches the other device', async () => {
  const srv = server();
  const a = device(srv), b = device(srv);
  await a.cloud.takeLoginHash(await githubSignIn(srv)); await a.cloud.sync();
  await b.cloud.takeLoginHash(await githubSignIn(srv)); await b.cloud.sync();
  a.t.now = 3000; a.prefs.set('voice', 'smooth');
  const song = a.mysongs.add('Gone soon', SONG_A, 3000);
  await a.cloud.sync();
  await b.cloud.sync();
  assert.equal(b.mysongs.count(), 1);

  // B edits offline from a stale shared copy: its PUT meets a newer revision, merges and retries.
  b.t.now = 4000; b.prefs.set('juice', false);
  a.t.now = 5000; a.mysongs.remove(song.uid, 5000);
  await a.cloud.sync();
  assert.equal((await b.cloud.sync()).ok, true);
  assert.equal(b.mysongs.count(), 0);
  assert.equal(b.prefs.values.voice, 'smooth');
  await a.cloud.sync();
  assert.equal(a.prefs.values.juice, false);

  b.scores.record('s9', 'hard', result(100, 4500));
  await b.cloud.sync();
  await a.cloud.sync();
  assert.ok(a.scores.get('s9', 'hard'));
  a.t.now = 6000;
  a.scores.clear(); a.stats.clear(); a.cloud.markReset();
  assert.equal(a.scores.get('s9', 'hard'), null, 'other devices drop out of the view at once');
  await a.cloud.sync();
  b.t.now = 7000;
  const r = await b.cloud.sync();
  assert.ok(r.changed.has('progress'));
  assert.equal(b.scores.get('s9', 'hard'), null);
  assert.deepEqual(b.scores.own(), {});
});

test('cloud: signed out makes no requests; a 401 signs out and keeps local data; sign out clears the remote view', async () => {
  const srv = server();
  let calls = 0;
  const storage = mem(), scores = createScores(storage), stats = createStats(storage), mysongs = createMySongs(storage);
  const prefs = { sharedSettings: () => ({ settings: {}, settingsT: {}, favorites: {} }), applyShared: () => false };
  const cloud = createCloud({ scores, stats, mysongs, prefs, apiBase: API, storage, fetch: (u, i) => { calls++; return srv.call(u.slice(API.length), i); } });
  assert.equal((await cloud.sync()).ok, false);
  cloud.queueRun('s', 'normal', result(1, 1));
  cloud.schedule(); cloud.flush();
  assert.equal(calls, 0);
  assert.equal(await cloud.takeLoginHash('#s=abc'), false);

  await cloud.takeLoginHash(await githubSignIn(srv));
  scores.record('s', 'normal', result(5, 5));
  assert.equal((await cloud.sync()).ok, true);
  const events = [];
  cloud.onChange(e => events.push(e));
  srv.env.DB.db.exec('DELETE FROM sessions');
  assert.equal((await cloud.sync()).ok, false);
  assert.equal(cloud.signedIn(), false);
  assert.deepEqual(events, ['signedout']);
  assert.equal(scores.get('s', 'normal').best.score, 5);

  const again = createCloud({ scores, stats, mysongs, prefs, apiBase: API, storage, fetch: (u, i) => srv.call(u.slice(API.length), i) });
  assert.equal(again.signedIn(), false, 'the sign-out was stored');
  assert.equal(again.deviceId, cloud.deviceId, 'the device keeps its id');
});

test('cloud: no API configured means no online profile', async () => {
  const storage = mem();
  const cloud = createCloud({ scores: createScores(storage), stats: createStats(storage), mysongs: createMySongs(storage),
    prefs: { sharedSettings: () => ({}), applyShared: () => false }, apiBase: '', storage, fetch: () => { throw new Error('no'); } });
  assert.equal(cloud.available(), false);
  assert.equal(await cloud.takeLoginHash('#login=' + 'a'.repeat(43)), false);
});
