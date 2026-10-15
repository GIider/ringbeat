// Procedural cover art: a small sunset/night scene derived from the song id, returned as an SVG data-URI.
import { hashString } from './library.js';

const PALETTES = [
  ['#2b1055', '#d53369', '#ffb347'], // sunset
  ['#0f2027', '#2c5364', '#6dd5ed'], // dusk sea
  ['#1a0b3b', '#5b2a86', '#ff6ec7'], // neon violet
  ['#0b3d2e', '#1f8a5b', '#b6f36a'], // forest
  ['#101a4a', '#3a6ea5', '#ffe66d'], // night sky
  ['#3b0d2a', '#c0392b', '#ffd23f'], // ember
];

function rng(seed) {
  let s = parseInt(seed, 36) || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 374761393 | 0) >>> 0) / 4294967296;
}

const cache = new Map();
export function coverURL(id) {
  if (cache.has(id)) return cache.get(id);
  const r = rng(hashString(id));
  const [a, b, c] = PALETTES[Math.floor(r() * PALETTES.length)];
  const sx = 40 + r() * 120, sy = 30 + r() * 25, sr = 14 + r() * 12;
  let stars = '';
  for (let i = 0; i < 14; i++) {
    stars += `<circle cx="${(r() * 200).toFixed(0)}" cy="${(r() * 60).toFixed(0)}" r="${(0.6 + r() * 1.1).toFixed(1)}" fill="#fff" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`;
  }
  const layer = (base, amp, fill) => {
    let d = `M0 90 L0 ${base}`;
    for (let x = 0; x <= 200; x += 20) d += ` L${x} ${(base - r() * amp).toFixed(0)}`;
    return `<path d="${d} L200 90 Z" fill="${fill}"/>`;
  };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 90" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/>` +
    `<stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>` +
    `<rect width="200" height="90" fill="url(#g)"/>${stars}` +
    `<circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="${sr.toFixed(0)}" fill="${c}" opacity=".9"/>` +
    layer(62, 18, '#1b1440') + layer(74, 14, '#0e0b24') + `</svg>`;
  const url = 'data:image/svg+xml,' + encodeURIComponent(svg);
  cache.set(id, url);
  return url;
}
