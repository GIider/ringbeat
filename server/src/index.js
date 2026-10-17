// Ringbeat API: a Cloudflare Worker over D1 (binding DB). Online profiles with GitHub sign-in, cloud save, the run
// history and leaderboards. Plain fetch handler; the game's own modules (../../src) are bundled in to re-play runs.
// Routes and data model: docs/CLOUD.md.
//
// Env: DB (D1), GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (secret), ALLOWED_ORIGINS (comma list; "http://localhost:*"
// allows any local port), LIMITER (optional rate-limit binding), ADMIN_TOKEN (optional secret: moderation routes).
import { RULES, replay, decodeLog } from '../../src/replay.js';
import { generateChart } from '../../src/chart.js';
import { parseRTTTL } from '../../src/rtttl.js';
import { SONGS } from '../../src/songs.js';
import { hashString } from '../../src/library.js';
import { planBot } from '../../src/bot.js';
import * as mods from '../../src/mods.js';
import { mergeShared, sameShared, stampUnset, cleanName } from '../../src/cloudmerge.js';

const SESSION_MS = 365 * 24 * 3600e3;
const STATE_MS = 10 * 60e3;   // OAuth round trip
const CODE_MS = 2 * 60e3;     // one-time code from the callback to /auth/exchange
const MAX_BODY = 300_000;     // request body, characters
const MAX_DOC = 256_000;      // stored document, characters
const MAX_DEVICES = 20;
const MAX_RUNS = 50;          // per POST /runs
const DIFFS = ['normal', 'hard'];
const DEVICE = /^[a-z0-9]{8,32}$/;
const DEFAULT_NAME = /^Player-[A-Z2-9]{4}$/;
const MAX_REPLAY = 250_000;   // characters of an encoded input log (replay.js MAX_EVENTS * 12)
const MAX_RTTTL = 8000;      // mysongs.js MAX_RTTTL
const VERIFY_PER_REQUEST = 4; // re-plays per request (CPU budget); the rest wait for the cron
const VERIFY_PER_CRON = 20;
const BOARD_MAX = 100;
const BOARD_TOP = 10;         // runs per song and difficulty in the GET /boards snapshot and in a sync's ranks
const BUILTIN = new Map(SONGS.map(s => [s.id, s.rtttl]));

export default {
  fetch: (req, env) => handle(req, env),
  scheduled: (ev, env, ctx) => ctx.waitUntil(prunePending(env).then(() => verifyPending(env)).then(() => rebuildBoards(env, Date.now()))),
};

