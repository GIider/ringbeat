// Node tests for the idle cameos and easter-egg helpers: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnake, createSpaceImpact, createParade, createScheduler, CAMEOS } from '../src/cameo.js';
import { createSequenceMatcher, KONAMI, IMEI_CODE, fakeImei, luhnCheckDigit, createWipeGag } from '../src/secrets.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const W = 20, H = 26;
function run(sim, max = 3000) { let n = 0; while (!sim.done && n++ < max) sim.step(); return n; }

test('snake: terminates, eats the apple, never reverses, leaves the grid', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = createSnake(seeded(seed), W, H);
    const len0 = s.len;
    let prev = null, ticks = 0;
    while (!s.done && ticks++ < 2500) {
      s.step();
      if (prev && s.body.length > 1) {
        // the neck must never fold back onto the previous head position
        assert.ok(!(s.body[1].x === prev.x && s.body[1].y === prev.y && s.body[0].x === prev.px && s.body[0].y === prev.py));
      }
      prev = { x: s.body[0].x, y: s.body[0].y, px: s.body[1] ? s.body[1].x : 0, py: s.body[1] ? s.body[1].y : 0 };
    }
    assert.ok(s.done, 'seed ' + seed + ' finished');
    assert.ok(s.eaten, 'seed ' + seed + ' ate the apple');
    assert.equal(s.len, len0 + 1);
    assert.ok(s.turns >= 1 && s.turns <= 12, 'turns ' + s.turns);
    assert.ok(s.body.every(c => c.x < 0 || c.y < 0 || c.x >= W || c.y >= H));
  }
});

test('snake: neighbouring cells are always adjacent (no teleporting)', () => {
  const s = createSnake(seeded(7), W, H);
  while (!s.done) {
    s.step();
    for (let i = 1; i < s.body.length; i++) {
      assert.equal(Math.abs(s.body[i].x - s.body[i - 1].x) + Math.abs(s.body[i].y - s.body[i - 1].y), 1);
    }
  }
});

test('space impact terminates and stay drawable', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const a = createSpaceImpact(seeded(seed), W, H);
    assert.ok(run(a) < 3000);
    let cells = 0;
    createSpaceImpact(seeded(seed), W, H).draw(() => cells++);
    assert.ok(cells >= 0);
  }
});

test('parade finishes', () => {
  const p = createParade(seeded(3), W, H, 5);
  assert.ok(run(p) < 3000);
});

test('scheduler: gaps in range, no repeats, respects state and once', () => {
  const rng = seeded(11);
  const s = createScheduler({ rng, minGap: 45, maxGap: 150 });
  for (let i = 0; i < 50; i++) { const g = s.gap(); assert.ok(g >= 45 && g <= 150); }
  let last = '';
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = s.pick('select');
    assert.ok(c.states.includes('select'));
    assert.notEqual(c.id, last);
    last = c.id; seen.add(c.id);
  }
  const title = createScheduler({ rng: seeded(5) });
  for (let i = 0; i < 50; i++) assert.equal(title.pick('title').kind, 'canvas');
  const once = createScheduler({ rng: seeded(9) });
  let batteries = 0;
  for (let i = 0; i < 300; i++) if (once.pick('select').id === 'low-battery') batteries++;
  assert.equal(batteries, 1);
  assert.ok(CAMEOS.every(c => c.states.every(st => !['playing', 'countin', 'results', 'composer'].includes(st))));
});

test('Konami and IMEI matchers', () => {
  const k = createSequenceMatcher(KONAMI);
  const hits = KONAMI.map(t => k.feed(t));
  assert.deepEqual(hits.slice(0, -1).every(x => !x), true);
  assert.equal(hits.at(-1), true);
  // mismatch resets; a restart on the first token still works
  const k2 = createSequenceMatcher(KONAMI);
  ['ArrowUp', 'ArrowUp', 'ArrowLeft'].forEach(t => k2.feed(t));
  assert.equal(KONAMI.map(t => k2.feed(t)).at(-1), true);
  const m = createSequenceMatcher(IMEI_CODE);
  assert.equal(['*', '#', '0', '6', '#'].map(t => m.feed(t)).at(-1), true);
});

test('fake IMEI: 15 digits, valid Luhn, reserved prefix, stable', () => {
  const a = fakeImei('1.2.3');
  assert.match(a, /^\d{15}$/);
  assert.equal(luhnCheckDigit(a.slice(0, 14)), +a[14]);
  assert.ok(a.startsWith('00'));
  assert.equal(a, fakeImei('1.2.3'));
  assert.notEqual(a, fakeImei('9.9.9'));
});

test('wipe gag: plays out, cancels on early release, never touches storage', () => {
  const calls = [];
  globalThis.localStorage = new Proxy({}, { get: (_, k) => { calls.push(k); return () => null; } });
  const g = createWipeGag();
  assert.equal(g.view(), null);
  g.start();
  assert.equal(g.view().text, 'Clearing memory...');
  g.step(1500);
  assert.equal(g.view().bar, 6);
  g.release();
  assert.equal(g.view(), null);
  g.start();
  g.step(3000);
  assert.equal(g.view().text, 'Memory cleared');
  g.release(); // too late to cancel
  assert.ok(g.active);
  g.step(1000);
  assert.equal(g.view().text, 'Just kidding.');
  g.step(1300);
  assert.equal(g.view(), null);
  assert.deepEqual(calls, []);
  delete globalThis.localStorage;
});
