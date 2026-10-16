// Builds assets/fonts/rb-pixel{,-bold}.ttf from the glyph table in src/pixelfont.js.
// A minimal TrueType writer: every glyph is a set of axis-aligned rectangles (pixel runs merged
// horizontally, then stacked vertically), so it renders crisp at multiples of 10px.
//   npm run font
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLYPHS, boldGlyph, ASC, DESC, CAP, FAMILY } from '../src/pixelfont.js';

const PX = 100;              // font units per pixel; unitsPerEm = 10 px, so font-size 10n px -> n px per pixel
const UPM = PX * (ASC + DESC);

// Pixel rows -> rectangles {x, y, w, h} in pixel units, y measured up from the baseline.
export function glyphRects(rows, up = 0) {
  const runs = [];
  rows.forEach((row, r) => {
    for (let x = 0; x < row.length;) {
      if (row[x] !== '#') { x++; continue; }
      let e = x;
      while (row[e] === '#') e++;
      runs.push({ r, x, w: e - x });
      x = e;
    }
  });
  // merge identical runs in consecutive rows
  const rects = [];
  const open = new Map();
  for (const run of runs) {
    const key = run.x + ':' + run.w, prev = open.get(key);
    if (prev && prev.r1 === run.r - 1) { prev.r1 = run.r; continue; }
    const rect = { x: run.x, w: run.w, r0: run.r, r1: run.r };
    open.set(key, rect); rects.push(rect);
  }
  return rects.map(k => ({ x: k.x, w: k.w, y: CAP - 1 - k.r1 + up, h: k.r1 - k.r0 + 1 }));
}

class Buf {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { return this.u8(v >> 8).u8(v); }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { return this.u16(v >>> 16).u16(v & 65535); }
  i64(v) { return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0); }
  tag(s) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  bytes(b) { for (const x of b) this.u8(x); return this; }
  pad4() { while (this.a.length % 4) this.u8(0); return this; }
  get length() { return this.a.length; }
  out() { return Uint8Array.from(this.a); }
}

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + ((bytes[i] << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0))) >>> 0;
  }
  return sum;
}