export async function handle(req, env, now = Date.now()) {
  const url = new URL(req.url);
  const origin = req.headers.get('Origin') || '';
  const cors = originAllowed(origin, env) ? {
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400',
  } : {};
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (body, status = 200, extra = {}) => new Response(body === null ? null : JSON.stringify(body), {
    status: body === null ? 204 : status, headers: { ...cors, ...(body !== null && { 'Content-Type': 'application/json' }), ...extra },
  });
  const fail = (status, error) => json({ error }, status);

  try {
    if (env.LIMITER) {
      const key = (req.headers.get('Authorization') || '').slice(-16) || req.headers.get('CF-Connecting-IP') || 'anon';
      if (!(await env.LIMITER.limit({ key })).success) return fail(429, 'slow down');
    }
    const route = req.method + ' ' + url.pathname;

    // ---- sign-in (browser navigations, not fetch) ----
    if (route === 'GET /auth/github/start') {
      const ret = returnUrl(url.searchParams.get('return'), env);
      if (!ret) return new Response('Bad return address', { status: 400 });
      const state = randomToken();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM oauth_states WHERE expires < ?').bind(now),
        env.DB.prepare('INSERT INTO oauth_states (state, return_to, expires) VALUES (?, ?, ?)').bind(state, ret, now + STATE_MS),
      ]);
      const gh = new URL('https://github.com/login/oauth/authorize');
      gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      gh.searchParams.set('redirect_uri', new URL('/auth/github/callback', url).href);
      gh.searchParams.set('state', state);
      gh.searchParams.set('allow_signup', 'true');
      return Response.redirect(gh.href, 302);
    }
    if (route === 'GET /auth/github/callback') {
      const state = url.searchParams.get('state') || '';
      const row = await env.DB.prepare('SELECT return_to, expires FROM oauth_states WHERE state = ?').bind(state).first();
      if (!row || row.expires < now) return new Response('Sign-in expired, please try again', { status: 400 });
      await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
      const back = reason => Response.redirect(row.return_to + '#login-error=' + reason, 302);
      const code = url.searchParams.get('code');
      if (!code) return back('denied');
      const gh = await githubUser(env, code, new URL('/auth/github/callback', url).href);
      if (!gh) return back('github');
      const userId = await userFor(env, 'github', gh.subject, playerName(gh.name) || playerName(gh.login), now);
      const login = randomToken();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM login_codes WHERE expires < ?').bind(now),
        env.DB.prepare('INSERT INTO login_codes (code_hash, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(login), userId, now + CODE_MS),
      ]);
      return Response.redirect(row.return_to + '#login=' + login, 302);
    }

    // ---- API (fetch from the game) ----
    const body = req.method === 'POST' ? await readJson(req) : null;
    if (body === undefined) return fail(400, 'bad body');

    if (route === 'POST /auth/exchange') {
      const hash = await sha256(String(body.code || ''));
      const row = await env.DB.prepare('SELECT user_id, expires FROM login_codes WHERE code_hash = ?').bind(hash).first();
      await env.DB.prepare('DELETE FROM login_codes WHERE code_hash = ?').bind(hash).run();
      if (!row || row.expires < now) return fail(400, 'expired');
      if (await env.DB.prepare('SELECT 1 FROM users WHERE id = ? AND banned = 1').bind(row.user_id).first()) return fail(403, 'banned');
      const token = randomToken();
      await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)')
        .bind(await sha256(token), row.user_id, now, now + SESSION_MS).run();
      return json({ token, profile: await profile(env, row.user_id) });
    }

    // ---- public: leaderboards ----
    if (route === 'GET /boards') {
      // Every song's top runs from one stored snapshot (rebuilt by the cron): one row read, however many songs.
      let row = await env.DB.prepare('SELECT rules, doc, built FROM board_tops WHERE id = 1').first();
      if (!row || row.rules !== String(RULES)) row = await rebuildBoards(env, now, { force: true });
      const etag = `"${row.built}"`;
      if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ...cors, ETag: etag, 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' } });
      return new Response(`{"rules":${RULES},"built":${row.built},"boards":${row.doc}}`, {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30', ETag: etag },
      });
    }
    const boardRoute = /^\/board\/([^/]+)\/([a-z]+)(\/me)?$/.exec(url.pathname);
    let boardSong = '';
    if (boardRoute && req.method === 'GET') {
      try { boardSong = decodeURIComponent(boardRoute[1]); } catch { return fail(400, 'bad song'); }
      if (!DIFFS.includes(boardRoute[2]) || boardSong.length > 200) return fail(400, 'bad song');
      if (!boardRoute[3]) {
        const limit = Math.max(1, Math.min(BOARD_MAX, parseInt(url.searchParams.get('limit'), 10) || 50));
        const runs = await board(env, boardSong, boardRoute[2], { limit });
        return json({ rules: RULES, runs }, 200, { 'Cache-Control': 'public, max-age=30' });
      }
    }

    // ---- moderation (ADMIN_TOKEN) ----
    if (url.pathname.startsWith('/admin/')) {
      const given = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
      if (!env.ADMIN_TOKEN || await sha256(given) !== await sha256(env.ADMIN_TOKEN)) return fail(404, 'not found');
      if (route === 'GET /admin/flagged') {
        const { results } = await env.DB.prepare(`SELECT r.id, r.user_id, u.display_name AS name, r.song_id, r.diff,
          r.score, r.flags, r.played_at FROM runs r JOIN users u ON u.id = r.user_id
          WHERE r.flags != '' AND r.verified = 1 AND r.hidden = 0 ORDER BY r.id DESC LIMIT 100`).all();
        return json({ runs: results });
      }
      if (route === 'POST /admin/hide') {
        const hidden = body.hidden === false ? 0 : 1;
        const r = Number.isInteger(body.runId)
          ? await env.DB.prepare('UPDATE runs SET hidden = ? WHERE id = ?').bind(hidden, body.runId).run()
          : await env.DB.prepare('UPDATE users SET hidden = ? WHERE id = ?').bind(hidden, String(body.userId || '')).run();
        if (r.meta.changes) await env.DB.batch([boardsChanged(env), audit(env, now, hidden ? 'hide' : 'unhide', Number.isInteger(body.runId) ? 'run ' + body.runId : 'user ' + body.userId)]);
        return r.meta.changes ? json(null) : fail(404, 'no such run or user');
      }
      if (route === 'POST /admin/verify') {
        const pruned = await prunePending(env);
        return json({ verified: await verifyPending(env), pruned });
      }
      return adminRoute(env, route, url, body, now, json, fail);
    }

    const auth = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('Authorization') || '');
    const tokenHash = auth && await sha256(auth[1]);
    const session = tokenHash && await env.DB.prepare(`SELECT s.user_id, s.expires, u.banned, u.reset_at FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(tokenHash).first();
    if (!session || session.expires < now) {
      return url.pathname === '/' ? new Response('Ringbeat API', { headers: cors }) : fail(401, 'sign in');
    }
    const uid = session.user_id;
    // The right of access holds for banned players too, so this route comes before the ban check.
    if (route === 'GET /me/export') return json(await exportUser(env, uid, now), 200, { 'Content-Disposition': 'attachment; filename="ringbeat-export.json"' });
    if (session.banned) return fail(403, 'banned');

    if (route === 'POST /auth/logout') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
      return json(null);
    }
    if (route === 'GET /me') return json({ profile: await profile(env, uid) });
    if (boardRoute && boardRoute[3] && req.method === 'GET') {
      // The caller and the players around them; included even when not public, so they still see their own rank.
      const runs = await board(env, boardSong, boardRoute[2], { me: uid });
      return json({ rules: RULES, runs });
    }
    if (route === 'DELETE /me') {
      await env.DB.batch(purgeUser(env, uid));
      return json(null);
    }

    // The game's one sync request: push whatever changed, pull what other devices wrote, upload runs and get their
    // ranks back. Every part is optional (docs/CLOUD.md › Requests).
    if (route === 'POST /sync') {
      if (body.runs !== undefined && (!Array.isArray(body.runs) || body.runs.length > MAX_RUNS)) return fail(400, 'bad runs');
      const out = { at: now, rules: RULES };
      let budget = VERIFY_PER_REQUEST;
      if (body.shared !== undefined || Number.isInteger(body.sharedRev)) {
        if (body.shared !== undefined) budget--; // the merge takes CPU too
        const r = await syncShared(env, session, body, now);
        if (r === 'bad') return fail(400, 'bad doc');
        if (r === 'busy') return fail(409, 'stale');
        if (r) out.shared = r;
      }
      if (body.profile !== undefined) {
        // A rename or the leaderboard opt-out, sent along with the next sync. A bad value is refused on its own
        // (profileError) so the rest of the sync still lands.
        const p = body.profile && typeof body.profile === 'object' ? body.profile : {};
        const name = p.displayName === undefined ? null : cleanName(p.displayName);
        if (name === '' || (p.public !== undefined && typeof p.public !== 'boolean')) out.profileError = name === '' ? 'bad name' : 'bad public';
        else {
          const sets = [];
          if (name) sets.push(env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ? AND display_name != ?').bind(name, uid, name));
          if (p.public !== undefined) sets.push(env.DB.prepare('UPDATE users SET public = ? WHERE id = ? AND public != ?').bind(+p.public, uid, +p.public));
          if (sets.length) {
            const r = await env.DB.batch(sets);
            if (r.some(x => x.meta.changes)) await boardsChanged(env).run(); // the snapshot shows names
          }
        }
        out.profile = await profile(env, uid);
      }
      if (body.device !== undefined) {
        const doc = docText(body.device);
        if (!DEVICE.test(String(body.deviceId)) || !doc) return fail(400, 'bad doc');
        await putDevice(env, uid, body.deviceId, doc, now);
      }
      if (isNum(body.devicesSince)) {
        // Only the slots that changed since the caller last looked; the id list lets it drop pruned devices.
        const { results } = await env.DB.prepare(`SELECT device_id, CASE WHEN updated > ? AND device_id != ? THEN doc END AS doc
          FROM device_slots WHERE user_id = ?`).bind(body.devicesSince, String(body.deviceId || ''), uid).all();
        out.deviceIds = results.map(r => r.device_id);
        out.profile ||= await profile(env, uid); // a rename on another device reaches this one
        out.devices = Object.fromEntries(results.filter(r => r.doc !== null).map(r => [r.device_id, JSON.parse(r.doc)]));
      }
      if (body.runs && body.runs.length) {
        const runs = await storeRuns(env, session, body.runs, budget, now);
        out.runs = verdicts(runs);
        // The caller's world rank wherever a run just ranked: the results screen needs no second request.
        out.ranks = {};
        for (const key of new Set(runs.filter(r => r.verified === 1).map(r => r.songId + '|' + r.diff))) {
          const [songId, diff] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
          const rows = await board(env, songId, diff, { me: uid });
          const me = rows.find(r => r.me);
          const top = await board(env, songId, diff, { limit: BOARD_TOP }); // the world top now, for the results screen
          // The players around them come along (already read for the rank): the results screen's World page.
          if (me && me.rank <= BOARD_TOP) await patchTop(env, songId, diff, now, top); // the snapshot shows it now, not at the next cron
          if (me) out.ranks[key] = { rank: me.rank, total: me.total, top,
            near: rows.map(r => ({ rank: r.rank, name: r.name, score: r.score, grade: r.grade, accuracy: r.accuracy,
              maxCombo: r.maxCombo, fc: r.fc, ap: r.ap, mods: r.mods, ...(r.dev && { dev: true }), ...(r.me && { me: true }) })) };
        }
      }
      // The stats screen's online page: the caller's rank on every board they are on, in this same round trip.
      if (body.wantRanks === true) out.myRanks = await ranks(env, uid);
      return json(out);
    }

    return fail(404, 'not found');
  } catch (e) {
    console.error(e);
    return fail(500, 'server error');
  }
}

// ---- helpers ----

async function putDevice(env, uid, deviceId, doc, now) {
  const known = await env.DB.prepare('SELECT 1 FROM device_slots WHERE user_id = ? AND device_id = ?').bind(uid, deviceId).first();
  await env.DB.prepare(`INSERT INTO device_slots (user_id, device_id, doc, updated) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, device_id) DO UPDATE SET doc = excluded.doc, updated = excluded.updated`).bind(uid, deviceId, doc, now).run();
  if (known) return; // the count only grows with a new device
  // Devices long gone make room: only the newest MAX_DEVICES are kept.
  await env.DB.prepare(`DELETE FROM device_slots WHERE user_id = ? AND device_id NOT IN
    (SELECT device_id FROM device_slots WHERE user_id = ? ORDER BY updated DESC LIMIT ?)`).bind(uid, uid, MAX_DEVICES).run();
}

// POST /sync's shared document. A sent document is merged here with the stored one (the same merge every device
// runs), written only when that changes it, and guarded by rev. -> { rev, doc? } (doc left out when the caller
// already has it), null when the caller is up to date, 'bad' or 'busy' (lost the race three times).
async function syncShared(env, session, body, now) {
  const uid = session.user_id;
  const read = () => env.DB.prepare('SELECT doc, rev FROM shared_docs WHERE user_id = ?').bind(uid).first();
  let row = await read();
  if (body.shared === undefined) {
    return row && row.rev !== body.sharedRev ? { rev: row.rev, doc: JSON.parse(row.doc) } : null;
  }
  if (!body.shared || typeof body.shared !== 'object' || Array.isArray(body.shared)) return 'bad';
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = row && JSON.parse(row.doc);
    // The first device to fill an empty profile stamps its never-changed settings with its own clock (stampUnset).
    const merged = stored ? mergeShared(body.shared, stored) : stampUnset(body.shared, isNum(body.stampAt) ? body.stampAt : now);
    const reply = rev => ({ rev, ...(!sameShared(merged, body.shared) && { doc: merged }) });
    await applyReset(env, session, merged.resetAt);
    if (stored && sameShared(merged, stored)) return reply(row.rev);
    const doc = docText(merged);
    if (!doc) return 'bad';
    const r = row
      ? await env.DB.prepare('UPDATE shared_docs SET doc = ?, rev = rev + 1, updated = ? WHERE user_id = ? AND rev = ?').bind(doc, now, uid, row.rev).run()
      : await env.DB.prepare('INSERT INTO shared_docs (user_id, doc, rev, updated) VALUES (?, ?, 1, ?) ON CONFLICT (user_id) DO NOTHING').bind(uid, doc, now).run();
    if (r.meta.changes) return reply(row ? row.rev + 1 : 1);
    row = await read(); // another device wrote in between: merge with that
  }
  return 'busy';
}

// A "reset scores & stats" reached the shared document: the player's stored runs up to then go, and with them their
// leaderboard entries. Runs played after it stay. Nothing is written unless the reset is newer than the last one seen.
async function applyReset(env, session, resetAt) {
  if (!isNum(resetAt) || resetAt <= session.reset_at) return;
  const uid = session.user_id;
  const r = await env.DB.prepare('UPDATE users SET reset_at = ? WHERE id = ? AND reset_at < ?').bind(resetAt, uid, resetAt).run();
  session.reset_at = resetAt;
  if (!r.meta.changes) return;
  await env.DB.batch([env.DB.prepare('DELETE FROM runs WHERE user_id = ? AND played_at <= ?').bind(uid, resetAt), boardsChanged(env)]);
}

// Cleans, re-plays (up to `budget`; the rest wait for the cron with verified = 0) and stores runs. -> the clean runs.
async function storeRuns(env, session, raw, budget, now) {
  const uid = session.user_id, resetAt = session.reset_at;
  // Runs played before the player's last reset (a device that was offline) are not stored again.
  const runs = raw.map(cleanRun).filter(r => r && (!resetAt || r.playedAt > resetAt));
  for (const r of runs) {
    // The server's own numbers replace the client's.
    if (r.replay && r.rules === String(RULES) && budget-- > 0) Object.assign(r, verifyRun(r));
  }
  if (!runs.length) return runs;
  await env.DB.batch(runs.map(r => env.DB.prepare(`INSERT INTO runs (user_id, client_run_id, song_id, diff, score, grade,
    accuracy, max_combo, fc, ap, mods, mult, game_version, played_at, received_at, replay, verified, rules, loadout, rtttl, flags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, client_run_id) DO NOTHING`).bind(uid, r.clientRunId, r.songId, r.diff, r.score, r.grade, r.accuracy,
    r.maxCombo, r.fc, r.ap, r.mods, r.mult, r.gameVersion, r.playedAt, now, r.replay, r.verified, r.rules, r.loadout,
    r.rtttl, r.flags)).concat(runs.some(r => r.verified === 1) ? [boardsChanged(env)] : []));
  return runs;
}
const verdicts = runs => runs.map(r => ({ clientRunId: r.clientRunId, verified: r.verified, ...(r.verified === 1 && { score: r.score }) }));

// The GET /boards snapshot needs a rebuild (a run ranked, a name or a hide changed). Writes nothing when already marked.
const boardsChanged = env => env.DB.prepare('UPDATE board_tops SET dirty = 1 WHERE id = 1 AND dirty = 0');

// Everything that belongs to one player, as statements for a batch (DELETE /me and the admin delete share it).
const purgeUser = (env, uid) => ['runs', 'device_slots', 'shared_docs', 'login_codes', 'sessions', 'identities']
  .map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(uid))
  .concat(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid), boardsChanged(env));

const audit = (env, now, action, target, detail = '') =>
  env.DB.prepare('INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)').bind(now, action, target, detail);

const ADMIN_PAGE = 20;
const TABLES = ['users', 'runs', 'sessions', 'device_slots', 'shared_docs', 'oauth_states', 'login_codes', 'admin_log'];

// The /admin/* routes beyond hide and verify. The caller has already checked ADMIN_TOKEN.
async function adminRoute(env, route, url, body, now, json, fail) {
  const q = url.searchParams;
  const offset = Math.max(0, parseInt(q.get('offset'), 10) || 0);
  const id = v => String(v || '').slice(0, 64);
  if (route === 'GET /admin/players') {
    const like = '%' + String(q.get('q') || '').replace(/[\\%_]/g, c => '\\' + c) + '%';
    // The page of users first, then each one's run count from runs_user (not a scan per user of the whole page query).
    const { results } = await env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM runs r WHERE r.user_id = p.id) AS runs FROM (
      SELECT u.id, u.display_name AS name, u.hidden, u.banned, u.created FROM users u
      WHERE u.display_name LIKE ? ESCAPE '\\' OR u.id = ? ORDER BY u.created DESC LIMIT ? OFFSET ?) p ORDER BY p.created DESC`)
      .bind(like, id(q.get('q')), ADMIN_PAGE, offset).all();
    return json({ players: results });
  }
  if (route === 'GET /admin/runs') {
    const { results } = await env.DB.prepare(`SELECT id, song_id, diff, score, flags, hidden, verified, played_at
      FROM runs WHERE user_id = ? ORDER BY played_at DESC, id DESC LIMIT ? OFFSET ?`).bind(id(q.get('user')), ADMIN_PAGE, offset).all();
    return json({ runs: results });
  }
  if (route === 'POST /admin/run/delete') {
    if (!Number.isInteger(body.runId)) return fail(400, 'bad run');
    const r = await env.DB.prepare('DELETE FROM runs WHERE id = ?').bind(body.runId).run();
    if (!r.meta.changes) return fail(404, 'no such run');
    await env.DB.batch([boardsChanged(env), audit(env, now, 'delete run', 'run ' + body.runId)]);
    return json(null);
  }
  if (route === 'POST /admin/player/delete') {
    const uid = id(body.userId);
    const u = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(uid).first();
    if (!u) return fail(404, 'no such user');
    await env.DB.batch([...purgeUser(env, uid), audit(env, now, 'delete player', 'user ' + uid, u.display_name)]);
    return json(null);
  }
  if (route === 'POST /admin/ban') {
    const uid = id(body.userId), banned = body.banned === false ? 0 : 1;
    const r = await env.DB.prepare('UPDATE users SET banned = ?, hidden = ? WHERE id = ?').bind(banned, banned, uid).run();
    if (!r.meta.changes) return fail(404, 'no such user');
    await env.DB.batch([...(banned ? [env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid)] : []),
      boardsChanged(env), audit(env, now, banned ? 'ban' : 'unban', 'user ' + uid)]);
    return json(null);
  }
  if (route === 'POST /admin/unflag') {
    if (!Number.isInteger(body.runId)) return fail(400, 'bad run');
    const r = await env.DB.prepare("UPDATE runs SET flags = '' WHERE id = ?").bind(body.runId).run();
    if (!r.meta.changes) return fail(404, 'no such run');
    await env.DB.batch([boardsChanged(env), audit(env, now, 'unflag', 'run ' + body.runId)]);
    return json(null);
  }
  if (route === 'GET /admin/stats') {
    const one = sql => env.DB.prepare(sql).bind(...(sql.includes('?') ? [now] : [])).first();
    const rules = env.DB.prepare(`SELECT COALESCE(SUM(replay IS NOT NULL AND rules = ?1), 0) AS pending,
      COALESCE(SUM(${STUCK}), 0) AS stuck FROM runs WHERE verified = 0`).bind(String(RULES)).first();
    const [counts, expired, board] = await Promise.all([
      Promise.all(TABLES.map(t => one(`SELECT COUNT(*) AS n FROM ${t}`))),
      one(`SELECT (SELECT COUNT(*) FROM sessions WHERE expires < ?1) + (SELECT COUNT(*) FROM oauth_states WHERE expires < ?1)
        + (SELECT COUNT(*) FROM login_codes WHERE expires < ?1) AS n`),
      one('SELECT built, dirty FROM board_tops WHERE id = 1'),
    ]);
    const { pending, stuck } = await rules;
    return json({ counts: Object.fromEntries(TABLES.map((t, i) => [t, counts[i].n])), pending, stuck, expired: expired.n,
      built: board?.built || 0, dirty: !!board?.dirty });
  }
  if (route === 'POST /admin/purge') {
    if (body.what === 'expired') {
      const rs = await env.DB.batch(['sessions', 'oauth_states', 'login_codes'].map(t => env.DB.prepare(`DELETE FROM ${t} WHERE expires < ?`).bind(now)));
      const n = rs.reduce((a, r) => a + r.meta.changes, 0);
      await audit(env, now, 'purge expired', '', String(n)).run();
      return json({ removed: n });
    }
    if (body.what === 'stuck') {
      const r = await env.DB.prepare(`DELETE FROM runs WHERE verified = 0 AND ${STUCK}`).bind(String(RULES)).run();
      await audit(env, now, 'purge unverifiable', '', String(r.meta.changes)).run();
      return json({ removed: r.meta.changes });
    }
    return fail(400, 'bad purge');
  }
  if (route === 'POST /admin/rebuild') {
    await rebuildBoards(env, now, { force: true });
    await audit(env, now, 'rebuild boards', '').run();
    return json(null);
  }
  if (route === 'GET /admin/log') {
    const { results } = await env.DB.prepare('SELECT at, action, target, detail FROM admin_log ORDER BY id DESC LIMIT 50').all();
    return json({ log: results });
  }
  return fail(404, 'not found');
}

