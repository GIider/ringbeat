import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, VOICES } from '../src/synth.js';
import { SFX_REGISTRY, SFX_EXCLUDED, SFX_CATEGORIES, playSfx } from '../src/sfx-registry.js';

// A recording Web Audio graph (same idea as tests/audiostate.test.mjs): any create* call yields a node.
function graphCtx() {
  const nodes = [];
  const param = () => new Proxy({ value: 0 }, { get: (t, k) => (k in t ? t[k] : () => param()), set: (t, k, v) => { t[k] = v; return true; } });
  const node = () => {
    const n = new Proxy({ started: 0 }, {
      get: (t, k) => {
        if (k in t) return t[k];
        if (k === 'connect') return d => d;
        if (k === 'start') return () => { t.started++; };
        if (['gain', 'frequency', 'detune', 'Q', 'pan', 'playbackRate'].includes(k)) return t[k] = param();
        return () => {};
      },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    nodes.push(n);
    return n;
  };
  const ctx = new Proxy({ currentTime: 1, state: 'running', destination: node(), sampleRate: 48000 }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createPeriodicWave') return () => ({});
      if (k === 'createBuffer') return (c, len) => ({ getChannelData: () => new Float32Array(len) });
      if (typeof k === 'string' && k.startsWith('create')) return () => node();
      return () => {};
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, nodes };
}

test('SFX registry: every public Synth method is registered or explicitly excluded', () => {
  const methods = Object.getOwnPropertyNames(Synth.prototype).filter(m => !m.startsWith('_') && typeof Synth.prototype[m] === 'function');
  const registered = new Set(SFX_REGISTRY.map(e => e.method));
  const missing = methods.filter(m => !registered.has(m) && !SFX_EXCLUDED.includes(m));
  assert.deepEqual(missing, [], `register new Synth sounds in src/sfx-registry.js (or list them in SFX_EXCLUDED): ${missing}`);
  for (const m of registered) assert.ok(methods.includes(m), `registry names ${m}, which Synth does not have`);
  for (const m of SFX_EXCLUDED) assert.ok(m === 'constructor' || methods.includes(m), `SFX_EXCLUDED lists ${m}, which Synth does not have`);
});

test('SFX registry: ids are unique, categories known, every instrument voice has an entry', () => {
  const ids = SFX_REGISTRY.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of SFX_REGISTRY) assert.ok(SFX_CATEGORIES.includes(e.category), `${e.id} has a known category`);
  for (const c of SFX_CATEGORIES) assert.ok(SFX_REGISTRY.some(e => e.category === c), `${c} is not empty`);
  for (const v of VOICES) assert.ok(ids.includes(`playNote:note ${v}`), `voice ${v} is listed`);
});

test('SFX registry: every entry makes sound, and playSfx cuts the previous preview', () => {
  for (const e of SFX_REGISTRY) {
    const { ctx, nodes } = graphCtx();
    const s = new Synth(); s.ctx = ctx; s.voice = 'smooth'; s.bus = ctx.createGain(); s.lowpass = ctx.createGain();
    const before = nodes.length;
    e.play(s);
    assert.ok(nodes.length > before, `${e.id} makes sound`);
    assert.equal(s.voice, 'smooth', `${e.id} leaves the synth voice alone`);
  }
  const { ctx } = graphCtx();
  const s = new Synth(); s.ctx = ctx; s.ensure = () => ctx; s.bus = ctx.createGain(); s.lowpass = ctx.createGain();
  const old = s.bus;
  playSfx(s, SFX_REGISTRY[0]);
  assert.notEqual(s.bus, old);
});
