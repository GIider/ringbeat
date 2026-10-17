// The changelog, delivered as text messages in the phone's Inbox (Menu -> Messages). Newest first.
// Plain ASCII plus the LCD font's symbols only (tests check every character has a glyph). Keep each one SMS-short.

export const SENDER = 'Ringbeat';

export const MESSAGES = [
  {
    version: '2.3', date: '2026-10-17', title: 'Find your song',
    body: '76 new songs: games, TV, Eurodance, pop and synth.\n' +
      'Song select shows where you are (Video Games 3/61). PageUp and PageDown page, comma and period jump between groups, / finds a song, G opens the category hub, and sort order has its own hub.\n' +
      'Favorites get a new effect and sound: a heart floats up when you add one and breaks when you remove it.\n' +
      'Gamepad lanes now follow your fingers: LB, D-pad right, X, RB. Press Reset buttons in Settings to switch.\n' +
      'Sorting by difficulty groups by half stars. German text no longer gets cut off.',
  },
  {
    version: '2.2', date: '2026-10-17', title: 'Online, nearly stable',
    body: 'The online features are settling down, and we are celebrating!\n' +
      'Sign-in, cloud save and world leaderboards are getting steadier with every update.\n' +
      'Also new: 30 NES, SNES and arcade classics in Video Games.\n' +
      'Found a bug? Tell us and keep playing.',
  },
  {
    version: '2.1', date: '2026-10-17', title: 'Leaderboards',
    body: 'Signed in? Your runs now count on world leaderboards.\n' +
      'The results screen shows your world rank, and each song shows the world top 10 under your own runs.\n' +
      'The server replays your key presses to check every score.\n' +
      'Rather stay off the boards? Profile -> On leaderboards.',
  },
  {
    version: '2.0', date: '2026-10-16', title: 'Online profile',
    body: 'Sign in with GitHub under Profile and your settings, favorites, songs, scores and stats follow you to every device.\n' +
      'Scores and stats from all your devices count together.\n' +
      'No account? Everything works as before, saved on this device.\n' +
      'Your runs are saved online too, ready for leaderboards later.',
  },
  {
    version: '1.5', date: '2026-10-16', title: 'Favorites',
    body: 'Mark your favorite songs: press V, or tap the icon of the selected song. Favorites get a solid icon.\n' +
      'New category: Favorites. New sort: Favorites first.',
  },
  {
    version: '1.4', date: '2026-10-16', title: 'Touch & Deutsch',
    body: 'Ringbeat speaks German now: Settings -> Language, or it follows your browser.\n' +
      'Touch screens: swipe through song select and the composer.\n' +
      'Custom songs can calculate their difficulty, and the rating travels in share links.\n' +
      'Songs with near-identical Normal and Hard charts get a single difficulty.\n' +
      'Clearer judgements, a sharper 3-2-1 countdown and a new Auto-play rolls option.',
  },
  {
    version: '1.3', date: '2026-10-16', title: 'New menu!',
    body: 'Hi! Your phone got a makeover: silver frame, Menu and C keys and a ▲▼ rocker, plus a proper menu.\n' +
      'Tones: all the songs.\n' +
      'My songs: compose, paste and share your own.\n' +
      'Stats: playtime, lifetime score, grades, streaks.\n' +
      'Messages: you are reading it ;)\n' +
      'Profile: coming soon.\n' +
      'Easy is gone: every song plays on 4 lanes, Normal or Hard.',
  },
  {
    version: '1.2', date: '2026-10-16', title: 'More juice',
    body: 'Hits feel better now: perfect pings, combo chirps, a sad slide when a combo breaks, and buzz on phones that vibrate.\n' +
      'Results count up and the grade stamps in.\n' +
      'The HUD shows your combo multiplier (max x1.5 from combo 50).\n' +
      'Too much? Settings -> Hit effects.',
  },
  {
    version: '1.1', date: '2026-10-16', title: 'Mods are here',
    body: 'Press Mods on the difficulty screen:\n' +
      'Speed 0.8-1.3x, Mirror, Hidden notes, Sudden death and Strict or Lenient judging.\n' +
      'Harder mods = bigger score multiplier.\n' +
      'Training mode is gone, Lenient judging replaces it.',
  },
  {
    version: '1.0', date: '2026-10-16', title: 'Welcome!',
    body: 'Ringbeat 1.0 is out!\n' +
      '150+ ringtones turned into rhythm charts, 3 difficulties, holds, rolls and slides.\n' +
      'Write your own tones in the composer and send them to friends with a share link.\n' +
      'Aim for FULL COMBO. Have fun!',
  },
];

// Versions read before the Inbox existed: everything but the newest message, so an update shows exactly one new SMS.
export const defaultSeen = () => MESSAGES.slice(1).map(m => m.version);
export const unread = (seen = []) => MESSAGES.filter(m => !seen.includes(m.version));
export const markRead = (seen = [], version) => (seen.includes(version) ? seen.slice() : [...seen, version]);
