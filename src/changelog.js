// The changelog, delivered as text messages in the phone's Inbox (Menu -> Messages). Newest first.
// Plain ASCII plus the LCD font's symbols only (tests check every character has a glyph). Keep each one SMS-short.

export const SENDER = 'Ringbeat';

export const MESSAGES = [
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
