// Gamepad API poller. Emits raw button edges and d-pad/stick navigation repeats; policy lives in main.js.
// Polling granularity is one animation frame (the API has no event timestamps), which is the documented limit.

// Standard-mapping button indices.
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
const NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', '↑', '↓', '←', '→'];
export const buttonName = i => NAMES[i] || 'Btn ' + i;

// Lane slot -> buttons. Slots are the 4 lanes.
export const DEFAULT_BINDINGS = {
  0: [BTN.LEFT, BTN.X, BTN.LB, BTN.LT],
  1: [BTN.DOWN, BTN.A],
  2: [BTN.UP, BTN.Y],
  3: [BTN.RIGHT, BTN.B, BTN.RB, BTN.RT],
};
export const cloneBindings = b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.slice()]));

export function sanitizeBindings(b) {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (!b || typeof b !== 'object') return out;
  for (let s = 0; s < 4; s++) {
    const v = b[s];
    if (Array.isArray(v) && v.length && v.every(x => Number.isInteger(x) && x >= 0 && x < 32)) out[s] = v.slice(0, 6);
  }
  return out;
}

// Lane for a binding slot given the chart's lane count (3-lane mode uses keys F J K = slots 1..3).

const STICK = 0.6, REPEAT_FIRST = 350, REPEAT_NEXT = 110;

export class Pad {
  constructor() {
    this.onButton = () => {};   // (index, down, perfTime)
    this.onNav = () => {};      // ('up'|'down'|'left'|'right')
    this.onConnect = () => {};  // (name)
    this.onDisconnect = () => {};
    this.prev = new Map();      // pad index -> boolean[] of pressed
    this.dir = { name: null, next: 0 };
    window.addEventListener('gamepadconnected', e => this.onConnect(e.gamepad.id));
    window.addEventListener('gamepaddisconnected', e => { this.prev.delete(e.gamepad.index); this.onDisconnect(e.gamepad.id); });
  }

  get connected() { return this.list().length > 0; }

  list() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); }
    catch { return []; }
  }

  poll() {
    const now = performance.now();
    let dirNow = null;
    for (const pad of this.list()) {
      const prev = this.prev.get(pad.index) || [];
      const cur = pad.buttons.map(b => b.pressed);
      // Prefer the pad's own update time when it is sane; it is closer to the real press than "now".
      const ts = pad.timestamp > 0 && now - pad.timestamp >= 0 && now - pad.timestamp < 100 ? pad.timestamp : now;
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] !== !!prev[i]) this.onButton(i, cur[i], ts);
      }
      this.prev.set(pad.index, cur);
      if (cur[BTN.UP] || pad.axes[1] < -STICK) dirNow = 'up';
      else if (cur[BTN.DOWN] || pad.axes[1] > STICK) dirNow = 'down';
      else if (cur[BTN.LEFT] || pad.axes[0] < -STICK) dirNow = 'left';
      else if (cur[BTN.RIGHT] || pad.axes[0] > STICK) dirNow = 'right';
    }
    const d = this.dir;
    if (dirNow !== d.name) {
      d.name = dirNow;
      if (dirNow) { this.onNav(dirNow); d.next = now + REPEAT_FIRST; }
    } else if (dirNow && now >= d.next) {
      this.onNav(dirNow);
      d.next = now + REPEAT_NEXT;
    }
  }
}
