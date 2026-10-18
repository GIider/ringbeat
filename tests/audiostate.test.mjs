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

test('focus mute silences the master gain without touching the volume, and survives setVolume and a rebuild', () => {
  const made = fakeAudio('running');
  const s = new Synth(); s.ensure();
  s.setVolume(0.5);
  assert.equal(s.master.gain.value, 0.4);
  s.setFocusMuted(true);
  assert.equal(s.master.gain.value, 0);
  assert.equal(s.volume, 0.5);
  s.setVolume(1);
  assert.equal(s.master.gain.value, 0);
  made[0].state = 'closed'; s.ensure();
  assert.equal(s.master.gain.value, 0);
  s.setFocusMuted(false);
  assert.equal(s.master.gain.value, 0.8);
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

test('favorite sounds play only on a running context', () => {
  for (const [state, expect] of [['running', true], ['suspended', false]]) {
    for (const sfx of ['favAdd', 'favBreak']) {
      fakeAudio(state);
      const s = new Synth(); s.ensure();
      let started = 0;
      const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
      const node = () => { const n = { connect: () => n, disconnect() {}, gain: param(), frequency: param(), start() { started++; }, stop() {} }; return n; };
      Object.assign(s.ctx, { state, sampleRate: 8000, createOscillator: node, createGain: node, createBiquadFilter: node,
        createBufferSource: node, createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }) });
      s[sfx]();
      assert.equal(started > 0, expect, `${sfx} while ${state}`);
    }
  }
});

// A recording Web Audio graph: every node and param accepts any call, and nodes remember what was started / stopped.
function graphCtx() {
  const nodes = [];
  const param = () => new Proxy({ value: 0 }, { get: (t, k) => (k in t ? t[k] : () => param()), set: (t, k, v) => { t[k] = v; return true; } });
  const node = kind => {
    const n = new Proxy({ kind, started: 0, stopped: 0, connected: [] }, {
      get: (t, k) => {
        if (k in t) return t[k];
        if (k === 'connect') return d => { t.connected.push(d); return d; };
        if (k === 'start') return () => { t.started++; };
        if (k === 'stop') return () => { t.stopped++; };
        if (['gain', 'frequency', 'detune', 'Q', 'pan', 'playbackRate'].includes(k)) return t[k] = param();
        return () => {};
      },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    nodes.push(n);
    return n;
  };
  const ctx = new Proxy({ currentTime: 1, state: 'running', destination: node('dest'), sampleRate: 48000 }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createPeriodicWave') return () => ({});
      if (k === 'createBuffer') return (c, len) => ({ getChannelData: () => new Float32Array(len) });
      if (typeof k === 'string' && k.startsWith('create')) return () => node(k.slice(6));
      return () => {};
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, nodes };
}

test('Synth: every voice plays, ends and releases without touching a stopped graph', async () => {
  const { VOICES } = await import('../src/synth.js');
  assert.ok(VOICES.length >= 10);
  for (const voice of VOICES) {
    const { ctx, nodes } = graphCtx();
    const s = new Synth(); s.ctx = ctx; s.voice = voice; s.bus = ctx.createGain(); s.lowpass = ctx.createGain();
    const timed = s.playNote({ midi: 64, when: 1, duration: 0.3 });
    const held = s.playNote({ midi: 67, when: 1.1 }); // no end: sustains until released
    const before = nodes.length;
    assert.ok(before > 2, `${voice} builds a graph`);
    const oscs = nodes.filter(n => n.started > 0);
    assert.ok(oscs.length >= 2, `${voice} starts its oscillators`);
    for (const h of [timed, held]) if (h && typeof h.release === 'function') h.release(1.5);
    for (const o of oscs) if (typeof o.onended === 'function') o.onended();
  }
});

test('Synth: sound effects schedule beeps, and stopAll swaps in a fresh bus', () => {
  const { ctx, nodes } = graphCtx();
  const s = new Synth(); s.ctx = ctx; s.voice = 'smooth'; s.bus = ctx.createGain(); s.lowpass = ctx.createGain();
  const fx = ['stinger:S', 'stinger:A', 'stinger:B', 'stinger:C', 'stinger:X', 'tickUp:3', 'favAdd', 'favBreak', 'keyClick', 'blocked', 'jingle', 'playMiss:60', 'playStray:2', 'tick:'];
  for (const f of fx) {
    const [name, arg] = f.split(':');
    const count = nodes.length;
    if (name === 'tick') s.tick({ when: 1, accent: true }); else if (name === 'stinger') s.stinger(arg);
    else s[name](arg === undefined ? undefined : Number.isNaN(+arg) ? arg : +arg);
    assert.ok(nodes.length > count, `${f} makes sound`);
  }
  s.tick({ when: 1 });
  s.favBreak(0.1);
  const oldBus = s.bus;
  s.stopAll();
  assert.notEqual(s.bus, oldBus);
  const idle = new Synth();
  idle.stopAll(); // no context yet: nothing to do
  assert.equal(idle.bus, undefined);
});
