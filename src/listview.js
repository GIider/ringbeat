// Song-list sorting and category filtering (pure; `scores` is the object from createScores()).

export const SORTS = [
  { id: 'diff-asc', label: 'Difficulty' },
  { id: 'title', label: 'Title' },
  { id: 'bpm', label: 'BPM' },
  { id: 'length', label: 'Duration' },
  { id: 'fav', label: 'Favorites' },
];

// Bot-measured rating (1..10, internal; players see it as rating/2 stars) when available, else the star heuristic scaled to the same range.
export const ratingOf = (e, d) => (e.rating && e.rating[d] != null ? e.rating[d] : (e.stars[d] || 0) * 1.4);

// Not offered on the difficulty the song is not available on.
const playable = (e, diff) => !(e.only && e.only !== diff);

// `search` filters by title / tag substring; `recent` is the played-song ids, newest first (the Recent view keeps that order).
export function applyView(entries, { sort = 'diff-asc', category = 'all' }, diff, scores, favorites = [], recent = [], search = '') {
  let list = entries.map((e, i) => ({ e, i }));
  if (category === 'favorites') list = list.filter(x => favorites.includes(x.e.id));
  else if (category === 'recent') {
    list = list.filter(x => recent.includes(x.e.id));
    return list.sort((a, b) => recent.indexOf(a.e.id) - recent.indexOf(b.e.id)).map(x => x.e).filter(matches(search));
  } else if (category === 'unplayed') list = list.filter(x => playable(x.e, diff) && !scores.get(x.e.id, diff));
  else if (category !== 'all') list = list.filter(x => x.e.category === category);
  const isFav = x => favorites.includes(x.e.id);
  const cmp = {
    'diff-asc': (a, b) => ratingOf(a.e, diff) - ratingOf(b.e, diff),
    title: (a, b) => a.e.title.localeCompare(b.e.title),
    bpm: (a, b) => a.e.bpm - b.e.bpm,
    length: (a, b) => a.e.length - b.e.length,
    fav: (a, b) => (isFav(b) - isFav(a)) || ratingOf(a.e, diff) - ratingOf(b.e, diff),
  }[sort] || (() => 0);
  // Custom songs always stay at the end of the list.
  const isCustom = x => String(x.e.id).startsWith('custom:');
  list.sort((a, b) => (isCustom(a) - isCustom(b)) || cmp(a, b) || a.i - b.i);
  return list.map(x => x.e).filter(matches(search));
}

const matches = q => {
  q = String(q || '').trim().toLowerCase();
  return q ? e => e.title.toLowerCase().includes(q) || String(e.tag || '').toLowerCase().includes(q) : () => true;
};

// Random pick from a list, never the current song unless it is the only one. `rnd` is injectable for tests.
export function randomOf(list, currentId, rnd = Math.random) {
  const pool = list.length > 1 ? list.filter(e => e.id !== currentId) : list;
  return pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
}

// Section a row belongs to under the current sort (first letter, star band, BPM / length band); '' when the sort has none.
export function sectionOf(e, sort, diff) {
  if (String(e.id).startsWith('custom:')) return '*';
  if (sort === 'title') { const c = e.title.trim()[0] || '#'; return /[a-z]/i.test(c) ? c.toUpperCase() : '#'; }
  if (sort === 'diff-asc') return String(Math.min(10, Math.max(1, Math.ceil(ratingOf(e, diff)))) / 2); // half-star steps
  if (sort === 'bpm') return String(Math.floor(e.bpm / 20) * 20);
  if (sort === 'length') { const s = Math.floor(e.length / 10) * 10; return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}+` : '<0:10'; }
  return '';
}

// Index to jump to for the previous (-1) / next (+1) section; the previous step first returns to the start of the current section.
export function jumpSection(list, idx, step, sort, diff) {
  if (!list.length) return -1;
  const sec = i => sectionOf(list[i], sort, diff);
  if (step > 0) {
    for (let i = idx + 1; i < list.length; i++) if (sec(i) !== sec(idx)) return i;
    return list.length - 1;
  }
  let i = idx;
  while (i > 0 && sec(i - 1) === sec(idx)) i--;
  if (i < idx) return i;
  if (i === 0) return 0;
  const prev = sec(i - 1);
  while (i > 0 && sec(i - 1) === prev) i--;
  return i;
}

export const nextOf =(arr, id) => arr[(arr.findIndex(x => x.id === id) + 1) % arr.length].id;
export const prevOf = (arr, id) => arr[(arr.findIndex(x => x.id === id) - 1 + arr.length) % arr.length].id;
