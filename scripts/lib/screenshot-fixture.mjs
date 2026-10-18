// The fixed player the README screenshots show: signed in as "Nova" with a played-in profile.
// Injected into localStorage before the page loads (see scripts/screenshots.mjs); the cloud is faked, nothing goes online.
import { MESSAGES } from '../../src/changelog.js';
import { buildLibrary } from '../../src/library.js';
import { RULES } from '../../src/replay.js';
import { BOARDS_KEY } from '../../src/cloud.js';

const DAY = 24 * 3600e3, START = Date.UTC(2026, 8, 20), LAST = Date.UTC(2026, 9, 16); // first and last play day
const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
const days = Array.from({ length: 12 }, (_, i) => dayKey(LAST - (11 - i) * DAY)); // a 12-day streak ending on the last day

// Songs the lived-in player has scores and world ranks on: the demo's Nokia Tune plus a handful of others.
const lib = buildLibrary();
const SONGS = ['nokia', ...lib.slice(30, 36).map(e => e.id)];
const run = (score, grade, accuracy, maxCombo, extra = {}) => ({ score, grade, accuracy, maxCombo, fc: false, ap: false, date: LAST - 2 * DAY, ...extra });
const best = i => 52660 - i * 1800; // the player's best on song i
const scoresOf = i => ({ top: [run(best(i), ['S', 'S', 'A', 'A', 'B', 'C', 'D'][i % 7], 99.1 - i * 2.4, 88 - i, { fc: i % 2 === 0, mods: i === 2 ? ['1.1x', 'HD'] : [] }), run(best(i) - 3400, 'A', 96.4, 70, { mods: ['1.1x'] }), run(best(i) - 7100, 'A', 94.2, 61), run(best(i) - 11000, 'B', 90.8, 47)], plays: 14 - i, fc: i % 2 === 0, ap: i === 0 });
const NAMES = ['Dial', 'Snake', 'Ringo-21', 'Tonal-40', 'Beep', 'Nova', 'Chirp', 'Trill-29', 'Buzz-22', 'Riff-30'];
// The world top 10 of a board; Nova (the player) sits at #6.
const board = nova => NAMES.map((name, i) => ({ rank: i + 1, total: 312, name, score: nova + (5 - i) * 820, grade: i < 4 ? 'S' : 'A', accuracy: 99 - i * 0.7, maxCombo: 90 - i * 3,
  fc: i % 3 !== 2, ap: i === 0, mods: i === 3 ? ['1.2x', 'MR'] : i === 6 ? ['HD'] : [], playedAt: LAST - i * DAY, ...(name === 'Nova' && { me: true }) }));
const boards = Object.fromEntries(SONGS.map((id, k) => [id, board(best(k))]));
const ranks = Object.fromEntries(SONGS.map((id, k) => { const rows = boards[id]; return [id, { rank: 6, total: 312, near: rows.slice(3, 8), top: rows, at: LAST }]; }));

export const fixture = {
  'ringbeat.api': 'http://127.0.0.1:9', // unreachable: defence in depth
  'ringbeat.cloud.v1': { token: 'x'.repeat(32), profile: { name: 'Nova', public: true }, syncedAt: Date.UTC(2026, 9, 16, 18, 30), rules: RULES, ranks,
    myRanks: { at: Date.UTC(2026, 9, 16, 18, 30), rows: SONGS.map((id, k) => ({ songId: id, score: best(k), rank: [6, 2, 14, 1, 31, 9, 4][k], total: 312 })) } },
  // The world leaderboard snapshot the picker and the results show (served from the cache; the unreachable API is never needed)
  [BOARDS_KEY]: { at: Date.UTC(2026, 9, 16, 18, 30), value: { rules: RULES, built: LAST, boards } },
  'ringbeat.scores.v1': Object.fromEntries(SONGS.map((id, i) => [id, scoresOf(i)])),
  'ringbeat.stats.v1': {
    playtime: 51240, runs: 214, finished: 187, failed: 9, quits: 14, restarts: 4, score: 9482600, bestCombo: 141,
    notes: { perfect: 14820, great: 2310, good: 640, miss: 395 }, ghosts: 520, fcRuns: 31, apRuns: 4, moddedRuns: 22, customRuns: 6,
    firstPlayed: START, lastPlayed: LAST + 18 * 3600e3, lastDay: dayKey(LAST), daysPlayed: 12 + 9, streak: 12, bestStreak: 12, backfilled: true,
    days: [dayKey(START), ...days], daysBase: 8,
  },
  // Read everything except the two newest messages, so the inbox shows two unread envelopes.
  // a loadout that is on, so the picker's modifier chips show something
  'ringbeat.v1': { tutorialDone: true, msgSeen: MESSAGES.slice(2).map(m => m.version), mods: { speed: 1.1, hidden: true } },
};
