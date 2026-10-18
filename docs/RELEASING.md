[Docs](README.md) › Releasing

# Releasing

Every push to `main` is a release: CI tests it, builds it, and deploys it to <https://giider.github.io/ringbeat/>.
Version numbers are derived from the changelog and git, so they are never edited by hand.

## Versioning

`<major>.<minor>.<patch>` comes from `scripts/version-lib.mjs` (`computeVersion`):

- **major.minor** is the `version` of the newest entry in `src/changelog.js` (`MESSAGES[0]`; it must be `X.Y`).
- **patch** is the number of commits since the commit that added that entry. That commit is the oldest one found by
  `git log -S"version: 'X.Y'"` on the changelog. The commit that adds the entry is therefore `X.Y.0`.
- If git history is unavailable (a shallow clone, no git), the result is `X.Y.0`, flagged as inexact. That's why the
  CI build checks out with `fetch-depth: 0`.

`node scripts/version-lib.mjs` prints the version the current checkout would get. Unbuilt source runs as
`X.Y.0-dev` (`src/version.js`).

## Releasing a minor version

Add a message to the top of `MESSAGES` in `src/changelog.js`:

```js
{
  version: '1.5', date: '2026-11-01', title: 'Short title',
  body: 'One line per change.\n' +
    'Keep it SMS-short.',
},
```

The tests enforce four rules:
- Versions strictly decrease down the list.
- `date` is `YYYY-MM-DD`.
- Every character in the title and body has a glyph in the LCD font (plain ASCII plus the font's symbols).
- The title and body have German translations in `src/lang/de.js`. Run `node scripts/i18n-keys.mjs` to list them; see
  [TRANSLATIONS.md](TRANSLATIONS.md).

In the game, the changelog is the **Messages** inbox: one SMS per version, and an update leaves exactly the new one
unread (the read state is `settings.msgSeen`). The main menu's Messages icon shows an envelope while anything is unread.

Patch releases need nothing: every commit to `main` bumps the patch.

## The dist build

`npm run build` (`scripts/build-dist.mjs`):
1. Wipes `dist/`.
2. Copies the runtime files (`index.html`, `style.css`, `src/`, `assets/`).
3. Stamps `dist/src/version.js` with:
   - `VERSION`: from [Versioning](#versioning).
   - `BUILD.number`: `BUILD_NUMBER`, digits only, default 0. CI passes the Actions run number.
   - `BUILD.commit`: the first 7 characters of `GITHUB_SHA`, else `git rev-parse --short=7 HEAD`, else `dev`.
   - `BUILD.date`: today.

The source `src/version.js` is never modified. The title screen shows the version and `commit · date`; the IMEI
panel (see [SPEC.md › Extras](SPEC.md#extras)) also shows `Build <number>`.

## CI

**`.github/workflows/deploy.yml` (Test & Deploy)** runs on pushes to `main`, pull requests and manual dispatch.

0. **changes**: decides whether the push touches anything but documentation. It diffs the pushed range (or the PR against
   its base) and counts only `docs/**`, `*.md` in the repository root and `LICENSE` as documentation. A
   documentation-only change runs just `node --test tests/docs.test.mjs` in **test** (links, anchors and the file lists
   in the docs) and skips **build**, **deploy** and **deploy-api**; the site, the `latest` release and the Worker stay as
   they were. Manual dispatch, a force-push (the old commit is gone) and any other changed file run everything.
1. **test** (Node 22), for a code change:
   - `npm ci`, then installs Playwright Chromium, Firefox and WebKit.
   - `npm test` (node tests + Chromium smoke).
   - The smoke test again in Firefox and WebKit, then in WebKit with `SMOKE_DEVICE='iPhone 13'`.
2. **build** (not on pull requests):
   - `npm run build` with `BUILD_NUMBER` = the run number.
   - Zips `dist/` and replaces the `latest` GitHub pre-release (titled `v<version> (latest build)`) with it.
   - Uploads `dist/` as the Pages artifact.
3. **deploy**: publishes the artifact to GitHub Pages.
4. **deploy-api** (not on pull requests; parallel to build): in `server/`, `npm ci`, `npm run migrate` (D1 migrations)
   and `npm run deploy` (the Worker). It needs the `CLOUDFLARE_API_TOKEN` repository secret and is skipped without it.
   The Worker re-plays runs with the game's own modules, so it ships from the same commit as the pages (see
   [CLOUD.md › Leaderboards](CLOUD.md#leaderboards)).

### Screenshots

**`.github/workflows/screenshots.yml`** runs on pushes to `main` (except documentation-only ones, by `paths-ignore`) and on manual dispatch. It keeps the README images current
without adding them to `main`'s history:

1. Checks out the existing `screenshots` branch as a worktree, with git hooks disabled.
2. Runs `SCREENSHOT_DIR=… npm run screenshots` with ImageMagick installed.
3. If any image changed, force-pushes a single parentless commit to `screenshots`.

The README links to `raw.githubusercontent.com/GIider/ringbeat/screenshots/<name>.png`.

`npm run screenshots` (`scripts/screenshots.mjs`) takes eight shots from `?demo=` states (see
[DEVELOPMENT.md › Debug URLs and hooks](DEVELOPMENT.md#debug-urls-and-hooks)), all as the same signed-in demo player:
- `results` (with a filled global leaderboard), `stats` (every page, with scores, grades and world ranks), `pause` and `profile` at desktop size (1000×1100, the wide LCD), and `select` (seeded grades and FC/AP badges, the details pane with a filled global board and a modifier loadout switched on, and the key legend beside the phone) at 1280×1100.
- `info` (the song details view), `play` and `inbox` at mobile size (480×800).
Shots that are no longer taken are deleted from the output directory, so the published branch loses them on the next run.

The player is `scripts/lib/screenshot-fixture.mjs`: a fake cloud sign-in with cached world boards and ranks, lifetime stats, local scores, a modifier loadout and read messages, written into localStorage before the page loads. The API address points nowhere and `?demo=` pages skip the sync, so no shot touches the network.
All of them use reduced motion, the en-US locale and the UTC timezone. Locally they go to the git-ignored `docs/screenshots/`.
With ImageMagick (`magick` or `convert`), each shot is reduced to a 128-colour PNG8 and only rewritten when its pixels
differ, so unchanged shots keep their exact bytes.

See also: [DEVELOPMENT.md](DEVELOPMENT.md) · [TRANSLATIONS.md](TRANSLATIONS.md) · [ARCHITECTURE.md](ARCHITECTURE.md)
