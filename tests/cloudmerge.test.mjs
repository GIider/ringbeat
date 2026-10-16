// Cloud sync merges: the shared document (cloudmerge.js), per-device scores and stats combined, and the stores' sync hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeShared, sameShared, cleanShared, blankShared, SYNCED_SETTINGS } from '../src/cloudmerge.js';
import { createScores, combineScores } from '../src/scores.js';
import { createStats, combineStats, clean as cleanStats, dayKey } from '../src/stats.js';
import { createMySongs } from '../src/mysongs.js';

const mem = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
};
const DAY = 864e5;
const T0 = new Date(2026, 9, 1, 12).getTime();
const SONG_A = 'A:d=4,o=5,b=120:c,d,e,f,g,a,b,c6';
const SONG_B = 'B:d=4,o=5,b=120:e,e,f,g,g,f,e,d';

const docA = {
  settings: { voice: 'smooth', scrollTime: 2, lang: 'de' }, settingsT: { voice: 10, scrollTime: 30, lang: 5 },
  favorites: { x: { on: true, t: 10 }, y: { on: false, t: 20 }, z: { on: true, t: 7 } },
  songs: { u1: { name: 'One', rtttl: SONG_A, updated: 10, rating: null }, u2: { name: 'Two', rtttl: SONG_B, updated: 10, rating: null } },
  gone: {}, resetAt: 0,
};
const docB = {
  settings: { voice: 'buzzer', scrollTime: 1.2, juice: false }, settingsT: { voice: 20, scrollTime: 25, juice: 3 },
  favorites: { x: { on: false, t: 15 }, y: { on: true, t: 10 }, z: { on: false, t: 7 } },
  songs: { u1: { name: 'One v2', rtttl: SONG_A, updated: 40, rating: null } },
  gone: { u2: 50 }, resetAt: 100,
};

test('mergeShared: newest wins per setting, per favourite, per song; deletes travel; reset is the newest', () => {
  const m = mergeShared(docA, docB);
  assert.deepEqual(m.settings, { voice: 'buzzer', scrollTime: 2, lang: 'de', juice: false });
  assert.deepEqual(m.settingsT, { voice: 20, scrollTime: 30, lang: 5, juice: 3 });
  assert.deepEqual(m.favorites, { x: { on: false, t: 15 }, y: { on: false, t: 20 }, z: { on: true, t: 7 } }, 'a tie keeps it on');
  assert.deepEqual(Object.keys(m.songs), ['u1']);
  assert.equal(m.songs.u1.name, 'One v2');
  assert.equal(m.gone.u2, 50);
  assert.equal(m.resetAt, 100);
});

test('mergeShared: commutative, idempotent, and a song edited after its delete survives', () => {
  assert.ok(sameShared(mergeShared(docA, docB), mergeShared(docB, docA)));
  const m = mergeShared(docA, docB);
  assert.ok(sameShared(mergeShared(m, docA), m));
  assert.ok(sameShared(mergeShared(m, m), m));
  const late = mergeShared({ songs: { u2: { name: 'Two', rtttl: SONG_B, updated: 60 } } }, { gone: { u2: 50 } });
  assert.ok(late.songs.u2);
});

test('mergeShared: the same melody saved on two devices is kept once', () => {
  const a = { songs: { aaa: { name: 'X', rtttl: SONG_A, updated: 5 } } };
  const b = { songs: { bbb: { name: 'X', rtttl: SONG_A + ' ', updated: 6 } } };
  const m = mergeShared(a, b);
  assert.deepEqual(Object.keys(m.songs), ['aaa']);
  assert.ok(m.gone.bbb >= 6);
  assert.ok(sameShared(mergeShared(m, b), m), 'the dropped copy stays dropped');
});

