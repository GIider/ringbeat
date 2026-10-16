[Docs](README.md) › Privacy

# Privacy

Ringbeat works fully without an account. Everything you do is kept in your browser's `localStorage` on your device,
and nothing is sent anywhere.

## Online profile (optional)

If you sign in on the **Profile** screen, the Ringbeat API stores:

| What | Why |
|---|---|
| Your GitHub **user number** | To recognise you the next time you sign in. Your email and other GitHub details are not stored; your GitHub name only becomes the starting player name (below) |
| A **player name** | Shown on your profile, and **publicly on leaderboards** next to your best runs. It starts as your GitHub display name (or username), shortened to what the game can show, or `Player-XXXX` if neither fits. You can change it |
| Your **game data** | So it can be the same on every device: synced settings, favourites, my songs, scores and stats per device, and a history of your finished runs |
| Each run's **key presses** (a replay) | So the server can compute the score itself for leaderboards. For your own songs, the melody goes with the run |
| A random **device id** and **sign-in tokens** | To tell your devices apart and keep you signed in. Tokens are stored only as hashes |

The API runs on Cloudflare Workers, and the data is in Cloudflare D1. Data is used only to run the game. It is not
sold, shared or used for advertising.

## Leaderboards

Leaderboards are public: anyone can see the player name, score, grade, accuracy, mods and date of each player's best
run on a song. To leave them, open **Profile** and switch **On leaderboards** to Off. You still see your own rank;
others don't see you. Runs that look automated can be reviewed and removed from the boards.

## Deleting it

- **Sign out** (Profile screen) ends sign-in on that device. The device keeps its own data; the online profile stays.
- **Delete online profile** (Profile screen, press twice) removes the profile and everything stored with it from the
  server at once. Your devices keep their own local data.
- To remove local data too, clear the site's data in your browser.

How it works in detail: [CLOUD.md](CLOUD.md).
