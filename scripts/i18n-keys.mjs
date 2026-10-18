// Lists every English source string the app can show, so translations can be checked for gaps:
//   node scripts/i18n-keys.mjs          print keys missing from a language (default de)
//   node scripts/i18n-keys.mjs --all    print every key
// Static scan: tr('..') / tn(n, '..', '..') calls and data-i18n markup, plus the data tables that hold UI text.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../src/songs.js';
import { SORTS } from '../src/listview.js';
import { BOARD_SORTS } from '../src/boardsview.js';
import { STAGES } from '../src/tutorial.js';
import { MESSAGES } from '../src/changelog.js';
import { SFX_CATEGORIES } from '../src/sfx-registry.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => fs.readFileSync(root + f, 'utf8');
const unesc = s => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const LIT = String.raw`(['"\`])((?:\\.|(?!\1)[^\\])*)\1`;

// `singulars` also returns tn()'s singular forms: they are shown in English but are not dictionary keys.
export function collectKeys({ singulars = false } = {}) {
  const keys = new Set();
  for (const f of fs.readdirSync(root + 'src').filter(n => n.endsWith('.js'))) {
    const src = read('src/' + f);
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:tr|tm|t)\(\s*${LIT}`, 'g'))) keys.add(unesc(m[2]));
    for (const line of src.split('\n')) {
      if (!/\b(?:tr|toast|tm)\(|dataset\.soft/.test(line)) continue;
      for (const m of line.matchAll(/\?\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*:\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g)) { keys.add(unesc(m[2])); keys.add(unesc(m[4])); }
    }
    for (const m of src.matchAll(new RegExp(String.raw`dataset\.soft(?:Left|Right)\s*=\s*(?:[^'"\`;]*\?\s*)?${LIT}`, 'g'))) keys.add(unesc(m[2]));
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:toast|openMySongs)\(\s*${LIT}`, 'g'))) keys.add(unesc(m[2]));
    for (const m of src.matchAll(new RegExp(String.raw`\btn\([^,]+,\s*${LIT}\s*,\s*${LIT}`, 'g'))) {
      keys.add(unesc(m[4]));
      if (singulars) keys.add(unesc(m[2]));
    }
  }
  const html = read('index.html') + read('boards.html');
  for (const m of html.matchAll(/<(\w+)([^>]*)>/g)) {
    const attrs = m[2];
    const dt = /data-title="([^"]*)"/.exec(attrs), sl = /data-soft-left="([^"]*)"/.exec(attrs), sr = /data-soft-right="([^"]*)"/.exec(attrs);
    for (const x of [dt, sl, sr]) if (x && x[1]) keys.add(decode(x[1]));
    const ia = /data-i18n-attr="([^"]*)"/.exec(attrs);
    if (ia) for (const a of ia[1].split(',')) { const v = new RegExp(`\\s${a}="([^"]*)"`).exec(attrs); if (v && /[A-Za-z]{2}/.test(v[1])) keys.add(decode(v[1])); }
  }
  for (const m of html.matchAll(/<(\w+)[^>]*\sdata-i18n(?:-html)?(?:="[^"]*")?(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/g)) {
    const inner = decode(m[2].trim());
    if (inner) keys.add(inner);
  }
  for (const c of CATEGORIES) keys.add(c.label);
  for (const s of [...SORTS, ...BOARD_SORTS]) keys.add(s.label);
  for (const st of STAGES) { keys.add(st.title); keys.add(st.text); }
  for (const m of MESSAGES) { keys.add(m.title); keys.add(m.body); }
  // Words the code capitalises or looks up by name (cap(), table rows, enums).
  const main = read('src/main.js');
  for (const block of [/const MENU = \[([\s\S]*?)\n\];/, /const MOD_HINTS = \{([\s\S]*?)\n\};/, /const JUDGE_LABELS = \{([^}]*)\}/, /const SLOT_NAMES = \[([^\]]*)\]/, /const STAT_PAGES = \[([^\]]*)\]/]) {
    const b = block.exec(main);
    if (!b) throw new Error('i18n-keys: block not found ' + block);
    for (const m of b[1].matchAll(/:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1|(?:^|[\[,]\s*)(['"`])((?:\\.|(?!\3)[^\\])*)\3/g)) {
      const v = unesc(m[2] ?? m[4]);
      if (/^[a-z]+$/.test(v) || /^m-/.test(v)) continue; // ids
      if (/[A-Za-z]{2}/.test(v) && !/^(tones|mysongs|stats|messages|profile|settings|normal|off|strict|lenient)$/.test(v)) keys.add(v);
    }
  }
  for (const w of ['Normal', 'All', 'Custom', 'Recent', 'Unplayed', 'Favorites', 'Perfect', 'Great', 'Good', 'Miss', 'Off', 'Buzzer', 'Smooth', 'Untitled',
    'Text', 'Link', 'My song', 'Could not duplicate: storage unavailable', 'Deleted',
    // parser / validation messages (src/rtttl.js, src/mysongs.js), translated by pattern
    'No notes section found (expected name:defaults:notes)', 'No valid notes found', 'Missing defaults section; using d=4,o=6,b=63',
    'Ignored default "{kv}"', 'Invalid default {kv}; using {fb}', 'Skipped unknown token "{tok}"', 'Skipped "{tok}": bad duration {dur}',
    'Skipped "{tok}": octave {oct} out of range 4-7', 'Nothing to save', 'Too long ({len}/{max} characters)', 'No notes long enough to play',
    'PERFECT', 'GREAT', 'GOOD', 'MISS', 'Clearing memory...', 'Memory cleared', 'Just kidding.', 'Failed', 'Results']) keys.add(w);
  for (const c of SFX_CATEGORIES) keys.add(c); // Settings › Developer › Sound library headings
  return [...keys].filter(k => /[A-Za-zÄÖÜäöü]{2}/.test(k)).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lang = process.argv.find(a => /^--lang=/.test(a))?.slice(7) || 'de';
  const { DICTS } = await import('../src/i18n.js');
  const all = collectKeys();
  const out = process.argv.includes('--all') ? all : all.filter(k => DICTS[lang][k] === undefined);
  console.log(out.join('\n'));
  console.error(`${out.length} of ${all.length} keys${process.argv.includes('--all') ? '' : ` missing in ${lang}`}`);
}
