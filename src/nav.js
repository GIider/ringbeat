// Focus navigation shared by keyboard arrows and gamepad: spatial move between focusable controls,
// left/right adjusts sliders and selects, confirm clicks.

const SELECTOR = 'button, input, select, textarea, [tabindex="0"]';

export function focusables(root) {
  return Array.from(root.querySelectorAll(SELECTOR)).filter(el =>
    !el.disabled && !el.hidden && el.tabIndex >= 0 && el.getClientRects().length > 0 && el.type !== 'hidden');
}

const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
// Checkboxes are tiny and sit at the row's left edge; score them by their whole row so they stay reachable.
const rectOf = el => (el.type === 'checkbox' && el.closest('label') || el).getBoundingClientRect();

// Focus the nearest control in `dir` ('up'|'down'|'left'|'right'). Returns true when focus moved.
export function move(root, dir) {
  const items = focusables(root);
  if (!items.length) return false;
  const cur = items.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) {
    (root.querySelector('[data-default]:not([disabled])') || items[0]).focus();
    return true;
  }
  const c = center(rectOf(cur));
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const p = center(rectOf(el));
    const dx = p.x - c.x, dy = p.y - c.y;
    let main, cross;
    if (dir === 'down') { main = dy; cross = Math.abs(dx); }
    else if (dir === 'up') { main = -dy; cross = Math.abs(dx); }
    else if (dir === 'right') { main = dx; cross = Math.abs(dy); }
    else { main = -dx; cross = Math.abs(dy); }
    if (main < 3) continue;
    const score = main + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus(); return true; }
  return false;
}

// Left/right on a slider or select changes its value; returns true if handled.
export function adjust(el, dir) {
  if (!el) return false;
  const sign = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  if (!sign) return false;
  if (el.tagName === 'INPUT' && el.type === 'range') {
    const step = +el.step || 1, min = +el.min, max = +el.max;
    el.value = Math.max(min, Math.min(max, +el.value + sign * step));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el.tagName === 'SELECT') {
    const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + sign));
    if (i !== el.selectedIndex) {
      el.selectedIndex = i;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  return false;
}

export function confirm(root) {
  const el = document.activeElement;
  if (el && root.contains(el) && el !== document.body && el.tagName !== 'TEXTAREA') { el.click(); return true; }
  return false;
}
