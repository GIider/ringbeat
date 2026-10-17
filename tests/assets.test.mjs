// Self-made assets: the pixel font table + TrueType builder, sprites, song pictures, and the voice setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLYPHS, boldGlyph, CAP } from '../src/pixelfont.js';
import { buildTTF, glyphRects } from '../scripts/build-font.mjs';
import { SPRITES, signal, battery, ringing, spriteSVG } from '../src/pixelart.js';
import { coverRows, COVER_W, COVER_H } from '../src/cover.js';
import { SONGS } from '../src/songs.js';

const rectangular = rows => rows.every(r => r.length === rows[0].length && /^[#.]+$/.test(r));

test('glyph table: every printable ASCII char, rectangular, cap or descender height', () => {
  for (let c = 32; c < 127; c++) assert.ok(GLYPHS[String.fromCharCode(c)], `missing ${String.fromCharCode(c)}`);
  for (const [ch, g] of Object.entries(GLYPHS)) {
    assert.ok(rectangular(g.rows), `ragged glyph ${ch}`);
    assert.equal(g.w, g.rows[0].length, ch);
    assert.ok(g.rows.length >= CAP && g.rows.length <= CAP + 2, `height of ${ch}`);
  }
});

test('glyphs cover every character the built-in song titles and UI symbols use', () => {
  const used = new Set([...SONGS.map(s => s.title + s.tag).join(''), ...'★♪◄►▶✓✗·…—–→']);
  for (const ch of used) assert.ok(GLYPHS[ch], `no glyph for ${JSON.stringify(ch)}`);
});

test('bold cut grows by one column and keeps every ink pixel', () => {
  const g = GLYPHS.A, b = boldGlyph(g);
  assert.equal(b.w, g.w + 1);
  g.rows.forEach((r, y) => [...r].forEach((p, x) => { if (p === '#') assert.equal(b.rows[y][x], '#'); }));
});

test('umlauts: base letter metrics kept, dots centred in the bold cut', () => {
  const rowAt = (g, y) => g.rows[CAP - 1 + (g.up || 0) - y]; // y measured up from the baseline
  for (const [u, base] of [['Ä', 'A'], ['Ö', 'O'], ['Ü', 'U']]) {
    const g = GLYPHS[u], b = GLYPHS[base];
    assert.equal(g.w, b.w, u);
    assert.equal(rowAt(g, 0), rowAt(b, 0), `${u} baseline row`);
  }
  assert.equal(rowAt(GLYPHS['Ä'], 3), '#####', 'Ä crossbar level with A');
  assert.equal(rowAt(GLYPHS.A, 3), '#####');
  for (const [u, base] of [['ä', 'a'], ['ö', 'o'], ['ü', 'u']]) {
    assert.deepEqual(GLYPHS[u].rows.slice(2), GLYPHS[base].rows.slice(2), u);
    assert.equal(GLYPHS[u].rows[1], '.#.#.', `${u} dots on the body`);
  }
  for (const u of 'äöüÄÖÜ') {
    const g = GLYPHS[u];
    assert.equal(boldGlyph(g).rows[g.rows.indexOf('.#.#.')], '##..##', `${u} bold dots`);
  }
});

test('glyphRects covers exactly the ink pixels', () => {
  for (const ch of ['A', 'g', '@', '★', '%']) {
    const rows = GLYPHS[ch].rows, ink = new Set(), drawn = new Set();
    rows.forEach((r, y) => [...r].forEach((p, x) => { if (p === '#') ink.add(x + ',' + (CAP - 1 - y)); }));
    for (const r of glyphRects(rows)) {
      for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) {
        assert.ok(!drawn.has(x + ',' + y), `overlap in ${ch}`); drawn.add(x + ',' + y);
      }
    }
    assert.deepEqual([...drawn].sort(), [...ink].sort(), ch);
  }
});

// Minimal sfnt reader for the checks below.
function readFont(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint16(4), tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16, tag = String.fromCharCode(...bytes.slice(o, o + 4));
    tables[tag] = { sum: v.getUint32(o + 4), off: v.getUint32(o + 8), len: v.getUint32(o + 12) };
  }
  return { v, tables };
}
const sum = (bytes, off, len) => {
  let s = 0;
  for (let i = 0; i < len; i += 4) s = (s + (((bytes[off + i] << 24) | ((bytes[off + i + 1] || 0) << 16) | ((bytes[off + i + 2] || 0) << 8) | (bytes[off + i + 3] || 0)) >>> 0)) >>> 0;
  return s;
};

