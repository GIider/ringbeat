// Keep major.minor in sync with package.json "version" (tests/core.test.mjs checks this); CI stamps the patch with the build number and fills BUILD (scripts/build-dist.mjs).
export const VERSION = '1.1.0';
export const BUILD = { number: 0, commit: 'dev', date: '' };

// "build 42 · 3a9f1c2 · 2026-10-16", or "dev build" when unstamped.
export function buildLine(b = BUILD) {
  if (!b.number) return 'dev build';
  return ['build ' + b.number, b.commit, b.date].filter(Boolean).join(' · ');
}
