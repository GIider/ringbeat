// Scrolls text that is wider than its box (CSS animation; see .scrolls in style.css).
export function marquee(el) {
  if (el) marqueeAll([el]);
}

// Same for many boxes at once: all DOM writes first, then all measurements, so the layout is computed once instead of once per box.
export function marqueeAll(els) {
  const list = [];
  for (const el of els) {
    let inner = el.firstElementChild;
    if (!inner || !inner.classList.contains('mq') || el.childNodes.length !== 1) {
      const text = el.textContent;
      el.textContent = '';
      inner = document.createElement('span');
      inner.className = 'mq';
      inner.textContent = text;
      el.appendChild(inner);
    }
    el.classList.remove('scrolls');
    list.push([el, inner]);
  }
  const over = list.map(([el, inner]) => Math.ceil(inner.scrollWidth - el.clientWidth));
  list.forEach(([el], i) => {
    if (over[i] <= 0) return;
    el.style.setProperty('--mq-dist', over[i] + 'px');
    el.style.setProperty('--mq-dur', Math.max(2, over[i] / 60).toFixed(1) + 's');
    el.classList.add('scrolls');
  });
}
