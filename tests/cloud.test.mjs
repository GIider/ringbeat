// Cloud save end to end: the Worker (server/src/index.js) over an in-memory SQLite stand-in for D1, and two simulated
// devices (src/cloud.js with real stores) syncing through it. GitHub is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle, playerName, verifyPending, rebuildBoards } from '../server/src/index.js';
import { RULES, encodeLog, headlessGame } from '../src/replay.js';
import { planBot, LADDER } from '../src/bot.js';
import { generateChart } from '../src/chart.js';
import { parseRTTTL } from '../src/rtttl.js';
import { SONGS } from '../src/songs.js';
import { hashString } from '../src/library.js';
import * as mods from '../src/mods.js';
import { createCloud } from '../src/cloud.js';
import { createNetDebug, describe, line } from '../src/netdebug.js';
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
  const dir = new URL('../server/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
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
function device(srv, t = { now: 1000 }, opts = {}) {
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
  const calls = [];
  const fetch = (url, init) => { calls.push({ path: url.slice(API.length), init }); return srv.call(url.slice(API.length), init); };
  const cloud = createCloud({ scores, stats, mysongs, prefs, apiBase: API, storage, fetch, now: () => t.now, gameVersion: '1.6.0', ...opts });
  return { storage, scores, stats, mysongs, prefs, cloud, t, calls };
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
  assert.equal((await srv.call('/sync', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await srv.call('/sync', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer ' + 'x'.repeat(40) } })).status, 401);
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

test('worker: POST /sync merges the shared document under its revision; runs are deduplicated and checked', async () => {
  const srv = server();
  const code = (await githubSignIn(srv)).slice('#login='.length);
  const { token } = await (await srv.call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code }) })).json();
  const h = { Authorization: 'Bearer ' + token };
  const sync = async body => {
    const r = await srv.call('/sync', { method: 'POST', headers: h, body: JSON.stringify({ deviceId: 'device0001', ...body }) });
    return { status: r.status, body: await r.json() };
  };
  const doc = (voice, t) => ({ settings: { voice }, settingsT: { voice: t } });
  // The first copy gets its never-changed settings stamped with the device's clock, so the answer brings it back.
  let r = await sync({ shared: doc('a', 0), sharedRev: 0, stampAt: 77 });
  assert.deepEqual([r.body.shared.rev, r.body.shared.doc.settingsT.voice], [1, 77]);
  // A device that saw no revision yet: its older change loses to the stored one, and the answer brings the merge.
  r = await sync({ shared: doc('b', 50), sharedRev: 0 });
  assert.deepEqual([r.body.shared.rev, r.body.shared.doc.settings.voice], [1, 'a'], 'nothing new: no write');
  r = await sync({ shared: doc('c', 100), sharedRev: 1 });
  assert.deepEqual(r.body.shared, { rev: 2 });
  r = await sync({ sharedRev: 1 });
  assert.deepEqual([r.body.shared.rev, r.body.shared.doc.settings.voice], [2, 'c']);
  assert.equal((await sync({ sharedRev: 2 })).body.shared, undefined, 'up to date: nothing comes down');
  assert.equal((await sync({ shared: { settings: { voice: 'x'.repeat(260_000) }, settingsT: { voice: 200 } } })).status, 400);
  assert.equal((await sync({ shared: [1] })).status, 400);
  assert.equal((await sync({ device: { v: 1 }, deviceId: 'BAD' })).status, 400);

  const runs = [
    { clientRunId: 'r1', songId: 's', diff: 'normal', score: 10 },
    { clientRunId: 'r1', songId: 's', diff: 'normal', score: 10 },
    { clientRunId: 'r2', songId: 's', diff: 'insane', score: 10 },
    { clientRunId: 'r3', songId: 's', diff: 'hard', score: -5 },
  ];
  assert.equal((await sync({ runs })).body.runs.length, 2);
  assert.equal(srv.env.DB.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1);
  assert.equal((await sync({ runs: Array(51).fill(runs[0]) })).status, 400);
  // The routes before 2.2 are gone.
  for (const [method, path] of [['GET', '/sync'], ['PUT', '/sync/shared'], ['PUT', '/sync/device/device0001'], ['POST', '/runs']]) {
    assert.equal((await srv.call(path, { method, headers: h, ...(method !== 'GET' && { body: '{}' }) })).status, 404, path);
  }
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

// ---- leaderboards: the Worker re-plays each run's input log and ranks its own score ----

// A run as the game uploads it: a bot plays `songId` with the game's frame loop, the log is encoded.
function played(songId, diff, skill, loadout = null, seed = 1, rtttl = SONGS.find(s => s.id === songId)?.rtttl) {
  const m = mods.normalize(loadout);
  const chart = mods.applyChart(generateChart(parseRTTTL(rtttl), { difficulty: diff }), m);
  const g = headlessGame();
  let res = null;
  g.onFinish = r => { res = r; };
  g.start({ ...chart, notes: chart.notes.map(n => ({ ...n })) }, { leadIn: 0, ...mods.gameOptions(m) });
  const ev = planBot(chart, skill, seed);
  let i = 0;
  for (let t = 0; !res; t += 1 / 60) {
    for (; i < ev.length && ev[i].t <= t; i++) (ev[i].type === 'press' ? g.press : g.release).call(g, ev[i].lane, ev[i].t);
    g.update(t);
  }
  const mult = mods.isActive(m) ? mods.multiplier(m) : 1;
  return {
    result: { ...res, score: Math.round(res.score * mult), mult },
    run: { songId, diff, score: Math.round(res.score * mult), grade: res.grade, accuracy: res.accuracy, maxCombo: res.maxCombo,
      fc: res.fc, ap: res.ap, mods: mods.tags(m), mult, playedAt: seed, replay: encodeLog(g.log), rules: RULES, loadout: m },
  };
}

async function signedIn(srv, githubId, name) {
  const code = (await githubSignIn(srv, githubId, { login: name, name })).slice('#login='.length);
  const { token, profile } = await (await srv.call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code }) })).json();
  const h = { Authorization: 'Bearer ' + token };
  const post = async runs => (await srv.call('/sync', { method: 'POST', headers: h, body: JSON.stringify({ deviceId: 'device0001', runs }) })).json();
  return { h, post, id: profile.id };
}
const boardOf = async (srv, song, diff, h) => (await srv.call(`/board/${encodeURIComponent(song)}/${diff}${h ? '/me' : ''}`, h ? { headers: h } : {})).json();
const rowOf = (srv, id) => ({ ...srv.env.DB.db.prepare('SELECT * FROM runs WHERE client_run_id = ?').get(id) });

