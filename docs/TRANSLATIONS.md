[Docs](README.md) › Translations

# Translations

Ringbeat ships in English and German. `src/i18n.js` holds the machinery and `src/lang/<code>.js` the dictionaries.

## How it works

- **The English source text is the key.** English needs no dictionary; a missing translation falls back to English
  and is recorded in `globalThis.__i18nMissing`.
- **In code:**
  - `t('Back')` translates a string. `src/main.js` and `src/render.js` import it as `tr`.
  - `tn(n, '{n} note', '{n} notes')` handles plurals. Dictionaries store plurals as `[one, other]`.
  - `fmt(s, { n })` fills `{placeholders}`.
  - `tm(msg)` translates a finished message that was built from a template.
- **In markup:** static elements carry `data-i18n`, `data-i18n-attr` or `data-i18n-html` and are translated by
  `applyStatic`. Screen titles and soft-key labels (`data-title`, `data-soft-*`) are translated in `refreshChrome`
  (`src/main.js`).
- **Language choice:** `settings.lang` once the player picks one in Settings → Language. Until then, it is the first
  supported entry of `navigator.languages`, falling back to English.
- **Never translated:** song titles, note names and the Ringbeat name.

## Adding a UI string

Write the English text as a literal inside `tr()` / `t()` / `tn()` / `tm()` / `toast()`, or in markup with `data-i18n`.
`scripts/i18n-keys.mjs` finds strings by scanning the source statically, so a string built at runtime is invisible to it.

The scanner reads:
- the call forms above, plus `openMySongs(` and `dataset.soft…` assignments;
- `data-i18n` markup in `index.html`;
- the tables `CATEGORIES`, `SORTS`, the tutorial `STAGES` and the changelog `MESSAGES`;
- its own fixed list.

It scans `src/*.js` only, not subfolders. A new table of labels has to be added to the scanner.

Then add the German entry to `src/lang/de.js`:
- `node scripts/i18n-keys.mjs` lists what's missing (`--lang=<code>` for another language).
- `--all` prints every key.

`npm test` fails until the entry is there.

## Adding a language

1. Create `src/lang/<code>.js` exporting the dictionary (copy the shape of `de.js`).
2. Register it in `src/i18n.js`: import it, add `<code>: '<native name>'` to `LANGS` and the dictionary to `DICTS`.
   The Settings → Language button cycles through `LANGS`.
3. Run `node scripts/i18n-keys.mjs --lang=<code>` and translate everything it lists, including the changelog messages.
4. Every character used must exist in the LCD font. Add glyphs to `src/pixelfont.js` and run `npm run font`
   (see [DEVELOPMENT.md › Editing the pixel font](DEVELOPMENT.md#editing-the-pixel-font)).
5. Extend `tests/i18n.test.mjs`. Its glyph check loops over all `LANGS`, but the gap, stale-entry, placeholder and
   plural-shape checks are written against `DICTS.de` only, so a new language is not checked until you add it there.

Translated strings have to fit the LCD, which is narrow. Check long ones on a compact screen.

See also: [DEVELOPMENT.md](DEVELOPMENT.md) · [RELEASING.md](RELEASING.md) · [ARCHITECTURE.md](ARCHITECTURE.md)
