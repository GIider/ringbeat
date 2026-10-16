import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, setLang, getLang, t, tn, tm, fmt, DICTS, LANGS } from '../src/i18n.js';
import { collectKeys } from '../scripts/i18n-keys.mjs';
import { GLYPHS } from '../src/pixelfont.js';

test.afterEach(() => setLang('en'));

test('detect: first supported browser language, else English', () => {
  assert.equal(detect(['de-AT', 'en']), 'de');
  assert.equal(detect(['fr-FR', 'de']), 'de');
  assert.equal(detect(['en-US']), 'en');
  assert.equal(detect(['fr', 'ja']), 'en');
  assert.equal(detect([]), 'en');
  assert.equal(detect(undefined), 'en');
  assert.equal(detect(['DE_de']), 'de');
});

test('t: English passes through, German translates, unknown keys fall back, params fill', () => {
  assert.equal(t('Back'), 'Back');
  setLang('de');
  assert.equal(getLang(), 'de');
  assert.equal(t('Back'), 'Zurück');
  assert.equal(t('Not a key at all'), 'Not a key at all');
  assert.equal(t('Rank #{n}', { n: 3 }), 'Platz 3');
  assert.equal(t('Unfilled {x}', {}), 'Unfilled {x}');
  setLang('xx');
  assert.equal(getLang(), 'de', 'unknown language is ignored');
});

test('tn: plural forms per language', () => {
  assert.equal(tn(1, '{n} note', '{n} notes'), '1 note');
  assert.equal(tn(2, '{n} note', '{n} notes'), '2 notes');
  setLang('de');
  assert.equal(tn(1, '{n} note', '{n} notes'), '1 Note');
  assert.equal(tn(5, '{n} note', '{n} notes'), '5 Noten');
});

test('tm: translates messages built from a template', () => {
  setLang('de');
  assert.equal(tm('Skipped unknown token "zz"'), 'Unbekanntes Element "zz" übersprungen');
  assert.equal(tm('Too long (9000/8000 characters)'), 'Zu lang (9000/8000 Zeichen)');
  assert.equal(tm('Back'), 'Zurück');
  assert.equal(tm('already German or unknown'), 'already German or unknown');
});

test('fmt: locale-aware numbers', () => {
  assert.equal(fmt(1234.5, 1), '1,234.5');
  setLang('de');
  assert.equal(fmt(1234.5, 1), '1.234,5');
});

const SOURCE = 'en'; // the English text is the key: no dictionary needed, but every string must still render
const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
const noGlyph = s => [...s].filter(ch => ch !== '\n' && !GLYPHS[ch] && !GLYPHS[ch.toUpperCase()]);

test('every source string in the app has a translation in every other language', () => {
  const keys = collectKeys();
  for (const code of Object.keys(LANGS).filter(c => c !== SOURCE)) {
    assert.deepEqual(keys.filter(k => DICTS[code][k] === undefined), [], `${code}: missing translations`);
  }
});

test('no language has stale or malformed entries', () => {
  const used = new Set(collectKeys());
  for (const code of Object.keys(LANGS)) {
    const stale = Object.keys(DICTS[code]).filter(k => !used.has(k));
    assert.deepEqual(stale, [], `${code}: entries nothing asks for (remove or add to scripts/i18n-keys.mjs)`);
    for (const [k, v] of Object.entries(DICTS[code])) {
      const forms = Array.isArray(v) ? v : [v];
      for (const f of forms) assert.equal(holes(f), holes(k), `${code}: placeholders differ in ${JSON.stringify(k)}`);
      if (Array.isArray(v)) assert.equal(v.length, 2, `${code}: plural needs [one, other]: ${k}`);
    }
  }
});

test('every English source string, plural singulars included, has a glyph in the LCD font', () => {
  const bad = collectKeys({ singulars: true }).filter(k => noGlyph(k).length).map(k => `${JSON.stringify(noGlyph(k).join(''))} in ${JSON.stringify(k)}`);
  assert.deepEqual(bad, []);
});

test('every character of every translation has a glyph in the LCD font', () => {
  for (const code of Object.keys(LANGS)) {
    for (const [k, v] of Object.entries(DICTS[code])) {
      const missing = noGlyph([].concat(v).join(''));
      assert.deepEqual(missing, [], `${code}: no glyph in ${JSON.stringify(k)}`);
    }
  }
});
