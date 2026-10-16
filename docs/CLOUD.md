[Docs](README.md) › Cloud save

# Cloud save

Signing in on the Profile screen is optional. It creates an **online profile**, and that profile keeps settings,
favourites, my songs, scores and stats the same on every device. Every finished run is also stored on the server, as
a base for online leaderboards later. The game is a static site, so the online part is a separate
**Cloudflare Worker + D1** API in `server/`. Sign-in is with GitHub.

- Signed out, nothing changes: `localStorage` is the only store and no request leaves the browser.
- Signed in, `localStorage` is still the source of truth. Sync happens:
  - at start,
  - a few seconds after a run, a settings change or a song edit,
  - when the tab comes back.

  Whatever is left goes up when the tab is hidden. A failed sync just tries again later.

What is stored online, and how to delete it: [PRIVACY.md](PRIVACY.md).

## Sync model

The data falls into two kinds, which avoids nearly all conflicts.

**Per device: scores and stats.** Each device has a random id (`ringbeat.device.v1`).
- It uploads only its own scores and stats, exactly as stored, as its **device slot**. Only that device writes its
  slot, so slots never conflict.
- The other devices' slots are downloaded into `ringbeat.cloud.v1`.
- The stores (`scores.js`, `stats.js`) show the slots combined (`setRemote`, `combineScores`, `combineStats`), but
  `record` / `recordRun` keep writing this device's data only. The combining works like this:
  - **Scores:** the top runs of every slot are pooled (a run seen twice counts once) and cut to the top 5. Plays add
    up, and FC/AP are sticky. The rank on the results screen counts every device's runs.
  - **Stats:** counters add up. Best combo and best streak take the max, first played the min. Play days are pooled
    from each slot's `days` list, so a day played on two devices counts once and a streak can run across devices.
    Stats saved before the list existed keep their old day count as `daysBase`.
- **Reset scores & stats** while signed in resets every device:
  - the shared document's `resetAt` moves forward;
  - on its next sync, every device clears its own data;
  - slots older than `resetAt` are ignored until their device uploads again.

  A reset while signed out stays on that device.

**Shared: settings, favourites, my songs.** One document that every device edits (`cloudmerge.js`, `mergeShared`).
- **Settings** (`SYNCED_SETTINGS`): the newest change wins, field by field. `saveSettings` stamps each changed field
  (`_t` in `ringbeat.v1`). Read messages are pooled. Some settings stay on each device and are never synced:
  - volume and calibration (the audio latency belongs to the device),
  - controller bindings,
  - the last selected song.
- **Favourites:** `{id: {on, t}}` (`_fav` in `ringbeat.v1`), newest mark wins. On a tie, the favourite stays on.
- **My songs:** matched by `uid`, and the newest `updated` wins.
  - Deletes are remembered (`ringbeat.songs.gone.v1`), so they reach other devices.
  - The same melody saved on two devices is kept once.
  - A merge never drops a song: the list can grow past the 30-song limit, which only applies to adding.

The merge is commutative and idempotent. Writes carry the revision they were based on. If another device wrote in
between, the API answers 409, and the client merges with the newer copy and tries again.

**Runs.** Each finished run (not demo, tutorial or failed) goes into an outbox (`ringbeat.cloud.v1`) and is posted to
`/runs`.
- A run carries song id, difficulty, score, grade, accuracy, max combo, FC/AP, mods, multiplier, game version and
  time.
- Its id is `device:song:difficulty:time`. The first sync after signing in also uploads the device's existing top
  runs; because the ids match, the server stores each run once.
- Song ids are stable: library ids for built-in songs, `custom:<hash of the RTTTL>` for custom ones.

## Sign-in flow

1. **Sign in with GitHub** sends the browser to `GET /auth/github/start?return=<game URL>`. The return address must be
   on an allowed origin. The API stores a one-time `state` and redirects to GitHub. No OAuth scope is requested, which
   means public profile info only.
2. GitHub calls back to `GET /auth/github/callback`. The API:
   - exchanges the code,
   - reads the numeric user id and the display name from `api.github.com/user` and drops the GitHub token,
   - finds or creates the profile. A new profile is named after the GitHub display name, else the username
     (`playerName`: accents dropped, unsupported characters removed, long names cut at a word). If neither leaves a
     valid name, it's `Player-XXXX`. A profile still on its `Player-XXXX` name takes the GitHub name at its next
     sign-in. A name the player chose is never replaced,
   - redirects to `<game URL>#login=<one-time code>` (or `#login-error=<reason>`).
