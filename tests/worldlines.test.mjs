import test from 'node:test';
import assert from 'node:assert/strict';
import { worldLines } from '../src/worldlines.js';

const row = (rank, name, score, extra = {}) => ({ rank, total: 2, name, score, grade: 'A', ...extra });

test('a stale near row is merged into the snapshot row and the order follows the score', () => {
  const near = [row(1, 'Blackjack', 6184, { me: true })]; // cached before fc/dev existed
  const top = [row(1, 'Blackjack', 6184, { fc: true, ap: false, mods: [], dev: true }), row(2, 'Tester', 5223, { fc: true })];
  const lines = worldLines(top, near);
  assert.deepEqual(lines.map(r => r.name), ['Blackjack', 'Tester']);
  assert.equal(lines[0].me, true);
  assert.equal(lines[0].fc, true);
  assert.equal(lines[0].dev, true);
});

test('a gap row stands only where the ranks skip', () => {
  const top = [row(1, 'A', 900), row(2, 'B', 800), row(3, 'C', 700)];
  assert.equal(worldLines(top, [row(4, 'D', 600, { me: true })]).some(r => r.gap), false);
  const lines = worldLines(top, [row(9, 'Me', 100, { me: true })]);
  assert.deepEqual(lines.map(r => r.gap ? '…' : r.name), ['A', 'B', 'C', '…', 'Me']);
});
