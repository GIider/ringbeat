import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, loadBoard, songRows, loadView, saveView, VIEW_KEY } from '../src/boardsview.js';

const entry = (id, title, category, extra = {}) => ({ id, title, tag: '', category, stars: { normal: 2, hard: 3 }, rating: { normal: 3, hard: 6 }, ...extra });
const entries = [
  entry('a', 'Alpha', 'pop'), entry('b', 'Bravo', 'classical', { rating: { normal: 8, hard: 9 } }),
  entry('c', 'Charlie', 'pop', { only: 'normal' }), entry('custom:x', 'Mine', 'custom'),
];
const row = (name, score, playedAt = 0) => ({ rank: 1, name, score, grade: 'A', playedAt });
const snap = { rules: 1, built: 1, boards: { 'a|normal': [row('Ann', 500, 10)], 'b|normal': [row('Bo', 900, 5)], 'c|normal': [row('Cy', 100, 99)] } };
const resp = (body, { status = 200, etag = '' } = {}) => ({ ok: status < 400, status, headers: { get: h => (h === 'ETag' ? etag : null) }, json: async () => body });

test('custom songs and songs without a board at this difficulty are left out', () => {
  assert.deepEqual(songRows(snap, entries, 'normal').map(r => r.entry.id), ['a', 'b', 'c']);
  assert.deepEqual(songRows(snap, entries, 'hard').map(r => r.entry.id), ['a', 'b']);
});

test('filters by category and by title, sorts by title, difficulty, score and recency', () => {
  const ids = (o, d = 'normal') => songRows(snap, entries, d, o).map(r => r.entry.id);
  assert.deepEqual(ids({ category: 'pop' }), ['a', 'c']);
  assert.deepEqual(ids({ query: ' BRA ' }), ['b']);
  assert.deepEqual(ids({ sort: 'diff-asc' }), ['a', 'c', 'b']);
  assert.deepEqual(ids({ sort: 'score' }), ['b', 'a', 'c']);
  assert.deepEqual(ids({ sort: 'recent' }), ['c', 'a', 'b']);
});

test('a song without runs has no leader and sorts last by score', () => {
  const empty = { boards: { 'b|normal': [row('Bo', 900)] } };
  const rows = songRows(empty, entries, 'normal', { sort: 'score' });
  assert.deepEqual(rows.map(r => r.entry.id), ['b', 'a', 'c']);
  assert.equal(rows[1].leader, null);
});

test('the snapshot is revalidated by ETag and a 304 keeps the old one', async () => {
  const calls = [];
  const f = async (url, init) => { calls.push([url, init]); return init ? resp(null, { status: 304 }) : resp(snap, { etag: '"7"' }); };
  const first = await loadSnapshot(f, 'https://api');
  assert.equal(first.etag, '"7"');
  const again = await loadSnapshot(f, 'https://api', first);
  assert.equal(again, first);
  assert.equal(calls[0][0], 'https://api/boards');
  assert.deepEqual(calls[1][1], { headers: { 'If-None-Match': '"7"' } });
});

test('bad answers and HTTP errors reject', async () => {
  await assert.rejects(loadSnapshot(async () => resp({ nope: 1 }), ''), /bad boards/);
  await assert.rejects(loadSnapshot(async () => resp({}, { status: 500 }), ''), /HTTP 500/);
  await assert.rejects(loadBoard(async () => resp({ runs: 5 }), '', 'a', 'normal'), /bad board/);
  await assert.rejects(loadBoard(async () => resp({ runs: [] }), '', 'a', 'easy'), /difficulty/);
});

test('a deep board asks for the song id encoded', async () => {
  let url;
  const runs = await loadBoard(async u => { url = u; return resp({ rules: 1, runs: [row('A', 1)] }); }, 'https://api', 'a b', 'hard', 100);
  assert.equal(url, 'https://api/board/a%20b/hard?limit=100');
  assert.equal(runs.length, 1);
});

test('the remembered view survives junk and blocked storage', () => {
  const mem = {};
  const st = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(loadView(st), { category: 'all', diff: 'normal', sort: 'title' });
  saveView(st, { category: 'pop', diff: 'hard', sort: 'score' });
  assert.deepEqual(loadView(st), { category: 'pop', diff: 'hard', sort: 'score' });
  mem[VIEW_KEY] = '{"category":"x","diff":"y","sort":"z"}';
  assert.deepEqual(loadView(st), { category: 'all', diff: 'normal', sort: 'title' });
  const blocked = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  assert.equal(loadView(blocked).diff, 'normal');
  saveView(blocked, { category: 'all', diff: 'normal', sort: 'title' });
});