// Writes one board's top runs into the GET /boards snapshot at once (one atomic statement, so concurrent syncs can't
// lose each other's edit). A key the JSON path can't hold is left to the cron's rebuild.
async function patchTop(env, songId, diff, now, top) {
  const key = songId + '|' + diff;
  if (/["\\]/.test(key)) return;
  top ||= await board(env, songId, diff, { limit: BOARD_TOP });
  await env.DB.prepare(`UPDATE board_tops SET doc = json_set(doc, ?1, json(?2)), built = ?3 WHERE id = 1 AND rules = ?4`)
    .bind(`$."${key}"`, JSON.stringify(top), now, String(RULES)).run();
}

// Rebuilds the GET /boards snapshot when something changed (or `force`): the top BOARD_TOP public runs of every song
// and difficulty under the current RULES. -> the stored row { rules, doc, built }.
export async function rebuildBoards(env, now, { force = false } = {}) {
  const row = await env.DB.prepare('SELECT rules, doc, built, dirty FROM board_tops WHERE id = 1').first();
  if (row && !force && !row.dirty && row.rules === String(RULES)) return row;
  const { results } = await env.DB.prepare(`WITH best AS (
      SELECT r.song_id, r.diff, r.user_id, r.score, r.grade, r.accuracy, r.max_combo, r.fc, r.ap, r.mods, r.played_at,
        ROW_NUMBER() OVER (PARTITION BY r.song_id, r.diff, r.user_id ORDER BY r.score DESC, r.played_at) AS n
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.rules = ?1 AND r.verified = 1 AND r.hidden = 0 AND u.hidden = 0 AND u.public = 1
    ), ranked AS (
      SELECT b.*, u.display_name AS name, u.dev,
        ROW_NUMBER() OVER (PARTITION BY b.song_id, b.diff ORDER BY b.score DESC, b.played_at) AS rank,
        COUNT(*) OVER (PARTITION BY b.song_id, b.diff) AS total
      FROM best b JOIN users u ON u.id = b.user_id WHERE b.n = 1
    ) SELECT * FROM ranked WHERE rank <= ?2 ORDER BY song_id, diff, rank`).bind(String(RULES), BOARD_TOP).all();
  const boards = {};
  for (const r of results) {
    (boards[r.song_id + '|' + r.diff] ||= []).push({ rank: r.rank, total: r.total, name: r.name, score: r.score, grade: r.grade,
      accuracy: r.accuracy, maxCombo: r.max_combo, fc: !!r.fc, ap: !!r.ap, mods: JSON.parse(r.mods), playedAt: r.played_at,
      ...(r.dev && { dev: true }) });
  }
  const next = { rules: String(RULES), doc: JSON.stringify(boards), built: now };
  await env.DB.prepare(`INSERT INTO board_tops (id, rules, doc, built, dirty) VALUES (1, ?1, ?2, ?3, 0)
    ON CONFLICT (id) DO UPDATE SET rules = ?1, doc = ?2, built = ?3, dirty = 0`).bind(next.rules, next.doc, next.built).run();
  return next;
}

function originAllowed(origin, env) {
  if (!origin) return false;
  let o;
  try { o = new URL(origin); } catch { return false; }
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).some(a => {
    if (a.endsWith(':*')) return o.protocol + '//' + o.hostname === a.slice(0, -2);
    return o.origin === a;
  });
}

// The page to send the browser back to: an allowed origin, without its hash. -> string or null.
function returnUrl(raw, env) {
  try {
    const u = new URL(raw);
    if (!originAllowed(u.origin, env)) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) return undefined;
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch { return undefined; }
}

const docText = doc => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const s = JSON.stringify(doc);
  return s.length <= MAX_DOC ? s : null;
};

