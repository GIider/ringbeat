// A run as the game uploads it: a bot plays a song with the game's frame loop and the input log is encoded.
// Shared by tests/cloud.test.mjs and scripts/seed-local.mjs.
import { RULES, encodeLog, headlessGame } from '../../src/replay.js';
import { planBot } from '../../src/bot.js';
import { generateChart } from '../../src/chart.js';
import { parseRTTTL } from '../../src/rtttl.js';
import { SONGS } from '../../src/songs.js';
import * as mods from '../../src/mods.js';

export function played(songId, skill, loadout = null, seed = 1, rtttl = SONGS.find(s => s.id === songId)?.rtttl, playedAt = seed) {
  const m = mods.normalize(loadout);
  const chart = mods.applyChart(generateChart(parseRTTTL(rtttl)), m);
  const g = headlessGame();
  let res = null;
  g.onFinish = r => { res = r; };
  g.start({ ...chart, notes: chart.notes.map(n => ({ ...n })) }, { leadIn: 0, ...mods.gameOptions(m) });
  const ev = planBot(chart, skill, seed);
  let i = 0;
  for (let t = 0; !res; t += 1 / 60) {
    for (; i < ev.length && ev[i].t <= t; i++) (ev[i].type === 'press' ? g.press : g.release).call(g, ev[i].lane, ev[i].t);
    g.update(t);
  }
  const mult = mods.isActive(m) ? mods.multiplier(m) : 1;
  return {
    result: { ...res, score: Math.round(res.score * mult), mult },
    run: { songId, score: Math.round(res.score * mult), grade: res.grade, accuracy: res.accuracy, maxCombo: res.maxCombo,
      fc: res.fc, ap: res.ap, mods: mods.tags(m), mult, playedAt, replay: encodeLog(g.log), rules: RULES, loadout: m },
  };
}
