// Song-list sorting and category filtering (pure; `scores` is the object from createScores()).

export const SORTS = [
  { id: 'diff-asc', label: 'Easiest first' },
  { id: 'diff-desc', label: 'Hardest first' },
  { id: 'title', label: 'Title' },
  { id: 'bpm', label: 'BPM' },
  { id: 'length', label: 'Duration' },
];

// Bot-measured rating (1..10, internal; players see it as rating/2 stars) when available, else the star heuristic scaled to the same range.
export const ratingOf = (e, d) => (e.rating && e.rating[d] != null ? e.rating[d] : (e.stars[d] || 0) * 1.4);

export function applyView(entries, { sort = 'diff-asc', category = 'all' }, diff, scores) {
  let list = entries.map((e, i) => ({ e, i }));
  if (category !== 'all') list = list.filter(x => x.e.category === category);
  // Custom songs always stay at the end of the list.
  const cmp = {
    'diff-asc': (a, b) => ratingOf(a.e, diff) - ratingOf(b.e, diff),
    'diff-desc': (a, b) => ratingOf(b.e, diff) - ratingOf(a.e, diff),
    title: (a, b) => a.e.title.localeCompare(b.e.title),
    bpm: (a, b) => a.e.bpm - b.e.bpm,
    length: (a, b) => a.e.length - b.e.length,
  }[sort] || (() => 0);
  const isCustom = x => String(x.e.id).startsWith('custom:');
  list.sort((a, b) => (isCustom(a) - isCustom(b)) || cmp(a, b) || a.i - b.i);
  return list.map(x => x.e);
}

export const nextOf = (arr, id) => arr[(arr.findIndex(x => x.id === id) + 1) % arr.length].id;
export const prevOf = (arr, id) => arr[(arr.findIndex(x => x.id === id) - 1 + arr.length) % arr.length].id;
