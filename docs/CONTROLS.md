[Docs](README.md) › Controls

# Controls

Keyboard, the drawn phone keys, touch and gamepad all drive the same focus navigation (`src/nav.js`), so every screen
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
| Song select: list difficulty (toggle) | `.` |
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

## Phone keys (mouse / touch)

The drawn phone's keys work, laid out like a 3310:

- **Menu** key (wide oval under the LCD): does what the single centred label says (Select / Read / Next…). On the song
  list it picks the song. During play it pauses.
- **C** (left): Back (Del in the composer). During play it pauses. Holding it for 1.2 s on the title, menu or song select
  runs a gag (see [SPEC.md › Extras](SPEC.md#extras)).
- **▲▼ rocker** (right): up / down.
- **Song list keypad:** `1` / `3` page up / down, `7` / `9` previous / next group, `0` random song. (`*` and `#` stay free for
  the secret dial codes; Up from the first song wraps to the last.)
- **Keypad:** `5` = select (pauses during play), `2` `8` `4` `6` = up / down / left / right. In the composer the keypad
  is the note entry, as on the keyboard.

The LCD label is tappable too. In the main menu, swipe or scroll the wheel to browse, or tap the icon or the ◄ ► arrows.

On the bare LCD (compact mode) there are no phone keys, so both soft-key labels are shown and tappable: left = the
action, right = Back.

## Gamepad (Standard Gamepad API)

Any controller the browser maps to the Standard Gamepad layout works. Menus follow the d-pad and left stick, `A` / Start select
and `B` goes back. The default lane buttons follow the finger order: lane 1 = `LB` / `LT`, lane 2 = d-pad right,
lane 3 = `X`, lane 4 = `RB` / `RT`. Settings › Controller shows the connection status, lets you capture a new button per
lane (`Esc` cancels) and has a *Reset buttons* action. Song picker buttons are in the
[song picker table](#song-picker-navigation).

## Touch

- **Play:** tap and hold the lane columns (multi-touch). The soft keys pause.
- **Title:** tap anywhere.
- **Main menu, Stats, Results, Messages, tutorial cards:** swipe left / right for the next / previous item or page (tap
  the arrows or tabs where shown). Tap a loading message to skip the animation.
- **Song select:** on wide screens every navigation key is listed in a panel to the right of the phone. There is no hint line
  on the LCD, so narrow and compact screens show none. With a controller, the category arrows in the header also become
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
**Unplayed** (no score yet on the current difficulty), **Custom** and **Favorites**.