for (const bold of [false, true]) {
  test(`TrueType ${bold ? 'bold' : 'regular'}: tables, checksums, cmap`, () => {
    const bytes = buildTTF({ bold });
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4); padded.set(bytes);
    const { v, tables } = readFont(padded);
    for (const t of ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']) assert.ok(tables[t], t);
    for (const [tag, t] of Object.entries(tables)) {
      if (tag === 'head') continue; // holds checkSumAdjustment
      assert.equal(sum(padded, t.off, t.len), t.sum, `${tag} checksum`);
    }
    assert.equal(sum(padded, 0, padded.length), 0xb1b0afba, 'whole-font checksum');
    assert.equal(v.getUint32(tables.head.off + 12), 0x5f0f3cf5, 'head magic');
    const numGlyphs = v.getUint16(tables.maxp.off + 4);
    assert.equal(numGlyphs, Object.keys(GLYPHS).length + 1);
    // cmap format 4: every glyph character maps to a non-zero glyph id
    const sub = tables.cmap.off + v.getUint32(tables.cmap.off + 8);
    assert.equal(v.getUint16(sub), 4);
    const seg2 = v.getUint16(sub + 6), ends = sub + 14, starts = ends + seg2 + 2, deltas = starts + seg2;
    const lookup = cp => {
      for (let i = 0; i < seg2 / 2; i++) {
        if (cp <= v.getUint16(ends + i * 2)) {
          if (cp < v.getUint16(starts + i * 2)) return 0;
          return (cp + v.getUint16(deltas + i * 2)) & 0xffff;
        }
      }
      return 0;
    };
    const gids = new Set();
    for (const ch of Object.keys(GLYPHS)) { const g = lookup(ch.codePointAt(0)); assert.ok(g > 0 && g < numGlyphs, ch); gids.add(g); }
    assert.equal(gids.size, Object.keys(GLYPHS).length, 'one glyph per character');
  });
}

test('committed font files match the glyph table (run `npm run font` after editing src/pixelfont.js)', () => {
  for (const bold of [false, true]) {
    const file = new URL(`../assets/fonts/rb-pixel${bold ? '-bold' : ''}.ttf`, import.meta.url);
    assert.deepEqual(new Uint8Array(readFileSync(file)), buildTTF({ bold }));
  }
});

test('sprites are rectangular 1-bit art', () => {
  for (const [name, rows] of Object.entries(SPRITES)) assert.ok(rectangular(rows), name);
  for (let i = 0; i <= 5; i++) assert.ok(rectangular(signal(i)));
  for (let i = 0; i <= 4; i++) assert.ok(rectangular(battery(i)));
  assert.ok(rectangular(ringing(0)) && rectangular(ringing(1)));
  assert.notDeepEqual(ringing(0), ringing(1));
  const ink = rows => rows.join('').split('#').length - 1;
  assert.ok(ink(signal(5)) > ink(signal(1)) && ink(battery(4)) > ink(battery(0)));
  assert.match(spriteSVG(['#.', '##']), /<rect x="0" y="1" width="2" height="1"\/>/);
});

test('song pictures: 72x28 picture messages, deterministic per song', () => {
  const seen = new Set();
  for (const s of SONGS) {
    const rows = coverRows(s.id, s.category);
    assert.equal(rows.length, COVER_H); assert.equal(rows[0].length, COVER_W);
    assert.ok(rectangular(rows), s.id);
    assert.deepEqual(rows, coverRows(s.id, s.category));
    const ink = rows.join('').split('#').length - 1;
    assert.ok(ink > 60 && ink < COVER_W * COVER_H * 0.6, `${s.id} ink ${ink}`);
    seen.add(rows.join('|'));
  }
  assert.equal(seen.size, SONGS.length, 'every song gets its own picture');
  assert.notDeepEqual(coverRows('ode', 'classical'), coverRows('tetris', 'videogame'));
});

test('settings.voice defaults to the buzzer and only accepts known voices', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  store.set('ringbeat.v1', JSON.stringify({ voice: 'kazoo' }));
  const a = await import('../src/settings.js?bad');
  assert.equal(a.settings.voice, 'buzzer');
  store.set('ringbeat.v1', JSON.stringify({ voice: 'smooth' }));
  const b = await import('../src/settings.js?smooth');
  assert.equal(b.settings.voice, 'smooth');
  store.set('ringbeat.v1', JSON.stringify({ voice: 'gameboy' }));
  const c = await import('../src/settings.js?gameboy');
  assert.equal(c.settings.voice, 'gameboy');
  delete globalThis.localStorage;
});
