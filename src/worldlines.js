// The World page's rows: the leaderboard snapshot's top runs and the players around the player's rank (from the sync
// that ranked their run) merged into one list in score order.

// A player in both lists is one row: the snapshot's row wins (the cached `near` may predate the FC/AP/DEV fields or the
// latest ranks) and only the `me` mark comes from `near`. A gap row stands where the ranks skip.
export function worldLines(top, near) {
  const rows = new Map();
  for (const r of [...near, ...top]) {
    const key = r.name || '#' + r.rank, old = rows.get(key);
    rows.set(key, { ...old, ...r, ...((old && old.me) || r.me ? { me: true } : {}) });
  }
  const out = [];
  for (const r of [...rows.values()].sort((a, b) => b.score - a.score || a.rank - b.rank)) {
    const last = out[out.length - 1];
    if (last && r.rank > last.rank + 1) out.push({ rank: 0, score: '…', grade: '', name: '', gap: true });
    out.push(r);
  }
  return out;
}
