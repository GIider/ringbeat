// Hand-drawn 5x7 LCD pixel font (the look of a late-90s phone menu).
// scripts/build-font.mjs turns this table into TrueType (regular + a bold cut), so the DOM and the canvas
// share one font. Run `npm run font` after editing.
//
// Format of FONT below: one drawing per glyph, a blank line between glyphs.
//   @<char> [raised] [dotted]      header; `@space` and `@backtick` name the two characters that can't be written literally
//   .###.                          rows top-down from the cap line, '#' = ink, '.' = empty; all rows of a glyph are equally wide
//   // ...                         comment line
// 7 rows sit on the baseline; rows 8-9 descend (g j p q y). Width is per glyph; the advance is width + 1.
// Flags:
//   raised  first row sits in the headroom row above the cap line (capital umlauts)
//   dotted  has a row of two separate dots ('.#.#.'): the bold cut widens every pixel, which would fuse them into a bar

export const CAP = 7;      // rows above the baseline
export const DESC = 2;     // rows below it
export const ASC = 8;      // ascent incl. one row of headroom (line = ASC + DESC = 10 pixels)

const FONT = String.raw`
@space
...
...
...
...
...
...
...

@A
.###.
#...#
#...#
#####
#...#
#...#
#...#

@B
####.
#...#
#...#
####.
#...#
#...#
####.

@C
.###.
#...#
#....
#....
#....
#...#
.###.

@D
####.
#...#
#...#
#...#
#...#
#...#
####.

@E
#####
#....
#....
####.
#....
#....
#####

@F
#####
#....
#....
####.
#....
#....
#....

@G
.###.
#...#
#....
#.###
#...#
#...#
.####

@H
#...#
#...#
#...#
#####
#...#
#...#
#...#

@I
###
.#.
.#.
.#.
.#.
.#.
###

@J
..###
...#.
...#.
...#.
#..#.
#..#.
.##..

@K
#...#
#..#.
#.#..
##...
#.#..
#..#.
#...#

@L
#....
#....
#....
#....
#....
#....
#####

@M
#...#
##.##
#.#.#
#.#.#
#...#
#...#
#...#

@N
#...#
#...#
##..#
#.#.#
#..##
#...#
#...#

@O
.###.
#...#
#...#
#...#
#...#
#...#
.###.

@P
####.
#...#
#...#
####.
#....
#....
#....

@Q
.###.
#...#
#...#
#...#
#.#.#
#..#.
.##.#

@R
####.
#...#
#...#
####.
#.#..
#..#.
#...#

@S
.####
#....
#....
.###.
....#
....#
####.

@T
#####
..#..
..#..
..#..
..#..
..#..
..#..

@U
#...#
#...#
#...#
#...#
#...#
#...#
.###.

@V
#...#
#...#
#...#
#...#
#...#
.#.#.
..#..

@W
#...#
#...#
#...#
#.#.#
#.#.#
#.#.#
.#.#.

@X
#...#
#...#
.#.#.
..#..
.#.#.
#...#
#...#

@Y
#...#
#...#
.#.#.
..#..
..#..
..#..
..#..

@Z
#####
....#
...#.
..#..
.#...
#....
#####

@a
.....
.....
.###.
....#
.####
#...#
.####

@b
#....
#....
#.##.
##..#
#...#
#...#
####.

@c
.....
.....
.###.
#....
#....
#...#
.###.

@d
....#
....#
.##.#
#..##
#...#
#...#
.####

@e
.....
.....
.###.
#...#
#####
#....
.###.

@f
..##
.#..
.#..
###.
.#..
.#..
.#..

@g
.....
.....
.####
#...#
#...#
.####
....#
....#
.###.

@h
#....
#....
#.##.
##..#
#...#
#...#
#...#

@i
.#.
...
##.
.#.
.#.
.#.
###

@j
...#
....
..##
...#
...#
...#
...#
#..#
.##.

@k
#...
#...
#..#
#.#.
##..
#.#.
#..#

@l
##.
.#.
.#.
.#.
.#.
.#.
###

@m
.....
.....
##.#.
#.#.#
#.#.#
#...#
#...#

@n
.....
.....
#.##.
##..#
#...#
#...#
#...#

@o
.....
.....
.###.
#...#
#...#
#...#
.###.

@p
.....
.....
####.
#...#
#...#
####.
#....
#....
#....

@q
.....
.....
.####
#...#
#...#
.####
....#
....#
....#

@r
.....
.....
#.##.
##..#
#....
#....
#....

@s
.....
.....
.####
#....
.###.
....#
####.

@t
.#..
.#..
###.
.#..
.#..
.#.#
..#.

@u
.....
.....
#...#
#...#
#...#
#..##
.##.#

@v
.....
.....
#...#
#...#
#...#
.#.#.
..#..

@w
.....
.....
#...#
#...#
#.#.#
#.#.#
.#.#.

@x
.....
.....
#...#
.#.#.
..#..
.#.#.
#...#

@y
.....
.....
#...#
#...#
#...#
.####
....#
....#
.###.

@z
.....
.....
#####
...#.
..#..
.#...
#####

@0
.###.
#...#
#..##
#.#.#
##..#
#...#
.###.

@1
..#..
.##..
..#..
..#..
..#..
..#..
.###.

@2
.###.
#...#
....#
...#.
..#..
.#...
#####

@3
#####
...#.
..#..
...#.
....#
#...#
.###.

@4
...#.
..##.
.#.#.
#..#.
#####
...#.
...#.

@5
#####
#....
####.
....#
....#
#...#
.###.

@6
..##.
.#...
#....
####.
#...#
#...#
.###.

@7
#####
....#
...#.
..#..
.#...
.#...
.#...

@8
.###.
#...#
#...#
.###.
#...#
#...#
.###.

@9
.###.
#...#
#...#
.####
....#
...#.
.##..

@!
#
#
#
#
#
.
#

@"
#.#
#.#
...
...
...
...
...

@#
.#.#.
.#.#.
#####
.#.#.
#####
.#.#.
.#.#.

@$
..#..
.####
#.#..
.###.
..#.#
####.
..#..

@%
##..#
##..#
...#.
..#..
.#...
#..##
#..##

@&
.##..
#..#.
#.#..
.#...
#.#.#
#..#.
.##.#

@'
#
#
.
.
.
.
.

@(
..#
.#.
#..
#..
#..
.#.
..#

@)
#..
.#.
..#
..#
..#
.#.
#..

@*
.....
..#..
#.#.#
.###.
#.#.#
..#..
.....

@+
.....
..#..
..#..
#####
..#..
..#..
.....

@,
..
..
..
..
..
.#
.#
#.

@-
....
....
....
####
....
....
....

@.
.
.
.
.
.
.
#

@/
....#
....#
...#.
..#..
.#...
#....
#....

@:
.
.
#
.
.
#
.

@;
..
..
.#
..
..
.#
.#
#.

@<
...#
..#.
.#..
#...
.#..
..#.
...#

@=
.....
.....
#####
.....
#####
.....
.....

@>
#...
.#..
..#.
...#
..#.
.#..
#...

@?
.###.
#...#
....#
...#.
..#..
.....
..#..

@@
.###.
#...#
#.###
#.#.#
#.##.
#....
.####

@[
###
#..
#..
#..
#..
#..
###

@\
#....
#....
.#...
..#..
...#.
....#
....#

@]
###
..#
..#
..#
..#
..#
###

@^
..#..
.#.#.
#...#
.....
.....
.....
.....

@_
.....
.....
.....
.....
.....
.....
#####

@backtick
#.
.#
..
..
..
..
..

@{
..#
.#.
.#.
#..
.#.
.#.
..#

@|
#
#
#
#
#
#
#

@}
#..
.#.
.#.
..#
.#.
.#.
#..

@~
.....
.....
.#...
#.#.#
...#.
.....
.....

// ---- German ----

// capitals: dots one row above the cap line (see RAISED), a gap row, then a 6-row body (Ä's crossbar level with A's)
@Ä raised dotted
.#.#.
.....
.###.
#...#
#####
#...#
#...#
#...#

@Ö raised dotted
.#.#.
.....
.###.
#...#
#...#
#...#
#...#
.###.

@Ü raised dotted
.#.#.
.....
#...#
#...#
#...#
#...#
#...#
.###.

// lowercase: dots sit directly on the x-height body
@ä dotted
.....
.#.#.
.###.
....#
.####
#...#
.####

@ö dotted
.....
.#.#.
.###.
#...#
#...#
#...#
.###.

@ü dotted
.....
.#.#.
#...#
#...#
#...#
#..##
.##.#

@ß
.##..
#..#.
#..#.
#.#..
#..#.
#...#
#.##.

// ---- symbols used by the UI ----
@·
.
.
.
#
.
.
.

@–
.....
.....
.....
#####
.....
.....
.....

@—
.......
.......
.......
#######
.......
.......
.......

@…
.....
.....
.....
.....
.....
.....
#.#.#

@×
.....
#...#
.#.#.
..#..
.#.#.
#...#
.....

@→
.....
...#.
....#
#####
....#
...#.
.....

@←
.....
.#...
#....
#####
#....
.#...
.....

@↑
..#..
.###.
#.#.#
..#..
..#..
..#..
..#..

@↓
..#..
..#..
..#..
..#..
#.#.#
.###.
..#..

@♪
..#..
..##.
..#.#
..#..
###..
###..
.....

@♫
.####
.#..#
.#..#
.#..#
##.##
##.##
.....

@★
..#..
.###.
#####
.###.
.#.#.
#...#
.....

@☆
..#..
.#.#.
##.##
#...#
.#.#.
#.#.#
.....

@◄
...#
..##
.###
####
.###
..##
...#

@►
#...
##..
###.
####
###.
##..
#...

@▶
#...
##..
###.
####
###.
##..
#...

@▲
.....
.....
..#..
.###.
#####
.....
.....

@▼
.....
.....
#####
.###.
..#..
.....
.....

@◆
.....
..#..
.###.
#####
.###.
..#..
.....

@■
.....
#####
#####
#####
#####
#####
.....

@▮
###
###
###
###
###
###
###

@▯
###
#.#
#.#
#.#
#.#
#.#
###

@✓
.....
....#
...##
#.##.
###..
.#...
.....

@✗
.....
#...#
.#.#.
..#..
.#.#.
#...#
.....

@⚠
..#..
..#..
.#.#.
.#.#.
#...#
#.#.#
#####

@❚
.##.
.##.
.##.
.##.
.##.
.##.
.##.
`;

