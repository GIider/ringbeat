// Lifetime stats, the changelog inbox data and the main-menu icons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStats, gradeTally, favourite, topSongs, formatDuration, currentStreak, dayKey, STATS_KEY } from '../src/stats.js';
import { createScores } from '../src/scores.js';
import { MESSAGES, defaultSeen, unread, markRead } from '../src/changelog.js';
import { MENU_IDS, menuFrame, menuFrames, letterFrame, ICON_W, ICON_H } from '../src/menuicons.js';
import { GLYPHS } from '../src/pixelfont.js';
import { VERSION } from '../src/version.js';

const mem = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const DAY = 86400000;
const noon = (y, mo, d) => new Date(y, mo - 1, d, 12).getTime();
const result = (extra = {}) => ({ score: 1000, maxCombo: 20, counts: { perfect: 10, great: 5, good: 3, miss: 2 }, ghosts: 1, fc: false, ap: false, ...extra });

test('stats: runs, notes, score, combo, aborts and playtime persist', () => {
  const st = mem();
  let t = noon(2026, 10, 16);
  const s = createStats(st, () => t);
  s.recordRun({ diff: 'normal', result: result() });
  s.recordRun({ diff: 'hard', result: result({ score: 500, maxCombo: 40, fc: true, ap: true }), custom: true, modded: true });
  s.recordRun({ diff: 'hard', result: result({ failed: true, fc: true }) });
  s.recordAbort('quit');
  s.recordAbort('restart');
  s.addPlaytime(90.5, 'hard');
  s.addPlaytime(-3, 'hard'); // ignored
  const d = createStats(st, () => t).get();
  assert.equal(d.runs, 3);
  assert.equal(d.finished, 2);
  assert.equal(d.failed, 1);
  assert.equal(d.quits, 1);
  assert.equal(d.restarts, 1);
  assert.equal(d.score, 2500);
  assert.equal(d.bestCombo, 40);
  assert.deepEqual(d.notes, { perfect: 30, great: 15, good: 9, miss: 6 });
  assert.equal(d.ghosts, 3);
  assert.equal(d.fcRuns, 1, 'a failed run never counts as FC');
  assert.equal(d.apRuns, 1);
  assert.equal(d.customRuns, 1);
  assert.equal(d.moddedRuns, 1);
  assert.equal(d.playtime, 90.5);
  assert.deepEqual(d.byDiff.hard, { runs: 2, playtime: 90.5 });
  assert.equal(d.byDiff.normal.runs, 1);
  assert.equal(d.firstPlayed, t);
  assert.equal(d.daysPlayed, 1);
});

test('stats: get() is a copy; corrupt or blocked storage falls back to zeros', () => {
  const s = createStats(mem());
  s.get().notes.perfect = 99;
  assert.equal(s.get().notes.perfect, 0);
  for (const bad of ['{', 'null', '"x"', '{"runs":-4,"notes":{"perfect":"lots"},"byDiff":7}']) {
    const st = mem(); st.setItem(STATS_KEY, bad);
    const d = createStats(st).get();
    assert.equal(d.runs, 0, bad);
    assert.equal(d.notes.perfect, 0, bad);
    assert.deepEqual(d.byDiff.normal, { runs: 0, playtime: 0 }, bad);
  }
  const blocked = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  const b = createStats(blocked);
  b.recordRun({ diff: 'normal', result: result() });
  assert.equal(b.get().runs, 1); // still counts for the session
});

test('stats: play-day streak counts consecutive local days', () => {
  let t = noon(2026, 10, 1);
  const s = createStats(mem(), () => t);
  const play = () => s.recordRun({ diff: 'normal', result: result() });
  play(); play(); // same day twice
  assert.equal(s.get().streak, 1);
  t += DAY; play();
  t += DAY; play();
  assert.equal(s.get().streak, 3);
  assert.equal(currentStreak(s.get(), t + DAY), 3, 'still alive the next day');
  assert.equal(currentStreak(s.get(), t + 2 * DAY), 0, 'broken after a missed day');
  t += 3 * DAY; play();
  const d = s.get();
  assert.equal(d.streak, 1);
  assert.equal(d.bestStreak, 3);
  assert.equal(d.daysPlayed, 4);
  // across a month boundary
  t = noon(2026, 10, 31); play(); t = noon(2026, 11, 1); play();
  assert.equal(s.get().streak, 2);
  assert.equal(dayKey(noon(2026, 3, 5)), '2026-03-05');
});

test('stats: backfill from highscores runs once, only without a stats record', () => {
  const st = mem(), sc = createScores(mem());
  sc.record('a', 'normal', { score: 900, grade: 'A', accuracy: 91, maxCombo: 50, fc: true, ap: false, date: noon(2026, 9, 1) });
  sc.record('a', 'normal', { score: 400, grade: 'C', accuracy: 70, maxCombo: 12, fc: false, ap: false, date: noon(2026, 9, 3) });
  sc.record('b', 'hard', { score: 1200, grade: 'S', accuracy: 100, maxCombo: 80, fc: true, ap: true, date: noon(2026, 9, 3) });
  const s = createStats(st);
  assert.equal(s.backfill(sc.all()), true);
  const d = s.get();
  assert.equal(d.runs, 3);
  assert.equal(d.byDiff.normal.runs, 2);
  assert.equal(d.score, 2500);
  assert.equal(d.bestCombo, 80);
  assert.equal(d.fcRuns, 2);
  assert.equal(d.apRuns, 1);
  assert.equal(d.daysPlayed, 2);
  assert.equal(d.firstPlayed, noon(2026, 9, 1));
  assert.equal(d.playtime, 0);
  assert.equal(d.backfilled, true);
  // second load: a record exists, nothing is added again
  assert.equal(createStats(st).backfill(sc.all()), false);
  assert.equal(createStats(st).get().runs, 3);
  // a new player gets an empty record and is never backfilled later
  const fresh = mem(), f = createStats(fresh);
  assert.equal(f.backfill([]), false);
  assert.equal(createStats(fresh).backfill(sc.all()), false);
  // clearing stats does not re-trigger the backfill either
  s.clear();
  assert.equal(createStats(st).backfill(sc.all()), false);
  assert.equal(createStats(st).get().runs, 0);
});

