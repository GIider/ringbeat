// The helpers behind `npm run bench:net` (scripts/lib/netbench.mjs): percentiles, the synthetic snapshot and its format variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { median, percentile, kb, synthBoards, slimBoards, expandBoards, topBoards, variants, measureBody } from '../scripts/lib/netbench.mjs';

test('netbench: median, percentile and sizes', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([5], 50), 5);
  assert.equal(kb(512), '512 B');
  assert.equal(kb(2048), '2.0 KB');
});

test('netbench: the synthetic snapshot is seeded and about the size of the real one', () => {
  const a = synthBoards({ boards: 367, seed: 1 });
  assert.deepEqual(a, synthBoards({ boards: 367, seed: 1 }));
  assert.equal(Object.keys(a).length, 367);
  assert.ok(Object.values(a).every(rows => rows.length === 10 && rows.every((r, i) => r.rank === i + 1 && r.total >= 10)));
  const bytes = Buffer.byteLength(JSON.stringify(a));
  assert.ok(bytes > 450e3 && bytes < 700e3, 'the live snapshot was 574 KB: ' + bytes);
});

test('netbench: slim rows expand back to the original rows; top-N slices', () => {
  const full = synthBoards({ boards: 20 });
  assert.deepEqual(expandBoards(slimBoards(full)), full);
  assert.deepEqual(expandBoards(JSON.parse(JSON.stringify(slimBoards(full)))), full, 'through JSON');
  assert.ok(Object.values(topBoards(full, 3)).every(r => r.length === 3));
});

test('netbench: variants are smaller in the order expected, and a row of results has every column', () => {
  const v = variants(synthBoards({ boards: 40 }));
  assert.deepEqual(v.map(x => x.name), ['current (top 10)', 'slim rows', 'current, top 3', 'slim rows, top 3']);
  const len = v.map(x => x.body.length);
  assert.ok(len[0] > len[1] && len[0] > len[2] && len[2] > len[3]);
  const row = measureBody(v[1], 3);
  assert.deepEqual(Object.keys(row), ['variant', 'raw', 'gzip6', 'br 4', 'br 11', 'gunzip', 'unbrotli', 'parse', 'expand']);
  assert.notEqual(row.expand, '-');
  assert.equal(measureBody(v[0], 3).expand, '-');
});
