// Keyboard + pointer/touch -> lane press/release events carrying AUDIO-clock timestamps.

// The one place that converts an event's performance.now()-based timeStamp to
// audio time, expressed on the *speaker* timeline (what the player is hearing
// when they act). Render time uses currentTime - latency, so both agree.
export function eventAudioTime(ctx, e) {
  const latency = ctx.outputLatency || ctx.baseLatency || 0;
  if (typeof ctx.getOutputTimestamp === 'function') {
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.performanceTime > 0) {
      const t = ts.contextTime + (e.timeStamp - ts.performanceTime) / 1000;
      // Sanity: reject wild mappings (e.g. a stale timestamp while suspended).
      if (Math.abs(t - (ctx.currentTime - latency)) < 1) return t;
    }
  }
  return ctx.currentTime - latency;
}

const KEYS = {
  3: ['KeyF', 'KeyJ', 'KeyK'],
  4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
};
export const KEY_LABELS = { 4: ['D', 'F', 'J', 'K'] };

export class Input {
  constructor({ getCtx, canvas, laneAt }) {
    this.getCtx = getCtx;
    this.laneAt = laneAt;
    this.lanes = 4;
    this.enabled = false;
    this.onPress = () => {};
    this.onRelease = () => {};
    this.heldKeys = new Set();
    this.pointers = new Map(); // pointerId -> lane

    window.addEventListener('keydown', e => {
      if (!this.enabled || e.repeat) return;
      const lane = KEYS[this.lanes].indexOf(e.code);
      if (lane < 0 || this.heldKeys.has(e.code)) return;
      this.heldKeys.add(e.code);
      this.onPress(lane, this._time(e));
    });
    window.addEventListener('keyup', e => {
      if (!this.heldKeys.delete(e.code)) return;
      const lane = KEYS[this.lanes].indexOf(e.code);
      if (lane >= 0) this.onRelease(lane, this._time(e));
    });

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      e.preventDefault();
      const lane = this.laneAt(e.clientX);
      this.pointers.set(e.pointerId, lane);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      this.onPress(lane, this._time(e));
    });
    const up = e => {
      if (!this.pointers.has(e.pointerId)) return;
      const lane = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      this.onRelease(lane, this._time(e));
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
  }

  _time(e) {
    const ctx = this.getCtx();
    return ctx ? eventAudioTime(ctx, e) : 0;
  }

  setLanes(n) { this.lanes = n; this.reset(); }
  reset() { this.heldKeys.clear(); this.pointers.clear(); }
}
