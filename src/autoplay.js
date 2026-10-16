// Demo autoplay: feeds a perfect press/release sequence into a running Game (see the "demo" mod).
import { planBot } from './bot.js';

export function createAutoplay(chart) {
  const ev = planBot(chart, {}, 1);
  let i = 0;
  return {
    // Fire every event that is due at song time `t`. `calibration` mirrors Game.press (audio = songStart + t + calibration).
    step(t, game, calibration = 0) {
      while (i < ev.length && ev[i].t <= t) {
        const e = ev[i++], at = game.songStart + e.t + calibration;
        if (e.type === 'press') game.press(e.lane, at); else game.release(e.lane, at);
      }
    },
  };
}