test('mergeShared: read messages are pooled; unknown and device-only settings are ignored', () => {
  const m = mergeShared({ settings: { msgSeen: ['1.3'], volume: 0.1, calibration: 0.2 } }, { settings: { msgSeen: ['1.4'], hax: 1 } });
  assert.deepEqual(m.settings, { msgSeen: ['1.3', '1.4'] });
  assert.ok(!SYNCED_SETTINGS.includes('volume') && !SYNCED_SETTINGS.includes('calibration') && !SYNCED_SETTINGS.includes('padBindings'));
});

test('cleanShared: garbage becomes a blank document', () => {
  for (const g of [null, 'x', 5, [], { songs: 'x', favorites: [1], gone: { a: 'x' }, resetAt: 'no' }]) {
    assert.deepEqual(cleanShared(g), blankShared(), JSON.stringify(g));
  }
});

const run = (score, date, extra = {}) => ({ score, date, grade: 'A', accuracy: 0.9, maxCombo: 10, fc: false, ap: false, ...extra });

test('combineScores: top runs pooled once, plays summed, FC/AP sticky', () => {
  const a = { s1: { normal: { top: [run(500, 1), run(300, 2)], plays: 4, fc: true, ap: false } } };
  const b = { s1: { normal: { top: [run(400, 3), run(500, 1)], plays: 2, fc: false, ap: true } }, s2: { hard: { top: [run(9, 4)], plays: 1, fc: false, ap: false } } };
  const c = combineScores([a, b]);
  assert.deepEqual(c.s1.normal.top.map(r => r.score), [500, 400, 300]);
  assert.equal(c.s1.normal.plays, 6);
  assert.ok(c.s1.normal.fc && c.s1.normal.ap);
  assert.equal(c.s2.hard.plays, 1);
});

test('scores store: remote devices show in get/all; record ranks against everything; own() is this device only', () => {
  const s = createScores(mem());
  s.record('s1', 'normal', run(300, 10));
  s.setRemote([{ s1: { normal: { top: [run(900, 5), run(800, 6)], plays: 7 } } }]);
  assert.equal(s.get('s1', 'normal').best.score, 900);
  assert.equal(s.get('s1', 'normal').plays, 8);
  const r = s.record('s1', 'normal', run(850, 20));
  assert.deepEqual(r, { rank: 2, isNewBest: false });
  assert.deepEqual(s.own().s1.normal.top.map(x => x.score), [850, 300]);
  s.setRemote([]);
  assert.equal(s.get('s1', 'normal').best.score, 850);
});

test('stats: play days are kept as a list; old records keep their count as a base', () => {
  const st = mem();
  st.setItem('ringbeat.stats.v1', JSON.stringify({ runs: 9, daysPlayed: 5, lastDay: '2026-09-30', streak: 2, bestStreak: 3 }));
  const s = cleanStats(JSON.parse(st.getItem('ringbeat.stats.v1')));
  assert.deepEqual(s.days, ['2026-09-30']);
  assert.equal(s.daysBase, 4);
  let t = T0;
  const stats = createStats(st, () => t);
  stats.recordRun({ diff: 'normal', result: { score: 1 } });
  const o = stats.own();
  assert.deepEqual(o.days, ['2026-09-30', dayKey(T0)]);
  assert.equal(o.daysPlayed, 6);
  assert.equal(o.streak, 3, 'the streak continues from yesterday');
});

test('combineStats: counters add up, a day played on two devices counts once, streaks run across devices', () => {
  const day = i => dayKey(T0 + i * DAY);
  const a = cleanStats({ runs: 3, playtime: 60, notes: { perfect: 5 }, bestCombo: 40, firstPlayed: T0, lastPlayed: T0 + DAY,
    days: [day(0), day(1)], daysPlayed: 2, lastDay: day(1), streak: 2, bestStreak: 2 });
  const b = cleanStats({ runs: 2, playtime: 30, notes: { perfect: 1 }, bestCombo: 70, firstPlayed: T0 - DAY, lastPlayed: T0 + 2 * DAY,
    days: [day(-1), day(1), day(2)], daysPlayed: 3, lastDay: day(2), streak: 2, bestStreak: 2 });
  const c = combineStats([a, b]);
  assert.equal(c.runs, 5);
  assert.equal(c.playtime, 90);
  assert.equal(c.notes.perfect, 6);
  assert.equal(c.bestCombo, 70);
  assert.equal(c.firstPlayed, T0 - DAY);
  assert.equal(c.lastPlayed, T0 + 2 * DAY);
  assert.equal(c.daysPlayed, 4);
  assert.equal(c.lastDay, day(2));
  assert.equal(c.streak, 4);
  assert.equal(c.bestStreak, 4);
  assert.deepEqual(combineStats([a]), a);
});