test('leaderboards: the server re-plays a run and keeps its own numbers; bad runs never rank', async () => {
  const srv = server();
  const u = await signedIn(srv, 1, 'Alice');
  const { run, result } = played('ode', 'normal', LADDER[3]);
  assert.ok(result.counts.great + result.counts.good + result.counts.miss > 0, 'an imperfect run');
  const loud = { ...run, clientRunId: 'a1', score: 9_999_999, grade: 'S', accuracy: 100, fc: true, ap: true };
  const r = await u.post([loud]);
  assert.deepEqual(r.runs, [{ clientRunId: 'a1', verified: 1, score: result.score }]);
  const row = rowOf(srv, 'a1');
  assert.equal(row.score, result.score);
  assert.equal(row.accuracy, result.accuracy, 'accuracy is stored in percent');
  assert.equal(row.ap, result.ap ? 1 : 0);
  assert.equal(row.rules, String(RULES));

  // Mods: the multiplier folds in as the game does; the stored tags are the server's.
  const modded = played('ode', 'normal', LADDER[3], { speed: 1.2, hidden: true });
  await u.post([{ ...modded.run, clientRunId: 'a2', mods: ['fake'] }]);
  assert.equal(rowOf(srv, 'a2').score, modded.result.score);
  assert.equal(rowOf(srv, 'a2').mods, '["1.2x","HD"]');

  const bad = [
    { ...run, clientRunId: 'b1', replay: run.replay.slice(0, -8) },             // garbled
    { ...run, clientRunId: 'b2', loadout: { demo: true } },                      // autoplay
    { ...run, clientRunId: 'b3', songId: 'no-such-song' },
    { ...run, clientRunId: 'b5', songId: 'custom:abc', rtttl: SONG_A },          // melody doesn't match the id
  ];
  assert.deepEqual((await u.post(bad)).runs.map(x => x.verified), [-1, -1, -1, -1]);
  // Older clients and other RULES: kept as history, not ranked.
  const later = await u.post([{ ...run, clientRunId: 'c1', rules: RULES + 1 }, { ...run, clientRunId: 'c2', replay: undefined }]);
  assert.deepEqual(later.runs.map(x => x.verified), [0, 0]);
  assert.equal(rowOf(srv, 'c2').replay, null);

  const b = await boardOf(srv, 'ode', 'normal');
  assert.equal(b.rules, RULES);
  assert.deepEqual(b.runs.map(x => [x.rank, x.name, x.score]), [[1, 'Alice', Math.max(result.score, modded.result.score)]]);
});

