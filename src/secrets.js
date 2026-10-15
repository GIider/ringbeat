// Easter-egg helpers (pure): passive sequence matchers, the fake IMEI and the "wipe memory" gag.
// Nothing here touches storage, scores or settings.

// Feeds tokens one at a time; true when the full sequence has just been completed. Never consumes input.
export function createSequenceMatcher(sequence) {
  let i = 0;
  return {
    feed(token) {
      if (token === sequence[i]) i++;
      else i = token === sequence[0] ? 1 : 0;
      if (i === sequence.length) { i = 0; return true; }
      return false;
    },
    reset() { i = 0; },
  };
}

export const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
export const IMEI_CODE = ['*', '#', '0', '6', '#'];

export function luhnCheckDigit(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - sum % 10) % 10;
}

// 15 digits, valid Luhn, reserved test TAC prefix "00" (never assigned to real handsets). Stable per seed.
export function fakeImei(seed = '') {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let body = '00';
  while (body.length < 14) { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; body += String(h % 10); }
  return body + luhnCheckDigit(body);
}
export const formatImei = s => `${s.slice(0, 2)}-${s.slice(2, 8)}-${s.slice(8, 14)}-${s.slice(14)}`;

// "Clearing memory..." gag. step(ms) advances it; view() is what to show (null when idle). Does nothing else.
const WIPE_MS = 3000, DONE_MS = 1000, JOKE_MS = 1300, SEGMENTS = 12;
export function createWipeGag() {
  let t = -1;
  return {
    get active() { return t >= 0; },
    start() { t = 0; },
    cancel() { t = -1; },
    step(ms) { if (t >= 0) { t += ms; if (t >= WIPE_MS + DONE_MS + JOKE_MS) t = -1; } },
    view() {
      if (t < 0) return null;
      if (t < WIPE_MS) return { text: 'Clearing memory...', bar: Math.floor(t / WIPE_MS * SEGMENTS), segments: SEGMENTS };
      if (t < WIPE_MS + DONE_MS) return { text: 'Memory cleared', bar: SEGMENTS, segments: SEGMENTS };
      return { text: 'Just kidding.', bar: -1, segments: SEGMENTS };
    },
    // Releasing the key only cancels while the bar is still filling.
    release() { if (t >= 0 && t < WIPE_MS) t = -1; },
  };
}
