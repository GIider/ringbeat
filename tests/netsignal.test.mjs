import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetSignal, restLevel, frames } from '../src/netsignal.js';

function rig(opts = {}) {
  const painted = [];
  let t = 0, id = 0;
  const timers = new Map();
  const sig = createNetSignal({
    paint: l => painted.push(l),
    now: () => t,
    setTimer: (f, ms) => { timers.set(++id, { f, at: t + ms }); return id; },
    clearTimer: i => timers.delete(i),
    setTick: (f, ms) => { timers.set(++id, { f, ms, at: t + ms, every: true }); return id; },
    clearTick: i => timers.delete(i),
    ...opts,
  });
  const advance = ms => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [k, x] = due;
      t = x.at;
      if (x.every) x.at += x.ms; else timers.delete(k);
      x.f();
    }
    t = end;
  };
  return { sig, painted, advance };
}

test('rest levels and frame order', () => {
  assert.deepEqual([restLevel('off'), restLevel('idle'), restLevel('error'), restLevel('offline')], [5, 5, 1, 0]);
  assert.deepEqual(frames('send'), [1, 2, 3, 4, 5]);
  assert.deepEqual(frames('recv'), [5, 4, 3, 2, 1]);
  assert.equal(frames('idle'), null);
});

test('sending climbs, receiving drops, and a quick round is still seen for the minimum time', () => {
  const { sig, painted, advance } = rig();
  sig.setState('idle');
  assert.deepEqual(painted, [5]);
  sig.setState('send');
  advance(140 * 3);
  assert.deepEqual(painted.slice(1), [1, 2, 3, 4]);
  sig.setState('idle');
  assert.equal(sig.state(), 'send', 'held until the minimum has passed');
  advance(500);
  assert.equal(sig.state(), 'idle');
  assert.equal(painted.at(-1), 5);
});

test('a new round while holding keeps the light on', () => {
  const { sig, advance } = rig();
  sig.setState('send'); sig.setState('idle'); sig.setState('recv');
  advance(2000);
  assert.equal(sig.state(), 'recv');
});

test('reduced motion: a still light, no ticks', () => {
  const { sig, painted, advance } = rig({ reduced: () => true });
  sig.setState('send');
  advance(1000);
  assert.deepEqual(painted, [3]);
});

test('blocked (play, cameo) paints nothing; repaint catches up', () => {
  let block = true;
  const { sig, painted, advance } = rig({ blocked: () => block });
  sig.setState('error');
  advance(1000);
  assert.deepEqual(painted, []);
  block = false;
  sig.repaint();
  assert.deepEqual(painted, [1]);
});
