# Ringbeat — product spec (MVP)

Ringbeat is a browser rhythm game. Charts are generated automatically from RTTTL (Nokia ringtone) text;
all sound is synthesized with Web Audio. The whole UI is an old candybar phone: menus are Nokia-style lists on its
green LCD (status bar, inverted highlight, two soft keys), the play screen puts the highway between a side phone
(progress) and the front phone (now playing). Self-made assets only, no runtime dependencies, no build step.

## Screens & flow

```
title ─▶ select ─▶ difficulty ─▶ play ─▶ results ─▶ select
            │  ▲        │          ▲ │
            │  │        │          │ └─ pause ─▶ resume | restart | settings | training options | select
            │  │        └─ Training: On ─▶ training options ─▶ play (practice)
            └──▶ Options ─┬─▶ my songs (composer / paste / import-export)
                          ├─▶ settings ─▶ calibration
                          └─▶ category / sort / show
```

| Screen | Purpose |
|---|---|
| Title | Boot screen, "Press any key" (plays a short power-on jingle). Satisfies the browser's audio-gesture requirement. |
| Song select | 153 built-in songs (11 of them full-length, 1–2 min, classical or folk) in 7 categories (Classical, Pop & Rock, Eurodance, NDW & Synth, TV & Film, Video Games, Folk & Kids; Options → Category, ←/→ or `[` / `]` cycles) + the user's Custom song. "Ringing tones" list: category icon, title, best grade, FC/AP badge; `◄ Category ►` header (←/→, LB/RB); footer with stars + rating, best, BPM, length. Confirming a song opens the difficulty screen (last-played difficulty preselected) with BPM/length and Info / Top runs tabs (dimmed until the song has been played) (←/→) for the focused difficulty. The difficulty screen also has a Training toggle (gamepad Y; the title becomes *Training*): with it on, picking a difficulty opens the training options instead of starting the song. Options (left soft key, `O`, gamepad X): My songs, Settings, Category, Sort (default / easiest / hardest / title / BPM / length; `D` / `F`, gamepad LT), Show (all / unplayed / no FC). Rating = 1 + 16.2 × the position (share of the ladder, capped at 10) on an eight-level simulated skill ladder where bots start full-combo-ing the chart at least half the time (`src/bot.js`). Auto-preview (10 s) after selection, toggle in settings. | RTTTL sources are credited in the README ("Song sources & credits").
| My songs | Up to 30 saved songs (`ringbeat.songs.v1`). Nokia-style composer: keys 1–7 = c…b, 0 rest, 8/9 length, `*` dot, `#` sharp, repeating a key cycles the octave, ▲▼ pitch step, ◀▶ cursor, left soft key = menu. Controller: A adds a copy of the last note, d-pad up/down tunes it. Also paste/edit RTTTL text, export a song (`.rtttl`), export/import all (`.json`, or RTTTL lines), copy text or share link (`#s=<base64url>`, saved to My songs when opened). |
| Settings | Tone (buzzer / smooth), volume, scroll time, backing pulse, song preview, latency calibration, controller rebinding, replay tutorial, reset highscores. |
| Training | Speed 50–150 %, optional A–B loop, then play. |
| Play | Highway canvas with a HUD column (score, accuracy + live grade, combo with multiplier, notes-left box, timing meter, judgement mix), between the side phone (signal bars = recent hit quality, progress %, time) and the front phone's now-playing LCD (title, ringing animation, progress bar, battery = time left; soft keys pause). Narrow screens: full-screen canvas with a top strip + bottom progress bar. FC/AP streak line, milestone banners. |
| Results | Grade, score, FULL COMBO / ALL PERFECT banner, NEW BEST / rank, judgement counts, timing histogram, average offset. Retry / Next song / Menu. |

## Gameplay

- **Difficulty:** Easy (3 lanes, beats and holds only), Normal (4 lanes), Hard (4 lanes, every note).
- **Notes:** taps, and holds for notes ≥ 0.45 s (hold until the tail; releasing in the last 150 ms is fine).
  Also derived from the RTTTL text, no authoring needed:
  - **Short holds** (Normal/Hard): a dotted note followed by a note ≤ ⅓ of its length (dotted quarter → eighth) and
    lasting ≥ 0.2 s is a short hold.
  - **Phrases:** a rest of ≥ 1 beat ends a phrase (so does 16 beats without one). The first note after a rest is an
    **accent** (caret above the head) and scores ×2. A phrase finished with no miss pays **+200** (`PHRASE +200`; not
    in songs with a single phrase).
  - **Power notes** (plus sign in the head): phrase peaks at or above the song's 85th pitch percentile. Hitting all of a
    phrase's power notes with no miss starts a ×1.5 score burst for 4 s (`POWER x1.5`).
  - **Rolls:** a legato run of ≥ 4 same-pitch notes, each starting within 0.26 s of the last, becomes one roll in a
    single lane: a dotted rail with a bar per tick. Mash the lane between the first tick (window opens 135 ms early) and
    50 ms after the last. Each press scores 10 × multiplier; one judgement at the end by presses ÷ goal
    (goal = span × 9 Hz, at most one per tick, ≥ 3): ≥ 80 % Perfect, ≥ 60 % Great, ≥ 40 % Good, else Miss. Presses
    inside a roll are never strays. Loop sections clip a roll to the ticks that fit (under 3 → a plain tap).
  - **Slides:** a run of ≥ 3 tap notes moving 1–2 semitones per step in one direction (legato, ≤ 0.5 s apart) is
    re-laned to sweep one lane per note (up = right, at most one note per lane, so ≤ 4) and joined by a dotted line.
    The first note is judged normally; the follow-ups accept presses up to ±180 ms off (anything outside the Good window
    is judged Good). Each note still scores and combos on its own.
  - **Double notes** (Hard): a legato leap of ≥ 7 semitones adds an octave-below partner tap in the neighbouring lane at
    the same time (a bridge joins the two heads). Both notes are judged separately.
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