test('leaderboards: custom songs re-play from the melody the run brings', async () => {
  const srv = server();
  const u = await signedIn(srv, 1, 'Alice');
  const id = 'custom:' + hashString(SONG_A);
  const { run, result } = played(id, 'normal', LADDER[5], null, 1, SONG_A);
  const r = await u.post([{ ...run, clientRunId: 'x', rtttl: '  ' + SONG_A + '\n' }]);
  assert.deepEqual(r.runs, [{ clientRunId: 'x', verified: 1, score: result.score }]);
});

test('leaderboards: best run per player, opt-out, the player\'s own neighbourhood, moderation', async () => {
  const srv = server();
  srv.env.ADMIN_TOKEN = 'admin-secret';
  const players = [];
  for (const [i, name] of ['Ann', 'Bob', 'Cyd', 'Dee', 'Eve', 'Fay'].entries()) players.push({ ...(await signedIn(srv, 10 + i, name)), name });
  const scoreOf = {};
  for (const [i, p] of players.entries()) {
    // Better ladder rungs score higher; each player also posts a worse run, which must not show.
    const good = played('ode', 'normal', LADDER[2 + i], null, 1), worse = played('ode', 'normal', LADDER[0], null, 2);
    await p.post([{ ...good.run, clientRunId: p.name + 1 }, { ...worse.run, clientRunId: p.name + 2, playedAt: 2 }]);
    scoreOf[p.name] = Math.max(good.result.score, worse.result.score);
  }
  let b = await boardOf(srv, 'ode', 'normal');
  const order = b.runs.map(x => x.name); // equal scores rank in either order
  assert.deepEqual([...order].sort(), Object.keys(scoreOf).sort());
  assert.deepEqual(b.runs.map(x => x.score), b.runs.map(x => scoreOf[x.name]), 'each player\'s best run');
  assert.deepEqual(b.runs.map(x => x.score), Object.values(scoreOf).sort((x, y) => y - x));
  assert.deepEqual(b.runs.map(x => x.rank), [1, 2, 3, 4, 5, 6]);
  assert.ok(b.runs.every(x => x.total === 6 && !('me' in x) && !('user_id' in x)));
  assert.equal((await srv.call('/board/ode/normal')).headers.get('Cache-Control'), 'public, max-age=30');
  assert.equal((await srv.call('/board/ode/insane')).status, 400);
  assert.equal((await srv.call('/board/ode/normal/me')).status, 401);

  // The last-placed player: themselves and the two above.
  const last = players.find(p => p.name === order[5]);
  const around = await boardOf(srv, 'ode', 'normal', last.h);
  assert.deepEqual(around.runs.map(x => [x.rank, x.name, !!x.me]), [[4, order[3], false], [5, order[4], false], [6, order[5], true]]);

  // Opting out leaves the public board but keeps the player's own rank.
  const top = players.find(p => p.name === order[0]);
  const pr = await (await srv.call('/me', { method: 'PATCH', headers: top.h, body: JSON.stringify({ public: false }) })).json();
  assert.equal(pr.profile.public, false);
  b = await boardOf(srv, 'ode', 'normal');
  assert.deepEqual(b.runs.map(x => x.name), order.slice(1));
  assert.deepEqual((await boardOf(srv, 'ode', 'normal', top.h)).runs.map(x => [x.rank, !!x.me]), [[1, true], [2, false], [3, false]]);
  assert.equal((await srv.call('/me', { method: 'PATCH', headers: top.h, body: JSON.stringify({ public: 'no' }) })).status, 400);

  // Moderation: nothing without the token; hiding a user or a run takes it off the board.
  const admin = { Authorization: 'Bearer admin-secret' };
  assert.equal((await srv.call('/admin/flagged')).status, 404);
  assert.equal((await srv.call('/admin/flagged', { headers: { Authorization: 'Bearer nope' } })).status, 404);
  const second = players.find(p => p.name === order[1]);
  assert.equal((await srv.call('/admin/hide', { method: 'POST', headers: admin, body: JSON.stringify({ userId: second.id }) })).status, 204);
  const runId = srv.env.DB.db.prepare('SELECT id FROM runs WHERE client_run_id = ?').get(order[2] + 1).id;
  assert.equal((await srv.call('/admin/hide', { method: 'POST', headers: admin, body: JSON.stringify({ runId }) })).status, 204);
  b = await boardOf(srv, 'ode', 'normal');
  assert.ok(!b.runs.some(x => x.name === order[1]));
  assert.ok(!b.runs.some(x => x.name === order[2] && x.score === scoreOf[order[2]]), 'the hidden run is gone');
  assert.equal((await srv.call('/admin/hide', { method: 'POST', headers: admin, body: JSON.stringify({ runId: 99999 }) })).status, 404);
});

