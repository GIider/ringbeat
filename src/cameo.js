// Idle "cameos": tiny decorative gags that wander across the phone LCD. Pure simulation, no DOM, no input.
// A sim is { step(), done, draw(put), status() }; it advances one tick per step() (the layer ticks at ~10 Hz).

const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
const OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };
const MAX_TICKS = 2500; // safety net: a sim never runs forever
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // inclusive
const inside = (x, y, w, h) => x >= 0 && y >= 0 && x < w && y < h;

// ---- Snake: wanders in from an edge, turns a few times, eats an apple, slithers off ----
export function createSnake(rng, w, h) {
  const edge = ri(rng, 0, 3); // 0 left, 1 right, 2 top, 3 bottom
  let x, y, dir;
  if (edge === 0) { x = -1; y = ri(rng, 2, h - 3); dir = 'R'; }
  else if (edge === 1) { x = w; y = ri(rng, 2, h - 3); dir = 'L'; }
  else if (edge === 2) { x = ri(rng, 2, w - 3); y = -1; dir = 'D'; }
  else { x = ri(rng, 2, w - 3); y = h; dir = 'U'; }
  const apple = { x: ri(rng, 3, Math.max(3, w - 4)), y: ri(rng, 3, Math.max(3, h - 4)) };
  const waypoints = [];
  if (rng() < 0.5) waypoints.push({ x: ri(rng, 2, w - 3), y: ri(rng, 2, h - 3), apple: false });
  waypoints.push({ ...apple, apple: true });
  const s = {
    body: [{ x, y }], len: ri(rng, 3, 5), dir, apple: { ...apple }, ticks: 0, turns: 0, eaten: false,
    exiting: false, done: false, run: ri(rng, 2, 5),
  };
  let target = waypoints.shift();

  function chooseExit() {
    const head = s.body[0];
    const d = [['L', head.x + 1], ['R', w - head.x], ['U', head.y + 1], ['D', h - head.y]].sort((a, b) => a[1] - b[1])[0][0];
    const ex = d === 'L' ? -1 : d === 'R' ? w : head.x;
    const ey = d === 'U' ? -1 : d === 'D' ? h : head.y;
    target = { x: ex, y: ey, exit: true };
  }

  function pickDir() {
    const head = s.body[0];
    const dx = target.x - head.x, dy = target.y - head.y;
    const cands = [];
    if (dx > 0) cands.push('R'); else if (dx < 0) cands.push('L');
    if (dy > 0) cands.push('D'); else if (dy < 0) cands.push('U');
    const ok = cands.filter(c => c !== OPP[s.dir]);
    if (!ok.length) return s.dir === 'U' || s.dir === 'D' ? 'R' : 'D'; // target dead behind us: turn sideways
    if (ok.includes(s.dir) && (s.run > 0 || ok.length === 1)) return s.dir;
    return ok.find(c => c !== s.dir) || ok[0];
  }

  s.step = () => {
    if (s.done) return;
    if (++s.ticks > MAX_TICKS) { s.done = true; return; }
    const head = s.body[0];
    if (!s.exiting && target && head.x === target.x && head.y === target.y) {
      if (target.apple) { s.len++; s.eaten = true; s.apple = null; }
      if (waypoints.length) target = waypoints.shift(); else { chooseExit(); s.exiting = true; }
    }
    // Once the exit is picked and we are already outside the grid, just keep going straight.
    const outside = !inside(head.x, head.y, w, h);
    const d = s.exiting && outside && s.ticks > 3 ? s.dir : pickDir();
    if (d !== s.dir) { s.turns++; s.run = ri(rng, 2, 5); s.dir = d; } else s.run--;
    const [vx, vy] = DIRS[d];
    s.body.unshift({ x: head.x + vx, y: head.y + vy });
    while (s.body.length > s.len) s.body.pop();
    if (s.exiting && s.body.every(c => !inside(c.x, c.y, w, h))) s.done = true;
  };
  s.draw = put => {
    if (s.apple && s.ticks % 2 === 0) put(s.apple.x, s.apple.y);
    for (const c of s.body) if (inside(c.x, c.y, w, h)) put(c.x, c.y);
  };
  s.status = () => null;
  return s;
}

