import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RULES, replay, encodeLog, decodeLog, headlessGame } from '../src/replay.js';
import { planBot, LADDER } from '../src/bot.js';
import { generateChart } from '../src/chart.js';
import { parseRTTTL } from '../src/rtttl.js';
import { SONGS } from '../src/songs.js';
import * as mods from '../src/mods.js';

const chartFor = (id, diff = 'hard', m = null) => {
  const c = generateChart(parseRTTTL(SONGS.find(s => s.id === id).rtttl), { difficulty: diff });
  return m ? mods.applyChart(c, m) : c;
};

// Plays like the browser does: the audio clock starts somewhere, there is a lead-in and a calibration offset, frames
// come at a jittery ~60 Hz, and input events arrive between frames (handled before that frame's update).
function playLive(chart, events, opts = {}, seed = 7) {
  const g = headlessGame();
  const ctx = g.synth.ctx;
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  ctx.currentTime = 37.1 + rnd();
  const calibration = 0.0137;
  let result = null;
  g.onFinish = x => { result = x; };
  g.start({ ...chart, notes: chart.notes.map(n => ({ ...n })) }, { leadIn: 2, calibration, ...opts });
  let i = 0;
  while (!result && g.state === 'running') {
    ctx.currentTime += 1 / 60 + (rnd() - 0.5) * 0.004;
    const songT = ctx.currentTime - g.songStart - calibration;
    for (; i < events.length && events[i].t <= songT; i++) {
      const e = events[i], at = g.songStart + e.t + calibration;
      if (e.type === 'press') g.press(e.lane, at); else g.release(e.lane, at);
    }
    g.update(songT);
  }
  return { result, log: g.log };
}

test('replay: a recorded run re-plays to identical results, through encode/decode', () => {
  for (const [id, diff, skill, m] of [
    ['ode-full', 'hard', LADDER[3], null],
    ['canon-full', 'normal', LADDER[1], null],
    ['elise-full', 'hard', LADDER[5], { ...mods.DEFAULT_MODS, speed: 1.2, mirror: true, judge: 'strict' }],
    ['turkish-full', 'hard', LADDER[0], { ...mods.DEFAULT_MODS, speed: 0.8, judge: 'lenient', hidden: true }],
  ]) {
    const chart = chartFor(id, diff, m);
    const { result, log } = playLive(chart, planBot(chart, skill, 3), m ? mods.gameOptions(m) : {});
    assert.ok(result && !result.failed, id);
    assert.ok(result.counts.miss > 0 || result.counts.great > 0, `${id}: a sloppy run, not a trivial one`);
    const back = decodeLog(encodeLog(log), chart.lanes);
    assert.deepEqual(back, log, id);
    assert.deepEqual(replay(chart, back, m ? mods.gameOptions(m) : {}), result, id);
  }
});

test('replay: a log that stops early, or is garbled, gives nothing', () => {
  const chart = chartFor('ode-full');
  const { log } = playLive(chart, planBot(chart, LADDER[4], 1));
  assert.equal(replay(chart, log.slice(0, log.length >> 1)), null);
  const enc = encodeLog(log);
  assert.equal(decodeLog(enc.slice(0, -4)), null);
  assert.equal(decodeLog('!!'), null);
  assert.equal(decodeLog(encodeLog([[NaN, 0]])), null);
  assert.equal(decodeLog(encodeLog([[1, 5]])), null); // lane 5 on a 4-lane chart
  assert.deepEqual(decodeLog(encodeLog([])), []);
});

test('replay: the log has the inputs plus only the updates that counted', () => {
  const chart = chartFor('ode-full');
  const { result, log } = playLive(chart, planBot(chart, LADDER[7], 1));
  const presses = log.filter(([, k]) => k >= 0 && k < 8).length;
  const updates = log.filter(([, k]) => k < 0).length;
  assert.ok(updates <= result.counts.miss + chart.notes.length + 1, `${updates} updates`);
  assert.ok(presses >= chart.notes.length * 0.9);
  assert.ok(log.length * 12 < 60_000, 'encoded size stays small');
});

// Scoring inputs: a change to any of these files might change what a stored replay scores. When this fails, decide:
// did scoring or charting change? Then bump RULES in src/replay.js. Either way, paste the new hash below.
const RULES_HASH = '1:4308ae3c63700305';
test('replay: RULES is bumped when the scoring files change', () => {
  const h = createHash('sha256');
  for (const f of ['game.js', 'chart.js', 'rtttl.js', 'mods.js', 'songs.js']) {
    h.update(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
  }
  const hash = h.digest('hex').slice(0, 16);
  assert.equal(`${RULES}:${hash}`, RULES_HASH, 'scoring files changed: see the comment above this test');
});
