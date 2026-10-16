// Keep major.minor in sync with package.json "version" (tests/core.test.mjs checks this); CI stamps the patch with the build number and fills BUILD (scripts/build-dist.mjs).
export const VERSION = '1.3.0';
export const BUILD = { number: 0, commit: 'dev', date: '' };

// "build 42 · 3a9f1c2 · 2026-10-16" ("3a9f1c2 · 2026-10-16" without the number), or "dev build" when unstamped.
export function buildLine(b = BUILD, withNumber = true) {
  if (!b.number) return withNumber ? 'dev build' : 'dev';
  return [withNumber && 'build ' + b.number, b.commit, b.date].filter(Boolean).join(' · ');
}