const isNum = v => typeof v === 'number' && isFinite(v);
function cleanRun(r) {
  if (!r || typeof r !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
  const clientRunId = str(r.clientRunId, 260), songId = str(r.songId, 200);
  if (!clientRunId || !songId || !DIFFS.includes(r.diff) || !isNum(r.score) || r.score < 0 || r.score > 1e9) return null;
  const replayLog = str(r.replay, MAX_REPLAY);
  return {
    clientRunId, songId, diff: r.diff, score: Math.round(r.score),
    grade: typeof r.grade === 'string' ? r.grade.slice(0, 2) : 'D',
    accuracy: isNum(r.accuracy) ? Math.max(0, Math.min(100, r.accuracy)) : 0, // percent
    maxCombo: isNum(r.maxCombo) ? Math.max(0, Math.round(r.maxCombo)) : 0,
    fc: r.fc ? 1 : 0, ap: r.ap ? 1 : 0,
    mods: JSON.stringify(Array.isArray(r.mods) ? r.mods.filter(t => typeof t === 'string').slice(0, 8).map(t => t.slice(0, 8)) : []),
    mult: isNum(r.mult) ? r.mult : 1,
    gameVersion: typeof r.gameVersion === 'string' ? r.gameVersion.slice(0, 32) : '',
    playedAt: isNum(r.playedAt) ? Math.round(r.playedAt) : 0,
    // Re-playable runs: the input log, the RULES it was played under, the mods as played, a custom song's melody.
    replay: replayLog,
    rules: replayLog && Number.isInteger(r.rules) ? String(r.rules) : null,
    loadout: replayLog ? JSON.stringify(mods.normalize(r.loadout)) : null,
    rtttl: replayLog && songId.startsWith('custom:') ? str(r.rtttl, MAX_RTTTL) : null,
    verified: 0, flags: '',
  };
}

// Re-play a run under this Worker's RULES: { verified: 1, and the server's score, grade, accuracy, max combo, FC/AP,
// mods, multiplier, flags } or { verified: -1 } when it can't count. `run` has songId, diff, replay, loadout, rtttl.
export function verifyRun(run) {
  const bad = { verified: -1 };
  const rtttl = run.songId.startsWith('custom:')
    ? run.rtttl && 'custom:' + hashString(run.rtttl.trim()) === run.songId && run.rtttl.trim()
    : BUILTIN.get(run.songId);
  if (!rtttl) return bad;
  let m, chart;
  try {
    m = mods.normalize(JSON.parse(run.loadout));
    chart = mods.applyChart(generateChart(parseRTTTL(rtttl), { difficulty: run.diff }), m);
  } catch { return bad; }
  if (m.demo || !chart.notes.length) return bad;
  const log = decodeLog(run.replay, chart.lanes);
  const res = log && replay(chart, log, mods.gameOptions(m));
  if (!res || res.failed) return bad;
  // As the game stores it (main.js, game.onFinish): the mods' multiplier folds into the score.
  const mult = mods.isActive(m) ? mods.multiplier(m) : 1;
  return {
    verified: 1, score: Math.round(res.score * mult), grade: res.grade, accuracy: res.accuracy, maxCombo: res.maxCombo,
    fc: res.fc ? 1 : 0, ap: res.ap ? 1 : 0, mods: JSON.stringify(mods.tags(m)), mult, flags: flagsFor(chart, log, res),
  };
}

// What looks automated, for moderation (GET /admin/flagged); flagged runs still count.
// flat: hit offsets barely vary (a bot, even one shifted by a constant). bot: nearly every press lands within 1 ms of
// the note (the demo mod's planned run).
function flagsFor(chart, log, res) {
  const f = [], d = res.deltas;
  if (d.length >= 30) {
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    if (sd < 0.004) f.push('flat');
  }
  const plan = planBot(chart, {}, 1).filter(e => e.type === 'press');
  if (plan.length >= 20) {
    const byLane = Array.from({ length: chart.lanes }, () => []);
    for (const [t, k] of log) if (k >= 0 && k < 8) byLane[k].push(t);
    byLane.forEach(l => l.sort((a, b) => a - b));
    let close = 0;
    for (const e of plan) {
      const l = byLane[e.lane];
      let lo = 0, hi = l.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (l[mid] < e.t) lo = mid + 1; else hi = mid; }
      if ((lo < l.length && l[lo] - e.t <= 0.001) || (lo > 0 && e.t - l[lo - 1] <= 0.001)) close++;
    }
    if (close >= plan.length * 0.9) f.push('bot');
  }
  return f.join(',');
}

