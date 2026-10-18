// Replays: a run's input log (Game.log) as a compact string, and re-playing it through a headless Game. The Worker
// re-plays every uploaded run to compute its score itself (docs/CLOUD.md › Leaderboards); bot.js uses the same
// headless Game. Times are stored as exact doubles, so a replay gives bit-for-bit the results of the live run.
import { Game } from './game.js';

// Bump when a change to scoring or charts (game.js, chart.js, rtttl.js, mods.js, songs.js, this file) changes what a
// replay scores. Leaderboards only rank runs played under the Worker's RULES. tests/replay.test.mjs fails when those
// files change, as a reminder: bump RULES, or only update the hash there when nothing that scores changed.
export const RULES = 2;
export const MAX_EVENTS = 20000;

// A Game without audio, DOM or timers. The clock starts at 0, so with leadIn 0 song time = audio time.
export function headlessGame() {
  const ctx = { currentTime: 0, suspend() {}, resume() {} };
  const synth = { ctx, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} };
  const g = new Game(synth);
  g._startScheduler = () => {}; // backing ticks and roll audio only; never judges
  return g;
}

// Re-play a log on a chart (not mutated) with Game options ({ windowScale, suddenDeath }).
// -> Game.results() of the finished run, or null when the log never reaches the end of the song.
export function replay(chart, log, { windowScale = 1, suddenDeath = false } = {}) {
  const c = { ...chart, notes: chart.notes.map(n => ({ ...n })) };
  const g = headlessGame();
  let result = null;
  g.onFinish = r => { result = r; };
  g.start(c, { leadIn: 0, backing: false, windowScale, suddenDeath });
  for (const [t, k] of log) {
    if (g.state !== 'running') break;
    if (k < 0) g.update(t);
    else if (k < 8) g.press(k, t);
    else g.release(k - 8, t);
  }
  g.stop();
  return result;
}

// Log -> base64url: version byte, event count (u32), one byte per code (+1), then the times as float64, little-endian.
export function encodeLog(log) {
  const n = log.length;
  const buf = new ArrayBuffer(5 + n * 9), v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint32(1, n, true);
  log.forEach(([t, k], i) => { v.setUint8(5 + i, k + 1); v.setFloat64(5 + n + i * 8, t, true); });
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// base64url -> log, or null for anything garbled: a bad length, a non-finite time, a code no 4-lane chart has.
export function decodeLog(s, lanes = 4) {
  try {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    if (bytes.length < 5 || v.getUint8(0) !== 1) return null;
    const n = v.getUint32(1, true);
    if (n > MAX_EVENTS || bytes.length !== 5 + n * 9) return null;
    const log = new Array(n);
    for (let i = 0; i < n; i++) {
      const k = v.getUint8(5 + i) - 1, t = v.getFloat64(5 + n + i * 8, true);
      if (!Number.isFinite(t) || !(k === -1 || (k >= 0 && k < lanes) || (k >= 8 && k < 8 + lanes))) return null;
      log[i] = [t, k];
    }
    return log;
  } catch { return null; }
}
