// Makes a developer overlay (perf HUD, request log) movable and resizable. Drag it anywhere, resize it from its
// bottom-right corner, double-click to put it back. Position and size are remembered per overlay on this device.

const KEY = 'rb-float-';
const GRIP = 18; // px square in the bottom-right corner left to the native resize handle

const live = new Set(); // reset functions of the overlays currently on screen

// Forget every saved overlay position / size and send the visible ones back to their corners.
export function resetFloatBoxes() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(KEY)) localStorage.removeItem(k); } catch { /* storage blocked */ }
  for (const r of [...live]) r();
}

export function floatBox(el, name, { defaults = {} } = {}) {
  if (!el || !el.addEventListener || !el.style) return () => {};
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY + name)) || null; } catch { return null; } };
  const write = v => { try { v ? localStorage.setItem(KEY + name, JSON.stringify(v)) : localStorage.removeItem(KEY + name); } catch { /* storage blocked */ } };
  const vw = () => window.innerWidth, vh = () => window.innerHeight;

  const place = ({ x, y, w, h }) => {
    const s = el.style;
    s.position = 'fixed'; s.right = 'auto'; s.bottom = 'auto'; s.maxWidth = 'none';
    s.pointerEvents = 'auto'; s.cursor = 'move'; s.resize = 'both'; s.overflow = 'auto'; s.touchAction = 'none';
    if (w) s.width = Math.min(w, vw()) + 'px';
    if (h) s.height = Math.min(h, vh()) + 'px';
    const r = el.getBoundingClientRect();
    s.left = Math.max(0, Math.min(x, vw() - Math.min(r.width, vw()))) + 'px'; // keep it fully on screen
    s.top = Math.max(0, Math.min(y, vh() - Math.min(r.height, vh()))) + 'px';
  };
  const current = () => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  // Where it starts: the saved spot, else the caller's default (which may anchor to the right / bottom).
  const home = () => {
    const d = typeof defaults === 'function' ? defaults() : defaults;
    el.style.width = el.style.height = '';
    el.style.left = d.left != null ? d.left + 'px' : 'auto'; el.style.right = d.right != null ? d.right + 'px' : 'auto';
    el.style.top = d.top != null ? d.top + 'px' : 'auto'; el.style.bottom = d.bottom != null ? d.bottom + 'px' : 'auto';
    el.style.position = 'fixed';
    el.style.pointerEvents = 'auto'; el.style.cursor = 'move'; el.style.resize = 'both'; el.style.overflow = 'auto'; el.style.touchAction = 'none';
    el.style.maxWidth = 'calc(100vw - 8px)'; // stays anchored to its corner (so a growing log grows inward) until the first drag
  };
  const saved = read();
  if (saved) place(saved); else home();

  let drag = null;
  const down = e => {
    if (e.button > 0) return;
    const r = el.getBoundingClientRect();
    if (e.clientX > r.right - GRIP && e.clientY > r.bottom - GRIP) return; // native resize
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = e => { if (drag) place({ ...current(), x: e.clientX - drag.dx, y: e.clientY - drag.dy, w: 0, h: 0 }); };
  const up = () => { if (!drag) return; drag = null; write(current()); };
  const reset = () => { write(null); home(); };
  live.add(reset);
  const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!drag && el.isConnected && el.style.width) write(current()); }) : null; // inline size = the user's resize handle
  const onWin = () => { if (el.style.left !== 'auto') place(current()); };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('dblclick', reset);
  window.addEventListener('resize', onWin);
  if (resized) setTimeout(() => el.isConnected && resized.observe(el), 0); // skip the initial observation

  return () => { live.delete(reset); window.removeEventListener('resize', onWin); if (resized) resized.disconnect(); };
}