// Waiting runs (verified = 0) that can never be re-played: no replay (history) or another RULES. Binds RULES as ?1.
const STUCK = '(replay IS NULL OR rules IS NOT ?1)';

// Drops waiting runs that cannot change a board: not above the player's verified best on that song, or beaten by another
// waiting run of theirs (equal claims: the lower id stays). -> how many.
export async function prunePending(env) {
  const r = await env.DB.prepare(`DELETE FROM runs WHERE verified = 0 AND replay IS NOT NULL AND rules = ?1 AND (
      EXISTS (SELECT 1 FROM runs b WHERE b.user_id = runs.user_id AND b.song_id = runs.song_id AND b.diff = runs.diff
        AND b.rules = runs.rules AND b.verified = 1 AND b.hidden = 0 AND b.score >= runs.score)
      OR EXISTS (SELECT 1 FROM runs b WHERE b.user_id = runs.user_id AND b.song_id = runs.song_id AND b.diff = runs.diff
        AND b.rules = runs.rules AND b.verified = 0 AND b.replay IS NOT NULL
        AND (b.score > runs.score OR (b.score = runs.score AND b.id < runs.id))))`).bind(String(RULES)).run();
  return r.meta.changes;
}

// Re-play runs waiting for it (over a request's budget, or posted before a deploy): the cron and POST /admin/verify.
export async function verifyPending(env, limit = VERIFY_PER_CRON) {
  const { results } = await env.DB.prepare(`SELECT id, song_id, diff, replay, loadout, rtttl FROM runs
    WHERE verified = 0 AND replay IS NOT NULL AND rules = ? ORDER BY score DESC LIMIT ?`).bind(String(RULES), limit).all();
  if (!results.length) return 0;
  await env.DB.batch(results.map(row => {
    const v = verifyRun({ songId: row.song_id, diff: row.diff, replay: row.replay, loadout: row.loadout, rtttl: row.rtttl });
    return v.verified === 1
      ? env.DB.prepare(`UPDATE runs SET verified = 1, score = ?, grade = ?, accuracy = ?, max_combo = ?, fc = ?, ap = ?,
          mods = ?, mult = ?, flags = ? WHERE id = ?`).bind(v.score, v.grade, v.accuracy, v.maxCombo, v.fc, v.ap, v.mods,
          v.mult, v.flags, row.id)
      : env.DB.prepare('UPDATE runs SET verified = -1 WHERE id = ?').bind(row.id);
  }).concat(boardsChanged(env)));
  return results.length;
}

