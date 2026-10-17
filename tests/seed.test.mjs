// The local leaderboard seeder's plan (scripts/lib/seedplan.mjs): few strong bots, tiers that keep most boards winnable
// for a human, and random but valid modifiers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/bot.js';
import * as mods from '../src/mods.js';
import { botLevels, pickTier, crowdFor, pickLoadout, TIERS } from '../scripts/lib/seedplan.mjs';

const BOTS = 40, BOARDS = 3000;
const bots = rnd => botLevels(BOTS, rnd).map((level, i) => ({ id: i, level }));

test('seed plan: bot levels follow the pyramid', () => {
  const levels = botLevels(BOTS, mulberry32(1));
  assert.equal(levels.length, BOTS);
  const n = l => levels.filter(x => x === l).length;
  assert.ok(n(1) > n(5) && n(5) > n(8), 'weak bots are common, perfect ones rare');
  assert.ok(n(8) >= 1 && n(7) + n(8) <= 4);
});

test('seed plan: perfect bots are rare per board and weak-only boards exist', () => {
  const rnd = mulberry32(2), pool = bots(rnd);
  let withL8 = 0, rookie = 0;
  for (let i = 0; i < BOARDS; i++) {
    const tier = pickTier(rnd), crowd = crowdFor(tier, pool, rnd);
    assert.ok(crowd.length >= 5 && crowd.length <= BOTS);
    assert.equal(new Set(crowd.map(c => c.bot.id)).size, crowd.length, 'a bot has one run per board');
    assert.ok(crowd.every(c => c.level <= tier.cap));
    for (const [lvl, max] of Object.entries(tier.limit)) assert.ok(crowd.filter(c => c.level === +lvl).length <= max);
    if (crowd.some(c => c.level === 8)) withL8++;
    if (tier.name === 'rookie') rookie++;
  }
  assert.ok(withL8 / BOARDS < 0.15, 'perfect bots on ' + withL8 / BOARDS);
  assert.ok(withL8 > 0, 'but they do appear');
  assert.ok(Math.abs(rookie / BOARDS - TIERS[0].share) < 0.04);
});

test('seed plan: loadouts are valid, never demo, and about MOD_RATE of runs use one', () => {
  const rnd = mulberry32(3), seen = new Set();
  let active = 0;
  for (let i = 0; i < 4000; i++) {
    const l = pickLoadout(rnd);
    if (!l) continue;
    assert.deepEqual(mods.normalize(l), { ...l, demo: false });
    assert.ok(mods.isActive(l));
    active++;
    mods.tags(l).forEach(t => seen.add(t));
  }
  assert.ok(Math.abs(active / 4000 - 0.45) < 0.04);
  for (const t of ['EZ', 'ST', 'MR', 'HD', 'SD', '1.2x']) assert.ok(seen.has(t), t);
});

test('seed plan: the same seed gives the same plan', () => {
  const plan = seed => { const r = mulberry32(seed), p = bots(r); return JSON.stringify([crowdFor(pickTier(r), p, r).map(c => [c.bot.id, c.level]), pickLoadout(r)]); };
  assert.equal(plan(5), plan(5));
});