// ---- Space Impact: a little ship flies across, fires a few shots and pops a rock ----
const SHIP = ['.##..', '#####', '.##..'];
export function createSpaceImpact(rng, w, h) {
  const y0 = ri(rng, 2, Math.max(2, h - 5));
  const rock = rng() < 0.7 ? { x: ri(rng, Math.floor(w / 2), Math.max(Math.floor(w / 2), w - 4)), blink: -1, gone: false } : null;
  const s = { x: -5, bullets: [], ticks: 0, shots: ri(rng, 2, 3), nextShot: ri(rng, 3, 6), done: false };
  const wob = () => Math.round(Math.sin(s.ticks / 3));
  s.step = () => {
    if (s.done) return;
    if (++s.ticks > MAX_TICKS) { s.done = true; return; }
    s.x += 1;
    if (s.shots > 0 && s.x >= 0 && s.ticks >= s.nextShot && s.x < w - 8) {
      s.bullets.push({ x: s.x + 5, y: y0 + 1 + wob() });
      s.shots--; s.nextShot = s.ticks + ri(rng, 4, 7);
    }
    for (const b of s.bullets) b.x += 2;
    if (rock && !rock.gone) {
      const hit = s.bullets.find(b => b.x >= rock.x);
      if (rock.blink < 0 && hit) rock.blink = 6;
      else if (rock.blink > 0 && --rock.blink === 0) rock.gone = true;
      if (rock.blink >= 0) s.bullets = s.bullets.filter(b => b.x < rock.x);
    }
    s.bullets = s.bullets.filter(b => b.x < w);
    if (s.x >= w && !s.bullets.length && (!rock || rock.gone || rock.blink < 0)) s.done = true;
  };
  s.draw = put => {
    const wy = y0 + wob();
    SHIP.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') put(s.x + i, wy + j); });
    for (const b of s.bullets) put(b.x, b.y);
    if (rock && !rock.gone && !(rock.blink > 0 && rock.blink % 2 === 0)) {
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (i !== 1 || j !== 1) put(rock.x + i, y0 + j);
    }
  };
  s.status = () => null;
  return s;
}

// ---- Status-bar cameos: drive the signal/battery icons (the layer restores them when done) ----
function statusSim(frames, tickEach, chirp) {
  const s = { ticks: 0, done: false, chirp: !!chirp };
  s.step = () => { if (++s.ticks >= frames.length * tickEach) s.done = true; };
  s.draw = () => {};
  s.status = () => (s.done ? null : frames[Math.min(frames.length - 1, Math.floor(s.ticks / tickEach))]);
  return s;
}
export const createSms = () => {
  const f = [];
  for (let i = 0; i < 8; i++) f.push(i % 2 === 0 ? { envelope: true } : { signal: 5 });
  return statusSim(f, 5, true);
};
export const createSignalWobble = () => statusSim([{ signal: 5 }, { signal: 2 }, { signal: 0 }, { signal: 0 }, { signal: 1 }, { signal: 4 }, { signal: 5 }], 5);
export const createLowBattery = () => {
  const f = [];
  for (let i = 0; i < 6; i++) f.push({ battery: i % 2 === 0 ? 1 : 0 });
  return statusSim(f, 5);
};

// ---- Snake parade (Konami reward): several snakes enter one after another ----
export function createParade(rng, w, h, n = 5) {
  const snakes = Array.from({ length: n }, (_, i) => ({ delay: i * 8, sim: createSnake(rng, w, h) }));
  const s = { ticks: 0, done: false };
  s.step = () => {
    s.ticks++;
    for (const sn of snakes) if (s.ticks > sn.delay) sn.sim.step();
    s.done = snakes.every(sn => sn.sim.done);
  };
  s.draw = put => { for (const sn of snakes) if (s.ticks > sn.delay) sn.sim.draw(put); };
  s.status = () => null;
  return s;
}

// ---- Registry + scheduler ----
const ALL = ['title', 'menu', 'select', 'options'];
export const CAMEOS = [
  { id: 'snake', weight: 5, kind: 'canvas', states: ALL, create: createSnake },
  { id: 'space-impact', weight: 2, kind: 'canvas', states: ['select', 'options'], create: createSpaceImpact },
  { id: 'sms', weight: 1, kind: 'status', states: ['select'], create: createSms },
  { id: 'signal-wobble', weight: 1, kind: 'status', states: ['select'], create: createSignalWobble },
  { id: 'low-battery', weight: 1, kind: 'status', states: ['select'], once: true, create: createLowBattery },
];

export function createScheduler({ rng = Math.random, minGap = 45, maxGap = 150, cameos = CAMEOS } = {}) {
  let last = '';
  const used = new Set();
  return {
    gap: () => minGap + rng() * (maxGap - minGap),
    // Weighted pick among the cameos allowed in `state`; never the same one twice in a row.
    pick(state, force = '') {
      if (force) { const c = cameos.find(x => x.id === force); if (c) { last = c.id; return c; } }
      let pool = cameos.filter(c => c.states.includes(state) && !(c.once && used.has(c.id)) && c.id !== last);
      if (!pool.length) pool = cameos.filter(c => c.states.includes(state) && !(c.once && used.has(c.id)));
      const total = pool.reduce((a, c) => a + c.weight, 0);
      if (!total) return null;
      let r = rng() * total;
      for (const c of pool) { r -= c.weight; if (r < 0) { last = c.id; if (c.once) used.add(c.id); return c; } }
      const c = pool[pool.length - 1];
      last = c.id; if (c.once) used.add(c.id);
      return c;
    },
  };
}
