import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth } from '../src/synth.js';
import { Game } from '../src/game.js';

// Minimal Web Audio stand-in: only what Synth.ensure() touches.
function fakeAudio(initialState) {
  const made = [];
  const node = () => { const n = { connect: () => n, disconnect() {}, gain: { value: 0 }, frequency: { value: 0 } }; return n; };
  class FakeAC {
    constructor() {
      this.state = initialState; this.resumes = 0; this.currentTime = 0; this.destination = node();
      made.push(this);
    }
    createBiquadFilter() { return node(); }
    createGain() { return node(); }
    createDynamicsCompressor() { return node(); }
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: FakeAC };
  globalThis.document = { hidden: false };
  return made;
}
test.afterEach(() => { delete globalThis.window; delete globalThis.document; delete globalThis.navigator; });

for (const st of ['suspended', 'interrupted']) {
  test(`Synth.ensure resumes a ${st} context`, () => {
    const made = fakeAudio(st);
    const s = new Synth(); s.ensure();
    assert.equal(made[0].resumes, 1);
    assert.equal(made[0].state, 'running');
  });
}

test('Synth.ensure leaves a running context alone', () => {
  const made = fakeAudio('running');
  const s = new Synth(); s.ensure(); s.ensure();
  assert.equal(made[0].resumes, 0);
});

test('statechange to interrupted triggers a resume while audio is wanted', () => {
  const made = fakeAudio('running');
  const s = new Synth(); s.ensure();
  made[0].state = 'interrupted'; made[0].onstatechange();
  assert.equal(made[0].resumes, 1);
});

test('statechange does not resume while paused or hidden', () => {
  const made = fakeAudio('running');
  const s = new Synth(); s.ensure();
  s.wantRunning = false; made[0].state = 'suspended'; made[0].onstatechange();
  assert.equal(made[0].resumes, 0);
  s.wantRunning = true; document.hidden = true; made[0].onstatechange();
  assert.equal(made[0].resumes, 0);
});

test('audioSession is set to playback when available', () => {
  fakeAudio('running');
  globalThis.navigator = { audioSession: { type: 'auto' } };
  new Synth().ensure();
  assert.equal(navigator.audioSession.type, 'playback');
});

test('Game.resume does not hang when ctx.resume() never settles', async () => {
  const ctx = { currentTime: 0, suspend() {}, resume: () => new Promise(() => {}) };
  const synth = { ctx, wantRunning: true, getLatency: () => 0, ensure: () => ctx, stopAll() {}, tick() {}, playNote() { return { release() {} }; }, playMiss() {} };
  const g = new Game(synth);
  g.state = 'paused'; g._startScheduler = () => {};
  g.pendingRelease = [];
  await Promise.race([g.resume(), new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 2000))]);
  assert.equal(g.state, 'running');
  assert.equal(synth.wantRunning, true);
  clearInterval(g.timer);
});

test('Game.pause marks audio as not wanted so statechange will not fight it', () => {
  const ctx = { currentTime: 0, suspend() {}, resume: () => Promise.resolve() };
  const synth = { ctx, wantRunning: true };
  const g = new Game(synth);
  g.state = 'running';
  g.pause();
  assert.equal(synth.wantRunning, false);
});