// Best verified run per player under the current RULES, ranked (ties: the earlier run first). `me` = a user id: only
// that player and the two above and below, with that player included even when not public.
async function board(env, songId, diff, { limit = 50, me = '' }) {
  const ranked = `WITH best AS (
      SELECT r.user_id, r.score, r.grade, r.accuracy, r.max_combo, r.fc, r.ap, r.mods, r.played_at,
        ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.score DESC, r.played_at) AS n
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.song_id = ?1 AND r.diff = ?2 AND r.rules = ?3 AND r.verified = 1 AND r.hidden = 0
        AND u.hidden = 0 AND (u.public = 1 OR u.id = ?4)
    ), ranked AS (
      SELECT b.*, u.display_name AS name, u.dev, ROW_NUMBER() OVER (ORDER BY b.score DESC, b.played_at) AS rank,
        COUNT(*) OVER () AS total
      FROM best b JOIN users u ON u.id = b.user_id WHERE b.n = 1
    )`;
  const q = me
    ? env.DB.prepare(`${ranked} SELECT * FROM ranked WHERE abs(rank - (SELECT rank FROM ranked WHERE user_id = ?4)) <= 2
        ORDER BY rank`).bind(songId, diff, String(RULES), me)
    : env.DB.prepare(`${ranked} SELECT * FROM ranked ORDER BY rank LIMIT ?5`).bind(songId, diff, String(RULES), '', limit);
  const { results } = await q.all();
  return results.map(r => ({
    rank: r.rank, total: r.total, name: r.name, score: r.score, grade: r.grade, accuracy: r.accuracy,
    maxCombo: r.max_combo, fc: !!r.fc, ap: !!r.ap, mods: JSON.parse(r.mods), playedAt: r.played_at,
    ...(r.dev && { dev: true }),
    ...(me && r.user_id === me && { me: true }),
  }));
}

