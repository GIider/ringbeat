// Swipe detection for touch/pen/mouse drags. `swipeDir` is pure so it can be tested without a DOM.

// Direction of a drag ('left'|'right'|'up'|'down') or null when it is too short or off-axis.
// axis: 'x' only horizontal, 'y' only vertical, 'both' the dominant axis wins.
export function swipeDir(dx, dy, axis = 'x', threshold = 40) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (axis === 'x') return ax > threshold && ax > ay ? (dx < 0 ? 'left' : 'right') : null;
  if (axis === 'y') return ay > threshold && ay > ax ? (dy < 0 ? 'up' : 'down') : null;
  if (Math.max(ax, ay) <= threshold) return null;
  return ax > ay ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
}

// Calls cb(dir, event) when a swipe ends on `el`. Returns a getter telling whether the last pointer
// gesture was a swipe, so click handlers can ignore the click that follows it.
export function onSwipe(el, cb, { axis = 'x', threshold = 40 } = {}) {
  let sx = null, sy = 0, swiped = false;
  el.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; swiped = false; });
  el.addEventListener('pointercancel', () => { sx = null; });
  el.addEventListener('pointerup', e => {
    if (sx === null) return;
    const dir = swipeDir(e.clientX - sx, e.clientY - sy, axis, threshold);
    sx = null;
    if (dir) { swiped = true; cb(dir, e); }
  });
  return () => swiped;
}