test('leaderboards: runs over a request\'s budget are verified later; automated-looking runs are flagged', async () => {
  const srv = server();
  srv.env.ADMIN_TOKEN = 'admin-secret';
  const u = await signedIn(srv, 1, 'Alice');
  const runs = Array.from({ length: 6 }, (_, i) => ({ ...played('ode', 'normal', LADDER[4], null, i + 1).run, clientRunId: 'r' + i }));
  const r = await u.post(runs);
  assert.deepEqual(r.runs.map(x => x.verified), [1, 1, 1, 1, 0, 0]);
  const admin = { Authorization: 'Bearer admin-secret' };
  assert.deepEqual(await (await srv.call('/admin/verify', { method: 'POST', headers: admin })).json(), { verified: 2 });
  assert.equal(srv.env.DB.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE verified = 1').get().n, 6);
  assert.equal(await verifyPending(srv.env), 0);

  // The demo mod's perfect timing, shifted by a constant: still flagged.
  const bot = played('ode', 'normal', { bias: 7 });
  await u.post([{ ...bot.run, clientRunId: 'bot' }]);
  assert.equal(rowOf(srv, 'bot').flags, 'flat');
  const exact = played('ode', 'normal', {});
  await u.post([{ ...exact.run, clientRunId: 'exact' }]);
  assert.equal(rowOf(srv, 'exact').flags, 'flat,bot');
  assert.equal(rowOf(srv, 'r0').flags, '', 'a human-like run is not flagged');
  const flagged = await (await srv.call('/admin/flagged', { headers: admin })).json();
  assert.deepEqual(flagged.runs.map(x => x.flags).sort(), ['flat', 'flat,bot']);
});

test('leaderboards: the client uploads replays, gets the verdict and reads boards signed out', async () => {
  const srv = server();
  const a = device(srv);
  await a.cloud.takeLoginHash(await githubSignIn(srv, 1, { login: 'alice', name: 'Alice' }));
  const { run, result } = played('ode', 'normal', LADDER[4]);
  const id = a.cloud.queueRun('ode', 'normal', { ...result, date: 50 }, [], { replay: run.replay, rules: RULES, loadout: null });
  const verdicts = await a.cloud.submit();
  assert.deepEqual(verdicts[id], { clientRunId: id, verified: 1, score: result.score });
  assert.equal(a.cloud.pendingRuns(), 0);
  assert.deepEqual((await a.cloud.around('ode', 'normal')).runs.map(x => [x.rank, x.me]), [[1, true]]);

  const anon = device(srv);
  assert.equal(anon.cloud.queueRun('ode', 'normal', result), null, 'signed out: nothing queued');
  const b = await anon.cloud.board('ode', 'normal');
  assert.deepEqual(b.runs.map(x => [x.name, x.score]), [['Alice', result.score]]);
  assert.equal(await anon.cloud.around('ode', 'normal'), null);

  // A big outbox goes up in several requests below the API's body limit; old replays give way first.
  for (let i = 0; i < 40; i++) a.cloud.queueRun('ode', 'normal', { ...result, date: 100 + i }, [], { replay: 'A'.repeat(30_000), rules: RULES });
  const stored = JSON.parse(a.storage.getItem('ringbeat.cloud.v1')).outbox;
  assert.ok(stored.reduce((n, r) => n + (r.replay || '').length, 0) <= 1_000_000);
  assert.ok(!stored[0].replay && stored[39].replay);
  const v = await a.cloud.submit();
  assert.equal(Object.keys(v).length, 40);
  assert.ok(Object.values(v).every(x => x.verified !== 1), 'junk replays never rank');
});

// ---- request budget: few requests, none during play, never in the way (docs/CLOUD.md › Requests) ----

// Timers the test fires by hand.
function fakeTimers() {
  const list = new Map();
  let id = 0;
  return {
    setTimer: (f, ms) => { list.set(++id, { f, ms }); return id; },
    clearTimer: i => list.delete(i),
    pending: () => [...list.values()],
    fireAll() { const now = [...list.values()]; list.clear(); for (const t of now) t.f(); },
  };
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('requests: a 20-song session with 5 new bests costs one request per best, plus start and hide', async () => {
  const srv = server();
  const timers = fakeTimers();
  const a = device(srv, { now: 1000 }, timers);
  await a.cloud.takeLoginHash(await githubSignIn(srv));
  await a.cloud.sync();
  a.calls.length = 0;
  const scoresPlayed = [100, 50, 60, 200, 10, 20, 30, 300, 40, 50, 60, 70, 400, 5, 6, 7, 8, 500, 9, 9];
  let bests = 0, queued = 0;
  for (const [i, score] of scoresPlayed.entries()) {
    a.t.now = 10_000 + i * 60_000;
    const r = result(score, a.t.now);
    const rec = a.scores.record('s1', 'normal', r);
    a.stats.recordRun({ diff: 'normal', result: r });
    a.cloud.schedule();
    const id = rec.rank ? a.cloud.queueRun('s1', 'normal', r) : null;
    if (id) queued++;
    if (rec.isNewBest) { bests++; assert.ok((await a.cloud.submit())[id]); }
  }
  assert.equal(bests, 5);
  assert.deepEqual(a.calls.map(c => c.path), Array(5).fill('/sync'));
  assert.ok(timers.pending().every(t => t.ms >= 60_000), 'nothing else waits on a short timer');
  a.cloud.flush(); // the tab is hidden: the last top-list runs and stats go up
  await settle(); await settle();
  assert.equal(a.calls.length, 6);
  assert.equal(a.cloud.pendingRuns(), 0);
  a.cloud.flush(); a.cloud.schedule(); await settle();
  assert.equal(a.calls.length, 6, 'nothing changed: nothing sent');
  a.cloud.wake();
  assert.equal(a.calls.length, 6, 'the tab coming back soon after a sync pulls nothing');
  a.t.now += 11 * 60e3;
  a.cloud.wake(); await settle(); await settle();
  assert.equal(a.calls.length, 7);
  // Top-list runs only (the rest never leave the device); the ones that weren't bests went up with the hide flush.
  assert.ok(queued < scoresPlayed.length);
  assert.equal(srv.env.DB.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, queued);
});

test('requests: nothing while a song plays; settings saves that change nothing send nothing', async () => {
  const srv = server();
  const timers = fakeTimers();
  let busy = false;
  const a = device(srv, { now: 1000 }, { ...timers, isBusy: () => busy });
  await a.cloud.takeLoginHash(await githubSignIn(srv));
  await a.cloud.sync();
  a.calls.length = 0;
  a.cloud.schedule(); // e.g. the last selected song saved: not synced, so not dirty
  assert.equal(timers.pending().length, 0);

  a.prefs.set('voice', 'smooth');
  a.cloud.schedule();
  assert.deepEqual(timers.pending().map(t => t.ms), [30_000]);
  busy = true;
  timers.fireAll();
  await settle();
  assert.equal(a.calls.length, 0, 'mid-song: waits');
  assert.equal(timers.pending().length, 1);
  busy = false;
  timers.fireAll();
  await settle(); await settle();
  assert.equal(a.calls.length, 1);
  assert.ok(JSON.parse(a.calls[0].init.body).shared, 'the settings went up');
  assert.ok(!('devicesSince' in JSON.parse(a.calls[0].init.body)), 'a push does not pull');
  a.cloud.schedule();
  assert.equal(timers.pending().length, 0, 'the echo of its own change is not a change');
});

test('requests: a hung request times out and does not block the next; keepalive only for small bodies; backoff', async t => {
  const srv = server();
  let hang = false;
  const calls = [];
  const storage = mem(), scores = createScores(storage), stats = createStats(storage), mysongs = createMySongs(storage);
  const prefs = { sharedSettings: () => ({ settings: {}, settingsT: {}, favorites: {} }), applyShared: () => false };
  let clock = 1000;
  const fetch = (url, init) => {
    calls.push(init);
    if (hang) return new Promise((_, no) => init.signal.addEventListener('abort', () => no(init.signal.reason)));
    return srv.call(url.slice(API.length), init);
  };
  const cloud = createCloud({ scores, stats, mysongs, prefs, apiBase: API, storage, fetch, now: () => clock, timeoutMs: 30, ...fakeTimers() });
  const alive = setInterval(() => {}, 1000); // Node's AbortSignal.timeout doesn't hold the event loop open
  t.after(() => clearInterval(alive));
  await cloud.takeLoginHash(await githubSignIn(srv));
  await cloud.sync();
  hang = true;
  cloud.queueRun('s', 'normal', result(1, 5));
  assert.deepEqual(await cloud.submit(), {});
  assert.equal(cloud.pendingRuns(), 1, 'kept for later');
  // Backing off: the automatic flush waits, the Sync button doesn't.
  hang = false;
  const n = calls.length;
  cloud.flush(); await settle();
  assert.equal(calls.length, n);
  assert.equal((await cloud.sync()).ok, true);
  assert.equal(cloud.pendingRuns(), 0);

  cloud.queueRun('s', 'normal', result(2, 6), [], { replay: 'A'.repeat(70_000), rules: RULES });
  clock += 1;
  cloud.flush(); await settle(); await settle();
  assert.equal(calls.at(-1).keepalive, false, 'over 64 KB: a normal request');
  cloud.queueRun('s', 'normal', result(3, 7));
  cloud.flush(); await settle(); await settle();
  assert.equal(calls.at(-1).keepalive, true);
  assert.equal(cloud.pendingRuns(), 0);
});

test('requests: signed out, only the leaderboard snapshot, without credentials, once for every song', async () => {
  const srv = server();
  const anon = device(srv);
  anon.cloud.schedule(); anon.cloud.flush(); anon.cloud.wake();
  await anon.cloud.sync();
  assert.equal(await anon.cloud.board('ode', 'normal').then(b => b.runs.length), 0);
  await anon.cloud.board('ode', 'hard');
  await anon.cloud.board('jingle', 'normal');
  assert.deepEqual(anon.calls.map(c => c.path), ['/boards']);
  assert.deepEqual(anon.calls[0].init.headers, {}, 'a simple request: no preflight');
  // A reload keeps the snapshot.
  const again = createCloud({ scores: anon.scores, stats: anon.stats, mysongs: anon.mysongs, prefs: anon.prefs, apiBase: API,
    storage: anon.storage, now: () => anon.t.now, fetch: () => { throw new Error('no request expected'); } });
  assert.ok(await again.board('ode', 'normal'));
});

test('POST /sync: ranks come back with a ranked run; the board snapshot is rebuilt only when something changed', async () => {
  const srv = server();
  const a = device(srv);
  await a.cloud.takeLoginHash(await githubSignIn(srv, 1, { login: 'alice', name: 'Alice' }));
  await a.cloud.sync();
  assert.equal(a.cloud.rank('ode', 'normal'), null);
  const { run, result: res } = played('ode', 'normal', LADDER[4]);
  const id = a.cloud.queueRun('ode', 'normal', { ...res, date: 50 }, [], { replay: run.replay, rules: RULES, loadout: null });
  a.calls.length = 0;
  assert.equal((await a.cloud.submit())[id].verified, 1);
  assert.equal(a.calls.length, 1, 'upload and rank in one request');
  assert.deepEqual({ ...a.cloud.rank('ode', 'normal'), at: 0 }, { rank: 1, total: 1, at: 0 });
  assert.equal(a.cloud.serverRules(), RULES);

  const boards = async () => (await srv.call('/boards')).json();
  const first = await boards();
  assert.deepEqual(first.boards['ode|normal'].map(r => [r.rank, r.name, r.score]), [[1, 'Alice', res.score]]);
  assert.equal((await srv.call('/boards')).headers.get('Cache-Control'), 'public, max-age=600');
  srv.tick(1000);
  await rebuildBoards(srv.env, 2_000_000);
  assert.equal((await boards()).built, first.built, 'nothing changed: no rebuild');
  await srv.call('/me', { method: 'PATCH', headers: { Authorization: 'Bearer ' + JSON.parse(a.storage.getItem('ringbeat.cloud.v1')).token },
    body: JSON.stringify({ public: false }) });
  await rebuildBoards(srv.env, 3_000_000);
  const later = await boards();
  assert.equal(later.built, 3_000_000);
  assert.equal(later.boards['ode|normal'], undefined, 'opted out');
});

test('POST /sync: only changed device slots come down; the shared document only when it changed', async () => {
  const srv = server();
  const a = device(srv), b = device(srv);
  await a.cloud.takeLoginHash(await githubSignIn(srv)); await a.cloud.sync();
  await b.cloud.takeLoginHash(await githubSignIn(srv)); await b.cloud.sync();
  srv.tick(10 * 60e3);
  await a.cloud.sync(); // takes B's slot
  const answers = [];
  const real = srv.call;
  srv.call = async (...x) => { const r = await real(...x); answers.push(await r.clone().json().catch(() => null)); return r; };
  srv.tick(10 * 60e3);
  await a.cloud.sync();
  const quiet = answers.at(-1);
  assert.deepEqual(quiet.devices, {}, 'no slot changed');
  assert.equal(quiet.deviceIds.length, 2);
  assert.ok(!('shared' in quiet), 'shared document unchanged');
  b.scores.record('s1', 'normal', result(9, 99));
  srv.tick(1000);
  await b.cloud.sync();
  srv.tick(10 * 60e3);
  await a.cloud.sync();
  assert.deepEqual(Object.keys(answers.at(-1).devices), [b.cloud.deviceId]);
  assert.equal(a.scores.get('s1', 'normal').best.score, 9);
});

test('dev request log: every request with why, what and sizes; held-back syncs; nothing measured without it', async () => {
  const srv = server();
  const entries = [];
  let busy = false;
  const timers = fakeTimers();
  const a = device(srv, { now: 1000 }, { ...timers, isBusy: () => busy, debug: e => entries.push(e) });
  await a.cloud.takeLoginHash(await githubSignIn(srv));
  await a.cloud.sync('start');
  const start = entries.find(e => e.why === 'start');
  assert.equal(start.method, 'POST');
  assert.equal(start.path, '/sync');
  assert.equal(start.status, 200);
  assert.ok(start.sent > 0 && start.received > 0 && start.body.devicesSince === 0 && start.response.at);
  assert.match(describe(start), /pull/);

  a.scores.record('s1', 'normal', result(100, 50));
  const id = a.cloud.queueRun('s1', 'normal', result(100, 50), [], { replay: 'A'.repeat(2048), rules: RULES });
  await a.cloud.submit();
  const best = entries.at(-1);
  assert.equal(best.why, 'new best');
  assert.equal(describe(best), 'device, 1 run (replays 2.0 KB) → invalid');
  assert.match(line(best, new Date(0)), /new best +POST \/sync 200 ↑[\d.]+ KB ↓\d+ B \d+ ms · device, 1 run/);
  assert.ok(id);

  a.prefs.set('voice', 'smooth');
  a.cloud.schedule();
  busy = true;
  timers.fireAll(); timers.fireAll();
  assert.deepEqual(entries.filter(e => e.skipped).map(e => [e.why, e.skipped]), [['push', 'a song is playing']], 'logged once');
  a.cloud.wake();
  assert.match(entries.at(-1).skipped, /synced \d+ s ago/);

  // The panel and the console.
  const out = [];
  const con = { groupCollapsed: t => out.push(t), log: () => {}, groupEnd: () => {}, debug: t => out.push(t) };
  const log = createNetDebug({ doc: null, out: con });
  for (const e of entries) log(e);
  assert.equal(log.totals().requests, entries.filter(e => e.method).length);
  assert.ok(out.every(t => t.startsWith('[cloud] ')));

  // Without a debug callback, answers are read as before.
  const plain = device(srv);
  await plain.cloud.takeLoginHash(await githubSignIn(srv));
  assert.equal((await plain.cloud.sync()).ok, true);
});
