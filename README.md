# Ringbeat

A browser rhythm game whose charts are generated automatically from RTTTL (Nokia ringtone) text.
All sound is synthesized with the Web Audio API. No assets, no dependencies, no build step.

## Run

ES modules need an HTTP server (opening `index.html` via `file://` won't work). No dependencies; npm only runs the script:

```
npm start            # http://localhost:8000 (also prints LAN URLs)
npm start -- 9000    # custom port (or PORT=9000 npm start)
```

Tests: `npm test` (node), plus `tests/rtttl.test.html` and `tests/smoke.html` in a browser (title shows PASS/FAIL).

## Features

Song select with 15 built-in songs + custom/share links · 3 difficulties · local highscores (top 5 per song/difficulty) ·
full combo / all perfect indicators · training mode (speed 50–150 %, A–B loop, timing display) ·
keyboard, touch and gamepad (rebindable) · latency calibration.

## Controls

`D F J K` (4 lanes) · `F J K` (easy) · tap lanes on touch · gamepad d-pad/face buttons/shoulders · `Esc` pause · `R` restart.
Full list: [docs/CONTROLS.md](docs/CONTROLS.md). Spec: [docs/SPEC.md](docs/SPEC.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## RTTTL format notes

`name:d=4,o=5,b=125:8e6,8d6,p,4c#.,...`

- Defaults `d` (duration), `o` (octave 4–7), `b` (BPM); any may be missing (fallback d=4, o=6, b=63).
- Note: `[duration][note][#][.][octave][.]` — a dot is accepted after the note letter or after the octave.
- `p` is a pause. Octave 4 means C4 = MIDI 60 (middle C); A4 = 440 Hz.
- Whitespace and case are ignored; unknown tokens are skipped and listed as warnings.

## Sharing

"Custom… → Copy share link" puts the song in the URL hash (`#s=<base64url>`). Opening it selects the custom song (no autoplay).
