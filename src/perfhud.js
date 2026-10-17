import { floatBox } from './floatbox.js';

// Corner overlay for perf.js. Only created when profiling is switched on.

export function createHud(perf, { interval = 500 } = {}) {
  let el = null, unfloat = null, timer = 0, obs = null, longTasks = 0, longMax = 0;
  const fmt = v => (v == null ? '-' : v.toFixed(2));

  function render() {
    const r = perf.report(), f = r.sections.frame;
    const lines = [`${r.fps.toFixed(0)} fps  long:${r.longFrames}/${r.frames}`];
    if (f) lines.push(`frame p50 ${fmt(f.p50)} p95 ${fmt(f.p95)} max ${fmt(f.max)} ms`);
    for (const [k, s] of Object.entries(r.sections)) {
      if (k !== 'frame') lines.push(`${k.padEnd(10)} ${fmt(s.mean)} (p95 ${fmt(s.p95)}) ms`);
    }
    if (obs) lines.push(`longtasks ${longTasks} (max ${longMax.toFixed(0)} ms)`);
    const m = performance.memory;
    if (m) lines.push(`heap ${(m.usedJSHeapSize / 1048576).toFixed(1)} MB`);
    el.textContent = lines.join('\n');
  }

  return {
    show() {
      if (el) return;
      el = document.createElement('pre');
      el.className = 'perf-hud';
      el.style.cssText = 'position:fixed;top:4px;left:4px;z-index:9999;margin:0;padding:4px 6px;font:11px/1.3 ui-monospace,monospace;color:#9f9;background:rgba(0,0,0,.65);pointer-events:none;white-space:pre';
      document.body.appendChild(el);
      unfloat = floatBox(el, 'perf', { defaults: () => (document.body.classList.contains('compact') ? { top: 4, right: 4 } : { top: 4, left: 4 }) });
      // Main-thread tasks over 50 ms (GC, layout, script) show up here even when the frame timer misses them.
      longTasks = 0; longMax = 0;
      try {
        obs = new PerformanceObserver(list => { for (const e of list.getEntries()) { longTasks++; longMax = Math.max(longMax, e.duration); } });
        obs.observe({ entryTypes: ['longtask'] });
      } catch { obs = null; /* not supported */ }
      timer = setInterval(render, interval);
      render();
    },
    hide() { clearInterval(timer); if (unfloat) unfloat(); unfloat = null; if (obs) obs.disconnect(); obs = null; if (el) el.remove(); el = null; },
    get visible() { return !!el; },
  };
}

export function copyReport(perf) {
  const r = perf.report();
  const rows = Object.entries(r.sections).map(([name, s]) => ({ name, ...s }));
  console.table(rows);
  try { navigator.clipboard.writeText(JSON.stringify(r, null, 1)); } catch { /* no clipboard */ }
  return r;
}
