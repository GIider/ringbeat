[Docs](README.md) › Songs

# Songs

Every chart in Ringbeat is generated from RTTTL (Nokia ringtone) text, so a song is a single text string. This page covers
the format, the built-in catalogue, difficulty ratings and players' own songs.

## RTTTL format

`name:d=4,o=5,b=125:8e6,8d6,p,4c#.,...`

- The second section holds the defaults `d` (duration), `o` (octave 4–7) and `b` (BPM). Any of them may be missing; the
  fallbacks are d=4, o=6, b=63.
- Each note is `[duration][note][#][.][octave][.]`. A dot is accepted after the note letter or after the octave.
  The dot always follows the note: a dotted quarter C is `4c.` (or `4c5.`), never `4.c`. A dot in front of the note is
  an unknown token, so that note is skipped and listed as a warning.
- `p` is a pause. Octave 4 means C4 = MIDI 60 (middle C); A4 = 440 Hz.
- Whitespace and case are ignored. Unknown tokens are skipped and listed as warnings.

Parser: `src/rtttl.js` (`parseRTTTL` → `{ name, bpm, notes[], warnings[] }`). Format reference:
[Wikipedia](https://en.wikipedia.org/wiki/Ring_Tone_Text_Transfer_Language).

## From melody to chart

`src/chart.js` turns the parsed notes into a chart per difficulty:
1. Lane assignment follows the melody's contour.
2. Long notes become holds, and dotted-plus-short pairs become short holds.
3. Legato same-pitch runs become rolls, and stepwise runs become slides.
4. On Hard, big leaps get double notes.

Notes that don't make the chart are played automatically as `backing`. The exact rules and thresholds are in
[SPEC.md › Gameplay](SPEC.md#gameplay). Nothing is hand-authored per song.

## Built-in songs

`src/songs.js` holds the catalogue (259 songs; check with `node -e "import('./src/songs.js').then(m=>console.log(m.SONGS.length))"`).

- `SONGS` entries are `{ id, category, title, tag, rtttl }`:
  - `id`: unique and stable. Highscores, stats and `difficulty.json` are keyed by it, so never rename a shipped id.
  - `category`: one of the `CATEGORIES` ids: `classical`, `pop`, `dance`, `ndw`, `screen`, `videogame`, `folk`.
  - `tag`: a short composer / artist / game label shown in the song info.
- `FULL_SONGS` are the full-length (1–2 min) arrangements of public-domain tunes. They are built with
  `rt(name, d, o, b, ...sections)`, where a section is an RTTTL note string or `[notes, semitoneShift, speed]`, and they are
  appended to `SONGS`.

### Adding a built-in song

1. Add the entry to `SONGS` (or `FULL_SONGS`) with a new unique `id` and an existing `category`. Source libraries are cached
   in the gitignored `song-libs/`; `npm run songs:fetch` downloads them once (`-- --force` refreshes).
2. Check that it parses without warnings and charts on both difficulties: `node --test tests/rtttl.test.mjs tests/core.test.mjs`.
3. Every character in the title needs a glyph in the LCD font (`assets.test.mjs`; see
   [DEVELOPMENT.md › Editing the pixel font](DEVELOPMENT.md#editing-the-pixel-font)). Titles are never translated.
4. Run `npm run bench` to regenerate `src/difficulty.json`. Without it, `core.test.mjs` fails with `rated: <id>`, and the
   game shows the song with an estimated rating.
5. If the RTTTL comes from a new source, credit the collection in the
   [README › Song sources & credits](../README.md#song-sources--credits).
6. Try it in the browser, ideally on both difficulties.

## Difficulty ratings

A song's rating (1–10, shown as 1–5 stars) is measured, not guessed. `src/bot.js` has the measurement:

- An eight-level **skill ladder** of headless bots plays the real `Game` many times per chart. The skill needed is the
  ladder position where bots start full-combo-ing the chart at least half the time.
- `rating = 1 + 9 × 1.8 × (position / ladder size)`, capped at 10. The 1.8 stretch makes the catalogue's hardest charts
  reach the top. Stars = `rating / 1.4`, rounded and clamped to 1–5.
- **Tags** name up to two weaknesses that cost a mid-skill bot at least 5 % accuracy. The candidates are `holds`, `rolls`,
  `slides`, `doubles`, `speed`, `stamina`, `left lane` and `right lane`, and each is only tested when the chart has that
  feature.
- The rating also decides single-difficulty songs: when Normal and Hard barely differ, only one is offered
  (see [SPEC.md › Gameplay](SPEC.md#gameplay)).

`npm run bench [-- --runs N]` measures every built-in song on both difficulties and writes `src/difficulty.json`
(`{ id: { normal|hard: { rating, fc: {L1..L8}, tags, nps, acc } } }`). The game fetches it after first paint. A missing
entry or a failed fetch falls back to a note-density estimate, which is marked as estimated.

**When charting or the bots change:** if a change to `chart.js`, `bot.js` or the ladder moves ratings:
1. Re-run `npm run bench`. `customrating.test.mjs` checks that a fresh measurement matches the file.
2. Bump `CALC_VERSION` in `src/bot.js`, so that stored ratings of custom songs from the old calculation are ignored.

## Custom songs (My songs)

Players keep up to 30 songs of up to 8000 characters each in `ringbeat.songs.v1` (`src/mysongs.js`). They can be made
in the Nokia-style composer (`src/composer.js`) or pasted as RTTTL text.

- **Highscores** for a custom song are keyed by a hash of its RTTTL, so they follow the melody, not the name.
- **Ratings:** until measured, a custom song shows the density estimate with a `~` (e.g. `~2.5`). *Calculate difficulty*
  in the song menu runs the bot ladder in the browser and stores the result with the song. Editing the melody clears it.
- **Export / import:**
  - One song exports as `.rtttl`.
  - All songs export as `.json`: `{ "v": 1, "songs": [{ name, rtttl, rating? }] }`.
  - Import accepts that JSON, a bare array, or plain text with RTTTL lines picked out of it. Imported ratings are
    unverified.

### Share links

*Copy share link* puts the song in the URL hash: `#s=<base64url(UTF-8 RTTTL)>`, plus `&r=<rating>` if it has a measured
rating (`src/share.js`).

The rating is encoded as `<CALC_VERSION>.<normal×10>.<hard×10>.<normal tag digits>.<hard tag digits>` (`src/customrating.js`).

Opening a link saves the song to My songs and selects it; nothing autoplays. The receiver treats the rating as
unverified, so it keeps its `~` until *Recalculate*, and drops it entirely if it came from a different `CALC_VERSION`.

See also: [SPEC.md](SPEC.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DEVELOPMENT.md](DEVELOPMENT.md)