test('gradeTally / favourite / formatDuration', () => {
  const sc = createScores(mem());
  const rec = (id, diff, grade, extra = {}) => sc.record(id, diff, { score: 100, grade, accuracy: 90, maxCombo: 1, fc: false, ap: false, ...extra });
  rec('a', 'normal', 'S', { fc: true, ap: true });
  rec('a', 'hard', 'C');
  rec('b', 'hard', 'B', { fc: true });
  rec('b', 'hard', 'A', { score: 200 }); // better run: becomes the best
  rec('c', 'normal', 'D');
  const all = gradeTally(sc.all());
  assert.deepEqual(all, { S: 1, A: 1, B: 0, C: 0, D: 1, fc: 2, ap: 1, played: 3 });
  assert.deepEqual(gradeTally(sc.all(), 'hard'), { S: 0, A: 1, B: 0, C: 1, D: 0, fc: 1, ap: 0, played: 2 });
  assert.deepEqual(gradeTally([], 'normal'), { S: 0, A: 0, B: 0, C: 0, D: 0, fc: 0, ap: 0, played: 0 });
  rec('b', 'normal', 'D');
  assert.deepEqual(favourite(sc.all()), { id: 'b', plays: 3 }, 'plays summed across difficulties');
  assert.equal(favourite([]), null);
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45.9), '45s');
  assert.equal(formatDuration(760), '12m 40s');
  assert.equal(formatDuration(11220), '3h 07m');
});

test('changelog: newest first, newest is this version, text fits the LCD font', () => {
  const v = s => s.split('.').map(Number);
  for (let i = 1; i < MESSAGES.length; i++) {
    const [a, b] = [v(MESSAGES[i - 1].version), v(MESSAGES[i].version)];
    assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]), `${MESSAGES[i - 1].version} before ${MESSAGES[i].version}`);
  }
  assert.equal(MESSAGES[0].version, VERSION.split('.').slice(0, 2).join('.'));
  for (const m of MESSAGES) {
    assert.ok(/^\d{4}-\d\d-\d\d$/.test(m.date), m.version);
    for (const ch of m.title + m.body.replace(/\n/g, '')) assert.ok(GLYPHS[ch], `no glyph for ${JSON.stringify(ch)} in v${m.version}`);
  }
});

test('changelog: one unread message after an update; reading marks it', () => {
  const seen = defaultSeen();
  assert.deepEqual(unread(seen).map(m => m.version), [MESSAGES[0].version]);
  const after = markRead(seen, MESSAGES[0].version);
  assert.equal(unread(after).length, 0);
  assert.deepEqual(markRead(after, MESSAGES[0].version), after, 'idempotent');
  assert.equal(unread([]).length, MESSAGES.length);
});

const rectangular = rows => rows.every(r => r.length === rows[0].length && /^[#.]+$/.test(r));
test('menu icons: every item animates, frames are equal-size 1-bit sprites', () => {
  assert.deepEqual(MENU_IDS, ['tones', 'mysongs', 'stats', 'messages', 'profile', 'settings']);
  for (const id of MENU_IDS) {
    for (const opts of [{}, { unread: true }]) {
      const frames = menuFrames(id, opts);
      for (const f of frames) {
        assert.ok(rectangular(f), id);
        assert.equal(f.length, ICON_H, id);
        assert.equal(f[0].length, ICON_W, id);
      }
      assert.ok(new Set(frames.map(f => f.join('/'))).size >= 2, `${id} has no animation`);
    }
    assert.deepEqual(menuFrame(id, -1), menuFrame(id, menuFrames(id).length - 1), `${id}: negative frames wrap`);
  }
  assert.notDeepEqual(menuFrame('messages', 1, { unread: true }), menuFrame('messages', 1), 'unread envelope looks different');
  for (const n of [0, 1, 2]) assert.ok(rectangular(letterFrame(n)));
});

test('topSongs: sums plays across difficulties, orders by plays then id, limits, skips 0 plays', () => {
  const e = (id, diff, plays) => ({ id, diff, plays });
  const list = [e('b', 'normal', 2), e('b', 'hard', 3), e('a', 'normal', 5), e('c', 'normal', 1), e('z', 'normal', 0)];
  assert.deepEqual(topSongs(list), [{ id: 'a', plays: 5 }, { id: 'b', plays: 5 }, { id: 'c', plays: 1 }]);
  assert.deepEqual(topSongs(list, 1), [{ id: 'a', plays: 5 }]);
  assert.deepEqual(topSongs([]), []);
  assert.deepEqual(favourite(list), { id: 'a', plays: 5 });
  assert.equal(favourite([]), null);
});
