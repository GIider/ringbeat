# Controls

## Keyboard
| Action | Keys |
|---|---|
| Lanes (4) | `D` `F` `J` `K` |
| Lanes (Easy, 3) | `F` `J` `K` |
| Menu navigation | `↑` `↓` (spatial focus), `Enter`/`Space` activate, `Tab` also works |
| Difficulty (song select) | `←` `→` |
| Options (song select) | `O` |
| Category (song select) | `[` `]`, or play keys `D` `F` (prev / next) |
| Sort (song select) | play keys `J` `K` (prev / next) |
| Back / pause / resume | `Esc` or `Backspace` |
| Restart (play, pause, results) | `R` |
| Sliders | `←` `→` |

## Phone keys (mouse / touch)
The drawn phone's keys work: left soft key (green call key) = the left label on the LCD (Options / Select / Play…),
right soft key (red end key) = Back, the centre key or `5` = select, `2` `8` `4` `6` = up / down / left / right.
The soft-key labels on the LCD are tappable too. During play, either soft key or the centre key pauses.

## Touch
Tap and hold the lane columns (multi-touch). On small screens the on-screen ❚❚ pauses. Menu items are plain buttons.

## Gamepad (Standard Gamepad API)
Gameplay — defaults, each lane has several buttons:

| Lane | Buttons |
|---|---|
| 1 (left) | D-pad ←, X, LB, LT |
| 2 | D-pad ↓, A |
| 3 | D-pad ↑, Y |
| 4 (right) | D-pad →, B, RB, RT |

Easy (3 lanes) folds lane 1 and 2 onto the left lane, so every button stays live.
`Start` pauses, `Back/Select` restarts. Buttons are rebindable in Settings → Controller
(press the lane, then the button; a button belongs to at most one lane). Bindings are saved.

Menus:

| Action | Input |
|---|---|
| Move | D-pad or left stick |
| Adjust slider | ← → |
| Confirm | A (or Start) |
| Back | B |
| Difficulty − / + (song select) | LB / RB |
| Toggle Training mode (song select) | Y |
| Options (song select) | X |
| Next category (song select) | RT (keyboard: `[` / `]`) |

A disconnect during play pauses the game. Notes: controllers appear to the browser only after the first button press.

## Tutorial
Shown automatically the first time you start the game (skipped for players who already picked a song). Four short lessons teach taps, timing, holds and combo. Each lesson opens with a text card that waits for you to confirm, shows "Lesson n of N" progress, and only unlocks the next lesson once you meet its goal (no misses, plus an accuracy target on some). Replay it from Settings → Replay tutorial.

## Song select hints
The song list shows each song's note count for the selected difficulty, and a hint line under it lists
the navigation keys (◄► difficulty, D/F category, J/K sort). Once a controller is used, the hint line and
the difficulty arrows switch to the controller buttons (LB/RB, RT, LT); keyboard or mouse input switches them back.
