// The status bar's signal icon as a connection light for signed-in players. Stepped like the LCD: sending climbs the
// bars, receiving drops them. Pure logic: the caller supplies how to paint, the timers and whether painting is allowed.
const SEND = [1, 2, 3, 4, 5];
const RECV = [5, 4, 3, 2, 1];
const REST = { off: 5, idle: 5, error: 1, offline: 0 }; // the bars shown when nothing is moving
const STILL = 3;                                         // a busy light held still (reduced motion)
const STEP_MS = 140;
const MIN_BUSY_MS = 600;                                 // so a quick round is still seen

export const restLevel = state => (state in REST ? REST[state] : REST.idle);
export const frames = state => (state === 'send' ? SEND : state === 'recv' ? RECV : null);

// state: 'off' | 'idle' | 'send' | 'recv' | 'error' | 'offline'
export function createNetSignal({ paint, blocked = () => false, reduced = () => false, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, setTick = setInterval, clearTick = clearInterval }) {
  let state = 'off', step = 0, busySince = 0, tick = 0, hold = 0, next = null, shown = -1;

  const busy = s => s === 'send' || s === 'recv';
  const level = () => {
    if (!busy(state)) return restLevel(state);
    return reduced() ? STILL : frames(state)[step % 5];
  };
  function render() {
    if (blocked()) return;
    const l = level();
    if (l === shown) return;
    shown = l;
    paint(l);
  }
  // Another screen drew the icon (play, a cameo): paint again on the next render.
  const repaint = () => { shown = -1; render(); };

  function apply(s) {
    next = null;
    state = s;
    if (tick) { clearTick(tick); tick = 0; }
    step = 0;
    if (busy(s)) {
      busySince = now();
      if (!reduced()) tick = setTick(() => { step++; render(); }, STEP_MS);
    }
    render();
  }
  function setState(s) {
    if (hold) { clearTimer(hold); hold = 0; }
    if (s === state) { next = null; return; }
    const wait = busy(state) && !busy(s) ? MIN_BUSY_MS - (now() - busySince) : 0;
    if (wait > 0) {
      next = s;
      hold = setTimer(() => { hold = 0; apply(next); }, wait);
      return;
    }
    apply(s);
  }
  return { setState, repaint, level, state: () => state };
}
