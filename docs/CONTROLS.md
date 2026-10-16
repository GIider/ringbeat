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
| Main menu | `↑` `↓` (or `←` `→`) browse, `1`–`6` jump to an item, `Enter` open, `Esc` / `Backspace` back to the title |
| Menu navigation | arrows (spatial focus), `Enter` / `Space` activate, `Tab` also works |
| Back / pause / resume | `Esc` or `Backspace` (`Esc` also cancels a controller-button capture) |
| Restart (count-in, play, pause, results) | `R` |
| Sliders | `←` `→` |
| Song select: category | `←` `→`, or `[` `]` |
| Song select: sort (previous / next) | `D` / `F` |
| Song select: list difficulty | `J` / `K` |
| Song select: toggle favorite | `V` |
| Results pages | `←` `→`, or `[` `]` |
| Stats pages | `←` `→`; `↑` `↓` scroll the Top page |
| Message | `↑` `↓` scroll, `←` `→` previous / next message; any key skips the opening animation |
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
- **Keypad:** `5` = select (pauses during play), `2` `8` `4` `6` = up / down / left / right. In the composer the keypad
  is the note entry, as on the keyboard.

The LCD label is tappable too. In the main menu, swipe or scroll the wheel to browse, or tap the icon or the ◄ ► arrows.

On the bare LCD (compact mode) there are no phone keys, so both soft-key labels are shown and tappable: left = the
action, right = Back.

## Touch

- **Play:** tap and hold the lane columns (multi-touch). The soft keys pause.
- **Title:** tap anywhere.
- **Main menu, Stats, Results, Messages, tutorial cards:** swipe left / right for the next / previous item or page (tap
  the arrows or tabs where shown). Tap a loading message to skip the animation.
- **Song select:** swipe the list left / right (or tap ◄ ►) to change category; tap the sort or difficulty chip to cycle
  it; tap a song to select it, tap the selected song again to play. Tap the icon of the selected song to toggle its favorite.
- **Composer:** on touch / narrow screens a note pad (C–B, rest, length, dot, sharp, pitch, delete) replaces the keys.
- Sliders get a taller touch target on touch / narrow screens. With *Hit effects* and *Vibration* on, phones buzz on
  Perfect hits and when a combo breaks.

## Gamepad (Standard Gamepad API)

Gameplay defaults (each lane has several buttons):

| Lane | Buttons |
|---|---|
| 1 (left) | D-pad ←, X, LB, LT |
| 2 | D-pad ↓, A |
| 3 | D-pad ↑, Y |
| 4 (right) | D-pad →, B, RB, RT |

`Start` pauses, `Back/Select` restarts.

**Rebinding:** in Settings → Controller, press a lane's button, then the gamepad button. That button becomes the lane's
only binding, and a button belongs to at most one lane. *Reset buttons* restores the defaults. Bindings are saved.

Menus:

| Action | Input |
|---|---|
| Move | D-pad or left stick |
| Adjust slider | ← → |
| Confirm | A (or Start) |
| Back | B |
| Song select: category − / + | LB / RB (or ← →) |
| Song select: next sort | LT |
| Difficulty screen: open Mods | X |
| Stats / Results / Message: page − / + | LB / RB (or ← →) |
| Calibration | any button taps; B or Start leaves |

Composer:

| Action | Input |
|---|---|
| Add a copy of the last note / rest | A / Y |
| Tune the note / move the cursor | D-pad up-down / left-right |
| Length shorter / longer | LB / RB |
| Preview | X |
| Composer menu | Start |

A disconnect during play pauses the game. Controllers appear to the browser only after their first button press.

## On-screen hints

- **Song select:** the hint line under the list shows the navigation keys: `◄► Cat · D/F Sort · J/K Diff · V Fav` on keyboard,
  or `LB/RB Cat · LT Sort` once a controller is used. With a controller, the category arrows in the header also become
  LB / RB.
- **Tutorial cards:** show the lane inputs for the device in use (keys, pad buttons or touch).
- **Legend:** on wide screens, a legend beside the phone lists the menu and play keys.

Keyboard or mouse input switches all of these back.

See also: [SPEC.md](SPEC.md) · [ARCHITECTURE.md](ARCHITECTURE.md#key-decisions)
