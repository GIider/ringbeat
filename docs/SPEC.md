# Ringbeat — product spec (MVP)

Ringbeat is a browser rhythm game. Charts are generated automatically from RTTTL (Nokia ringtone) text;
all sound is synthesized with Web Audio. The whole UI is an old candybar phone: menus are Nokia-style lists on its
green LCD (status bar, inverted highlight, two soft keys), the play screen puts the highway between a side phone
(progress) and the front phone (now playing). Self-made assets only, no runtime dependencies, no build step.

## Screens & flow

```
title ─▶ select ─▶ play ─▶ results ─▶ select
            │  ▲      ▲ │
            │  │      │ └─ pause ─▶ resume | restart | settings | training options | select
            └──▶ Options ─┬─▶ details ─▶ play
                          ├─▶ my songs (composer / paste / import-export)
                          ├─▶ settings ─▶ calibration
                          └─▶ Training: On + song ─▶ training options ─▶ play (practice)
```

| Screen | Purpose |
|---|---|
| Title | Boot screen, "Press any key" (plays a short power-on jingle). Satisfies the browser's audio-gesture requirement. |
| Song select | 104 built-in songs (11 of them full-length, 1–2 min, classical or folk) in 7 categories (Classical, Pop & Rock, Eurodance, NDW & Synth, TV & Film, Video Games, Folk & Kids; Options → Category, ←/→ or `[` / `]` cycles) + the user's Custom song. "Ringing tones" list: category icon, title, best grade, FC/AP badge; `◄ Category ►` header (←/→, LB/RB); footer with stars + rating, best, BPM, length. Confirming a song opens the difficulty screen (last-played difficulty preselected) with BPM/length and Info / Best / Top runs tabs (←/→) for the focused difficulty. Options (left soft key, `O`, gamepad X): Play/Train, Preview, Training mode, Category, Sort (default / easiest / hardest / title / BPM / length; `D` / `F`, gamepad LT), Show (all / unplayed / no FC), My songs, Settings. Rating = 1 + 9 × expected share of six simulated skill levels that fail to full-combo the chart (`src/bot.js`). Auto-preview (10 s) after selection, toggle in settings. |
| My songs | Up to 30 saved songs (`ringbeat.songs.v1`). Nokia-style composer: keys 1–7 = c…b, 0 rest, 8/9 length, `*` dot, `#` sharp, repeating a key cycles the octave, ▲▼ pitch step, ◀▶ cursor, left soft key = menu. Controller: A adds a copy of the last note, d-pad up/down tunes it. Also paste/edit RTTTL text, export a song (`.rtttl`), export/import all (`.json`, or RTTTL lines), copy text or share link (`#s=<base64url>`, saved to My songs when opened). |
| Settings | Tone (buzzer / smooth), volume, scroll time, backing pulse, song preview, latency calibration, controller rebinding, replay tutorial, reset highscores. |
| Training | Speed 50–150 %, optional A–B loop, then play. |
| Play | Highway canvas with a HUD column (score, accuracy + live grade, combo with multiplier, notes-left box, timing meter, judgement mix), between the side phone (signal bars = recent hit quality, progress %, time) and the front phone's now-playing LCD (title, ringing animation, progress bar, battery = time left; soft keys pause). Narrow screens: full-screen canvas with a top strip + bottom progress bar. FC/AP streak line, milestone banners. |
| Results | Grade, score, FULL COMBO / ALL PERFECT banner, NEW BEST / rank, judgement counts, timing histogram, average offset. Retry / Next song / Menu. |

## Gameplay

- **Difficulty:** Easy (3 lanes, beats and holds only), Normal (4 lanes), Hard (4 lanes, every note).
- **Notes:** taps, and holds for notes ≥ 0.45 s (hold until the tail; releasing in the last 150 ms is fine).
- **Judgement windows** (|Δ| from the note time): Perfect ≤ 45 ms, Great ≤ 90 ms, Good ≤ 135 ms, otherwise miss.
- **Score:** Perfect 300 / Great 200 / Good 100, times a combo multiplier (+0.1 per 10 combo, max 2×); completed hold +100.
- **Accuracy:** Perfect 1, Great ⅔, Good ⅓, Miss 0 (averaged over all judged notes; a dropped hold counts a miss).
- **Grade:** S ≥ 95 %, A ≥ 90 %, B ≥ 80 %, C ≥ 70 %, D below.
- **Full combo (FC):** no misses in the run (a dropped hold is a miss). **All perfect (AP):** FC and every note Perfect.
  During play the HUD shows `FULL COMBO` / `ALL PERFECT` while the streak is alive; it disappears at the first miss.
- There is no fail state.

## Highscores

- Stored locally (`localStorage`, key `ringbeat.scores.v1`), per song id and difficulty: top 5 runs, play count.
- Run: score, grade, accuracy, max combo, fc, ap, date. Ranking by score; ties rank below the older run.
- Custom songs are keyed by a hash of their RTTTL text, so scores follow the melody.
- Training runs are never recorded. Highscores can be reset in Settings (two-step confirm).

## Training mode

- **Speed** 50–150 %: the chart's time axis is scaled; pitch is unchanged (notes are synthesized).
- **Loop A–B:** a section (as % of the song, ≥ 10 % wide) restarts automatically when it ends. Holds crossing the end are clipped.
- Results are labelled *Practice* and not saved. Pause menu offers *Training options* to change speed/section.

## Controls

See [CONTROLS.md](CONTROLS.md).

## Timing model

The audio clock (`AudioContext.currentTime`) is the only time source. Input timestamps are mapped onto the audio
timeline (`eventAudioTime`), output latency and the user's calibration offset are subtracted from song time.
Gamepad input is polled once per animation frame (the Gamepad API has no event timestamps), which limits
controller timing resolution to one frame (~16 ms @ 60 Hz); the pad's own `timestamp` is used when sane.

## Non-goals (MVP)

Online leaderboards, accounts, user-authored charts beyond RTTTL, keyboard rebinding, rumble, audio files.
