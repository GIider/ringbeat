[Docs](README.md) › Privacy

# Privacy

Last updated: 2026-10-17

Ringbeat works fully without an account. Everything you do is kept in your browser's `localStorage` on your device.
An online profile is optional and only exists if you sign in.

## Who is responsible

The Ringbeat project, run by GitHub user [GIider](https://github.com/GIider). Contact for any privacy question or
request: open an issue at <https://github.com/GIider/ringbeat/issues>. Issues are public, so please don't put personal
details in one; say what you need and a way to continue privately will be arranged.

## Without an account

- Settings, scores, stats and your songs stay in `localStorage` on your device. Nothing is sent anywhere.
- The only request is the public leaderboard snapshot (for the difficulty picker), at most every 30 seconds. It carries
  no account data.
- The site is served by GitHub Pages and the API by Cloudflare. Like any web server, they see your IP address and
  browser details when you load the site or make a request. Ringbeat itself does not store or use them.
- No cookies, no analytics, no advertising, no tracking.

## Online profile (optional)

If you sign in on the **Profile** screen (with GitHub), the Ringbeat API stores:

| What | Why | Legal basis (GDPR) |
|---|---|---|
| Your GitHub **user number** | To recognise you the next time you sign in. Your email and other GitHub details are not stored; your GitHub name only becomes the starting player name (below) | Art. 6(1)(b): providing the profile you asked for |
| A **player name** | Shown on your profile, and **publicly on leaderboards** next to your best runs. It starts as your GitHub display name (or username), shortened to what the game can show, or `Player-XXXX` if neither fits. You can change it | Art. 6(1)(b) for the profile, Art. 6(1)(f) for the public leaderboard (see [Leaderboards](#leaderboards)) |
| Your **game data** | So it can be the same on every device: synced settings, favourites, my songs, and scores and stats per device | Art. 6(1)(b) |
| Your **best runs**: a new best on a song and difficulty, with a **replay** (the key presses) | To rank you on leaderboards. The server computes the score itself from the replay to catch cheating. For your own songs, the melody goes with the run | Art. 6(1)(f): fair leaderboards |
| A random **device id** and **sign-in tokens** | To tell your devices apart and keep you signed in. Tokens are stored only as hashes | Art. 6(1)(b) |

Signing in is your choice. You can withdraw at any time by signing out or deleting the profile ([below](#your-rights)).
No data is sold, used for advertising, or used to profile you.

## Who receives it

- **Cloudflare, Inc.** runs the API (Workers) and the database (D1) for the project, as a processor. Its servers may be
  outside the EU/EEA, including the United States; Cloudflare relies on the EU Standard Contractual Clauses and the
  EU-US Data Privacy Framework for that.
- **GitHub, Inc.** handles the sign-in. It tells Ringbeat your user number and name, and sees that you signed in to
  Ringbeat. GitHub's own policy applies to your GitHub account.
- **The public**, for leaderboard entries (below). Nobody else gets your data.

## Leaderboards

Leaderboards are public: anyone can see the player name, score, grade, accuracy, mods and date of each player's best
run on a song. Opening **Profile** and switching **On leaderboards** to Off removes you from them. You still see your own
rank; others don't see you. Runs that look automated can be reviewed and removed from the boards, and players who
cheat can be banned. A ban is a flag on the profile, so deleting the profile removes it too.

## How long it is kept

- Your profile data stays until you delete it. Nothing else expires it, apart from sign-in tokens, which last a year.
- Short-lived sign-in records (a few minutes) are removed on expiry.
- Moderation actions are written to a log (action, target and, when a player is deleted by the moderator, that
  player's name). The log is kept to be able to explain and reverse moderation decisions.

## Your rights

Under the GDPR (and similar laws) you can:

- **See and export your data.** **Export my data** (Profile screen, signed in) downloads everything the server stores
  about you as one JSON file: profile, sign-in identity, synced settings and songs, scores and stats per device, and
  your runs with their replays. Sign-in tokens are left out (they are stored only as hashes). The data in your browser
  is yours on the device already.
- **Correct it.** Change your player name on the Profile screen.
- **Delete it.** **Delete online profile** (Profile screen, press twice) removes the profile and everything stored with
  it from the server at once. Your devices keep their own local data.
  **Reset scores & stats** (Settings) while signed in deletes your stored runs and replays too, so they leave the
  leaderboards, and clears your other devices.
- **Object or limit it.** Switch **On leaderboards** to Off to stop being shown publicly. To object to anything else,
  use the contact above.
- **Withdraw.** **Sign out** (Profile screen) ends sign-in on that device. The device keeps its own data; the online
  profile stays until you delete it.
- **Complain.** You can complain to your local data protection authority.

To remove local data too, clear the site's data in your browser.

How it works in detail: [CLOUD.md](CLOUD.md).
