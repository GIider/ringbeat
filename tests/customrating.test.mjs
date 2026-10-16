// Node tests for custom-song difficulty: async measurement, rating validation, storage, share links.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SONGS } from '../src/songs.js';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';
import { measureChart, measureChartAsync, CALC_VERSION } from '../src/bot.js';
import { cleanRating, encodeRating, decodeRating, ratingFromMeasured } from '../src/customrating.js';
import { createMySongs } from '../src/mysongs.js';
import { encodeSong, decodeShare, decodeSong } from '../src/share.js';
import { customEntry } from '../src/library.js';

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const TUNE = 'a:d=8,o=5,b=140:c,d,e,f,g,a,b,c6';
const rec = (n = 4.2, h = 6.5) => ({ v: CALC_VERSION, normal: { rating: n, tags: ['holds'] }, hard: { rating: h, tags: ['speed', 'stamina'] } });

test('measureChartAsync matches measureChart and the bundled difficulty.json; progress ends at 1; cancel resolves null', async () => {
  const dj = JSON.parse(fs.readFileSync(new URL('../src/difficulty.json', import.meta.url), 'utf8'));
  const s = SONGS[0];
  const chart = generateChart(parseRTTTL(s.rtttl), { difficulty: 'hard' });
  const prog = [];
  const res = await measureChartAsync(chart, {}, p => prog.push(p));
  assert.deepEqual(res, measureChart(chart));
  assert.deepEqual(res, dj[s.id].hard);
  assert.equal(prog.at(-1), 1);
  assert.ok(prog.every((p, i) => !i || p > prog[i - 1]));
  assert.equal(await measureChartAsync(chart, {}, () => {}, () => true), null);
});

test('cleanRating: clamps, filters tags, rejects other versions and malformed records', () => {
  const c = cleanRating({ v: CALC_VERSION, normal: { rating: 99, tags: ['holds', 'bogus', 'speed', 'rolls'] }, hard: { rating: -3 } });
  assert.deepEqual(c, { v: CALC_VERSION, normal: { rating: 10, tags: ['holds', 'speed'] }, hard: { rating: 1, tags: [] } });
  assert.equal(cleanRating({ ...rec(), v: CALC_VERSION + 1 }), null);
  assert.equal(cleanRating({ v: CALC_VERSION, normal: { rating: 'x' }, hard: { rating: 3 } }), null);
  assert.equal(cleanRating(null), null);
  assert.equal(ratingFromMeasured({ normal: { rating: 3, tags: [] }, hard: { rating: 5, tags: [] } }).hard.rating, 5);
});

test('rating share form round-trips, is flagged imported, and garbage decodes to null', () => {
  const enc = encodeRating(rec());
  assert.match(enc, /^\d+\.42\.65\.\d*\.\d*$/);
  const d = decodeRating(enc);
  assert.equal(d.imported, true);
  assert.deepEqual({ ...d, imported: undefined }, { ...cleanRating(rec()), imported: undefined });
  for (const bad of ['', 'abc', '1.2.3', '1.42.65.99999.', null, undefined, `${CALC_VERSION + 5}.42.65..`]) assert.equal(decodeRating(bad), null, String(bad));
});

test('share links: with and without rating; old links, garbled and unknown params still import the song', () => {
  const plain = encodeSong(TUNE);
  assert.ok(!plain.includes('&r='));
  assert.deepEqual(decodeShare(plain), { rtttl: TUNE, rating: null });
  const rated = encodeSong(TUNE, rec());
  assert.equal(decodeShare(rated).rtttl, TUNE);
  assert.equal(decodeShare(rated).rating.normal.rating, 4.2);
  assert.equal(decodeSong(rated), TUNE);
  assert.deepEqual(decodeShare(plain + '&r=garbage'), { rtttl: TUNE, rating: null });
  assert.equal(decodeShare(plain + '&x=1').rtttl, TUNE);
  assert.equal(decodeShare('#s=%%%'), null);
  assert.equal(encodeSong(TUNE, { v: 0 }), plain); // an invalid rating is simply left out
});

test('mysongs: rating persists, survives export/import as unverified, is cleared by a melody edit, bad data dropped', () => {
  const st = mem(), m = createMySongs(st);
  const s = m.add('t', TUNE);
  assert.equal(s.rating, null);
  m.setRating(s.uid, rec());
  assert.equal(createMySongs(st).get(s.uid).rating.hard.rating, 6.5); // persisted
  const before = m.get(s.uid).updated;
  m.setRating(s.uid, rec(3, 3));
  assert.equal(m.get(s.uid).updated, before); // not an edit
  const m2 = createMySongs(mem());
  m2.importText(m.exportJSON());
  assert.equal(m2.list()[0].rating.imported, true);
  assert.equal(m2.list()[0].rating.normal.rating, 3);
  m.update(s.uid, { name: 'renamed' });
  assert.ok(m.get(s.uid).rating, 'rename keeps the rating');
  m.update(s.uid, { rtttl: 'a:d=8,o=5,b=140:c,d,e' });
  assert.equal(m.get(s.uid).rating, null);
  const st3 = mem();
  st3.setItem('ringbeat.songs.v1', JSON.stringify([{ uid: 'u', name: 'x', rtttl: TUNE, rating: { v: CALC_VERSION, normal: { rating: 'no' } } }]));
  assert.equal(createMySongs(st3).list()[0].rating, null);
});

test('customEntry: own rating replaces the heuristic; imported or missing ratings are marked estimated', () => {
  const TUNE = 'a:d=16,o=5,b=180:c,c7,d,d7,e,e7,f,f7,g,g7,a,a7,b,b7,c6,c4'; // Hard differs from Normal, so both ratings show
  const heur = customEntry(TUNE);
  assert.equal(heur.estimated, true);
  const own = customEntry(TUNE, cleanRating(rec()));
  assert.equal(own.estimated, false);
  assert.equal(own.rating.normal, 4.2);
  assert.equal(own.rating.hard, 6.5);
  assert.deepEqual(own.tags.hard, ['speed', 'stamina']);
  assert.equal(customEntry(TUNE, decodeRating(encodeRating(rec()))).estimated, true);
});
