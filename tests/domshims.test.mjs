// The thin browser-facing modules (swipe, floatbox, input, scorechart, i18n.applyStatic) against hand-made fakes: no DOM needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onSwipe } from '../src/swipe.js';
import { floatBox, resetFloatBoxes } from '../src/floatbox.js';
import { Input } from '../src/input.js';
import { drawScoreChart } from '../src/scorechart.js';
import { applyStatic, setLang, t } from '../src/i18n.js';

// Minimal EventTarget-ish element.
function fakeEl(extra = {}) {
  const handlers = {};
  return {
    style: {}, isConnected: true, dataset: {}, classList: { contains: () => false },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type, ev = {}) { for (const fn of handlers[type] || []) fn({ preventDefault() {}, ...ev }); },
    handlers,
    ...extra,
  };
}

// Swap globals for the length of one test.
async function withGlobals(vals, fn) {
  const saved = {};
  for (const k of Object.keys(vals)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: vals[k], configurable: true, writable: true });
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(vals)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
}

test('onSwipe: fires once past the threshold, reports swiped, ignores a cancelled drag', () => {
  const el = fakeEl(), seen = [];
  const swiped = onSwipe(el, dir => seen.push(dir));
  el.fire('pointerdown', { clientX: 100, clientY: 0 });
  el.fire('pointermove', { clientX: 90, clientY: 0 });
  assert.deepEqual(seen, []);
  el.fire('pointermove', { clientX: 40, clientY: 5 });
  el.fire('pointerup', { clientX: 10, clientY: 5 });
  assert.deepEqual(seen, ['left'], 'one swipe per gesture');
  assert.equal(swiped(), true);
  el.fire('pointerdown', { clientX: 0, clientY: 0 });
  assert.equal(swiped(), false, 'a new press clears the flag');
  el.fire('pointercancel');
  el.fire('pointermove', { clientX: 200, clientY: 0 });
  assert.deepEqual(seen, ['left'], 'cancel drops the drag');
});

test('floatBox: default spot, drag saves, double-click and resetFloatBoxes put it back', async () => {
  const store = new Map();
  const api = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  // Object.keys(localStorage) is how resetFloatBoxes scans: expose the stored keys as own properties.
  const localStorage = new Proxy(api, {
    ownKeys: () => [...store.keys()],
    getOwnPropertyDescriptor: (_, k) => (store.has(k) ? { value: store.get(k), enumerable: true, configurable: true } : undefined),
  });
  const winHandlers = {};
  const win = { innerWidth: 800, innerHeight: 600, addEventListener: (t, f) => { winHandlers[t] = f; }, removeEventListener: t => { delete winHandlers[t]; } };
  let rect = { left: 10, top: 20, width: 100, height: 50, right: 110, bottom: 70 };
  await withGlobals({ window: win, localStorage, ResizeObserver: undefined }, () => {
    const el = fakeEl({ getBoundingClientRect: () => rect, setPointerCapture() {} });
    const off = floatBox(el, 'a', { defaults: { right: 4, bottom: 4 } });
    assert.equal(el.style.right, '4px');
    assert.equal(el.style.left, 'auto');
    // press on the body (not the resize grip), drag, release
    el.fire('pointerdown', { button: 0, clientX: 20, clientY: 30, pointerId: 1 });
    el.fire('pointermove', { clientX: 220, clientY: 130 });
    assert.equal(el.style.left, '210px');
    rect = { left: 210, top: 120, width: 100, height: 50, right: 310, bottom: 170 };
    el.fire('pointerup');
    assert.deepEqual(JSON.parse(store.get('rb-float-a')), { x: 210, y: 120, w: 100, h: 50 });
    // the resize grip belongs to the browser: no drag starts
    el.fire('pointerdown', { button: 0, clientX: 305, clientY: 165, pointerId: 2 });
    el.fire('pointermove', { clientX: 0, clientY: 0 });
    assert.equal(el.style.left, '210px');
    // a saved spot is restored (the fake window keeps the latest resize handler), kept on screen after the window shrinks
    const el2 = fakeEl({ getBoundingClientRect: () => rect });
    floatBox(el2, 'a');
    assert.equal(el2.style.left, '210px');
    win.innerWidth = 250;
    winHandlers.resize();
    assert.equal(el2.style.left, '150px');
    // double-click forgets the saved spot
    el.fire('dblclick');
    assert.equal(store.has('rb-float-a'), false);
    assert.equal(el.style.right, '4px', 'back at its default corner');
    // resetFloatBoxes wipes every saved box and re-homes the live ones
    store.set('rb-float-b', '{}'); store.set('other', '1');
    resetFloatBoxes();
    assert.equal(store.has('rb-float-b'), false);
    assert.equal(store.get('other'), '1');
    off();
    assert.equal(winHandlers.resize, undefined);
    assert.equal(typeof floatBox(null, 'x'), 'function', 'a missing element is a no-op');
  });
});

