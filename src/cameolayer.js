// DOM glue for the idle cameos. The canvas is pointer-events:none and never focusable; this layer only reads
// the app state (via getState) and paints. It never calls into navigation, selection or the game.
import { createScheduler, createParade, CAMEOS, CAMEO_STATES } from './cameo.js';

const CELL = 4;      // CSS px per LCD cell
const TICK_MS = 100; // sim speed

export function createCameoLayer({ canvas, getState, enabled, onStatus, onChirp, rng = Math.random, dev = '' }) {
  const sched = createScheduler({ rng, ...(dev && dev !== 'debug' ? { minGap: 2, maxGap: 4 } : {}) });
  const ctx = canvas.getContext('2d');
  let timer = 0, due = 0, remaining = 0, raf = 0, status = null, sim = null, last = 0, acc = 0, gridW = 0, gridH = 0, statusOn = false;

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const allowed = () => enabled() && !reduced() && !document.hidden;

  function clear() { if (gridW) ctx.clearRect(0, 0, gridW, gridH); }
  function stopActive() {
    if (raf) cancelAnimationFrame(raf);
    if (status) clearInterval(status);
    raf = 0; status = null; sim = null;
    clear();
    if (statusOn) { statusOn = false; onStatus(null); }
  }
  function cancel() {
    if (timer) clearTimeout(timer);
    timer = 0; remaining = 0;
    stopActive();
  }
  // Leaving the cameo screens (or hiding the tab) stops a running cameo but keeps the countdown for when we return.
  function pause() {
    if (timer) { clearTimeout(timer); timer = 0; remaining = Math.max(0, due - performance.now()); }
    stopActive();
  }
  function finish() { stopActive(); arm(); }

  function measure() {
    const w = Math.floor(canvas.parentElement.clientWidth / CELL), h = Math.floor(canvas.parentElement.clientHeight / CELL);
    if (w < 8 || h < 8) return false;
    gridW = canvas.width = w; gridH = canvas.height = h;
    canvas.style.width = w * CELL + 'px'; canvas.style.height = h * CELL + 'px';
    return true;
  }

  function runCanvas(s) {
    if (!measure()) return false;
    sim = s;
    ctx.fillStyle = getComputedStyle(canvas).color;
    last = performance.now(); acc = 0;
    const frame = now => {
      if (sim !== s) return;
      acc += now - last; last = now;
      let stepped = false;
      while (acc >= TICK_MS && !s.done) { s.step(); acc -= TICK_MS; stepped = true; }
      if (stepped || s.done) {
        clear();
        s.draw((x, y) => { if (x >= 0 && y >= 0 && x < gridW && y < gridH) ctx.fillRect(x, y, 1, 1); });
      }
      if (s.done) finish(); else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return true;
  }

  function runStatus(s) {
    sim = s; statusOn = true;
    if (s.chirp) onChirp();
    status = setInterval(() => {
      s.step();
      if (s.done) { finish(); return; }
      onStatus(s.status());
    }, TICK_MS);
    onStatus(s.status());
  }

  function spawn() {
    timer = 0;
    if (!allowed()) return;
    const st = getState();
    const c = sched.pick(st, dev && dev !== 'now' && dev !== 'debug' ? dev : '');
    if (!c || !c.states.includes(st)) { arm(); return; }
    if (!measure()) { arm(); return; }
    const s = c.create(rng, gridW, gridH);
    if (c.kind === 'canvas') { if (!runCanvas(s)) arm(); } else runStatus(s);
  }

  function arm() {
    if (timer || sim) return;
    if (!allowed() || !CAMEO_STATES.includes(getState())) return;
    const ms = remaining || sched.gap() * 1000;
    remaining = 0;
    due = performance.now() + ms;
    timer = setTimeout(spawn, ms);
  }

  // Called after every screen change: cancel instantly when leaving the places cameos may appear.
  function sync() {
    if (!allowed() || !CAMEO_STATES.includes(getState())) pause();
    else arm();
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else sync(); });
  window.addEventListener('resize', () => { if (sim || timer) { pause(); sync(); } });

  return {
    sync, cancel,
    // Debug panel: seconds until the next scheduled cameo, 'playing' while one runs, or null when none is armed.
    nextIn: () => sim ? 'playing' : timer ? Math.max(0, (due - performance.now()) / 1000) : remaining ? remaining / 1000 : null,
    paused: () => !timer && !sim && remaining > 0,
    // Debug panel: play one cameo right now, whatever screen is showing.
    play(id) {
      cancel();
      if (!measure()) return;
      if (id === 'parade') { runCanvas(createParade(rng, gridW, gridH)); return; }
      const c = CAMEOS.find(x => x.id === id);
      if (!c) return;
      const s = c.create(rng, gridW, gridH);
      if (c.kind === 'canvas') runCanvas(s); else runStatus(s);
    },
    stop() { cancel(); },
    // Konami reward: a parade of snakes right now (only where cameos are allowed).
    parade() {
      if (!allowed() || !CAMEO_STATES.includes(getState())) return;
      cancel();
      if (measure()) runCanvas(createParade(rng, gridW, gridH));
    },
  };
}
