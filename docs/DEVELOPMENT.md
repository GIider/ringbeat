[Docs](README.md) › Development

# Development

Ringbeat is vanilla ES modules served as-is: no bundler, no transpiler, no runtime dependencies. The only dev dependency
is Playwright, for the browser tests and screenshots.

## Setup

```
npm install                                   # also points git at .githooks/ (the `prepare` script)
npx playwright install chromium               # once; add firefox webkit to run the smoke test on those engines
npm start                                     # http://localhost:8000
```

Use Node 22 (what CI runs). ES modules need an HTTP server: opening `index.html` via `file://` won't work.

## npm scripts

| Script | What it does |
|---|---|
| `npm start` | Dev server on port 8000 (see [Dev server](#dev-server)) |
| `npm run dev` | Same server with live reload |
| `npm run dev:cloud` | Live-reload game server **plus** the local Worker/D1 with bot-filled boards and a GitHub-free sign-in ([CLOUD.md](CLOUD.md#local-development)). `npm run dev:cloud:fresh` first wipes the local D1 |
| `npm run songs:fetch` | Downloads and unpacks the credited song libraries into the gitignored `song-libs/` once (`-- --force` refreshes) |
| `npm run seed` | Re-fills the local D1 with bot players and their server-verified runs (`--bots=`, `--songs=`, `--seed=`); `npm run seed:reset` removes only the bots |
| `npm test` | Node unit tests (`tests/*.test.mjs`), the headless Chromium smoke test and the cut-off text audit, run side by side (`scripts/test-all.mjs`) |
| `npm run smoke` | Only the smoke test (`scripts/smoke.mjs` → `tests/smoke.html`) |
| `npm run audit:overflow` | Only the cut-off text audit (`scripts/overflow-audit.mjs`): English and German at 320-900px, fails on text that is clipped without the marquee  (`AUDIT_JOBS=n` sets how many language/viewport runs go in parallel, default 4) |
| `npm run coverage` | Node unit tests with `--experimental-test-coverage` |
| `npm run build` | Stage the runtime files into `dist/`, version-stamped (see [RELEASING.md](RELEASING.md#the-dist-build)) |
| `npm run bench` | Re-measure every built-in song with the bot ladder → `src/difficulty.json` (`-- --runs N`, default 30; see [SONGS.md](SONGS.md#difficulty-ratings)) |
| `npm run bench:net` | Cloud request cost: `GET /boards` formats (raw / gzip / brotli size, decompress, parse) and a live API (encoding, wire vs decoded bytes, timings, 304s); `-- --url <api> --runs N --offline --live` (see [PERFORMANCE.md](PERFORMANCE.md#cloud-requests)) |
| `npm run bench:tutorial` | Per tutorial lesson: play time, note density, and how bots of four skill levels fare (`-- --runs N`, default 200) |
| `npm run perf` | Node micro-benchmarks (see [PERFORMANCE.md](PERFORMANCE.md)) |
| `npm run perf:play` | Plays songs in headless Chromium and reports frame pacing |
| `npm run perf:menus` | Drives the menus in headless Chromium and reports per-press cost |
| `npm run screenshots` | README screenshots into the git-ignored `docs/screenshots/` (see [RELEASING.md](RELEASING.md#screenshots)) |
| `npm run font` | Rebuild `assets/fonts/*.ttf` from `src/pixelfont.js` |
| `prepare` | Runs on `npm install`: `git config core.hooksPath .githooks` |

Not wired to npm: `node scripts/i18n-keys.mjs [--lang=de] [--all]` lists untranslated strings
(see [TRANSLATIONS.md](TRANSLATIONS.md)), and `node scripts/version-lib.mjs` prints the version a build would get.

## Dev server

`scripts/serve.mjs` is a dependency-free static server.

- Port: the first all-digit argument (`npm start -- 9000`), else `PORT`, else 8000.
- Binds `0.0.0.0` and prints the LAN URLs, so you can open the game on a phone on the same network.
- Sends `Cache-Control: no-store`, so a reload always gets fresh modules.
- `--dev` (`npm run dev`) watches the project (ignoring `node_modules`, `.git`, `dist`) and injects a small
  EventSource client into HTML pages that reloads the page shortly after any file changes.
- `--cloud` (used by `npm run dev:cloud`) also makes the game talk to the local API on port 8787 of the same host and
  use its dev sign-in. Add `?api=prod` to the page URL to use the live API from the dev server instead.

## Tests

`npm test` runs both layers. CI additionally runs the smoke test in Firefox and WebKit and in WebKit with
iPhone 13 touch emulation (see [RELEASING.md](RELEASING.md#ci)).

**Node unit tests** (`node --test tests/*.test.mjs`) cover the logic modules with in-memory storage and fake
audio/canvas:

| File | Covers |
|---|---|
| `assets.test.mjs` | Glyph table and bold cut, glyphs for every song title, committed TTFs match the glyph table, sprites, cover art |
| `audiostate.test.mjs` | AudioContext resume / interruption handling, Game pause and resume |
| `boardsview.test.mjs` | The World boards page: song list filter / sort, custom songs, ETag revalidation, bad answers, remembered view |
| `calibration.test.mjs` | Latency calibration ticks, median, outliers |
| `cloud.test.mjs` | Cloud save end to end: the Worker in `server/` over an in-memory SQLite D1 stand-in (sign-in, CORS, revisions, runs, account deletion), leaderboards (re-played scores, bad runs, RULES, best per player, opt-out, moderation, flags, the cron) and two simulated devices syncing |
| `cloudmerge.test.mjs` | Cloud merges: shared document (settings, favourites, songs, deletes), combined scores and stats, the stores' sync hooks |
| `netbench.test.mjs` | The `bench:net` helpers: percentiles, the synthetic snapshot, slim/top-N variants round-trip |
| `netsignal.test.mjs` | The status-bar signal icon as a connection light: bar order, minimum busy time, reduced motion, blocked while playing |
| `cameo.test.mjs` | Idle cameos (snake, Space Impact, parade), scheduler, Konami / IMEI / wipe easter eggs |
| `core.test.mjs` | Library and the single-difficulty collapse, built-in songs parse and chart, scores, game FC/AP, gamepad, tutorial, bots, `difficulty.json` completeness, list view, composer, My songs, versioning, changelog, chart rules |
| `customrating.test.mjs` | Custom-song ratings: async measurement matches `difficulty.json`, cleaning, share encoding, storage |
| `game.test.mjs` | Grades, combo multiplier, holds, pause/resume, judgement windows, rolls, the stray error tone |
| `i18n.test.mjs` | Language detection, `t`/`tn`/`tm`/`fmt`; for every language: no gaps (except English, the source), no stale entries, matching placeholders and plural shapes, glyphs for every character; glyphs for every English source string |
| `mods.test.mjs` | Speed, mirror, sudden death, judging, demo autoplay; scores keep their mods |
| `modules.test.mjs` | My songs validation and storage, composer edits, bot weaknesses, list view, lane assignment, input clock, gamepad, cameo status, IMEI formatting |
| `replay.test.mjs` | Replays: a run played with a live-like frame loop re-plays to identical results (mods too), encode/decode, garbled logs; RULES is bumped when the scoring files change |
| `rtttl.test.mjs` | Parser edge cases, every built-in parses without warnings, share-link encode/decode |
| `settings.test.mjs` | Settings sanitising and persistence |
| `stats.test.mjs` | Lifetime stats, changelog ordering / glyphs / unread logic, menu icons, top songs |
| `scorechart.test.mjs` | The results' score chart series: density per slice, accuracy averages, miss counts |
| `worldlines.test.mjs` | The World page rows: snapshot and near rows merged, score order, gap rows |
| `seed.test.mjs` | The local leaderboard seeder's plan: skill pyramid, board tiers, random modifiers |
| `docs.test.mjs` | Links between docs resolve; every source file, script and test is in [ARCHITECTURE.md](ARCHITECTURE.md); every npm script is in this file |

**Browser tests:**

- `scripts/smoke.mjs` starts the dev server on a random port and loads `tests/smoke.html`, which drives `index.html` in
  an iframe through the real UI. It fails on any failed check or page error and prints `WARN` lines as GitHub warnings.
  - `SMOKE_BROWSERS=chromium,firefox,webkit` picks the engines (default `chromium`; each needs `npx playwright install`).
  - `SMOKE_DEVICE='iPhone 13'` applies a Playwright device profile (touch, viewport).
- `tests/smoke.html` and `tests/rtttl.test.html` (parser and chart checks) also run by hand: start the dev server and
  open them; the page title shows PASS or FAIL. `rtttl.test.html` is not run by any script.

## Git hooks

`npm install` enables `.githooks/`:

| Hook | Runs |
|---|---|
| `pre-commit` | The node unit tests (quietly; only `tests/docs.test.mjs` when every staged file is documentation). If `src/pixelfont.js` or `scripts/build-font.mjs` is staged, also rebuilds the fonts and aborts if `assets/fonts` changed |
| `pre-push` | `npm test` (including the Chromium smoke test); only the docs tests when the pushed commits change nothing but documentation |
| `post-merge` | `sync-deps`: `npm install` if `package-lock.json` changed |
| `post-checkout` | `sync-deps`, on branch checkouts only |

Documentation means `docs/`, `*.md` in the root and `LICENSE`, the same rule as CI ([RELEASING.md › CI](RELEASING.md#ci)); `.githooks/docs-only` holds it. Skip `pre-commit` / `pre-push` in an emergency with `--no-verify`.

## Debug URLs and hooks

| Hook | Effect |
|---|---|
| `?demo=<state>` | Boots straight into a screen with the Nokia Tune loaded: `title` (stays on the title screen), `menu` (on Settings), `select`, `info` (the details view on narrow LCDs; wide ones show them beside the list), `play`, `pause`, `results`, `fc`, `settings`, `stats`, `inbox`, `profile`, `message` (anything else lands on `select`; `select` also records a fixed spread of best runs around the cursor). `?demo=` pages never sync with the cloud. `play` / `pause` freeze the highway after a seeded bot has played up to the middle note. Used by `npm run screenshots` |
| `?dev` | Dev mode: a panel with a button per cameo plus stop, IMEI, wipe and Konami, and the **Admin** menu app (7th item, also shown without `?dev` to a signed-in dev-flag account; needs the Worker's `ADMIN_TOKEN`, see [CLOUD.md](CLOUD.md#leaderboards)) |
| `?dev=<cameo id>` / `?dev=now` | Dev mode, and idle cameos every 2–4 s instead of every 45–150 s (only that cameo, or any) |
| `#s=<base64url>[&r=<rating>]` | A share link: saves the song to My songs and selects it (see [SONGS.md](SONGS.md#share-links)) |
| `?api=prod` | With `npm run dev:cloud`: skip the local API and use the live one for this page load |
| `window.__ringbeat` | `{game, scores, stats, settings, perf, mysongs, cloud, state}` for devtools and `tests/smoke.html` |
| `#login=<code>` | The API's hand-back after GitHub sign-in (see [CLOUD.md](CLOUD.md#sign-in-flow)); `localStorage['ringbeat.api']` points the game at a local API |
| `globalThis.__i18nMissing` | Set of strings that had no translation in the current language |

The profiler overlay (also F3; see [PERFORMANCE.md](PERFORMANCE.md#in-the-browser)) and the request log below are switched on in **Settings › Developer**. Drag either overlay to move it, pull its bottom-right corner to resize it, double-click to reset (position is kept per device); **Reset overlay positions** resets both. Both are synced settings (`perfOverlay`, `netTracker`), so they follow the player account. **Glyphs & icons** opens a gallery of every font glyph (with its codepoint and size) and every sprite, pop-up icon and menu icon (focusing a menu icon or pop-up replays its animation).

**New symbols, animations, glyphs and icons must be viewable in that gallery.** When you add one (a font glyph, a sprite in `src/pixelart.js`, a pop-up, a menu icon or an animated frame set), register it where the gallery reads from (`GLYPHS`, `SPRITES` / `ICONS` / `ICONS_FAV`, `POPUPS`, `MENU_IDS`) or add a section in `buildGlyphs()` (`src/main.js`), make it replay its animation on focus, and extend the rectangular-art check in `tests/assets.test.mjs`.

**Request log.** With *Request tracker* on, a panel in the bottom-left corner lists the last cloud requests (`src/netdebug.js`):
- why each one went out: `start`, `tab back`, `push`, `new best`, `tab hidden`, `boards`, `Sync button`, `signed in`;
- what it carried (`shared`, `device`, runs and replay size, `pull`) and what came back (slots, verdicts, ranks);
- status, bytes up, and bytes down as compressed on the wire and decoded (`↓61.2 KB wire br / 574.0 KB`; `↓0 B (304)` when
  the browser revalidated and got no body, `(cache)` when it answered from cache), and total time;
- where the time went: `read` (receiving the body, which includes the browser decompressing it), `parse` (`JSON.parse`),
  and `unzip ~` (an estimate of the decompression alone, made by timing the same work on this page; the browser does not
  expose the real figure, `npm run bench:net` measures it exactly). Wire sizes need the API to send `Timing-Allow-Origin`
  (it does); without them the log shows the decoded size only;
- syncs that were held back and why (a song playing, backing off, synced recently).

The top line counts requests and bytes (wire / decoded) for the session. Each request is also a collapsed console group with the
full body sent and received. See [CLOUD.md › Requests](CLOUD.md#requests) for when requests go out.

To start fresh, clear the `ringbeat.*` keys in `localStorage` (list in
[ARCHITECTURE.md › Persistence](ARCHITECTURE.md#persistence)).

## Editing the pixel font

1. Edit the glyph bitmaps in `src/pixelfont.js` (the bold cut is derived; umlauts and other raised glyphs are listed in
   `RAISED`).
2. Run `npm run font` to rebuild `assets/fonts/rb-pixel.ttf` and `rb-pixel-bold.ttf` (`scripts/build-font.mjs` has its
   own small TrueType writer).
3. Commit the `.js` and both `.ttf` files together; `pre-commit` and `assets.test.mjs` check they match.

Any new character in UI text, a translation, a song title or a changelog message needs a glyph; the tests list the
missing ones.

## Conventions

- Logic modules are DOM-free and take their storage as a parameter (`createScores(storage)`, `createStats(storage)`,
  `createMySongs(storage)`), so node tests run them against an in-memory map. Every storage read is guarded and
  validated.
- `src/main.js` holds the DOM wiring; keep rules and maths in the small modules where they can be tested.
- The English source text is the translation key; wrap new UI strings as described in [TRANSLATIONS.md](TRANSLATIONS.md).
- Visual assets are made in the repo (no external fonts or images); see the [project README](../README.md#assets).
- `src/difficulty.json` and `assets/fonts/*.ttf` are generated; regenerate them instead of editing them by hand.

See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [SONGS.md](SONGS.md) · [RELEASING.md](RELEASING.md) · [PERFORMANCE.md](PERFORMANCE.md)
