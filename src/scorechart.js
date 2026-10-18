// The results' score chart: how dense the song is over time (bars) and how well the player did meanwhile (line). Pure
// series maths first, then a canvas painter in the same two-colour pixel style as the playfield.

// `timeline` = { length, noteTimes: [s], events: [[note time s, accuracy weight 0..1]] } from Game.results().
// -> { density: [0..1] per bin, acc: [0..100 | null] per bin, miss: [count] per bin }
export function scoreSeries(timeline, bins = 48) {
  const out = { density: new Array(bins).fill(0), acc: new Array(bins).fill(null), miss: new Array(bins).fill(0) };
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
  return out;
}

const INK = '#1d2b12';

// Paints into `canvas` (backing store one pixel per LCD pixel, `u` CSS px each). Bars = note density, line = accuracy per
// slice (gaps where no note fell), ticks along the bottom edge = misses.
export function drawScoreChart(canvas, series, u) {
  const box = canvas.parentElement || canvas;
  const w = Math.floor(box.clientWidth / u), h = Math.floor(box.clientHeight / u);
  if (!(w > 8 && h > 8)) return;
  canvas.width = w; canvas.height = h;
  canvas.style.width = w * u + 'px'; canvas.style.height = h * u + 'px';
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, w, h);
  c.fillStyle = INK;
  const n = series.density.length, bw = w / n, top = 1, base = h - 3, span = base - top;
  // frame: baseline and a dotted 100% line
  c.fillRect(0, base, w, 1);
  for (let x = 0; x < w; x += 4) c.fillRect(x, top, 1, 1);
  // density: dotted columns (every other pixel) so the accuracy line stays readable on top
  for (let i = 0; i < n; i++) {
    const x0 = Math.floor(i * bw), x1 = Math.max(x0 + 1, Math.floor((i + 1) * bw) - 1), hh = Math.round(series.density[i] * span * 0.8);
    for (let x = x0; x < x1; x++) for (let y = base - hh; y < base; y++) if (((x + y) & 1) === 0) c.fillRect(x, y, 1, 1);
  }
  // accuracy line (2 px thick), joined across empty slices
  let px = -1, py = -1;
  for (let i = 0; i < n; i++) {
    const a = series.acc[i];
    if (a == null) continue;
    const x = Math.round((i + 0.5) * bw), y = Math.round(base - 1 - (a / 100) * (span - 2));
    if (px >= 0) {
      const steps = Math.max(Math.abs(x - px), Math.abs(y - py));
      for (let k = 0; k <= steps; k++) c.fillRect(Math.round(px + (x - px) * k / steps), Math.round(py + (y - py) * k / steps), 2, 2);
    } else c.fillRect(x, y, 2, 2);
    px = x; py = y;
  }
  // misses: ticks under the baseline
  for (let i = 0; i < n; i++) if (series.miss[i]) c.fillRect(Math.round((i + 0.5) * bw) - 1, base + 1, 3, 2);
}
