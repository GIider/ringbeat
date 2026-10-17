// Data and list logic of the stand-alone leaderboard page (boards.html): pure, no DOM. `fetch` and `storage` are
// injected so tests can fake them. Only public data is read: GET /boards (every song's top 10, one request) and
// GET /board/:song/:diff (the deeper list of one board).
import { applyView } from './listview.js';

export const VIEW_KEY = 'ringbeat.boards.view';
export const DEEP_LIMIT = 100;   // the API's largest board
export const BOARD_SORTS = [
  { id: 'title', label: 'Title' },
  { id: 'diff-asc', label: 'Rating' },
  { id: 'score', label: 'Top score' },
  { id: 'recent', label: 'Latest' },
];
const DIFFS = ['normal', 'hard'];
const CATEGORY_IDS = ['all', 'classical', 'pop', 'dance', 'ndw', 'screen', 'videogame', 'folk'];

async function getJSON(fetchFn, url, etag) {
  const r = await fetchFn(url, etag ? { headers: { 'If-None-Match': etag } } : undefined);
  if (r.status === 304) return { notModified: true, etag };
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return { value: await r.json(), etag: r.headers && r.headers.get ? r.headers.get('ETag') || '' : '' };
}

// The snapshot of every board: { rules, built, boards: { 'songId|diff': [rows] } }. Pass the previous result as
// `prev` to revalidate with its ETag; a 304 hands the same object back.
export async function loadSnapshot(fetchFn, base, prev = null) {
  const r = await getJSON(fetchFn, base + '/boards', prev && prev.etag);
  if (r.notModified && prev) return prev;
  const v = r.value;
  if (!v || typeof v.boards !== 'object' || v.boards === null) throw new Error('bad boards');
  return { ...v, etag: r.etag };
}

// One board in depth: [rows], best verified run per player.
export async function loadBoard(fetchFn, base, songId, diff, limit = DEEP_LIMIT) {
  if (!DIFFS.includes(diff)) throw new Error('bad difficulty');
  const r = await getJSON(fetchFn, `${base}/board/${encodeURIComponent(songId)}/${diff}?limit=${limit}`);
  if (!r.value || !Array.isArray(r.value.runs)) throw new Error('bad board');
  return r.value.runs;
}

const topOf = (snap, id, diff) => (snap && snap.boards[id + '|' + diff]) || [];
const latest = rows => rows.reduce((m, r) => Math.max(m, Number(r.playedAt) || 0), 0);

// The song list: [{ entry, top: [rows], leader: row|null }] from each song's board (its one chart). Custom songs are
// ignored. `sort`: title, diff-asc (rating), score, recent.
export function songRows(snap, entries, { category = 'all', query = '', sort = 'title' } = {}) {
  const q = String(query).trim().toLowerCase();
  const base = entries.filter(e => !String(e.id).startsWith('custom:') &&
    (!q || e.title.toLowerCase().includes(q) || (e.tag || '').toLowerCase().includes(q)));
  const list = applyView(base, { sort: sort === 'diff-asc' ? 'diff-asc' : 'title', category }, null)
    .map(entry => { const top = topOf(snap, entry.id, entry.chart); return { entry, top, leader: top[0] || null }; });
  const key = { score: x => x.leader ? x.leader.score : -1, recent: x => latest(x.top) }[sort];
  return key ? list.map((x, i) => ({ x, i })).sort((a, b) => (key(b.x) - key(a.x)) || a.i - b.i).map(o => o.x) : list;
}

// Remembered choices (category, sort), sanitized; storage may be blocked or hold junk.
export function loadView(storage) {
  let raw = {};
  try { raw = JSON.parse(storage.getItem(VIEW_KEY)) || {}; } catch { /* defaults */ }
  return {
    category: CATEGORY_IDS.includes(raw.category) ? raw.category : 'all',
    sort: BOARD_SORTS.some(s => s.id === raw.sort) ? raw.sort : 'title',
  };
}
export function saveView(storage, view) {
  try { storage.setItem(VIEW_KEY, JSON.stringify({ category: view.category, sort: view.sort })); } catch { /* ignore */ }
}
