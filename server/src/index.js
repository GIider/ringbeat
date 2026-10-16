// Ringbeat API: a Cloudflare Worker over D1 (binding DB). Online profiles with GitHub sign-in, cloud save and the run
// history for future leaderboards. Plain fetch handler, no dependencies. Routes and data model: docs/CLOUD.md.
//
// Env: DB (D1), GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (secret), ALLOWED_ORIGINS (comma list; "http://localhost:*"
// allows any local port), LIMITER (optional rate-limit binding).

const SESSION_MS = 365 * 24 * 3600e3;
const STATE_MS = 10 * 60e3;   // OAuth round trip
const CODE_MS = 2 * 60e3;     // one-time code from the callback to /auth/exchange
const MAX_BODY = 300_000;     // request body, characters
const MAX_DOC = 256_000;      // stored document, characters
const MAX_DEVICES = 20;
const MAX_RUNS = 50;          // per POST /runs
const DIFFS = ['normal', 'hard'];
const NAME = /^[A-Za-z0-9_.-](?:[A-Za-z0-9 _.-]{1,14})[A-Za-z0-9_.-]$/; // 3-16 characters the LCD font has
const DEVICE = /^[a-z0-9]{8,32}$/;
const DEFAULT_NAME = /^Player-[A-Z2-9]{4}$/;

export default { fetch: (req, env) => handle(req, env) };

export async function handle(req, env, now = Date.now()) {
  const url = new URL(req.url);
  const origin = req.headers.get('Origin') || '';
  const cors = originAllowed(origin, env) ? {
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400',
  } : {};
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
    status: body === null ? 204 : status, headers: { ...cors, ...(body !== null && { 'Content-Type': 'application/json' }) },
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
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : null;
    if (body === undefined) return fail(400, 'bad body');

    if (route === 'POST /auth/exchange') {
      const hash = await sha256(String(body.code || ''));
      const row = await env.DB.prepare('SELECT user_id, expires FROM login_codes WHERE code_hash = ?').bind(hash).first();
      await env.DB.prepare('DELETE FROM login_codes WHERE code_hash = ?').bind(hash).run();
      if (!row || row.expires < now) return fail(400, 'expired');
      const token = randomToken();
      await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)')
        .bind(await sha256(token), row.user_id, now, now + SESSION_MS).run();
      return json({ token, profile: await profile(env, row.user_id) });
    }

    const auth = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('Authorization') || '');
    const tokenHash = auth && await sha256(auth[1]);
    const session = tokenHash && await env.DB.prepare('SELECT user_id, expires FROM sessions WHERE token_hash = ?').bind(tokenHash).first();
    if (!session || session.expires < now) {
      return url.pathname === '/' ? new Response('Ringbeat API', { headers: cors }) : fail(401, 'sign in');
    }
    const uid = session.user_id;

    if (route === 'POST /auth/logout') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
      return json(null);
    }
    if (route === 'GET /me') return json({ profile: await profile(env, uid) });
    if (route === 'PATCH /me') {
      const name = String(body.displayName || '').trim().replace(/\s+/g, ' ');
      if (!NAME.test(name)) return fail(400, 'bad name');
      await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name, uid).run();
      return json({ profile: await profile(env, uid) });
    }
    if (route === 'DELETE /me') {
      await env.DB.batch(['runs', 'device_slots', 'shared_docs', 'login_codes', 'sessions', 'identities']
        .map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(uid))
        .concat(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid)));
      return json(null);
    }

    if (route === 'GET /sync') {
      const shared = await env.DB.prepare('SELECT doc, rev FROM shared_docs WHERE user_id = ?').bind(uid).first();
      const { results } = await env.DB.prepare('SELECT device_id, doc FROM device_slots WHERE user_id = ?').bind(uid).all();
      return json({
        shared: shared ? { doc: JSON.parse(shared.doc), rev: shared.rev } : { doc: null, rev: 0 },
        devices: Object.fromEntries(results.map(r => [r.device_id, JSON.parse(r.doc)])),
      });
    }
    if (route === 'PUT /sync/shared') {
      const doc = docText(body.doc), base = body.baseRev;
      if (!doc || !Number.isInteger(base) || base < 0) return fail(400, 'bad doc');
      const r = base === 0
        ? await env.DB.prepare('INSERT INTO shared_docs (user_id, doc, rev, updated) VALUES (?, ?, 1, ?) ON CONFLICT (user_id) DO NOTHING').bind(uid, doc, now).run()
        : await env.DB.prepare('UPDATE shared_docs SET doc = ?, rev = rev + 1, updated = ? WHERE user_id = ? AND rev = ?').bind(doc, now, uid, base).run();
      if (!r.meta.changes) return fail(409, 'stale');
      return json({ rev: base + 1 });
    }
    const dev = /^PUT \/sync\/device\/([^/]+)$/.exec(route);
    if (dev) {
      const doc = docText(body.doc);
      if (!DEVICE.test(dev[1]) || !doc) return fail(400, 'bad doc');
      await env.DB.prepare(`INSERT INTO device_slots (user_id, device_id, doc, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, device_id) DO UPDATE SET doc = excluded.doc, updated = excluded.updated`).bind(uid, dev[1], doc, now).run();
      // Devices long gone make room: only the newest MAX_DEVICES are kept.
      await env.DB.prepare(`DELETE FROM device_slots WHERE user_id = ? AND device_id NOT IN
        (SELECT device_id FROM device_slots WHERE user_id = ? ORDER BY updated DESC LIMIT ?)`).bind(uid, uid, MAX_DEVICES).run();
      return json(null);
    }

    if (route === 'POST /runs') {
      if (!Array.isArray(body.runs) || body.runs.length > MAX_RUNS) return fail(400, 'bad runs');
      const runs = body.runs.map(cleanRun).filter(Boolean);
      if (runs.length) {
        await env.DB.batch(runs.map(r => env.DB.prepare(`INSERT INTO runs (user_id, client_run_id, song_id, diff, score, grade,
          accuracy, max_combo, fc, ap, mods, mult, game_version, played_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, client_run_id) DO NOTHING`).bind(uid, r.clientRunId, r.songId, r.diff, r.score, r.grade, r.accuracy,
          r.maxCombo, r.fc, r.ap, r.mods, r.mult, r.gameVersion, r.playedAt, now)));
      }
      return json({ accepted: runs.length });
    }
    return fail(404, 'not found');
  } catch (e) {
    console.error(e);
    return fail(500, 'server error');
  }
}

