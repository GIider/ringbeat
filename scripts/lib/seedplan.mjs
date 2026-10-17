// Who plays what in the seeded local leaderboards (scripts/seed-local.mjs): a pyramid of bot skills, a per-board tier
// that caps how good the bots on it may be (so a human can win most boards), and random modifiers. Pure and seeded.
import { SPEEDS } from '../../src/mods.js';

export const LEVELS = 8; // LADDER in src/bot.js: L1 (sloppy) … L8 (perfect)
// Share of the bots per level, L1…L8: strong bots are rare.
export const PYRAMID = [0.20, 0.20, 0.18, 0.15, 0.12, 0.08, 0.05, 0.02];
// Per board: the highest effective level allowed, and how many bots of the top levels may share it.
export const TIERS = [
  { name: 'rookie', share: 0.30, cap: 3, limit: {} },
  { name: 'casual', share: 0.35, cap: 5, limit: {} },
  { name: 'good', share: 0.25, cap: 7, limit: { 7: 1 } },
  { name: 'elite', share: 0.10, cap: 8, limit: { 8: 1, 7: 2 }, anchor: true }, // anchor: always holds its strongest bot
];
export const MOD_RATE = 0.45; // share of runs played with at least one modifier

// Base level (1…LEVELS) of each of `n` bots, following PYRAMID, in random order.
export function botLevels(n, rnd) {
  const out = [];
  let cum = 0;
  for (let lvl = 1; lvl <= LEVELS; lvl++) {
    cum += PYRAMID[lvl - 1];
    while (out.length < Math.round(n * cum)) out.push(lvl);
  }
  while (out.length < n) out.push(1);
  return shuffle(out.slice(0, n), rnd);
}

export const shuffle = (list, rnd) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export function pickTier(rnd) {
  let r = rnd();
  for (const t of TIERS) { if ((r -= t.share) < 0) return t; }
  return TIERS[TIERS.length - 1];
}

// A bot's level on one board: its base level, nudged by −1/0/0/+1.
export const effectiveLevel = (base, rnd) => Math.max(1, Math.min(LEVELS, base + [-1, 0, 0, 1][Math.floor(rnd() * 4)]));

// The bots on one board -> [{ bot, level }]. `bots`: [{ ..., level }]. Between 5 and all of them, fewer if the tier allows fewer.
export function crowdFor(tier, bots, rnd) {
  const size = Math.min(bots.length, Math.max(5, Math.round(bots.length * (0.25 + 0.5 * rnd()))));
  const cands = shuffle(bots, rnd).map(bot => ({ bot, level: effectiveLevel(bot.level, rnd) })).filter(c => c.level <= tier.cap);
  const picked = [], used = {};
  const take = c => {
    if (tier.limit[c.level] !== undefined && (used[c.level] || 0) >= tier.limit[c.level]) return false;
    used[c.level] = (used[c.level] || 0) + 1;
    picked.push(c);
    return true;
  };
  if (tier.anchor) { // a board of this tier is the one with a (near) perfect bot on it
    const best = cands.reduce((a, c) => (!a || c.level > a.level ? c : a), null);
    if (best) take(best);
  }
  for (const c of cands) { if (picked.length >= size) break; if (!picked.includes(c)) take(c); }
  return picked;
}

// A loadout for mods.normalize(): none for most runs, else a random non-empty mix. Never demo (autoplay).
export function pickLoadout(rnd) {
  if (rnd() >= MOD_RATE) return null;
  const pick = list => list[Math.floor(rnd() * list.length)];
  const on = {
    speed: rnd() < 0.35, judge: rnd() < 0.30, mirror: rnd() < 0.25, hidden: rnd() < 0.20, sudden: rnd() < 0.08,
  };
  if (!Object.values(on).some(Boolean)) on[pick(['speed', 'judge', 'mirror', 'hidden'])] = true;
  return {
    speed: on.speed ? pick(SPEEDS.filter(s => s !== 1)) : 1,
    judge: on.judge ? pick(['lenient', 'strict']) : 'off',
    mirror: on.mirror, hidden: on.hidden, sudden: on.sudden,
  };
}
