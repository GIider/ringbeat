[Ringbeat](../README.md) › Docs

# Ringbeat docs

The map of everything written down about Ringbeat. Start with the [project README](../README.md) for the pitch and
a quick start; come here for the details.

## Playing

| Doc | What's in it |
|---|---|
| [SPEC.md](SPEC.md) | Product behaviour: screens and flow, gameplay rules and numbers, highscores, stats, modifiers, tutorial, extras |
| [CONTROLS.md](CONTROLS.md) | Every input: keyboard, the drawn phone keys, touch, gamepad |

## Design

| Doc | What's in it |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map of `src/`, `scripts/` and `tests/`, key design decisions, storage keys |

## Contributing

| Doc | What's in it |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Setup, npm scripts, dev server, tests, git hooks, debug URLs and hooks, editing the font |
| [SONGS.md](SONGS.md) | RTTTL format, adding a built-in song, difficulty ratings and `npm run bench`, custom songs and share links |
| [TRANSLATIONS.md](TRANSLATIONS.md) | How UI strings are translated, adding a string, adding a language |
| [RELEASING.md](RELEASING.md) | Versioning, changelog messages, the `dist/` build, CI deploy and screenshots |
| [PERFORMANCE.md](PERFORMANCE.md) | The in-browser profiler and the node / headless-browser benchmarks |

## I want to…

| Task | Go to |
|---|---|
| Run the game locally | [DEVELOPMENT.md › Setup](DEVELOPMENT.md#setup) |
| Run the tests | [DEVELOPMENT.md › Tests](DEVELOPMENT.md#tests) |
| Look at one screen without playing to it | [DEVELOPMENT.md › Debug URLs and hooks](DEVELOPMENT.md#debug-urls-and-hooks) |
| Find the module that does X | [ARCHITECTURE.md › Source map](ARCHITECTURE.md#source-map) |
| Add a built-in song | [SONGS.md › Adding a built-in song](SONGS.md#adding-a-built-in-song) |
| Change charting or the bots (ratings move) | [SONGS.md › Difficulty ratings](SONGS.md#difficulty-ratings) |
| Add a UI string or a language | [TRANSLATIONS.md](TRANSLATIONS.md) |
| Ship a new version | [RELEASING.md › Releasing a minor version](RELEASING.md#releasing-a-minor-version) |
| Change a glyph in the LCD font | [DEVELOPMENT.md › Editing the pixel font](DEVELOPMENT.md#editing-the-pixel-font) |
| Check a change didn't slow frames down | [PERFORMANCE.md](PERFORMANCE.md) |
| Look up a timing window or score rule | [SPEC.md › Gameplay](SPEC.md#gameplay) |

`tests/docs.test.mjs` keeps this set honest: it fails on broken links between docs, on a source file, script or test
missing from [ARCHITECTURE.md](ARCHITECTURE.md), and on an npm script missing from [DEVELOPMENT.md](DEVELOPMENT.md).
