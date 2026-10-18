// Admin client for the Worker's /admin/* routes (docs/CLOUD.md › Moderation). Dev mode (?dev) or a signed-in dev-flag account. The admin token
// lives in this closure and nowhere else: not in storage, not in the cloud state, and a wrong one never signs the
// player out (this has its own fetch path, unlike cloud.js request()).
export const TIMEOUT = 8000;
export const PAGE = 20; // the server's page size

export class AdminError extends Error {
  constructor(status) { super('admin ' + status); this.status = status; }
}

// debug: the request log callback (netdebug.js), as in cloud.js; the token is never passed to it.
export function createAdmin({ apiBase, fetch = globalThis.fetch.bind(globalThis), debug = null }) {
  let token = '';
  const qs = o => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== '' && v !== undefined && v !== 0) p.set(k, v);
    return p.size ? '?' + p : '';
  };
  async function call(method, path, body) {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const t0 = Date.now(), log = debug && debug.enabled !== false && { why: 'admin', method, path, body: body ?? null, sent: text ? text.length : 0 };
    const done = extra => { if (log) debug({ ...log, ms: Date.now() - t0, ...extra }); };
    let res;
    try {
      res = await fetch(apiBase + path, {
        method, signal: AbortSignal.timeout(TIMEOUT),
        headers: { Authorization: 'Bearer ' + token, ...(text !== undefined && { 'Content-Type': 'application/json' }) },
        ...(text !== undefined && { body: text }),
      });
    } catch { done({ error: 'network' }); throw new AdminError(0); }
    if (!res.ok) { done({ status: res.status }); throw new AdminError(res.status); } // 404 is both a bad token and a missing target
    if (res.status === 204) { done({ status: 204, received: 0 }); return null; }
    const raw = await res.text(), data = JSON.parse(raw);
    done({ status: res.status, received: raw.length, response: data });
    return data;
  }
  const post = (path, body) => call('POST', path, body);
  return {
    unlocked: () => !!token,
    lock() { token = ''; },
    // Probes the token with a read every Worker version has (/admin/stats is newer, so an API not yet deployed with it
    // would answer 404 to a right token); keeps it only when the server accepts it.
    async unlock(candidate) {
      token = String(candidate || '').trim();
      try { await call('GET', '/admin/flagged'); } catch (e) { token = ''; throw e; }
    },
    stats: () => call('GET', '/admin/stats'),
    players: (q = '', offset = 0) => call('GET', '/admin/players' + qs({ q, offset })).then(r => r.players),
    // -> { runs, counts (the player's runs per STATUSES group, `total`), versions (game versions seen, newest first) }
    runs: (user, { status = '', version = '', offset = 0 } = {}) => call('GET', '/admin/runs' + qs({ user, status, version, offset })),
    flagged: () => call('GET', '/admin/flagged').then(r => r.runs),
    log: () => call('GET', '/admin/log').then(r => r.log),
    deleteRun: runId => post('/admin/run/delete', { runId }),
    deletePlayer: userId => post('/admin/player/delete', { userId }),
    ban: (userId, banned) => post('/admin/ban', { userId, banned }),
    hideRun: (runId, hidden) => post('/admin/hide', { runId, hidden }),
    hidePlayer: (userId, hidden) => post('/admin/hide', { userId, hidden }),
    unflag: runId => post('/admin/unflag', { runId }),
    purgeExpired: () => post('/admin/purge', { what: 'expired' }),
    purgeStuck: () => post('/admin/purge', { what: 'stuck' }),
    purgeOutdated: () => post('/admin/purge', { what: 'outdated' }),
    rebuild: () => post('/admin/rebuild', {}),
    verify: () => post('/admin/verify', {}),
  };
}

// ---- one-line summaries for the list rows (pure) ----
// The player view's groups, in the order the filter button cycles through them ('' = all runs).
export const STATUSES = ['', 'valid', 'verified', 'pending', 'rejected', 'flagged', 'hidden', 'outdated'];
// The next entry of `list` after `cur` (wraps; an unknown `cur` starts over).
export const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
export const countsLine = c => STATUSES.filter(Boolean).filter(k => c[k]).map(k => `${c[k]} ${k}`).join(' · ');
export const playerLine = p => `${p.name}${p.banned ? ' [banned]' : p.hidden ? ' [hidden]' : ''} · ${p.runs}`;
export const runLine = r => `${r.name ? r.name + ' · ' : ''}${r.song_id} · ${r.score}` +
  `${r.flags ? ' · ' + r.flags : ''}${r.hidden ? ' · hidden' : ''}${r.verified === 0 ? ' · pending' : r.verified === -1 ? ' · rejected' : ''}${r.game_version ? ' · v' + r.game_version : ''}`;
export const logLine = l => `${new Date(l.at).toISOString().slice(0, 16).replace('T', ' ')} ${l.action} ${l.target}${l.detail ? ' ' + l.detail : ''}`;