// The caller's rank on every board they are on (best verified run per player, current RULES, as in board()). Only the
// boards the caller has a verified run on are ranked (runs_user, then runs_rank), not the whole table.
async function ranks(env, me) {
  const { results } = await env.DB.prepare(`WITH mine AS (
      SELECT DISTINCT song_id, diff FROM runs WHERE user_id = ?2 AND rules = ?1 AND verified = 1 AND hidden = 0
    ), best AS (
      SELECT r.user_id, r.song_id, r.diff, r.score, r.played_at,
        ROW_NUMBER() OVER (PARTITION BY r.song_id, r.diff, r.user_id ORDER BY r.score DESC, r.played_at) AS n
      FROM mine m JOIN runs r ON r.song_id = m.song_id AND r.diff = m.diff
      JOIN users u ON u.id = r.user_id
      WHERE r.rules = ?1 AND r.verified = 1 AND r.hidden = 0 AND u.hidden = 0 AND (u.public = 1 OR u.id = ?2)
    ), ranked AS (
      SELECT user_id, song_id, diff, score,
        ROW_NUMBER() OVER (PARTITION BY song_id, diff ORDER BY score DESC, played_at) AS rank,
        COUNT(*) OVER (PARTITION BY song_id, diff) AS total
      FROM best WHERE n = 1
    ) SELECT song_id, diff, score, rank, total FROM ranked WHERE user_id = ?2
      ORDER BY CAST(rank AS REAL) / total, song_id LIMIT 500`).bind(String(RULES), me).all();
  return results.map(r => ({ songId: r.song_id, diff: r.diff, score: r.score, rank: r.rank, total: r.total }));
}

