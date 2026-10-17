// The fixed player the README screenshots show: signed in as "Nova" with a played-in profile.
// Injected into localStorage before the page loads (see scripts/screenshots.mjs); the cloud is faked, nothing goes online.
import { MESSAGES } from '../../src/changelog.js';

const DAY = 24 * 3600e3, START = Date.UTC(2026, 8, 20), LAST = Date.UTC(2026, 9, 16); // first and last play day
const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
const days = Array.from({ length: 12 }, (_, i) => dayKey(LAST - (11 - i) * DAY)); // a 12-day streak ending on the last day

export const fixture = {
  'ringbeat.api': 'http://127.0.0.1:9', // unreachable: defence in depth
  'ringbeat.cloud.v1': { token: 'x'.repeat(32), profile: { name: 'Nova', public: true }, syncedAt: Date.UTC(2026, 9, 16, 18, 30) },
  'ringbeat.stats.v1': {
    playtime: 51240, runs: 214, finished: 187, failed: 9, quits: 14, restarts: 4, score: 9482600, bestCombo: 141,
    notes: { perfect: 14820, great: 2310, good: 640, miss: 395 }, ghosts: 520, fcRuns: 31, apRuns: 4, moddedRuns: 22, customRuns: 6,
    byDiff: { normal: { runs: 131, playtime: 30100 }, hard: { runs: 83, playtime: 21140 } },
    firstPlayed: START, lastPlayed: LAST + 18 * 3600e3, lastDay: dayKey(LAST), daysPlayed: 12 + 9, streak: 12, bestStreak: 12, backfilled: true,
    days: [dayKey(START), ...days], daysBase: 8,
  },
  // Read everything except the two newest messages, so the inbox shows two unread envelopes.
  'ringbeat.v1': { tutorialDone: true, msgSeen: MESSAGES.slice(2).map(m => m.version) },
};