const NAMES = { space: ' ', backtick: '`' };
const FLAGS = new Set(['raised', 'dotted']);

// Parses the FONT text into { char: { w, rows: string[], up?, dotted? } }; throws on a malformed glyph.
export function parseFont(text) {
  const glyphs = {};
  let name = null, g = null;
  const close = () => {
    if (!g) return;
    if (!g.rows.length) throw new Error(`glyph '${name}' has no rows`);
    g.w = g.rows[0].length;
    for (const r of g.rows) {
      if (!/^[#.]+$/.test(r)) throw new Error(`glyph '${name}': row '${r}' may only contain '#' and '.'`);
      if (r.length !== g.w) throw new Error(`glyph '${name}': row '${r}' is ${r.length} wide, expected ${g.w}`);
    }
    g = null;
  };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//')) continue;
    if (!t) { close(); continue; }
    if (t[0] === '@') {
      close();
      const [token, ...flags] = t.slice(1).split(/\s+/);
      const ch = NAMES[token] ?? token;
      if ([...ch].length !== 1) throw new Error(`bad glyph header '${t}'`);
      if (ch in glyphs) throw new Error(`duplicate glyph '${ch}'`);
      for (const f of flags) if (!FLAGS.has(f)) throw new Error(`glyph '${ch}': unknown flag '${f}'`);
      name = ch;
      g = { w: 0, rows: [] };
      if (flags.includes('raised')) g.up = 1;
      if (flags.includes('dotted')) g.dotted = true;
      glyphs[ch] = g;
    } else {
      if (!g) throw new Error(`row '${t}' outside a glyph`);
      g.rows.push(t);
    }
  }
  close();
  return glyphs;
}

// { char: { w, rows: string[], up?, dotted? } }
export const GLYPHS = parseFont(FONT);
export const RAISED = new Set(Object.keys(GLYPHS).filter(ch => GLYPHS[ch].up));

// Bold cut: every ink pixel also inks its right neighbour (glyphs grow one column).
export function boldGlyph(g) {
  const rows = g.rows.map(r => {
    let out = '';
    for (let x = 0; x <= r.length; x++) out += (r[x] === '#' || r[x - 1] === '#') ? '#' : '.';
    return out;
  });
  if (g.dotted) {
    const i = g.rows.indexOf('.#.#.');
    rows[i] = '##..##'; // centred on the 6-wide bold body
    // Lowercase dots sit right on the letter; bold, they would merge with its top or stems (ü), so they rise one row.
    if (i > 0 && !/#/.test(rows[i - 1])) { rows[i - 1] = rows[i]; rows[i] = '.'.repeat(rows[i].length); }
  }
  return g.up ? { w: g.w + 1, rows, up: g.up, dotted: g.dotted } : { w: g.w + 1, rows, dotted: g.dotted };
}

export const FAMILY = 'RB Pixel';
