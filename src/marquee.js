// Scrolls text that is wider than its box (CSS animation; see .scrolls in style.css).
export function marquee(el) {
  if (!el) return;
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
  const over = Math.ceil(inner.scrollWidth - el.clientWidth);
  if (over > 0) {
    el.style.setProperty('--mq-dist', over + 'px');
    el.style.setProperty('--mq-dur', Math.max(2, over / 60).toFixed(1) + 's');
    el.classList.add('scrolls');
  }
}
