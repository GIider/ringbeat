# Ringbeat — product spec (MVP)

Ringbeat is a browser rhythm game. Charts are generated automatically from RTTTL (Nokia ringtone) text;
all sound is synthesized with Web Audio. No assets, no runtime dependencies, no build step.

## Screens & flow

```
title ─▶ select ─▶ play ─▶ results ─▶ select
            │  ▲      ▲ │
            │  │      │ └─ pause ─▶ resume | restart | training options | select
            ├──▶ custom (paste / share link)
            ├──▶ settings ─▶ calibration
            └──▶ Training toggle + song ─▶ training options ─▶ play (practice)
```

| Screen | Purpose |
|---|---|
| Title | "Press any key". Satisfies the browser's audio-gesture requirement. |
| Song select | 43 built-in songs (11 of them full-length, 1–2 min, public-domain or original) in 5 categories (Classical, Pop & Film, Video Games, Folk & Kids, Originals; tabs above the list, RT or `[` / `]` cycles) + the user's Custom song. Per-row BPM, length, best grade, FC/AP badge. Detail pane: difficulty stars + bot rating (1-10) and weakness tags, best run, top 5. Sort (default / easiest / hardest / title / BPM) and filter (all / unplayed / no FC for the selected difficulty) buttons; gamepad LT cycles sort, X cycles filter. Rating = 1 + 9 × expected share of six simulated skill levels that fail to full-combo the chart (`src/bot.js`). Auto-preview (10 s) after selection, toggle in settings. |
| Custom | Paste RTTTL, live validation, preview, play, copy share link (`#s=<base64url>`). |
| Settings | Volume, scroll time, backing pulse, song preview, latency calibration, controller rebinding, reset highscores. |
| Training | Speed 50–150 %, optional A–B loop, then play. |
| Play | Highway canvas flanked by side panels (title, progress column, score, accuracy + live grade, combo with multiplier, notes left, judgement mix) that collapse to a top strip + bottom progress bar on narrow screens; FC/AP streak badge, timing meter, milestone banners. |
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
