// The results' score chart: how dense the song is over time (bars) and how well the player did meanwhile (line), with an
// accuracy axis and the misses and ghost taps picked out. Pure series maths first, then a canvas painter in the same
// two-colour pixel style as the playfield.
import { paintText, textWidth } from './render.js';

// `timeline` = { length, noteTimes: [s], events: [[note time s, accuracy weight 0..1]], ghosts: [s] } from Game.results().
// -> { density: [0..1] per slice, acc: [0..100 | null] per slice, miss: [count] per slice, ghost: [count] per slice }
export function scoreSeries(timeline, bins = 48) {
  const out = { density: new Array(bins).fill(0), acc: new Array(bins).fill(null), miss: new Array(bins).fill(0), ghost: new Array(bins).fill(0) };
  const len = timeline && timeline.length > 0 ? timeline.length : 0;
  if (!len) return out;
  const bin = t => Math.max(0, Math.min(bins - 1, Math.floor(t / len * bins)));
  for (const t of timeline.noteTimes || []) out.density[bin(t)]++;
  const peak = Math.max(1, ...out.density);
  out.density = out.density.map(n => n / peak);
  const sum = new Array(bins).fill(0), cnt = new Array(bins).fill(0);
  for (const [t, w] of timeline.events || []) {
    const b = bin(t);
    sum[b] += w; cnt[b]++;
    if (w === 0) out.miss[b]++;
  }
  for (let i = 0; i < bins; i++) if (cnt[i]) out.acc[i] = 100 * sum[i] / cnt[i];
  for (const t of timeline.ghosts || []) out.ghost[bin(t)]++;
  return out;
}

const INK = '#1d2b12';

// Paints into `canvas` (backing store one pixel per LCD pixel, `u` CSS px each; the canvas fills its parent box).
// Axis on the left (0 / 50 / 100 %), dotted bars = note density, thick line = accuracy per slice (joined across empty
// slices), misses = a dotted drop line plus a solid block under the baseline, ghost taps = a cross above the baseline.
export function drawScoreChart(canvas, series, u) {
  const box = canvas.parentElement || canvas;
  const w = Math.floor(box.clientWidth / u), h = Math.floor(box.clientHeight / u);
  if (!(w > 30 && h > 16)) return;
  canvas.width = w; canvas.height = h;
  canvas.style.width = w * u + 'px'; canvas.style.height = h * u + 'px';
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, w, h);
  c.fillStyle = INK;
  const lm = textWidth('100%') + 3, top = 4, base = h - 6, span = base - top, pw = w - lm;
  const yOf = a => Math.round(base - (a / 100) * span);
  // axis: labels at 100 / 50 / 0 %, dotted gridlines at the first two, solid baseline
  for (const [a, label] of [[100, '100%'], [50, '50%'], [0, '0%']]) {
    paintText(c, label, lm - 3 - textWidth(label), yOf(a) - 3, INK, false);
    if (a) for (let x = lm; x < w; x += 4) c.fillRect(x, yOf(a), 1, 1);
  }
  c.fillRect(lm, base, pw, 1);
  c.fillRect(lm - 1, top, 1, span + 1);
  const n = series.density.length, bw = pw / n;
  const xc = i => lm + Math.round((i + 0.5) * bw);
  // density: dotted columns (every other pixel) so the accuracy line stays readable on top
  for (let i = 0; i < n; i++) {
    const x0 = lm + Math.floor(i * bw), x1 = Math.max(x0 + 1, lm + Math.floor((i + 1) * bw) - 1), hh = Math.round(series.density[i] * span * 0.8);
    for (let x = x0; x < x1; x++) for (let y = base - hh; y < base; y++) if (((x + y) & 1) === 0) c.fillRect(x, y, 1, 1);
  }
  // misses: a dotted line down from the top of the plot, so the slice stands out
  for (let i = 0; i < n; i++) if (series.miss[i]) for (let y = top; y < base; y += 2) c.fillRect(xc(i), y, 1, 1);
  // accuracy line (2 px thick)
  let px = -1, py = -1;
  for (let i = 0; i < n; i++) {
    const a = series.acc[i];
    if (a == null) continue;
    const x = xc(i), y = yOf(a);
    if (px >= 0) {
      const steps = Math.max(Math.abs(x - px), Math.abs(y - py));
      for (let k = 0; k <= steps; k++) c.fillRect(Math.round(px + (x - px) * k / steps), Math.round(py + (y - py) * k / steps), 2, 2);
    } else c.fillRect(x, y, 2, 2);
    px = x; py = y;
  }
  // miss blocks under the baseline, with a ring on the line where the slice's accuracy sits
  for (let i = 0; i < n; i++) {
    if (!series.miss[i]) continue;
    const x = xc(i);
    c.fillRect(x - 2, base + 2, 5, 3);
    if (series.acc[i] != null) { const y = yOf(series.acc[i]); c.clearRect(x - 3, y - 2, 7, 7); c.fillRect(x - 3, y - 2, 7, 1); c.fillRect(x - 3, y + 4, 7, 1); c.fillRect(x - 3, y - 2, 1, 7); c.fillRect(x + 3, y - 2, 1, 7); }
  }
  // ghost taps: a cross on a cleared patch just above the baseline
  for (let i = 0; i < n; i++) {
    if (!series.ghost[i]) continue;
    const x = xc(i), y = base - 7;
    c.clearRect(x - 3, y - 3, 7, 7);
    for (let k = -2; k <= 2; k++) { c.fillRect(x + k, y + k, 1, 1); c.fillRect(x + k, y - k, 1, 1); }
  }
}
