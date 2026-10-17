import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BINDINGS } from '../src/gamepad.js';

let n = 0;
async function load(raw, { throwing = false } = {}) {
  const store = new Map();
  if (raw !== undefined) store.set('ringbeat.v1', typeof raw === 'string' ? raw : JSON.stringify(raw));
  globalThis.localStorage = {
    getItem: k => { if (throwing) throw new Error('blocked'); return store.get(k) ?? null; },
    setItem: (k, v) => { if (throwing) throw new Error('blocked'); store.set(k, String(v)); },
  };
  try {
    const mod = await import('../src/settings.js?case' + n++);
    return { ...mod, store };
  } finally { delete globalThis.localStorage; }
}

test('settings: empty or corrupt storage gives defaults', async () => {
  for (const raw of [undefined, 'not json', 'null', '[]', '"x"']) {
    const { settings: s } = await load(raw);
    assert.equal(s.volume, 0.7, String(raw));
    assert.equal(s.voice, 'buzzer');
    assert.equal(s.scrollTime, 1.6);
    assert.equal(s.backing, false);
    assert.equal(s.calibration, 0);
    assert.deepEqual(s.view, { sort: 'diff-asc', category: 'all' });
    assert.equal(s.tutorialDone, false);
    assert.equal(s.tutorialLessons, 0);
    assert.equal(s.loginAsked, false);
    assert.deepEqual(s.padBindings, DEFAULT_BINDINGS);
  }
});

test('settings: blocked storage degrades to defaults and save does not throw', async () => {
  const { settings, saveSettings } = await load(undefined, { throwing: true });
  assert.equal(settings.volume, 0.7);
  globalThis.localStorage = { setItem() { throw new Error('quota'); } };
  assert.doesNotThrow(() => saveSettings());
  delete globalThis.localStorage;
});

test('settings: numbers are clamped, junk falls back', async () => {
  let { settings: s } = await load({ volume: 5, scrollTime: 0, calibration: -9 });
  assert.deepEqual([s.volume, s.scrollTime, s.calibration], [1, 1, -0.5]);
  ({ settings: s } = await load({ volume: -1, scrollTime: 99, calibration: 9 }));
  assert.deepEqual([s.volume, s.scrollTime, s.calibration], [0, 2.5, 0.5]);
  ({ settings: s } = await load({ volume: '0.2', scrollTime: NaN, calibration: null }));
  assert.deepEqual([s.volume, s.scrollTime, s.calibration], [0.7, 1.6, 0]);
  ({ settings: s } = await load({ volume: 0.25, scrollTime: 2, calibration: 0.05 }));
  assert.deepEqual([s.volume, s.scrollTime, s.calibration], [0.25, 2, 0.05]);
});

test('settings: rollAudio defaults off and loads when saved', async () => {
  let { settings: s } = await load({});
  assert.equal(s.rollAudio, false);
  ({ settings: s } = await load({ rollAudio: true }));
  assert.equal(s.rollAudio, true);
});

test('settings: boolean flags default on except backing', async () => {
  let { settings: s } = await load({});
  assert.deepEqual([s.preview, s.idleGags, s.juice, s.haptics, s.backing], [true, true, true, true, false]);
  ({ settings: s } = await load({ preview: false, idleGags: false, juice: false, haptics: false, backing: true }));
  assert.deepEqual([s.preview, s.idleGags, s.juice, s.haptics, s.backing], [false, false, false, false, true]);
  ({ settings: s } = await load({ backing: 'yes' }));
  assert.equal(s.backing, false);
});

test('settings: sort and category only accept known values', async () => {
  let { settings: s } = await load({ difficulty: 'hard', view: { sort: 'bpm', category: 'ndw' } });
  assert.equal(s.difficulty, undefined); // the difficulty setting is gone
  assert.deepEqual(s.view, { sort: 'bpm', category: 'ndw' });
  ({ settings: s } = await load({ difficulty: 'insane', view: { sort: 'random', category: 'metal' } }));
  assert.deepEqual(s.view, { sort: 'diff-asc', category: 'all' });
  ({ settings: s } = await load({ view: { sort: 'diff-desc' } })); // the old Hardest first option is gone
  assert.equal(s.view.sort, 'diff-asc');
  ({ settings: s } = await load({ view: 'oops' }));
  assert.deepEqual(s.view, { sort: 'diff-asc', category: 'all' });
});

test('settings: recent songs are de-duplicated, capped and sanitized', async () => {
  let { settings: s } = await load({ view: { category: 'recent' }, recent: ['a', 'b', 'a', 7, ''] });
  assert.deepEqual(s.recent, ['a', 'b']);
  assert.equal(s.view.category, 'recent');
  ({ settings: s } = await load({ recent: Array.from({ length: 50 }, (_, i) => 's' + i), view: { category: 'unplayed' } }));
  assert.equal(s.recent.length, 20);
  assert.equal(s.view.category, 'unplayed');
  ({ settings: s } = await load({ recent: 'x' }));
  assert.deepEqual(s.recent, []);
});

test('settings: tutorialLessons is a clamped whole number', async () => {
  for (const [raw, want] of [[3, 3], [2.7, 2], [-1, 0], ['x', 0], [500, 99]]) {
    const { settings: s } = await load({ tutorialLessons: raw });
    assert.equal(s.tutorialLessons, want, String(raw));
  }
});