test('stats store: get() combines with remote devices, own() does not', () => {
  const stats = createStats(mem(), () => T0);
  stats.recordRun({ diff: 'hard', result: { score: 100 } });
  stats.setRemote([{ runs: 4, score: 50, days: [dayKey(T0)], daysPlayed: 1, lastDay: dayKey(T0), streak: 1 }]);
  assert.equal(stats.get().runs, 5);
  assert.equal(stats.get().score, 150);
  assert.equal(stats.get().daysPlayed, 1);
  assert.equal(stats.own().runs, 1);
});

test('mysongs: deletes are remembered; applyShared keeps local order, appends new songs, drops deleted ones', () => {
  const st = mem(), m = createMySongs(st);
  const a = m.add('A', SONG_A, 1), b = m.add('B', SONG_B, 2);
  m.remove(b.uid, 3);
  assert.deepEqual(m.shared().gone, { [b.uid]: 3 });
  assert.equal(createMySongs(st).shared().gone[b.uid], 3, 'persisted');
  const c = m.add('C', SONG_B, 4);
  const changed = m.applyShared({ songs: { [c.uid]: { name: 'C', rtttl: SONG_B, updated: 4 }, zz: { name: 'Z', rtttl: SONG_A.replace('c6', 'd6'), updated: 9 },
    [a.uid]: { name: 'A2', rtttl: SONG_A, updated: 5 } }, gone: { gonez: 7 } });
  assert.ok(changed);
  assert.deepEqual(m.list().map(s => s.name), ['A2', 'C', 'Z']);
  assert.equal(m.applyShared({ songs: m.shared().songs, gone: m.shared().gone }), false, 'no change the second time');
  m.applyShared({ songs: {}, gone: {} });
  assert.equal(m.count(), 0);
});

test('settings: saves stamp changed synced settings and favourites; applyShared takes merged values without re-stamping', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    const mod = await import('../src/settings.js?cloud');
    const { settings, saveSettings, sharedSettings, applyShared } = mod;
    let calls = 0;
    mod.onSave(() => calls++);
    settings.voice = 'smooth'; settings.volume = 0.1; settings.favorites.push('s1');
    saveSettings(100);
    assert.equal(calls, 1);
    let sh = sharedSettings();
    assert.equal(sh.settingsT.voice, 100);
    assert.equal(sh.settingsT.volume, undefined);
    assert.equal(sh.settings.volume, undefined, 'volume stays on the device');
    assert.deepEqual(sh.favorites, { s1: { on: true, t: 100 } });
    settings.favorites = [];
    saveSettings(200);
    assert.deepEqual(sharedSettings().favorites, { s1: { on: false, t: 200 } });
    const merged = mergeShared(sharedSettings(), { settings: { voice: 'buzzer', scrollTime: 99 }, settingsT: { voice: 300, scrollTime: 300 },
      favorites: { s2: { on: true, t: 300 } } });
    assert.equal(applyShared(merged), true);
    assert.equal(settings.voice, 'buzzer');
    assert.equal(settings.scrollTime, 2.5, 'sanitized like stored values');
    assert.deepEqual(settings.favorites, ['s2']);
    sh = sharedSettings();
    assert.equal(sh.settingsT.voice, 300);
    assert.equal(applyShared(merged), false);
    const stored = JSON.parse(store.get('ringbeat.v1'));
    assert.equal(stored._t.voice, 300);
    assert.equal(stored._fav.s2.on, true);
  } finally { delete globalThis.localStorage; }
});
