// Tiny frame/section profiler. Disabled by default: begin/end/time are near-free no-ops until enable().
// Clock is injectable so the stats are testable in node.

const FRAME = 'frame';

export function createPerf({ now = () => performance.now(), cap = 600, budgetMs = 1000 / 60 } = {}) {
  const series = new Map(); // name -> { buf: Float64Array, n: total samples, i: write index }
  const open = new Map();   // name -> start time
  let lastFrame = -1, long = 0, frames = 0;

  const rec = (name, v) => {
    let s = series.get(name);
    if (!s) series.set(name, s = { buf: new Float64Array(cap), n: 0, i: 0 });
    s.buf[s.i] = v;
    s.i = (s.i + 1) % cap;
    s.n++;
  };

  const p = {
    enabled: false,
    enable(on = true) { p.enabled = !!on; lastFrame = -1; },
    begin(name) { if (p.enabled) open.set(name, now()); },
    end(name) {
      if (!p.enabled) return;
      const t0 = open.get(name);
      if (t0 !== undefined) { rec(name, now() - t0); open.delete(name); }
    },
    time(name, fn) {
      if (!p.enabled) return fn();
      const t0 = now();
      try { return fn(); } finally { rec(name, now() - t0); }
    },
    // Record a one-off value (e.g. a duration measured elsewhere).
    sample(name, v) { if (p.enabled) rec(name, v); },
    // Call once per animation frame; records the interval since the previous call.
    frame() {
      if (!p.enabled) return;
      const t = now();
      if (lastFrame >= 0) {
        const dt = t - lastFrame;
        rec(FRAME, dt);
        frames++;
        if (dt > budgetMs * 1.5) long++;
      }
      lastFrame = t;
    },
    stats() {
      const out = {};
      for (const [name, s] of series) {
        const len = Math.min(s.n, cap);
        const a = Array.from(s.buf.subarray(0, len)).sort((x, y) => x - y);
        const q = f => a[Math.min(len - 1, Math.floor(f * len))];
        out[name] = { n: s.n, mean: a.reduce((x, y) => x + y, 0) / len, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: a[len - 1] };
      }
      return out;
    },
    report() {
      const st = p.stats(), f = st[FRAME];
      return { fps: f ? 1000 / f.mean : 0, frames, longFrames: long, sections: st };
    },
    reset() { series.clear(); open.clear(); lastFrame = -1; long = 0; frames = 0; },
  };
  return p;
}

export const perf = createPerf();
