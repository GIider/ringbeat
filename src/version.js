// major.minor = newest changelog entry; the patch is commits since it was added. The build stamps the real value (scripts/version-lib.mjs, scripts/build-dist.mjs).
import { MESSAGES } from './changelog.js';
export const VERSION = MESSAGES[0].version + '.0-dev';
export const BUILD = { number: 0, commit: 'dev', date: '', time: '' }; // time: UTC HH:MM of the build, shown on the IMEI panel

// "build 42 · 3a9f1c2 · 2026-10-16" ("3a9f1c2 · 2026-10-16" without the number), or "dev build" when unstamped.
export function buildLine(b = BUILD, withNumber = true) {
  if (!b.number) return withNumber ? 'dev build' : 'dev';
  return [withNumber && 'build ' + b.number, b.commit, b.date].filter(Boolean).join(' · ');
}