export function buildTTF({ family = FAMILY, bold = false } = {}) {
  const chars = Object.keys(GLYPHS).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  // glyph 0 = .notdef (hollow box)
  const notdef = { w: 5, rows: ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'] };
  const glyphs = [notdef, ...chars.map(c => GLYPHS[c])].map(g => (bold && g !== notdef ? boldGlyph(g) : g));

  // ---- glyf / loca / hmtx ----
  const glyf = new Buf(), loca = [], hmtx = new Buf();
  let maxPoints = 0, maxContours = 0, xMin = 0, yMin = 0, xMax = 0, yMax = 0, advMax = 0, minRsb = 1e9, sumAdv = 0;
  for (const g of glyphs) {
    loca.push(glyf.length);
    const adv = (g.w + 1) * PX;
    advMax = Math.max(advMax, adv); sumAdv += adv;
    const rects = glyphRects(g.rows, g.up || 0);
    if (!rects.length) { hmtx.u16(adv).i16(0); continue; }
    let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
    for (const r of rects) {
      gx0 = Math.min(gx0, r.x * PX); gy0 = Math.min(gy0, r.y * PX);
      gx1 = Math.max(gx1, (r.x + r.w) * PX); gy1 = Math.max(gy1, (r.y + r.h) * PX);
    }
    xMin = Math.min(xMin, gx0); yMin = Math.min(yMin, gy0); xMax = Math.max(xMax, gx1); yMax = Math.max(yMax, gy1);
    minRsb = Math.min(minRsb, adv - gx1);
    maxContours = Math.max(maxContours, rects.length); maxPoints = Math.max(maxPoints, rects.length * 4);
    glyf.i16(rects.length).i16(gx0).i16(gy0).i16(gx1).i16(gy1);
    rects.forEach((r, i) => glyf.u16(i * 4 + 3));        // endPtsOfContours
    glyf.u16(0);                                           // instructionLength
    const pts = [];
    for (const r of rects) {                               // clockwise (y up): BL, TL, TR, BR
      const x0 = r.x * PX, y0 = r.y * PX, x1 = (r.x + r.w) * PX, y1 = (r.y + r.h) * PX;
      pts.push([x0, y0], [x0, y1], [x1, y1], [x1, y0]);
    }
    for (let i = 0; i < pts.length; i++) glyf.u8(1);       // on-curve, int16 deltas
    let px = 0; for (const [x] of pts) { glyf.i16(x - px); px = x; }
    let py = 0; for (const [, y] of pts) { glyf.i16(y - py); py = y; }
    glyf.pad4();
    hmtx.u16(adv).i16(gx0);
  }
  loca.push(glyf.length);
  const locaB = new Buf(); for (const o of loca) locaB.u32(o);

  // ---- cmap (format 4, one segment per run of consecutive codepoints) ----
  const segs = [];
  chars.forEach((c, i) => {
    const cp = c.codePointAt(0), gid = i + 1, last = segs[segs.length - 1];
    if (last && last.end === cp - 1 && last.gid + (cp - last.start) === gid) last.end = cp;
    else segs.push({ start: cp, end: cp, gid });
  });
  segs.push({ start: 0xffff, end: 0xffff, gid: 0, last: true });
  const n = segs.length, sr = 2 * 2 ** Math.floor(Math.log2(n));
  const sub = new Buf();
  sub.u16(4).u16(16 + n * 8).u16(0).u16(n * 2).u16(sr).u16(Math.log2(sr / 2)).u16(n * 2 - sr);
  for (const s of segs) sub.u16(s.end);
  sub.u16(0);
  for (const s of segs) sub.u16(s.start);
  for (const s of segs) sub.u16(s.last ? 1 : (s.gid - s.start + 65536) % 65536);
  for (const s of segs) sub.u16(0);
  const cmap = new Buf().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.a);

  // ---- name ----
  const style = bold ? 'Bold' : 'Regular';
  const names = { 1: family, 2: style, 3: `${family} ${style} 1.0`, 4: `${family}${bold ? ' Bold' : ''}`,
    5: 'Version 1.0', 6: (family + '-' + style).replace(/\s/g, '') };
  const strs = Object.entries(names).map(([id, s]) => {
    const b = []; for (const ch of s) { const c = ch.charCodeAt(0); b.push(c >> 8, c & 255); }
    return { id: +id, b };
  });
  const name = new Buf().u16(0).u16(strs.length).u16(6 + strs.length * 12);
  let off = 0;
  for (const s of strs) { name.u16(3).u16(1).u16(0x409).u16(s.id).u16(s.b.length).u16(off); off += s.b.length; }
  for (const s of strs) name.bytes(s.b);

  // ---- fixed tables ----
  const asc = ASC * PX, desc = DESC * PX, cps = chars.map(c => c.codePointAt(0));
  const head = new Buf().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(UPM)
    .i64(3_000_000_000).i64(3_000_000_000).i16(xMin).i16(yMin).i16(xMax).i16(yMax)
    .u16(bold ? 1 : 0).u16(8).i16(2).i16(1).i16(0);
  const hhea = new Buf().u32(0x00010000).i16(asc).i16(-desc).i16(0).u16(advMax).i16(0).i16(minRsb).i16(xMax)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length);
  const maxp = new Buf().u32(0x00010000).u16(glyphs.length).u16(maxPoints).u16(maxContours).u16(0).u16(0)
    .u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  const os2 = new Buf().u16(4).i16(Math.round(sumAdv / glyphs.length)).u16(bold ? 700 : 400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(300).i16(0)
    .bytes([2, 0, 6, 9, 0, 0, 0, 0, 0, 0])                 // panose: decorative-ish, monospace-ish
    .u32(1).u32(0).u32(0).u32(0).tag('RBT ').u16(bold ? 0x20 : 0x40)
    .u16(Math.min(...cps)).u16(Math.min(0xffff, Math.max(...cps)))
    .i16(asc).i16(-desc).i16(0).u16(asc).u16(desc).u32(1).u32(0)
    .i16(5 * PX).i16(CAP * PX).u16(0).u16(32).u16(1);
  const post = new Buf().u32(0x00030000).u32(0).i16(-PX).i16(PX).u32(0).u32(0).u32(0).u32(0).u32(0);

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca: locaB, maxp, name, post };
  const tags = Object.keys(tables).sort();
  const nt = tags.length, esr = 16 * 2 ** Math.floor(Math.log2(nt));
  const font = new Buf().u32(0x00010000).u16(nt).u16(esr).u16(Math.log2(esr / 16)).u16(nt * 16 - esr);
  let offset = 12 + nt * 16;
  const bodies = [];
  let headOffset = 0;
  for (const t of tags) {
    const b = tables[t].out();
    font.tag(t).u32(checksum(b)).u32(offset).u32(b.length);
    if (t === 'head') headOffset = offset;
    bodies.push(b);
    offset += Math.ceil(b.length / 4) * 4;
  }
  for (const b of bodies) font.bytes(b).pad4();
  const out = font.out();
  const adj = (0xb1b0afba - checksum(out)) >>> 0;
  out[headOffset + 8] = adj >>> 24; out[headOffset + 9] = (adj >>> 16) & 255;
  out[headOffset + 10] = (adj >>> 8) & 255; out[headOffset + 11] = adj & 255;
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../assets/fonts/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const bold of [false, true]) {
    const file = new URL(bold ? 'rb-pixel-bold.ttf' : 'rb-pixel.ttf', dir);
    const bytes = buildTTF({ bold });
    writeFileSync(file, bytes);
    console.log(`${fileURLToPath(file)}  ${bytes.length} bytes`);
  }
}
