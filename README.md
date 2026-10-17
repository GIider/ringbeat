# Ringbeat

[![Test & Deploy](https://github.com/GIider/ringbeat/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/GIider/ringbeat/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/github/license/GIider/ringbeat)](LICENSE)

**Play now:** <https://giider.github.io/ringbeat/>

Ringbeat is a browser rhythm game whose charts are generated automatically from RTTTL (Nokia ringtone) text. It is
dressed up as a late-90s candybar phone: every menu lives on the phone's green LCD, and during a song the note highway
runs inside that LCD.
All sound is synthesized with the Web Audio API (default voice: a phone piezo buzzer). There are no dependencies and no
build step, and the few assets (pixel font, phone artwork) are made in this repo; see [Assets](#assets).
Everything works offline and signed out. An optional GitHub sign-in adds cloud save and server-verified world
leaderboards; see [Online](#online-optional).

## Screenshots

The screenshots show a signed-in demo player ("Nova") with fixed scores and stats.

| Title | Main menu | Song list |
| --- | --- | --- |
| ![Title](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/title-desktop.png) | ![Main menu](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/menu-desktop.png) | ![Song list](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/select-desktop.png) |
| Title screen: "Press any key" (or "Tap" on touch screens) starts the game. | Main menu for a signed-in player: the profile name in the title bar, with Settings selected. | Song list with each song's best grade and FC (full combo) / AP (all perfect) badges, and the cursor song's best score below. |

| Mods | Playing | Playing (compact) |
| --- | --- | --- |
| ![Mods](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/mods-desktop.png) | ![Playing](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/play-desktop.png) | ![Playing (compact)](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/play-compact.png) |
| Mods: 1.2x speed, mirror lanes, hidden notes, sudden death. | Playing on the phone. | Compact layout: on small windows the LCD fills the window. |

| Messages | Profile | Settings |
| --- | --- | --- |
| ![Messages](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/inbox-desktop.png) | ![Profile](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/profile-desktop.png) | ![Settings](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/settings-desktop.png) |
| Messages: the changelog arrives as texts, unread ones in bold. | Profile of a signed-in player: name, play time, leaderboard visibility, sync status. | Settings, Sound tab: volume, tone, backing pulse and auto-play rolls. |

| Stats |
| --- |
| ![Stats](https://raw.githubusercontent.com/GIider/ringbeat/screenshots/grades-desktop.png) |
| Stats, Grades page: how many songs ended on each grade, from the saved best runs. |

On small windows (under 600 px wide or 520 px tall) the phone body is dropped and the LCD fills the window.
CI regenerates the screenshots on every push to `main` (see [docs/RELEASING.md](docs/RELEASING.md#screenshots)).

## Quick start

```
npm install                       # Playwright for the browser tests; also enables the git hooks
npm start                         # http://localhost:8000 (also prints LAN URLs); npm run dev adds live reload
npm test                          # node unit tests + headless Chromium smoke test (once: npx playwright install chromium)
```

ES modules need an HTTP server: opening `index.html` via `file://` won't work. All scripts, tests, hooks and debug URLs
are covered in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Features

- **Songs:**
  - 249 built-in songs (10 of them full-length) in 7 categories.
  - Custom songs: a Nokia-style composer or pasted RTTTL, import/export, share links.
  - 2 difficulties (Normal, Hard) with bot-measured ratings.
- **Scoring:**
  - Local highscores (top 5 per song and difficulty).
  - Optional online profile with world leaderboards (see [Online](#online-optional)).
  - Full combo / all perfect indicators.
  - Timing histogram.
  - Holds, rolls, slides and double notes, all derived from the melody.
- **Modifiers:** speed, mirror, hidden, sudden death, judging, demo autoplay.
- **Menus and extras:**
  - 3310-style main menu (Tones, My songs, Stats, Messages, Profile, Settings) with animated icons.
  - Lifetime stats (playtime, score, grades, streaks, and an Online page with your world ranks).
  - Changelog delivered as SMS.
  - First-run tutorial.
  - Idle cameos and a few easter eggs.
- **Input and sound:**
  - Keyboard, touch and gamepad (rebindable), with clickable phone keys.
  - Latency calibration.
  - Ten instrument voices (buzzer, smooth, pulse, triangle, arpeggio, bell, organ, pluck, sawtooth, Game Boy).
- **Languages:** English and German (follows the browser language, switchable in Settings).

## Online (optional)

There is no multiplayer; the online side is a profile, cloud save and leaderboards. It is all opt-in: signed out,
the game never needs the network and `localStorage` stays the source of truth.

- **Sign in with GitHub** (Menu → Profile). Settings, favorites, my songs, scores and stats then follow you to every
  device. Scores and stats from all your devices count together, and *Reset scores & stats* resets them all.
- **World leaderboards** rank each player's best run per song and difficulty. The score on a board is always the
  server's: the game uploads your key presses and the API re-plays them through the same game code, so a claimed score
  can't be faked. Runs under older scoring rules don't rank ("Not ranked: update the game").
- **Where you see it:** *World #n of total* on the results screen, the world top 10 under your own runs on each song,
  and an Online page in Stats. The **World boards** page (`boards.html`, linked from Profile) lets anyone browse every song's board, signed in or not. Prefer to stay off the boards? Profile → *On leaderboards: Off*.
- **Your data:** you can sign out or delete the online profile and everything stored with it at any time; see
  [PRIVACY.md](docs/PRIVACY.md).
- **Self-hosting:** the API is a Cloudflare Worker + D1 in `server/`; setup, local development (a local API needs its
  own GitHub OAuth App) and the full design are in [docs/CLOUD.md](docs/CLOUD.md).

## Controls

`D F J K` play the 4 lanes; on touch, tap the lanes; on a gamepad, use the d-pad / face buttons / shoulders. `Esc` pauses and `R` restarts.
In menus, use the arrows, `Enter` and `Esc`/`Backspace`, or `1`–`6` for main-menu items, or click the phone's Menu, C and ▲▼ keys and keypad.
On song select, `D`/`F` changes the sort, `.` toggles the difficulty, `J`/`K` jump between groups and `V` toggles a favorite. Full list: [docs/CONTROLS.md](docs/CONTROLS.md).

## Documentation

The [docs index](docs/README.md) maps everything. The most-used pages:

- [SPEC.md](docs/SPEC.md): screens, gameplay rules, scoring, modifiers, tutorial
- [CONTROLS.md](docs/CONTROLS.md): every input
- [CLOUD.md](docs/CLOUD.md): online profile, cloud save, leaderboards, the API and its deploy
- [PRIVACY.md](docs/PRIVACY.md): what an online profile stores, and how to delete it
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): module map and design decisions
- [DEVELOPMENT.md](docs/DEVELOPMENT.md): setup, scripts, tests, hooks, debug URLs
- [SONGS.md](docs/SONGS.md): RTTTL format, adding songs, difficulty ratings, share links
- [TRANSLATIONS.md](docs/TRANSLATIONS.md) · [RELEASING.md](docs/RELEASING.md) · [PERFORMANCE.md](docs/PERFORMANCE.md)

## Assets

Everything visual is made here, with no external fonts or images:

- `src/pixelfont.js`: hand-drawn 5×7 LCD font (ASCII, German umlauts, UI symbols). `npm run font` compiles it to
  TrueType (`assets/fonts/rb-pixel.ttf` plus a bold cut).
- `assets/phone.svg`: the phone shells. The LCD and key hit areas are DOM laid over them.
- `src/pixelart.js`: 1-bit sprites (signal bars, battery, ringing phone, category icons) used as CSS masks.
- `src/menuicons.js`: the animated main-menu icons (folder card + symbol + pressing hand), drawn in code.
- `src/cover.js`: per-song 72×28 "picture message" art, generated from the song id.

## Song sources & credits

The built-in songs are short RTTTL transcriptions of existing melodies; the tunes belong to their composers and rights
holders. The RTTTL strings come from:

- **PICAXE RTTTL archive**: <https://picaxe.com/rtttl-ringtones-for-tune-command/>
  (zips: [rtttl](http://picaxe.com/downloads/rtttl.zip), [rtttl2](http://picaxe.com/downloads/rtttl2.zip),
  [rtttl3](http://picaxe.com/downloads/rtttl3.zip), [rtttl_tv](http://picaxe.com/downloads/rtttl_tv.zip),
  [rtttl_xmas](http://picaxe.com/downloads/rtttl_xmas.zip)). Used for German/European songs, pop, Eurodance, and TV & Film.
- **FlipperMusicRTTTL**: <https://github.com/neverfa11ing/FlipperMusicRTTTL> (including ArcadeTones and the 10k song
  archive). Used for the NDW & Synth and Video Games additions (NES, SNES and Arcade folders).
- **Traditional / public-domain tunes** (classical, folk, nursery, and the "Full" arrangements) were written by hand.

Credit is per collection, not per song. The RTTTL format itself is described in [docs/SONGS.md](docs/SONGS.md#rtttl-format).

## License

[MIT](LICENSE).
