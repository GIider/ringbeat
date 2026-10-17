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
  const cr = rectOf(cur), c = center(cr);
  // Gap between two spans on the cross axis: 0 while they overlap, so a wide control counts as in line with everything it spans.
  const gap = (a0, a1, b0, b1) => Math.max(0, a0 - b1, b0 - a1);
  // In a grid (data-rows) left/right stay in the current row, so a wide cell above or below is only reached with up/down.
  const inRow = el => { const r = rectOf(el); return gap(cr.top, cr.bottom, r.top, r.bottom) === 0; };
  const pool = (dir === 'left' || dir === 'right') && cur.closest('[data-rows]') ? items.filter(inRow) : items;
  let best = null, bestScore = Infinity;
  for (const el of pool) {
    if (el === cur) continue;
    const p = center(rectOf(el));
    const r = rectOf(el);
    const dx = p.x - c.x, dy = p.y - c.y;
    const vert = dir === 'down' || dir === 'up';
    const main = dir === 'down' ? dy : dir === 'up' ? -dy : dir === 'right' ? dx : -dx;
    const cross = vert ? gap(cr.left, cr.right, r.left, r.right) : gap(cr.top, cr.bottom, r.top, r.bottom);
    if (main < 3) continue;
    const score = main + cross * 2.5 + Math.abs(vert ? dx : dy) * 0.01; // centre distance only breaks ties
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