3. The game removes the hash and posts the code to `POST /auth/exchange` (one-time use, valid for 2 minutes). It gets
   back a bearer token, valid for one year, which it keeps in `ringbeat.cloud.v1`. Cookies aren't used: the API's
   domain would be third-party on the game's page.

## API

All JSON. Everything except the auth routes needs `Authorization: Bearer <token>`. A 401 signs the device out, and
the device keeps its own data.

| Route | Does |
|---|---|
| `GET /auth/github/start?return=` | Starts sign-in (browser navigation) |
| `GET /auth/github/callback` | GitHub's redirect target (browser navigation) |
| `POST /auth/exchange` `{code}` | → `{token, profile}` |
| `POST /auth/logout` | Ends this token |
| `GET /me` | → `{profile: {id, name, created, logins}}` |
| `PATCH /me` `{displayName}` | 3–16 characters: letters, digits, space, `.` `_` `-` |
| `DELETE /me` | Deletes the profile and everything stored with it |
| `GET /sync` | → `{shared: {doc, rev}, devices: {deviceId: doc}}` |
| `PUT /sync/shared` `{doc, baseRev}` | 409 when `baseRev` is stale |
| `PUT /sync/device/:id` `{doc}` | This device's slot; the newest 20 devices are kept |
| `POST /runs` `{runs: [...]}` | Up to 50 runs; invalid ones are dropped, repeats ignored |

Limits:
- Request bodies up to 300 000 characters, each stored document up to 256 000.
- 60 requests a minute per token or IP, through the optional `LIMITER` binding.
- CORS only for `ALLOWED_ORIGINS`.

## Data model

`server/migrations/0001_init.sql` creates these tables:

| Table | Holds |
|---|---|
| `users` | A profile: our own id, display name |
| `identities` | `(provider, subject) → user`; GitHub's numeric id. Another login provider becomes another row on the same user |
| `sessions` | SHA-256 of each bearer token, expiry |
| `oauth_states`, `login_codes` | Short-lived sign-in state |
| `shared_docs` | The shared document and its revision |
| `device_slots` | One row per user × device |
| `runs` | Every uploaded run, indexed by `(song_id, diff, score)` for leaderboards. `replay` is reserved for checking scores on the server: charts are deterministic (`chart.js`), so the Worker can re-run a submitted run |

## Setup and deploy

You need a Cloudflare account (the free plan is enough) and a GitHub account.

1. In `server/`, install and log in:
   ```sh
   npm install
   npx wrangler login
   ```
2. Create the database, and put the printed `database_id` into `server/wrangler.toml`:
   ```sh
   npx wrangler d1 create ringbeat
   ```
3. Apply the schema:
   ```sh
   npm run migrate
   ```
4. Deploy once to learn the Worker's URL (`https://ringbeat-api.<your-subdomain>.workers.dev`):
   ```sh
   npm run deploy
   ```
5. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps):
   - Homepage: `https://giider.github.io/ringbeat/`
   - Callback URL: `https://ringbeat-api.<your-subdomain>.workers.dev/auth/github/callback`
6. Put the app's Client ID into `GITHUB_CLIENT_ID` in `wrangler.toml`, then store the secret and deploy again:
   ```sh
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npm run deploy
   ```
7. Set `API_BASE` in `src/cloud.js` to the Worker's URL (no trailing slash). Until it is set, the Profile screen shows
   "Online profiles are not available yet." Add a changelog message when it ships (see
   [RELEASING.md](RELEASING.md#releasing-a-minor-version)).

Schema changes go into a new numbered file in `server/migrations/`, followed by `npm run migrate`.

## Local development

1. Create a second OAuth App with the callback `http://localhost:8787/auth/github/callback`.
2. Put its id and secret into `server/.dev.vars` (this file is not committed):
   ```
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```
3. Start the API on port 8787 with a local D1:
   ```sh
   cd server
   npm run dev
   ```
4. In the game's devtools, point it at the local API, then reload:
   ```js
   localStorage.setItem('ringbeat.api', 'http://localhost:8787')
   ```

`ALLOWED_ORIGINS` already allows any `http://localhost` port.

`tests/cloud.test.mjs` runs the Worker against an in-memory SQLite stand-in for D1 (`node:sqlite`) with GitHub faked,
including two simulated devices syncing through it. `tests/cloudmerge.test.mjs` covers the merges, so neither needs
wrangler or a network.

See also: [PRIVACY.md](PRIVACY.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SPEC.md › Profile](SPEC.md#profile)
