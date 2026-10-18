[Docs](README.md) › Spec

# Ringbeat — product spec

Ringbeat is a browser rhythm game. Charts are generated automatically from RTTTL (Nokia ringtone) text, and all sound
is synthesized with Web Audio. The whole UI is an old candybar phone. Menus are Nokia-style lists on its green LCD
(status bar, inverted highlight, two soft keys), and during a song the note highway runs inside that same LCD. All
assets are made in the repo, with no runtime dependencies and no build step.

## Screens & flow

```
title ─▶ menu ─┬─ 1 Tones ─▶ (first visit: tutorial prompt) ─▶ select ─▶ play ─▶ results ─▶ select
               │                                                  │          ▲ │
               │                                                  │          │ └─ pause ─▶ resume (3-2-1) | restart
               │                                                  │          │           | settings | back to select
               ├─ 2 My songs (composer / paste RTTTL / import-export / share)
               ├─ 3 Stats (Time / Score / Top / Grades / Notes / Online)
               ├─ 4 Messages ─▶ inbox ─▶ message
               ├─ 5 Profile (optional online profile)
               ├─ 6 Settings ─▶ calibration
               └─ 7 Admin (only with ?dev or a signed-in dev-flag account; needs the admin token)
```

| Screen | Purpose |
|---|---|
| Title | Boot screen: an LCD scene (power-on, a Nokia 3310 drops in and bounces, the RINGBEAT logo lands letter by letter) that then rings in an 8.4 s loop (vibrating phone, sound waves, floating notes, a falling-note highway on the phone's own screen, a glint and a ripple across the logo); reduced motion shows one still frame. Below it "Press any key" ("Tap" on touch screens), the version (linking to GitHub) and the build line. The first boot plays a short power-on jingle. The key press also satisfies the browser's audio-gesture requirement. |
| Main menu | 3310 style: one item per screen, with a big title, an animated 1-bit icon (a small 3310 beside the item's symbol), a numbered scrollbar on the right and the Select / Back soft keys. You can browse with ↑↓/←→, digits 1–6 (7 for Admin), swipe, the wheel or the ◄► arrows. Back returns to the title. The menu returns to the last item used in the session. |
| Login prompt | Shown once per device after the tutorial (played or skipped, or *No thanks* on the tutorial prompt) to a player who isn't signed in: *Sign in with GitHub* / *Not now*. |
| Tutorial prompt | Shown the first time Tones is opened, unless the player has already picked a song: *Play tutorial* / *No thanks*. See [Tutorial](#tutorial). |
| Song select | Covered in the [Song select](#song-select) section below. |
| Mods | Speed, Mirror, Hidden, Sudden death, Demo (autoplay), Judging; a live score multiplier; *Reset all*. See [Modifiers](#modifiers). |
| Play | Covered in the [Play screen](#play-screen) section below. |
| Pause | *Resume* (with a 3-2-1 "GET READY" countdown; audio stays frozen meanwhile), *Restart*, *Settings*, and *Tones* (or the screen the run came from). Back resumes. During the tutorial, *Back to lesson* replaces the last button. Play also pauses when the tab is hidden or a gamepad disconnects. |
| Results | Covered in the [Results](#results) section below. |
| My songs | Covered in the [My songs](#my-songs) section below. |
| Stats | Six pages (←→, LB/RB, swipe); on a wide LCD (800 px and up) all six are panels of one screen, and the played-songs list scrolls up and down like a marquee when it is too long. See [Stats](#stats). |
| Messages | The changelog as an SMS inbox: one message per version (bold = unread). Opening one shows the SMS view (with an SMS tone the first time per visit to Messages) (↑↓ scroll; ←→ or *Next* flip between messages). An update leaves exactly one new message, and the menu shows the envelope icon until it is read. How entries are written: [RELEASING.md](RELEASING.md#releasing-a-minor-version). |
| Profile | The player card (name, since, playtime) and the optional online profile. See [Profile](#profile). |
| Admin | Dev mode (`?dev`) or a signed-in account with the developer flag (`profile.dev`). Unlock with the `ADMIN_TOKEN` (kept in memory, never stored), then: *Players* (search by name; open one to blacklist/whitelist, hide, delete, or browse their runs), *Flagged runs* (approve, hide or delete), *Maintenance* (table counts, purge expired sessions and sign-in rows, rebuild boards, verify pending runs) and *Log* (the audit trail). Deletes need a second press. Routes: [CLOUD.md](CLOUD.md#leaderboards). |
| Settings | Covered in the [Settings](#settings) section below. |
| Calibration | Tap along with 12 ticks at 90 BPM; the median offset becomes the latency setting (±5 ms nudge, *Again*, *Reset*, clamped to ±500 ms). Any key or button counts as a tap. |

### Song select

- **Catalogue:** 249 built-in songs (10 of them full-length, 1–2 min, classical or folk) in 7 categories: Classical,
  Pop & Rock, Eurodance, NDW & Synth, TV & Film, Video Games, Folk & Kids. A *Custom* category holds the player's saved
  songs; it appears only when there are some, and they always sort last.
- **Changing the view:**
  - Category: ←→, `[` `]`, LB/RB, a swipe, or the ◄► arrows in the header.
  - Sort: `D` / `F`, gamepad LT, or tapping the sort chip. The options are *Rating* (easiest first, the default),
    *Title*, *BPM*, *Duration* (grouped in 10 s steps) and *Favorites* (favorites first).
- **Favorites:** a *Favorites* category chip (after the others) appears once a song is favorited. `V`, or clicking / tapping the icon of the selected row (or the space beside it, so a fingertip does not start the song), toggles a song's favorite (saved in the settings; custom
  songs too). Favorites show a solid variant of their category icon (`SPRITES_FAV`).
- **Rows:** category icon, title, best grade, and an FC/AP badge if that was ever achieved (not
  necessarily in the best run).
- **Footer (narrow LCDs):** stars + rating, best, BPM and length of the selected song. The navigation keys for the input device in use are listed in a panel beside the phone on wide
  screens (no hint line on the LCD).
- **Selecting and playing:** focusing or tapping a row selects it, and an optional 10 s preview plays. Confirming,
  double-clicking or re-tapping the selected row plays it on a wide LCD (800 px and up), where the details sit beside the list. On a narrow LCD the first confirm opens the details view (title, favorite heart, stars, stats, the modifier chips, the local / global board, your best) and the next confirm starts the song; a vertical swipe (or ↑ ↓) there steps to the next / previous song, and the sort and category rows are hidden.
- **Details pane:** BPM, length, rating, local plays and grade; the Modifiers row has five chips (Speed, Style = mirror, Visuals = hidden, Input = judging, Mode = sudden death / demo) that cycle on a tap (`1`–`5`, or gamepad X on the chip under the R3-moved cursor) and explain the mod underneath; *Global* / *Local* boards (`T` to switch; rows scroll up and down like a marquee when they don't all fit). The Global board always includes the player's own row (the rows around their rank), so there is no separate best-score line.
- **Rating:** `1 + 16.2 ×` the position on an eight-level simulated skill ladder where bots start full-combo-ing the
  chart at least half the time, capped at 10. Stars = rating ÷ 1.4. Unmeasured songs show an estimate. See
  [SONGS.md › Difficulty ratings](SONGS.md#difficulty-ratings).

### Play screen

- **The LCD:** the highway fills the LCD canvas, below the status bar.
- **Status bar:**
  - the song title, scrolling if it is too long;
  - signal bars: full during a song, otherwise the connection light for signed-in players (full: synced, climbing: sending, dropping: receiving, 1 bar: last sync failed, none: offline). Hovering shows what the bars mean right now;
  - a battery (always full; the HUD's progress bar shows the time).
- **HUD:** two rows at the top of the canvas (on a wide LCD, with stat rails beside the highway).
  1. Score, then live grade + accuracy.
  2. A `FULL COMBO` / `ALL PERFECT` tag while the streak is alive (after at least 5 judged notes), or the active mod
     chips, plus the combo with its multiplier (`x1.2`).
  - Wide LCDs (800 px and up) replace the combo on row 2 with rails: left, BPM and time left under note / clock icons;
    right, the combo (centred over its label), the judgement counts and an *ACC* meter (ten segments, empty until the
    first note is judged). The progress bar sits between the score and the accuracy on row 1.
- **Pause:** a modal over the dimmed playfield (*Resume*, *Restart*, *Settings*, *Tones*).
- **Feedback:** judgement chips appear per lane, and a milestone banner every 50 combo. With *Hit effects* on, you also
  get receptor punches, debris, combo chirps and an LCD edge blink.
- The right soft button pauses.
- **Compact mode** (window under 600 px wide or 520 px tall, or forced by Settings › Compact view, which is only offered when the window is at least 600 × 520 px) has the same layout on a bare LCD, without the phone body.

### Results

- **Pages:** four, shown one tab at a time between ◄ ► arrows like Settings (←→, `[` `]`, LB/RB, swipe or arrow tap; wraps around). On a wide LCD (800 px and up) all of them are panels of one screen, plus a *Song Info* panel.
  - **Score:** grade, score, FULL COMBO / ALL PERFECT banner, NEW BEST / rank.
  - **Stats:** accuracy, max combo, judgement counts, ghost hits.
  - **Chart:** the score chart (`src/scorechart.js`): dotted bars = how many notes fall in each slice of the song, the line = the player's accuracy in that slice (axis 0 / 50 / 100 %), misses = a dotted drop line, a ring on the line and a block under the baseline, ghost taps = a cross above the baseline. On a wide LCD nothing on this screen scrolls: the board scrolls up and down like a marquee when it has more rows than room. Below it the early/late timing histogram and the average offset.
  - **Top:** one leaderboard. Signed in, a *Global* / *Local* toggle switches it (Global first): the world top 10 and the players around the player's rank, or the song's top runs on this device. Signed out: the local runs, or "Run not saved".
- **Buttons:** *Retry* / *Next song* (the next song in the current filtered list) / *Tones* (or the screen the run came
  from: *My song*, *Composer*, *RTTTL text*).
- **Failed runs:** a Sudden-death fail is titled *Failed*.

### My songs

- **Capacity:** up to 30 saved songs (`ringbeat.songs.v1`).
- **Composer** (Nokia style):
  - Keys 1–7 = c…b, 0 = rest, 8/9 = length, `*` = dot, `#` = sharp. Repeating a key cycles the octave.
  - ▲▼ steps the pitch, ◀▶ moves the cursor, and the left soft key opens the menu: Preview, Name, Tempo (40–250),
    Edit as text, Clear all, Exit.
  - On touch or narrow screens, a note pad replaces the keys. Gamepad and keyboard letters also work; see
    [CONTROLS.md › Composer](CONTROLS.md#composer).
- **Other ways in:** paste or edit RTTTL text; import a single song (it opens in the text screen to be named).
- **Song menu:** Play, Preview, Edit in composer, Duplicate, Export file (`.rtttl`), Copy RTTTL text, Calculate
  difficulty, Copy share link, Delete (two-step).
  The list menu exports or imports everything (`.json`, or RTTTL lines).
- **Difficulty:** custom songs show the density estimate with a `~` (e.g. `~2.5`). *Calculate difficulty* runs the bot
  ladder on the song's chart (with a progress bar; press again to stop) and stores the result with the song. Editing
  the melody clears it.
- **Share links** carry the rating; an imported rating stays unverified (`~`) until *Recalculate*. Formats and versioning:
  [SONGS.md › Custom songs](SONGS.md#custom-songs-my-songs).

### Settings

- **Layout:** one tab at a time between ◄ ► on a narrow LCD; on a wide one (800 px and up) every tab is a panel (Sound, Gameplay, Effects, General, Developer, and Controller last when a pad is connected) in two columns, filled down the left column first, with no tab strip.
- **Items:**
  - Tone (buzzer / smooth / pulse / triangle / arpeggio / bell / organ / pluck / sawtooth / Game Boy)
  - Language (English / Deutsch; follows the browser until set)
  - Volume
  - Scroll time
  - Backing pulse (off by default)
  - Auto-play rolls
  - Song preview
  - Idle animations
  - Hit effects
  - Vibration
  - Latency (calibration)
  - Controller (status, lane-binding buttons, *Reset buttons*; see [CONTROLS.md › Gamepad](CONTROLS.md#gamepad-standard-gamepad-api))
  - Replay tutorial
  - Reset scores & stats (two-step confirm)
  - Developer tab: Performance overlay (also F3), Request tracker and a Glyphs & icons gallery (every new symbol, animation, glyph or icon must be viewable there, see [DEVELOPMENT.md](DEVELOPMENT.md)); both sync to the player account, `?dev` does not affect them
- **From pause:** Latency, Replay tutorial and Reset are hidden.

## Gameplay

- **Charts:** every song has one chart with 4 lanes, generated at Hard or Normal settings (the `difficulty` option of `generateChart`). There is no difficulty choice.
  - Hard keeps every note except ones closer than 90 ms to the previous one; those go to the auto-played backing.
  - A song whose Normal and Hard charts differ by at most 2 notes (`COLLAPSE_MAX`, `src/library.js`) plays
    one chart (`entry.only`): Hard if its Hard rating is at least 5.0 (2.5 stars), else Normal. Every other song plays
    Hard. The result is `entry.chart`, which scores, runs and boards are keyed by. This applies to custom songs too;
    their rating, calculated or estimated, decides.
- **Notes:** taps, and holds for notes ≥ 0.45 s (hold until the tail; releasing in the last 150 ms is fine).
  The following are also derived from the RTTTL text, with no authoring needed:
  - **Short holds** (Normal/Hard): a dotted note followed by a note ≤ ⅓ of its length (dotted quarter → eighth) and
    lasting ≥ 0.2 s is a short hold.
  - **Rolls:** a legato run (gaps under 0.03 s) of ≥ 4 same-pitch notes, each starting within 0.26 s of the last,
    becomes one roll in a single lane: a dotted rail with a bar per tick.
    - Mash the lane from when the roll enters reach (180 ms before the first tick at Normal judging) until 50 ms after
      the last tick.
    - Each press scores 10 × the combo multiplier.
    - There is one judgement at the end, by presses ÷ goal, where goal = `max(3, min(ticks, round((span + 0.1 s) × 9)))`:
      ≥ 80 % is Perfect, ≥ 60 % Great, ≥ 40 % Good, else Miss.
    - Presses inside a roll are never strays. With *Auto-play rolls* on, the first press plays the written notes.
  - **Slides:** a run of ≥ 3 tap notes moving 1–2 semitones per step in one direction (legato, ≤ 0.5 s apart) is
    re-laned to sweep one lane per note (up = right, at most one note per lane, so ≤ 4) and joined by a dotted line.
    The first note is judged normally. The follow-ups accept presses up to ±180 ms off, and anything outside the Good
    window is judged Good. Each note still scores and combos on its own.
  - **Double notes** (Hard): a legato leap of ≥ 7 semitones adds an octave-below partner tap in the neighbouring lane at
    the same time (a bridge joins the two heads). Both notes are judged separately.
- **Judgement windows** (|Δ| from the note time): Perfect ≤ 45 ms, Great ≤ 90 ms, Good ≤ 135 ms, otherwise miss.
- **Score:** Perfect 300 / Great 200 / Good 100, times a combo multiplier of +0.1 per 10 combo, up to ×1.5 at 50 combo
  (a miss resets it). A completed hold adds 100 × the multiplier.
- **Accuracy:** Perfect 1, Great ⅔, Good ⅓, Miss 0, averaged over all judged notes. A dropped hold counts as a miss.
- **Grade:** S ≥ 95 %, A ≥ 90 %, B ≥ 80 %, C ≥ 70 %, D below.
- **Full combo (FC):** no misses in the run (a dropped hold is a miss). **All perfect (AP):** FC and every note Perfect.
- **Stray presses** (a lane press with no note in reach) break the combo and FC, and play a low error buzz, so mashing
  every lane can't play the song for you. They don't count before the first note comes into reach (warm-up), inside a
  roll, or after the last note is judged.
- There is no fail state, unless the opt-in *Sudden death* mod is on (see [Modifiers](#modifiers)).

## Profile

- **Signed out** (the default): the card reads *Player 1*. *Sign in with GitHub* is offered. The button is disabled, with "Online profiles are not available yet.", until the game is built
  with an API address.
- **Signed in:** the card shows the online player name (at first the GitHub display name or username, else `Player-XXXX`). The screen offers:
  - a *Name* field and *Save* beside it (3–16 letters, digits, space, `.` `_` `-`; shown at once, sent with the next sync);
  - *On leaderboards: On/Off* (Off: the player's runs leave the public boards; they still see their own rank);
  - *Sign out*;
  - *Export my data* (downloads everything the server stores about the player as JSON);
  - *Delete online profile* (press twice; this device keeps its own data).

  *Privacy policy* is always shown (signed in or out). It opens [PRIVACY.md](PRIVACY.md) on GitHub in a new tab.

  The line below shows when the last sync was.
- **What syncs:**
  - settings, except volume, latency, controller buttons and the last selected song;
  - favourites;
  - My songs;
  - highscores and stats.

  Highscores and stats from every signed-in device are shown combined: pooled top 10, summed plays and counters, play
  days counted once. Resetting scores & stats while signed in resets every device. Details:
  [CLOUD.md](CLOUD.md).
- Every finished run that makes the local top 10 is also uploaded (song, chart, score, grade, accuracy, combo,
  FC/AP, mods, time, and the run's inputs as a replay) for the [world leaderboards](#world-leaderboards).

## Highscores

- Stored locally (`ringbeat.scores.v1`) per song id and chart: the top 10 runs and a play count.
- A run stores score, grade, accuracy, max combo, fc, ap and date, plus the `mods` tags and `mult` for modded runs.
  Runs are ranked by score; on a tie, the newer run ranks below the older one.
- Custom songs are keyed by a hash of their RTTTL text, so scores follow the melody.
- Failed (Sudden death) runs and Demo runs are never recorded. Highscores can be reset in Settings (two-step confirm;
  this also clears stats).

## World leaderboards

- One board per song id and chart (the one the song plays): each player's best run, ranked by score (on a tie, the earlier run first).
  Built-in and custom songs both have boards.
- The score on a board is the server's: it re-plays the run's inputs. Runs without a replay (from before 2.1) and
  runs played under older scoring rules (`RULES`) don't rank. Details: [CLOUD.md › Leaderboards](CLOUD.md#leaderboards).
- **Results screen:** signed in, a new best is uploaded at once and the score page shows *World #n of total* (the
  player's best run on that board), or *Not ranked* / *Not ranked: update the game* / *World rank pending*. Any
  other run shows the world rank last seen for that board, or nothing when there is none yet. Signed out: *Sign in
  for world ranks*.
- **Song detail** (the picker's details pane): the *Global* tab shows the world top 10 around the player's rank; *Local* shows the local top runs.
  Boards are readable signed out; they are cached for a minute.

## Stats

- **Stored locally** (`ringbeat.stats.v1`):
  - playtime (song time actually played; pauses are excluded, and time is banked at pause, quit, restart and finish);
  - runs (finished / failed), quits and restarts;
  - lifetime score (after mods) and best combo;
  - judgement totals, ghost taps and FC/AP runs;
  - modded and My-songs runs;
  - first/last play, days played, and the current and best play-day streak (consecutive local days).

  Neither the tutorial nor Demo runs are counted.
- **Grade counts** are derived from the highscores (best grade per song), so they always match the song list.
- **Backfill:** players with highscores from before 1.3 got a one-time backfill (runs, FCs/APs, best combo, a lower
  bound of lifetime score, days played). Playtime and note totals started at 0.
- **Pages** (◄►; the header reads e.g. "Time 1/5"):
  - **Time:** total playtime, runs, finished, days played, play-day streak.
  - **Score:** lifetime score count-up, best combo, average per run, favourite song, modded and My-songs runs.
  - **Top:** every played song by play count, scrollable with ▲▼.
  - **Grades:** songs per best grade S–D as bars, FC/AP counts, played/total.
  - **Notes:** lifetime judgement mix, accuracy, ghost taps, FC/AP runs.
  - **Online:** signed in: average world rank, boards, world #1s, top 10s and the best boards. Signed out: a sign-in hint.

## Modifiers

A sticky loadout (`settings.mods`) chosen with the picker's modifier chips and applied to every run, except the tutorial. Most mods
are chart transforms (`src/mods.js`); the rest are `Game.start` options.

| Mod | Values | Effect | Score |
|---|---|---|---|
| Speed | 0.5 / 0.6 / 0.7 / 0.8 / 0.9 / 1.0 / 1.1 / 1.2 / 1.3× | time axis scaled; pitch unchanged | ×0.5 … ×1.3 |
| Mirror | on/off | lanes flipped left↔right | ×1.00 |
| Hidden | on/off | notes are not drawn in the last 35 % of the approach (held notes stay visible) | ×1.10 |
| Sudden death | on/off | the first miss, dropped hold or stray press ends the run (*Failed*, not saved) | ×1.20 |
| Judging | Lenient / Normal / Strict | hit windows ×1.4 / ×1 / ×0.7 (slide windows and roll reach too) | ×0.80 / ×1 / ×1.15 |
| Demo (autoplay) | on/off | a bot plays the run perfectly; your input is ignored; nothing is saved or counted in stats | ×0 |

- The multiplier is the product of the active mods, capped at 2.0 (no floor) (except Demo, which forces 0), and is folded
  into the stored score. Grade and accuracy stay raw.
- Mod tags (e.g. `1.2x HD`) are stored with the run and shown in the HUD, in top runs and on results.
- Stars are rated on the unmodded chart. The picker's modifier chips show the active loadout, and
  the multiplier is shown next to the chips and on results.

## Tutorial

- **When it's offered:** the first time Tones is opened, unless the player already picked a song. Saying no marks it
  done. Replay it from Settings → Replay tutorial.
- **Lessons:** four short ones, played through the normal game loop on hand-made charts at 100 BPM (`src/tutorial.js`):
  1. Tap notes (with the timing judgements)
  2. Hold notes
  3. Roll notes
  4. Slides and doubles
- **Lesson cards:** each lesson opens with a card that waits for the player to confirm. The card shows a small lane
  diagram, a sentence, and (first card only) the controls for the input device in use; the hint updates live if the
  device changes. A strip of boxes shows lesson progress.
- **No pass/fail:** finishing a round moves on to the next card. ←/→ or swipes move back and forward over lessons
  already played; that count is saved as `settings.tutorialLessons`.
- **Leaving:** the right soft key / *Skip tutorial* ends the tutorial, and the pause menu offers *Back to lesson*.
- **Closing card:** explains combos and the Full Combo, and offers *Pick a song* or *Calibrate*.
- The tutorial ignores mods and is not counted in stats. `npm run bench:tutorial` measures each lesson's length and how
  hard it is for bots.

## Extras

Decorative and harmless: none of these touch scores, stats or the selection.

- **Idle cameos** (setting *Idle animations*): every 45–150 s on the title, menu or song select, a small gag plays on the
  LCD. The gags are Snake, Space Impact, a fake SMS envelope, a signal wobble and a once-only low battery. They chirp
  only if audio is already running.
- **Konami code** (keyboard, or d-pad + B A on a gamepad) on title / menu / song select: "Cheat activated", a flash and a
  snake parade.
- **IMEI panel** (↓ ↑ ↓ ↑ A on keyboard or gamepad on title / menu / song select, or five quick taps on the title screen's version label): a fake, Luhn-valid IMEI, the version and build, and a credit link.
- **Holding C** for 1.2 s on title / menu / song select: "Clearing memory…", then "Just kidding."

## Controls

See [CONTROLS.md](CONTROLS.md).

## Timing model

The audio clock (`AudioContext.currentTime`) is the only time source. Input timestamps are mapped onto the audio
timeline (`eventAudioTime`), and the output latency and the player's calibration offset are subtracted from song time.

Gamepad input is polled once per animation frame (the Gamepad API has no event timestamps), which limits controller
timing resolution to one frame (~16 ms at 60 Hz). The pad's own `timestamp` is used when sane.

## Persistence

Everything stays in the browser's `localStorage`: settings, highscores, stats and My songs. Keys and contents are listed
in [ARCHITECTURE.md › Persistence](ARCHITECTURE.md#persistence). With an online profile, the same data is also synced
through the Ringbeat API ([CLOUD.md](CLOUD.md), [PRIVACY.md](PRIVACY.md)); `localStorage` stays the source of truth.

## Non-goals

User-authored charts beyond RTTTL, keyboard rebinding (only gamepad buttons are rebindable), gamepad rumble (phones
can vibrate; see Settings), audio files.

See also: [CONTROLS.md](CONTROLS.md) · [SONGS.md](SONGS.md) · [ARCHITECTURE.md](ARCHITECTURE.md)
