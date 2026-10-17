// Leaderboard row fragments shared by the game and the boards page (pure: strings in, HTML strings out).

export function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

export function badgeHTML(run, withMods = false) {
  return (run && run.ap ? '<span class="badge ap">AP</span>' : run && run.fc ? '<span class="badge">FC</span>' : '') +
    (withMods && run && run.mods && run.mods.length ? `<span class="badge mod">${esc(run.mods.join(' '))}</span>` : '');
}

// A world row's player name; the developer's gets the rainbow wave.
export const nameHTML = r => `<span class="nm${r && r.dev ? ' dev' : ''}">${esc(r.name || '')}</span>`;

// Five stars filled proportionally to a 1..10 rating (half-star precision), e.g. 6.0 -> 3 stars. `label` is the
// accessible text (already translated).
export function starsBar(rating, label) {
  const pct = Math.max(0, Math.min(100, Math.round(rating * 5) * 2));
  return `<span class="stars-bar" role="img" aria-label="${esc(label)}">` +
    `<span class="off">★★★★★</span><span class="on" style="width:${pct}%">★★★★★</span></span>`;
}