// A provider's display name -> a valid player name (accents dropped, other characters removed, long names cut at a
// word), or '' when too little is left.
export function playerName(raw) {
  let s = String(raw || '').replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 16) {
    const cut = s.slice(0, 17).lastIndexOf(' ');
    s = cut >= 3 ? s.slice(0, cut) : s.slice(0, 16);
  }
  s = s.replace(/^[ ._-]+|[ ._-]+$/g, '');
  return cleanName(s);
}

// GitHub OAuth code -> { subject: numeric user id as text, name, login }, or null. The access token is used once and dropped.
async function githubUser(env, code, redirectUri) {
  const ua = { 'User-Agent': 'ringbeat-api', Accept: 'application/json' };
  const t = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { ...ua, 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
  }).then(r => r.json()).catch(() => null);
  if (!t || !t.access_token) return null;
  const u = await fetch('https://api.github.com/user', { headers: { ...ua, Authorization: 'Bearer ' + t.access_token } })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  return u && Number.isInteger(u.id) ? { subject: String(u.id), name: u.name, login: u.login } : null;
}

// The profile a login belongs to; a first login creates it, named after the provider's display name when it gives
// a usable one. A profile still on its generated Player-XXXX name takes that name on its next sign-in.
async function userFor(env, provider, subject, suggested, now) {
  const row = await env.DB.prepare(`SELECT i.user_id, u.display_name FROM identities i JOIN users u ON u.id = i.user_id
    WHERE i.provider = ? AND i.subject = ?`).bind(provider, subject).first();
  if (row) {
    if (suggested && DEFAULT_NAME.test(row.display_name)) {
      await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(suggested, row.user_id).run();
    }
    return row.user_id;
  }
  const id = crypto.randomUUID();
  const name = suggested || 'Player-' + [...crypto.getRandomValues(new Uint8Array(4))].map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, display_name, created) VALUES (?, ?, ?)').bind(id, name, now),
    env.DB.prepare('INSERT INTO identities (provider, subject, user_id, created) VALUES (?, ?, ?, ?)').bind(provider, subject, id, now),
  ]);
  return id;
}

async function profile(env, uid) {
  const u = await env.DB.prepare('SELECT id, display_name, created, public, dev FROM users WHERE id = ?').bind(uid).first();
  const { results } = await env.DB.prepare('SELECT provider FROM identities WHERE user_id = ?').bind(uid).all();
  return u && { id: u.id, name: u.display_name, created: u.created, public: !!u.public, logins: results.map(r => r.provider), ...(u.dev && { dev: true }) };
}

// Everything stored about one player, for GET /me/export (GDPR access and portability). Sign-in tokens are left out:
// they are stored only as hashes and are credentials, not data about the player.
async function exportUser(env, uid, now) {
  const all = async (sql) => (await env.DB.prepare(sql).bind(uid).all()).results;
  const u = await env.DB.prepare('SELECT id, display_name, created, public, hidden, banned, dev, reset_at FROM users WHERE id = ?').bind(uid).first();
  const parse = t => { try { return JSON.parse(t); } catch { return t; } };
  const shared = (await all('SELECT doc, rev, updated FROM shared_docs WHERE user_id = ?'))[0];
  return {
    exportedAt: now,
    profile: { id: u.id, name: u.display_name, created: u.created, public: !!u.public, hidden: !!u.hidden, banned: !!u.banned, dev: !!u.dev, resetAt: u.reset_at },
    identities: await all('SELECT provider, subject, created FROM identities WHERE user_id = ?'),
    shared: shared && { rev: shared.rev, updated: shared.updated, doc: parse(shared.doc) },
    devices: (await all('SELECT device_id, doc, updated FROM device_slots WHERE user_id = ?')).map(d => ({ deviceId: d.device_id, updated: d.updated, doc: parse(d.doc) })),
    runs: (await all(`SELECT client_run_id, song_id, diff, score, grade, accuracy, max_combo, fc, ap, mods, mult, game_version, played_at,
      received_at, verified, hidden, flags, rules, loadout, rtttl, replay FROM runs WHERE user_id = ? ORDER BY played_at`)).map(r => ({
      clientRunId: r.client_run_id, songId: r.song_id, diff: r.diff, score: r.score, grade: r.grade, accuracy: r.accuracy, maxCombo: r.max_combo,
      fc: !!r.fc, ap: !!r.ap, mods: r.mods, mult: r.mult, gameVersion: r.game_version, playedAt: r.played_at, receivedAt: r.received_at,
      verified: r.verified, hidden: !!r.hidden, flags: r.flags, rules: r.rules, loadout: r.loadout, rtttl: r.rtttl, replay: r.replay,
    })),
  };
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
