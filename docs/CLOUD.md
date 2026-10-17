[Docs](README.md) › Cloud save

# Cloud save and leaderboards

Signing in on the Profile screen is optional. It creates an **online profile**, and that profile keeps settings,
favourites, my songs, scores and stats the same on every device. A new best on a board is also stored on
the server, and runs the server could re-play itself rank on public **leaderboards** ([below](#leaderboards)). The game is a static site, so the online part is a separate
**Cloudflare Worker + D1** API in `server/`. Sign-in is with GitHub.

- Signed out, nothing changes: `localStorage` is the only store. The only request is the leaderboard snapshot for
  the difficulty picker (one every 15 minutes at most, never waited for).
- Signed in, `localStorage` is still the source of truth, and the network is never in the way: no sync starts
  while a song plays, nothing on screen waits for one, and a failed one backs off. When requests go out:
  [Requests](#requests).

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

The merge is commutative and idempotent. A device sends its copy and the Worker runs the same merge
(`cloudmerge.js`) against the stored one, writing only when that changes it. Writes are guarded by the revision. If
another device wrote in between, the Worker merges with the newer copy and tries again. The answer carries the
merged document only when it differs from what the device sent.

**Runs.** A finished run (not demo, tutorial or failed) that is a new best for its song and difficulty goes
into an outbox (`ringbeat.cloud.v1`); a better run replaces waiting ones on the same board. Other runs never leave
the device: they can't change the player's place on any board, and the scores and stats they changed travel in the
device slot anyway. The first sync after sign-in sends the best run per board.
- A run carries song id, difficulty, score, grade, accuracy, max combo, FC/AP, mods, multiplier, game version and
  time.
- Its id is `device:song:difficulty:time`. The first sync after signing in also uploads the device's existing top
  runs; because the ids match, the server stores each run once.
- Song ids are stable: library ids for built-in songs, `custom:<hash of the RTTTL>` for custom ones.
- Runs played since leaderboards also carry their **replay** (below), which the API re-plays. A new best goes up
  from the results screen right away, and its world rank comes back in the same answer. Other runs wait for the
  next push, and the results screen shows the rank last seen (`ranks` in `ringbeat.cloud.v1`).
- The outbox keeps at most 1 000 000 characters of replays. When it would hold more, the oldest runs drop theirs:
  they still go up as history, but can't rank.

## Leaderboards

A leaderboard ranks each player's best run on one song and difficulty. **The score on a board is always the
server's own.** The game uploads the run's inputs, and the Worker re-plays them through the same game code to get
the score. Whatever score the client claims is ignored.

**Replays.** `Game` logs everything that changed the outcome, in order, as `[song time, code]` (`game.log`):
- every press (code = lane),
- every release that ended a hold (lane + 8),
- every frame update that judged something or ended the song (−1).

Frames that changed nothing are left out. Replaying the log through a headless `Game` (`replay.js`) gives the live
run's results bit for bit:
- times are kept as exact doubles, so a judgement on a window's edge can't flip;
- the scoring path uses no engine-dependent maths, so Chromium, Firefox and WebKit agree with the Worker.

`encodeLog` packs the log into base64url at 9 bytes per event, so a 3-minute song is about 6 KB.

**Verification.** For each uploaded run with a replay, `POST /sync` does this:
1. It finds the melody. Built-in songs come from `songs.js`. Custom songs bring their RTTTL, which must hash to
   the song id.
2. It builds the chart (`generateChart`, then `mods.applyChart` with the mods as played).
3. It re-plays the log with `mods.gameOptions`.
4. It stores the result, with the mods' multiplier folded in as the game does, and marks it `verified = 1`.

Some runs get `verified = -1` instead and never rank:
- a garbled log,
- a log that doesn't reach the end of the song,
- a failed run or a demo run,
- an unknown song, or a melody that doesn't match.

Runs without a replay, such as older clients and the backfill, are kept with `verified = 0` as plain history.

**Developer mark.** A board row of a user with `users.dev = 1` carries `dev: true`; the game shows a DEV badge. The flag is set by hand in D1 (`UPDATE users SET dev = 1 WHERE id = ?`), never through the API.

**RULES.** `RULES` in `replay.js` is a number that changes whenever a code change would score a replay differently.
- Each run carries the client's `RULES`, and boards only rank runs with the Worker's.
- A client on an older version gets "Not ranked: update the game", and its runs wait with `verified = 0`.
- `tests/replay.test.mjs` hashes the scoring files (`game.js`, `chart.js`, `rtttl.js`, `mods.js`, `songs.js`) and
  fails when they change. Then decide:
  - if scoring or charts changed, bump `RULES`;
  - if not, only paste the new hash.
- When `RULES` changes, the boards start empty for the new rules. Old runs stay stored with their replays.

**CPU.** Chart plus replay of the longest song takes about 1.5 ms. The free plan allows 10 ms of CPU per request,
so each request re-plays at most 4 runs (3 when it also merges the shared document). The others wait with
`verified = 0`. A cron trigger (every 15 minutes) re-plays waiting runs 20 at a time, then rebuilds the
[board snapshot](#requests) if anything changed.

**What it does not stop.** Replay verification proves that a score is what its inputs earn. It doesn't prove that a
person pressed the keys: a script can write a plausible log, and `planBot` already can. Two **flags** mark runs that
look automated, for moderation only. Flagged runs still count.
- `flat`: hit offsets barely vary (standard deviation under 4 ms over at least 30 hits), even when shifted by a
  constant.
- `bot`: at least 90 % of the notes have a press within 1 ms of the note's time.

**Moderation.** `/admin/*` answers only with `Authorization: Bearer <ADMIN_TOKEN>`, a Worker secret. Without it,
these routes answer 404.
- `GET /admin/flagged`: the newest flagged runs.
- `POST /admin/hide {runId}` or `{userId}`: takes a run or a player off every board. Add `hidden: false` to undo.
- `POST /admin/verify`: re-plays waiting runs now.
- `GET /admin/players?q=&offset=` and `GET /admin/runs?user=&offset=`: search players by name (or id) and list a player's runs, 20 per page.
- `POST /admin/ban {userId, banned}`: the blacklist. A banned player is hidden from every board, loses their sessions, and
  sign-in and sync answer `403 banned`. `banned: false` is the whitelist (it also unhides).
- `POST /admin/run/delete {runId}`, `POST /admin/player/delete {userId}`: delete a run, or a player with everything of theirs
  (the same cascade as `DELETE /me`).
- `POST /admin/unflag {runId}`: approve a flagged run.
- `GET /admin/stats`, `POST /admin/purge {what: "expired"}`, `POST /admin/rebuild`: row counts, delete expired sessions and
  sign-in rows, force a leaderboard snapshot rebuild.
- `GET /admin/log`: the newest 50 entries of `admin_log`; every change above (and `hide`) writes one.

The game's **Admin** app (dev mode, `?dev`) drives these routes. The token is typed in and kept in memory only.

**Opt-out.** Profile → "On leaderboards" (`profile.public` in the next `POST /sync`). A player who opts out leaves the public boards but
still sees their own rank.

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

## Requests

The free plan allows 100 000 Worker requests and 100 000 D1 rows written a day, so the client sends little:

| When | Request |
|---|---|
| Game start, after signing in | One `POST /sync`: push what changed, pull the rest |
| The Sync button | Same, at most once per 30 s (counted from the last sync too); the button counts down meanwhile |
| The tab comes back | Same, but only when the last sync is over 10 minutes old |
| A synced setting, favourite or song changed | A push within 30 s, only if the shared document differs from the last synced one |
| A new player name, "On leaderboards" | Shown at once, sent with that same push within 30 s (and before signing out) |
| A new best | One push from the results screen; the world rank comes back with it. Meanwhile `guessRank` shows a dimmed rank from the cached snapshot (empty board: #1) when the score lands in the top 3; the answer replaces it |
| Scores and stats | A push within 10 minutes, or when the tab is hidden, whichever comes first |
| The tab is hidden | A push, only if something changed (`keepalive` when the body is under 60 KB) |
| The stats screen's Online page | One `POST /sync` with `wantRanks`, only when the overview is over 10 minutes old (a ranked run patches a cached overview from the answer); it goes with whatever else is waiting |
| The results screen's World page | Nothing: the top 3 come from `GET /boards`, the players around the player from the push that ranked the run |
| After the tutorial | Nothing until the player agrees to sign in (asked once per device, `loginAsked`) |
| The difficulty picker, app start | `GET /boards`, once per 15 minutes for every song (kept in `ringbeat.boards.v1`); the menu warms it at start. A ranked run patches its board in the snapshot. Signed-in players see a World tab (first) and a Local tab; signed-out players see only their local runs |

How it stays small:
- **Dirty checks.** The client keeps fingerprints of the shared document and of its own slot as last synced. A
  push sends only the parts that differ. Saving a per-device setting (volume, last selected song) or applying a
  merged document sends nothing.
- **One round trip.** `POST /sync` carries the shared document, the device slot and runs together. Device slots
  come down only when they changed since the last pull (`devicesSince`).
- **Never in the way.** A sync that comes due during a song (or a pause) waits until the song is over. Requests
  time out after 8 s, are skipped when the browser is offline, and back off after a failure (1, 2, 4 … 30 minutes;
  5 after a 429). The Sync button ignores the backoff.
- **One snapshot for every board.** `GET /boards` reads one stored row (`board_tops`) with the top 3 of every song
  and difficulty. The cron rebuilds it only when it is marked dirty: a run ranked, or a name, opt-out or hide
  changed. A new best shows up there within 15 minutes; the player's own rank is fresh on the results screen.
- **No preflights for public reads.** `GET /boards` sends no credentials, so the browser needs no CORS preflight.
  Signed-in requests go to one URL, so one preflight is cached for all of them.

## API

All JSON. Everything except the auth and public board routes needs `Authorization: Bearer <token>`. A 401 signs the device out, and
the device keeps its own data.

| Route | Does |
|---|---|
| `GET /auth/github/start?return=` | Starts sign-in (browser navigation) |
| `GET /auth/github/callback` | GitHub's redirect target (browser navigation) |
| `POST /auth/exchange` `{code}` | → `{token, profile}` |
| `POST /auth/logout` | Ends this token |
| `GET /me` | → `{profile: {id, name, created, public, logins}}` |
| `DELETE /me` | Deletes the profile and everything stored with it |
| `POST /sync` `{deviceId, sharedRev?, shared?, stampAt?, profile?, device?, devicesSince?, runs?, wantRanks?}` | The game's one sync request; every part optional (see below) |
| `GET /boards` | **No sign-in needed.** The top 3 of every song and difficulty: `{rules, built, boards: {"song\|diff": [{rank, total, name, score, grade, accuracy, maxCombo, fc, ap, mods, playedAt}]}}`. Cached 10 min |
| `GET /board/:song/:diff?limit=` | **No sign-in needed.** Best ranked run per player, up to 100: `{rules, runs: [...]}` as above. Cached 30 s |
| `GET /board/:song/:diff/me` | The caller and the two players above and below (`me: true` on the caller's row) |
| `/admin/*` (`flagged`, `hide`, `verify`, `players`, `runs`, `ban`, `run/delete`, `player/delete`, `unflag`, `stats`, `purge`, `rebuild`, `log`) | Moderation, with `ADMIN_TOKEN` (see [Leaderboards](#leaderboards)) |

`POST /sync`, part by part. The answer always has `{at, rules}`:
- `shared` (the device's copy) and/or `sharedRev` (the revision it last saw): the Worker merges and stores as above.
  The answer has `shared: {rev, doc?}` when there is anything new. `doc` is left out when the device already has
  it. `stampAt` is the device's clock, used to stamp never-changed settings when it fills an empty profile.
- `profile`: `{displayName?, public?}`, a rename or the leaderboard opt-out. Names are 3–16 characters (letters,
  digits, space, `.` `_` `-`; `cleanName` in `cloudmerge.js`, which the game checks first). A bad value is refused
  on its own as `profileError` and the rest of the sync still lands. The answer has the `profile`.
- `device`: this device's slot. The newest 20 devices are kept.
- `devicesSince`: the answer has `deviceIds` (all slots), `devices` (the docs of other devices' slots written
  after that time) and the `profile`, so a rename on another device shows here.
- `runs`: up to 50. Invalid ones are dropped, repeats ignored. The answer has `runs: [{clientRunId, verified,
  score?}]`, and `ranks: {"song|diff": {rank, total, near}}` wherever a run just ranked. `near` is the player and the
  two players above and below ([{rank, name, score, grade, me?}]), already read to find the rank.
- `wantRanks: true`: the answer has `myRanks: [{songId, diff, score, rank, total}]`, the caller's rank on every board
  they have a verified run on, best percentile first (at most 500). Only those boards are read (`runs_user`, then
  `runs_rank`), not the whole table.

Limits:
- Request bodies up to 300 000 characters, each stored document up to 256 000.
- 60 requests a minute per token or IP, through the optional `LIMITER` binding.
- CORS only for `ALLOWED_ORIGINS`.

## Data model

`server/migrations/` creates these tables (`0001_init.sql`, `0002_leaderboards.sql`, then `0003_sync.sql`):

| Table | Holds |
|---|---|
| `users` | A profile: our own id, display name, `public` (on leaderboards), `hidden` (moderation), `banned` (blacklist) |
| `identities` | `(provider, subject) → user`; GitHub's numeric id. Another login provider becomes another row on the same user |
| `sessions` | SHA-256 of each bearer token, expiry |
| `oauth_states`, `login_codes` | Short-lived sign-in state |
| `shared_docs` | The shared document and its revision |
| `device_slots` | One row per user × device |
| `runs` | Every uploaded run. Re-playable runs also keep `replay`, `rules`, `loadout` (the mods) and a custom song's `rtttl`. `verified` (1 ranked, 0 waiting or history, −1 invalid), `flags` and `hidden` (moderation). Boards read the partial index `runs_rank` |
| `board_tops` | One row: the `GET /boards` snapshot, its `rules`, when it was `built`, and `dirty` |
| `admin_log` | One row per moderation change: when, action, target, detail |

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

8. For moderation, set an admin token (any long random string, kept to yourself):
   ```sh
   npx wrangler secret put ADMIN_TOKEN
   ```
9. To deploy the API from CI with every push to `main`, add a repository secret `CLOUDFLARE_API_TOKEN`. It needs a
   Cloudflare API token with the "Edit Cloudflare Workers" template plus D1 edit permission. The `deploy-api` job
   then applies migrations and deploys. Without the secret, the job is skipped.
   - Deploying the API together with the pages matters because both must agree on `RULES`.
   - An API left behind on older rules marks new runs "Not ranked" until it is deployed.

Schema changes go into a new numbered file in `server/migrations/`, followed by `npm run migrate` (CI does this too).

## Local development

1. Create a second OAuth App with the callback `http://localhost:8787/auth/github/callback`.
2. Put its id and secret into `server/.dev.vars` (this file is not committed), together with the pages the local API
   should accept. `:*` allows any port. The live API accepts only `https://giider.github.io`, so a dev server can't
   sign in against it.
   ```
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ALLOWED_ORIGINS=http://localhost:*,http://<your LAN IP>:*
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
   From another device, use the API machine's address instead of `localhost`. Its OAuth App callback then has to
   use that address too.

`tests/cloud.test.mjs` runs the Worker against an in-memory SQLite stand-in for D1 (`node:sqlite`) with GitHub faked,
including two simulated devices syncing through it. `tests/cloudmerge.test.mjs` covers the merges, so neither needs
wrangler or a network.

See also: [PRIVACY.md](PRIVACY.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SPEC.md › Profile](SPEC.md#profile)