test('settings: lastSongId implies the tutorial was done', async () => {
  let { settings: s } = await load({ lastSongId: 'ode' });
  assert.equal(s.lastSongId, 'ode');
  assert.equal(s.tutorialDone, true);
  ({ settings: s } = await load({ lastSongId: '' }));
  assert.equal(s.tutorialDone, false);
  ({ settings: s } = await load({ tutorialDone: true }));
  assert.equal(s.tutorialDone, true);
  ({ settings: s } = await load({ tutorialDone: 'true', lastSongId: 7 }));
  assert.deepEqual([s.tutorialDone, s.lastSongId], [false, '']);
});

test('settings: loginAsked is kept on this device and never synced', async () => {
  assert.equal((await load({ loginAsked: true })).settings.loginAsked, true);
  assert.equal((await load({ loginAsked: 'yes' })).settings.loginAsked, false);
  const { settings: s, sharedSettings } = await load({ loginAsked: true });
  assert.ok(!('loginAsked' in sharedSettings().settings));
});

test('settings: customRtttl is capped and migrates from lastSong', async () => {
  let { settings: s } = await load({ customRtttl: 'x'.repeat(5000) });
  assert.equal(s.customRtttl.length, 4000);
  ({ settings: s } = await load({ lastSong: 'y'.repeat(5000) }));
  assert.equal(s.customRtttl.length, 4000);
  ({ settings: s } = await load({ customRtttl: 'a:d=4:c', lastSong: 'old' }));
  assert.equal(s.customRtttl, 'a:d=4:c');
  ({ settings: s } = await load({ customRtttl: 5 }));
  assert.equal(s.customRtttl, '');
});

test('settings: msgSeen keeps strings only, capped at 100; missing uses the changelog default', async () => {
  let { settings: s } = await load({ msgSeen: ['1.0.0', 3, null, '1.1.0'] });
  assert.deepEqual(s.msgSeen, ['1.0.0', '1.1.0']);
  ({ settings: s } = await load({ msgSeen: Array.from({ length: 150 }, (_, i) => 'v' + i) }));
  assert.equal(s.msgSeen.length, 100);
  ({ settings: s } = await load({}));
  assert.ok(Array.isArray(s.msgSeen));
});

test('settings: favorites keep unique non-empty strings, capped; sort fav is allowed', async () => {
  let { settings: s } = await load({ favorites: ['a', 'a', 3, '', null, 'b'], view: { sort: 'fav' } });
  assert.deepEqual(s.favorites, ['a', 'b']);
  assert.equal(s.view.sort, 'fav');
  ({ settings: s } = await load({ favorites: Array.from({ length: 800 }, (_, i) => 's' + i) }));
  assert.equal(s.favorites.length, 500);
  ({ settings: s } = await load({ favorites: 'x' }));
  assert.deepEqual(s.favorites, []);
});

test('settings: pad bindings and mods are sanitized', async () => {
  let { settings: s } = await load({ padBindings: { 0: [1, 2], 1: 'x', 2: [99], 3: [] } });
  assert.deepEqual(s.padBindings[0], [1, 2]);
  assert.deepEqual(s.padBindings[1], DEFAULT_BINDINGS[1]);
  assert.deepEqual(s.padBindings[2], DEFAULT_BINDINGS[2]);
  assert.deepEqual(s.padBindings[3], DEFAULT_BINDINGS[3]);
  ({ settings: s } = await load({ mods: 'garbage' }));
  assert.equal(typeof s.mods, 'object');
});

test('settings: saveSettings persists and a reload reads it back', async () => {
  const { settings, saveSettings, store } = await load({});
  settings.volume = 0.3;
  globalThis.localStorage = { setItem: (k, v) => store.set(k, v) };
  saveSettings();
  delete globalThis.localStorage;
  const again = await load(store.get('ringbeat.v1'));
  assert.equal(again.settings.volume, 0.3);
});

test('settings: num helper', async () => {
  const { num } = await load({});
  assert.equal(num(5, 0, 1, 9), 1);
  assert.equal(num(Infinity, 0, 1, 9), 9);
  assert.equal(num('1', 0, 2, 9), 9);
});

test('settings: language is kept only when supported; otherwise the browser language decides', async () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const browser = languages => Object.defineProperty(globalThis, 'navigator', { value: { languages }, configurable: true });
  try {
    browser(['fr-FR', 'en']);
    let { settings: s, effectiveLang } = await load({ lang: 'de' });
    assert.equal(s.lang, 'de');
    assert.equal(effectiveLang(), 'de', 'a saved choice wins over the browser');
    ({ settings: s, effectiveLang } = await load({ lang: 'klingon' }));
    assert.equal(s.lang, '');
    assert.equal(effectiveLang(), 'en');
    browser(['de-DE', 'en']);
    ({ effectiveLang } = await load({}));
    assert.equal(effectiveLang(), 'de');
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig); else delete globalThis.navigator;
  }
});

test('developer toggles default off, sanitise to booleans, and sync with the account', async () => {
  let { settings: s } = await load({});
  assert.deepEqual([s.perfOverlay, s.netTracker], [false, false]);
  ({ settings: s } = await load({ perfOverlay: 'yes', netTracker: true }));
  assert.deepEqual([s.perfOverlay, s.netTracker], [false, true]);
  const { SYNCED_SETTINGS } = await import('../src/cloudmerge.js');
  assert.ok(SYNCED_SETTINGS.includes('perfOverlay') && SYNCED_SETTINGS.includes('netTracker'));
});

test('settings: welcomeSeen is kept on this device and never synced', async () => {
  assert.equal((await load({ welcomeSeen: true })).settings.welcomeSeen, true);
  assert.equal((await load({ welcomeSeen: 'yes' })).settings.welcomeSeen, false);
  const { sharedSettings } = await load({ welcomeSeen: true });
  assert.ok(!('welcomeSeen' in sharedSettings().settings));
});