// ---- helpers ----

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
  return {
    clientRunId, songId, diff: r.diff, score: Math.round(r.score),
    grade: typeof r.grade === 'string' ? r.grade.slice(0, 2) : 'D',
    accuracy: isNum(r.accuracy) ? Math.max(0, Math.min(1, r.accuracy)) : 0,
    maxCombo: isNum(r.maxCombo) ? Math.max(0, Math.round(r.maxCombo)) : 0,
    fc: r.fc ? 1 : 0, ap: r.ap ? 1 : 0,
    mods: JSON.stringify(Array.isArray(r.mods) ? r.mods.filter(t => typeof t === 'string').slice(0, 8).map(t => t.slice(0, 8)) : []),
    mult: isNum(r.mult) ? r.mult : 1,
    gameVersion: typeof r.gameVersion === 'string' ? r.gameVersion.slice(0, 32) : '',
    playedAt: isNum(r.playedAt) ? Math.round(r.playedAt) : 0,
  };
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
  return NAME.test(s) ? s : '';
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
  const u = await env.DB.prepare('SELECT id, display_name, created FROM users WHERE id = ?').bind(uid).first();
  const { results } = await env.DB.prepare('SELECT provider FROM identities WHERE user_id = ?').bind(uid).all();
  return u && { id: u.id, name: u.display_name, created: u.created, logins: results.map(r => r.provider) };
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