test('Input: keys and pointers become timed lane presses and releases', async () => {
  const winHandlers = {};
  const win = { addEventListener: (t, f) => { winHandlers[t] = f; } };
  const canvas = fakeEl({ setPointerCapture() {} });
  const ctx = { currentTime: 5, outputLatency: 0.1 };
  await withGlobals({ window: win }, () => {
    const input = new Input({ getCtx: () => ctx, canvas, laneAt: x => (x < 50 ? 0 : 3) });
    const log = [];
    input.onPress = (l, t) => log.push(['p', l, +t.toFixed(2)]);
    input.onRelease = (l, t) => log.push(['r', l, +t.toFixed(2)]);
    winHandlers.keydown({ code: 'KeyD', timeStamp: 0 });
    assert.deepEqual(log, [], 'disabled input ignores keys');
    input.enabled = true;
    winHandlers.keydown({ code: 'KeyD', timeStamp: 0 });
    winHandlers.keydown({ code: 'KeyD', timeStamp: 0 });
    winHandlers.keydown({ code: 'KeyF', repeat: true, timeStamp: 0 });
    winHandlers.keydown({ code: 'KeyZ', timeStamp: 0 });
    winHandlers.keyup({ code: 'KeyD', timeStamp: 0 });
    winHandlers.keyup({ code: 'KeyD', timeStamp: 0 });
    assert.deepEqual(log, [['p', 0, 4.9], ['r', 0, 4.9]], 'one press per key-down, one release, repeats and strangers ignored');
    log.length = 0;
    canvas.fire('pointerdown', { pointerId: 7, clientX: 80 });
    canvas.fire('pointerup', { pointerId: 7 });
    canvas.fire('pointerup', { pointerId: 7 });
    canvas.fire('pointerdown', { pointerId: 8, clientX: 10 });
    input.setLanes(3);
    canvas.fire('lostpointercapture', { pointerId: 8 });
    assert.deepEqual(log, [['p', 3, 4.9], ['r', 3, 4.9], ['p', 0, 4.9]], 'setLanes drops held pointers, so no stray release');
    input.enabled = false;
    canvas.fire('pointerdown', { pointerId: 9, clientX: 80 });
    assert.equal(log.length, 3);
    const noCtx = new Input({ getCtx: () => null, canvas: fakeEl(), laneAt: () => 0 });
    assert.equal(noCtx._time({}), 0);
  });
});

test('drawScoreChart: paints every mark kind, and skips a box too small to draw in', () => {
  const calls = { fill: 0, clear: 0 };
  const c = { clearRect: () => { calls.clear++; }, fillRect: () => { calls.fill++; }, set fillStyle(_) {}, drawImage() {}, getImageData: () => ({ data: [] }) };
  const canvas = { style: {}, getContext: () => c, parentElement: { clientWidth: 400, clientHeight: 120 } };
  const n = 6;
  const series = {
    density: [0, 0.5, 1, 0.2, 0, 0.7],
    acc: [100, null, 60, 80, null, 20],
    miss: [0, 0, 1, 0, 0, 1],
    ghost: [0, 1, 0, 0, 0, 2],
  };
  assert.equal(series.density.length, n);
  drawScoreChart(canvas, series, 2);
  assert.equal(canvas.width, 200);
  assert.equal(canvas.style.width, '400px');
  assert.ok(calls.fill > 100 && calls.clear > 2, 'axis, bars, line, miss rings and ghost crosses were drawn');
  const before = calls.fill;
  drawScoreChart({ ...canvas, parentElement: { clientWidth: 20, clientHeight: 10 } }, series, 2);
  assert.equal(calls.fill, before, 'a tiny box draws nothing');
});

test('applyStatic: translates text, markup and attributes, and switching back restores English', async () => {
  const mk = (attrs = {}, text = '') => {
    const el = { dataset: {}, textContent: text, innerHTML: text, attrs: { ...attrs }, getAttribute(a) { return this.attrs[a] ?? null; }, setAttribute(a, v) { this.attrs[a] = v; } };
    return el;
  };
  const txt = mk({}, ' Settings '); txt.dataset.i18n = '';
  const html = mk({}, ' <b>Settings</b> '); html.dataset.i18nHtml = '';
  const attr = mk({ title: 'Settings' }); attr.dataset.i18nAttr = 'title';
  const root = { querySelectorAll: sel => (sel === '[data-i18n]' ? [txt] : sel === '[data-i18n-html]' ? [html] : [attr]) };
  const doc = { documentElement: {} };
  await withGlobals({ document: doc }, () => {
    try {
      setLang('de');
      applyStatic(root);
      assert.equal(doc.documentElement.lang, 'de');
      assert.equal(txt.textContent, t('Settings'));
      assert.equal(attr.attrs.title, t('Settings'));
      assert.equal(txt.dataset.i18n, 'Settings', 'the English key is remembered');
      assert.equal(html.dataset.i18nHtml, '<b>Settings</b>');
      setLang('en');
      applyStatic(root);
      assert.equal(txt.textContent, 'Settings');
      assert.equal(attr.attrs.title, 'Settings');
    } finally { setLang('en'); }
  });
});
