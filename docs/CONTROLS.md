[Docs](README.md) › Controls

# Controls

Keyboard, the soft buttons (on the LCD and on the phone body), touch and gamepad all drive the same focus navigation (`src/nav.js`), so every screen
works with every input. Lane keys are fixed; gamepad buttons are rebindable. What the screens do is described in
[SPEC.md](SPEC.md).

## Keyboard

| Action | Keys |
|---|---|
| Lanes (4) | `D` `F` `J` `K` |
| Title | any key |
| Main menu | `↑` `↓` (or `←` `→`) browse, `1`–`6` (`7` with the Admin item) jump to an item, `Enter` open, `Esc` / `Backspace` back to the title |
| Menu navigation | arrows (spatial focus), `Enter` / `Space` activate, `Tab` also works |
| Back / pause / resume | `Esc` or `Backspace` (`Esc` also cancels a controller-button capture) |
| Restart (count-in, play, pause, results) | `R` |
| Sliders | `←` `→` |
| Song select: category | `←` `→`, or `[` `]` |
| Song select: sort (previous / next) | `D` / `F` |
| Song select: toggle favorite | `V` |
| Results pages | `←` `→`, or `[` `]` |
| Stats pages | `←` `→`; `↑` `↓` scroll the Top page |
| Message | `↑` `↓` scroll, `←` `→` previous / next message |
| Tutorial cards | `←` `→` back / forward over lessons already played |
| Calibration | any key taps |
| Profiler | `F3` toggle, `F4` copy report (see [PERFORMANCE.md](PERFORMANCE.md#in-the-browser)) |

### Composer

| Action | Keys |
|---|---|
| Notes | `1`–`7` = c…b (repeat a key to cycle the octave), or the letters `a`–`g` |
| Rest | `0` or `p` |
| Length shorter / longer | `8` / `9` |
| Dot | `*` or `.` |
| Sharp | `#` or `+` |
| Pitch step / cursor | `↑` `↓` / `←` `→` |
| Delete | `Backspace` or `Delete` |
| Preview | `Space` or `Enter` |

In the RTTTL text box, `Enter` leaves the field (`Shift+Enter` = newline), and `↑` / `↓` leave it from the first / last
position.

## Soft keys (mouse / touch)

Every screen has two buttons along the bottom of the LCD, both tappable: left = the action (Select by default, Read, Next, Retry…),
right = Back (Continue on the results, Pause during play, Clear in the composer). `Enter` / `Esc` and the gamepad's A / B do the
same. Holding the right one for 1.2 s on the title, menu or song select runs a gag (see [SPEC.md › Extras](SPEC.md#extras)).

The LCD label is tappable too. In the main menu, swipe or scroll the wheel to browse, tap the icon to open it, or tap the item peeking in above or below.

## Gamepad (Standard Gamepad API)

Any controller the browser maps to the Standard Gamepad layout works. Menus follow the d-pad and left stick, `A` / Start select
and `B` goes back. The default lane buttons follow the finger order: lane 1 = `LB` / `LT`, lane 2 = d-pad right,
lane 3 = `X`, lane 4 = `RB` / `RT`. Settings › Controller shows the connection status, lets you capture a new button per
lane (`Esc` cancels) and has a *Reset buttons* action. Song picker buttons are in the
[song picker table](#song-picker-navigation).

## Developer tools

Settings › Developer has two viewers, **Glyphs & icons** and **Sound library**. Both are grids: arrows / d-pad move, `Enter` / `A`
(or a tap) activates (in the Sound library that plays the sound and cuts the previous one), and `Esc` / `B` / the right soft key
goes back to the Developer tab with the viewer's entry highlighted. The focused cell is remembered for the session.

## Touch

- **Play:** tap and hold the lane columns (multi-touch). To hit a double or triple with fewer fingers, press the first lane and slide the
  same finger across the others in time: each slide hits that lane's chord note (nothing else, a stray slide is ignored). The right soft button pauses.
- **Title:** tap anywhere.
- **Main menu, Stats, Results, Messages, tutorial cards:** swipe left / right for the next / previous item or page (tap
  the arrows or tabs where shown). Tap a loading message to skip the animation.
- **Song select:** on wide screens every navigation key is listed in a panel to the right of the phone. There is no hint line
  on the LCD, so narrow screens show none. On a narrow screen the details view (after the first Select) steps to the next /
  previous song with a vertical swipe, ↑ ↓ or the d-pad. With a controller, the category arrows in the header also become
  LB / RB.
- **Tutorial cards:** show the lane inputs for the device in use (keys, pad buttons or touch).
- **Legend:** on wide screens, a legend beside the phone lists the menu and play keys.

Keyboard or mouse input switches all of these back.

See also: [SPEC.md](SPEC.md) · [ARCHITECTURE.md](ARCHITECTURE.md#key-decisions)

## Song picker navigation

The list shows `Category pos/total · group` in the header, where the group depends on the sort: first letter (Title),
star band, BPM band or duration band. A scroll thumb on the right edge shows where you are.

| Action | Keyboard | Controller | Touch |
|---|---|---|---|
| Next / previous category | `◄ ►`, `[` `]` | LB / RB | swipe the list, header arrows |
| Category hub (all groups + counts) | `G` | Y | tap the header |
| Page up / down | PageUp / PageDown | hold the d-pad (speeds up) | scroll |
| First / last song | Home / End | | |
| Previous / next group | `J` `K` | Back / RT | A–Z strip (Title sort) |
| Find (live title / tag filter) | `/` (Esc clears) | | **Find** chip |
| Random song in the current view | `R` | X | |

Besides the seven categories the hub offers **Recent** (the last 20 songs played on this device, newest first),
**Unplayed** (no score yet), **Custom** and **Favorites**.
