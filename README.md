# Ringbeat

A browser rhythm game whose charts are generated automatically from RTTTL (Nokia ringtone) text, dressed up as a
late-90s candybar phone: every menu lives on the phone's green LCD, and during a song the phone steps aside so the
highway can run next to its "now playing" screen.
All sound is synthesized with the Web Audio API (default voice: a phone piezo buzzer). No dependencies, no build step;
the few assets (pixel font, phone artwork) are made in-repo — see below.

## Run

ES modules need an HTTP server (opening `index.html` via `file://` won't work). No dependencies; npm only runs the script:

```
npm start            # http://localhost:8000 (also prints LAN URLs)
npm start -- 9000    # custom port (or PORT=9000 npm start)
npm run dev          # same server, the page reloads whenever a file changes
npm run build        # stage runtime files into dist/ (what CI deploys to GitHub Pages)
npm run bench        # re-measure song difficulty with bots -> src/difficulty.json
npm run font         # rebuild assets/fonts/*.ttf after editing the glyphs in src/pixelfont.js
```

Screenshot states for development: `index.html?demo=play` (also `pause`, `select`, `options`, `info`, `results`,
`settings`) loads the Nokia Tune and freezes a frame at ~10 %.

Tests: `npm test` (node: core logic, font builder, sprites); `npm run smoke` drives the UI (`tests/smoke.html`) in headless
Chromium via Playwright (`npm install`, then once `npx playwright install chromium`). `tests/rtttl.test.html` and
`tests/smoke.html` also run by hand in a browser (title shows PASS/FAIL).

## Features

Song select with 104 built-in songs (11 full-length) + custom/share links · 3 difficulties · local highscores (top 5 per song/difficulty) ·
full combo / all perfect indicators · training mode (speed 50–150 %, A–B loop, timing display) ·
keyboard, touch and gamepad (rebindable) · latency calibration · Nokia-style phone UI with clickable phone keys ·
buzzer or smooth instrument voice.

## Assets

Everything visual is made here, no external fonts or images:

- `src/pixelfont.js` — hand-drawn 5×7 LCD font (ASCII + UI symbols). `scripts/build-font.mjs` compiles it to
  TrueType (`assets/fonts/rb-pixel.ttf` + a bold cut); text is crisp at multiples of 10 px.
- `assets/phone.svg` — the phone shells; the LCD and key hit areas are DOM laid over them.
- `src/pixelart.js` — 1-bit sprites (signal bars, battery, ringing phone, category icons) used as CSS masks.
- `src/cover.js` — per-song 72×28 "picture message" art, generated from the song id.

## Controls

`D F J K` (4 lanes) · `F J K` (easy) · tap lanes on touch · gamepad d-pad/face buttons/shoulders · `Esc` pause · `R` restart.
Menus: arrows, `Enter`, `Esc`/`Backspace`, `O` options — or click the phone's soft keys and keypad.
Full list: [docs/CONTROLS.md](docs/CONTROLS.md). Spec: [docs/SPEC.md](docs/SPEC.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## RTTTL format notes

`name:d=4,o=5,b=125:8e6,8d6,p,4c#.,...`

- Defaults `d` (duration), `o` (octave 4–7), `b` (BPM); any may be missing (fallback d=4, o=6, b=63).
- Note: `[duration][note][#][.][octave][.]` — a dot is accepted after the note letter or after the octave.
- `p` is a pause. Octave 4 means C4 = MIDI 60 (middle C); A4 = 440 Hz.
- Whitespace and case are ignored; unknown tokens are skipped and listed as warnings.

## Sharing

"My songs… → (song) → Copy share link" puts the song in the URL hash (`#s=<base64url>`). Opening it selects the custom song (no autoplay).
