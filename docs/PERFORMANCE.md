[Docs](README.md) › Performance

# Performance

The game draws a canvas every frame and judges input against the audio clock, so a single slow frame shows up as
stutter. Four tools measure it. Timings are machine-specific, so always compare before and after on the same machine.

## In the browser

Turn on the profiler with either of these:
- tick **Settings › Developer › Performance overlay**;
- press **F3** in any screen; this toggles the same setting.

The choice is the synced `perfOverlay` setting, so it follows the player account.

The overlay shows:
- FPS;
- frame time p50 / p95 / max;
- the mean ms of each instrumented section:

| Section | Measures |
|---|---|
| `pad` | Gamepad polling, every frame |
| `update` | Game update during a run |
| `draw` | Highway draw during a run |
| `drawIdle` | The renderer's idle draw while no run is active |
| `chartgen` | Chart generation when a run starts |
| `library` | Building the song library |

It also counts main-thread long tasks.

**F4** (only while the profiler is on) prints a table and copies the JSON report. `__ringbeat.perf.report()` returns the
same data. With the profiler off, every hook is a single-boolean no-op (`src/perf.js`, overlay in `src/perfhud.js`).

## Node micro-benchmarks

`npm run perf` (`scripts/perf-bench.mjs`, run with `--expose-gc`) times the pure modules and a headless render pass with a
fake canvas.

| Flag | Effect |
|---|---|
| `--filter <text>` | Only cases whose name contains it |
| `--json <file>` | Save the results |
| `--baseline <file>` | Add a Δ% column against saved results |
| `--fail-over <pct>` | Exit nonzero if any mean regresses by more than this |
| `--fail-over-max <pct>` | Same, for the worst-frame (max) column |

Example: `npm run perf -- --filter chart --baseline scripts/perf-baseline.json`.

How to read the columns:
- Columns include p99 and max, because stutter is about the worst frame.
- `alloc B/call` is the approximate heap growth per call. Steady-state `render.draw` should stay near zero.
- `canvas calls/frame` for `render.draw` is deterministic, so it is the best regression signal across machines.
- `frames.*` cases replay a whole song at 60 Hz and report per-frame percentiles.

The node suite also covers hit effects (storm, holds, chips, juice off), menu icon frames, sprite URLs, cover art and
cameo sims.

## Menus in headless Chromium

`npm run perf:menus` (`scripts/perf-menus.mjs`) seeds the library with custom songs, then scrolls through:
- the main menu;
- the song list;
- categories and sorts;
- stats, including the Top page with a score for every song (long titles go through the marquee);
- the inbox;
- settings.

It drives the real key handlers. For each key press it reports the handler's JS time, the forced layout right after
it, and the time to the next frame, plus the browser's layout and style-recalc totals over the whole run.

| Flag | Default | Effect |
|---|---|---|
| `--reps <n>` | 3 | Repetitions per scenario |
| `--customs <n>` | 30 (max) | Custom songs seeded into My songs |
| `--json <file>` / `--baseline <file>` | | Save / compare (`scripts/perf-menus-baseline.json`) |
| `--fail-over <pct>` | | Exit nonzero on a regression larger than this |

## Real play in headless Chromium

`npm run perf:play` (`scripts/perf-play.mjs`) opens the game with `ringbeat.perf` set, plays songs with a keyboard bot and reads the in-page
profiler. It reports:
- fps;
- the share of long frames;
- frame p50 / p95 / p99 / max;
- `draw` and `update` p99.

| Flag | Default | Effect |
|---|---|---|
| `--songs <i,j,…>` | `0,6,12` | Song indexes in `SONGS` |
| `--seconds <n>` | 30 | Seconds played per song |
| `--max-long <pct>` | 2 | Fail if more than this share of frames exceed 1.5× the frame budget |
| `--max-p99 <ms>` | 25 | Fail if frame p99 exceeds this |

Headless software rendering is slower than a real GPU, so use these numbers for before/after comparisons, not as absolute
fps.

## Cloud requests

`npm run bench:net` (`scripts/net-bench.mjs`) measures what the API costs on the wire, with no sign-in and read-only GETs.
- **Formats** (`--offline`): the `GET /boards` snapshot (367 boards x 10 rows, seeded, about the size of the live one) in
  its current shape and in candidate shapes (slim rows, top 3 only): raw, gzip and brotli size, exact decompress time,
  `JSON.parse` and expand time.
- **Live** (`--live`, `--url <api>`, default `http://localhost:8787` from `npm run dev:cloud`): per `Accept-Encoding`, the
  encoding the API chose, bytes on the wire vs decoded, exact decompress time of the wire bytes, TTFB and total time
  (median / p95 over `--runs`), the dev-only `Server-Timing` (db, total), and whether `If-None-Match` gets a 304 (as sent,
  as a weak `W/` copy, and wrong). A local `wrangler dev` does not compress like Cloudflare's edge, so take wire sizes
  from the deployed URL.

In the browser, the request log (Settings › Developer › Request tracker) shows the same sizes per request ([DEVELOPMENT.md](DEVELOPMENT.md#debug-urls-and-hooks)).
Findings so far (measured 2026-10-17): the 574 KB seen in the log was the decoded size of the local seeded database
(367 boards); the same payload is about 86 KB gzipped and 67-93 KB brotli, and a top-3-only snapshot about 26 KB. The
deployed API's snapshot was small (8.3 KB decoded, 1.4 KB on the wire). The edge sends `W/"…"` ETags on compressed
answers, which the Worker used to refuse, so browsers never got a 304; fixed by comparing the tag without `W/`.

Its "decoded" size is the text length, which is not what crosses the network: judge payload changes by the wire column.

## Baselines

`scripts/perf-baseline.json` and `scripts/perf-menus-baseline.json` were recorded on the maintainer's machine. They are
starting points for `--baseline`, and CI does not use them. Re-record them on your own machine (`--json`) before
relying on the Δ% columns.

See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [DEVELOPMENT.md](DEVELOPMENT.md)
