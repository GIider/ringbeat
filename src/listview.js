// Song-list sorting and category filtering (pure; `scores` is the object from createScores()).

export const SORTS = [
  { id: 'diff-asc', label: 'Rating' },
  { id: 'title', label: 'Title' },
  { id: 'bpm', label: 'BPM' },
  { id: 'length', label: 'Duration' },
  { id: 'fav', label: 'Favorites' },
];

// Bot-measured rating (1..10, internal; players see it as rating/2 stars) when available, else the star heuristic scaled to the same range.
export const ratingOf = e => (e.rating && e.rating[e.chart] != null ? e.rating[e.chart] : (e.stars[e.chart] || 0) * 1.4);

// `search` filters by title / tag substring; `recent` is the played-song ids, newest first (the Recent view keeps that order); `keep` are ids the Unplayed view still lists after being played.
// `sortFavorites` (default: `favorites`) is who counts as a favorite for the Favorites sort, so the order can stay put while the player toggles hearts.
export function applyView(entries, { sort = 'diff-asc', category = 'all' }, scores, favorites = [], recent = [], search = '', keep = [], sortFavorites = favorites) {
  let list = entries.map((e, i) => ({ e, i }));
  if (category === 'favorites') list = list.filter(x => favorites.includes(x.e.id));
  else if (category === 'recent') {
    list = list.filter(x => recent.includes(x.e.id));
    return list.sort((a, b) => recent.indexOf(a.e.id) - recent.indexOf(b.e.id)).map(x => x.e).filter(matches(search));
  } else if (category === 'unplayed') list = list.filter(x => !scores.get(x.e.id, x.e.chart) || keep.includes(x.e.id));
  else if (category !== 'all') list = list.filter(x => x.e.category === category);
  const isFav = x => sortFavorites.includes(x.e.id);
  const cmp = {
    'diff-asc': (a, b) => ratingOf(a.e) - ratingOf(b.e),
    title: (a, b) => a.e.title.localeCompare(b.e.title),
    bpm: (a, b) => a.e.bpm - b.e.bpm,
    length: (a, b) => a.e.length - b.e.length,
    fav: (a, b) => (isFav(b) - isFav(a)) || ratingOf(a.e) - ratingOf(b.e),
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
export function sectionOf(e, sort) {
  if (String(e.id).startsWith('custom:')) return '*';
  if (sort === 'title') { const c = e.title.trim()[0] || '#'; return /[a-z]/i.test(c) ? c.toUpperCase() : '#'; }
  if (sort === 'diff-asc') return String(Math.min(10, Math.max(1, Math.ceil(ratingOf(e)))) / 2); // half-star steps
  if (sort === 'bpm') return String(Math.floor(e.bpm / 20) * 20);
  if (sort === 'length') { const s = Math.floor(e.length / 10) * 10; return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}+` : '<0:10'; }
  return '';
}

// Header text for a section key: the band as a range ("3 - 3.5", "120 - 139", "0:40 - 0:49"); letters and custom stay as they are.
export function sectionRange(sec, sort, fmtStars = String) {
  if (!sec) return sec;
  if (sort === 'diff-asc' && !isNaN(sec)) return `${fmtStars(+sec - 0.5)} - ${fmtStars(+sec)}`;
  if (sort === 'bpm' && !isNaN(sec)) return `${sec} - ${+sec + 19}`;
  if (sort === 'length') {
    const m = /^(\d+):(\d\d)\+$/.exec(sec), lo = m ? +m[1] * 60 + +m[2] : 0, hi = lo + 9, t = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
    if (m || sec === '<0:10') return `${t(lo)} - ${t(hi)}`;
  }
  return sec;
}

// Index to jump to for the previous (-1) / next (+1) section; the previous step first returns to the start of the current section.
export function jumpSection(list, idx, step, sort) {
  if (!list.length) return -1;
  const sec = i => sectionOf(list[i], sort);
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
