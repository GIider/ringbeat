// The chart explorer page (charts.html): every song's chart with note counts by kind, filters and sortable columns.
// Reads the game's own modules, so it is always in step with the charting code and difficulty.json; nothing is baked in.
import { buildLibrary, setMeasured } from './library.js';
import { chartStats } from './chartstats.js';
import { CATEGORIES } from './songs.js';

let rows = [];
const catName = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));
const COLS = [
  ['title', 'Song', 'l'], ['category', 'Category', 'l'], ['rating', 'Rating'], ['bpm', 'BPM'], ['length', 'Length'],
  ['notes', 'Notes'], ['taps', 'Taps'], ['holds', 'Holds'], ['rolls', 'Rolls'], ['doubles', 'Doubles'], ['triples', 'Triples'],
  ['backing', 'Backing'], ['nps', 'Notes/s'], ['peak', 'Peak/s'],
];
const FEATURES = [['holds', 'Holds'], ['shortHolds', 'Short holds'], ['rolls', 'Rolls'], ['doubles', 'Doubles'], ['triples', 'Triples'], ['backing', 'Backing notes']];
const st = { sort: 'title', desc: false, open: new Set() };
const $ = id => document.getElementById(id);

function init() {
$('sub').textContent = rows.length + ' songs, one chart each. Generated live from the game code.';
$('filters').innerHTML = `
  <label>Search<input id="q" type="search" placeholder="title or tag"></label>
  <label>Category<select id="cat"><option value="">All</option>${CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}</select></label>
  <label>Rating<span class="range"><input id="rmin" type="number" min="1" max="10" step="0.1" placeholder="min"><input id="rmax" type="number" min="1" max="10" step="0.1" placeholder="max"></span></label>
  <label>Notes<span class="range"><input id="nmin" type="number" min="0" placeholder="min"><input id="nmax" type="number" min="0" placeholder="max"></span></label>
  <label>Length (s)<span class="range"><input id="lmin" type="number" min="0" placeholder="min"><input id="lmax" type="number" min="0" placeholder="max"></span></label>
  <label>Min notes/s<input id="npsmin" type="number" min="0" step="0.1"></label>
  <label>Weakness tag<select id="wtag"><option value="">Any</option>${[...new Set(rows.flatMap(r => r.tags))].sort().map(t => `<option>${t}</option>`).join('')}</select></label>
  ${FEATURES.map(([k, n]) => `<label>Min ${n.toLowerCase()}<input id="min-${k}" type="number" min="0" placeholder="0"></label>`).join('')}
  <div class="checks">
    ${FEATURES.map(([k, n]) => `<label><input type="checkbox" id="only-${k}">only with ${n.toLowerCase()}</label>`).join('')}
    <label><input type="checkbox" id="none-chords">no doubles or triples</label>
    <label><input type="checkbox" id="measured">measured rating only</label>
    <button id="reset" type="button">Reset</button>
  </div>`;

const num = id => { const v = $(id).value; return v === '' ? null : Number(v); };
function filtered() {
  const q = $('q').value.trim().toLowerCase(), cat = $('cat').value, wt = $('wtag').value;
  const rmin = num('rmin'), rmax = num('rmax'), nmin = num('nmin'), nmax = num('nmax'), lmin = num('lmin'), lmax = num('lmax'), npsmin = num('npsmin');
  return rows.filter(r => {
    if (q && !(r.title + ' ' + r.tag + ' ' + r.id).toLowerCase().includes(q)) return false;
    if (cat && r.category !== cat) return false;
    if (wt && !r.tags.includes(wt)) return false;
    if (rmin !== null && !(r.rating >= rmin)) return false;
    if (rmax !== null && !(r.rating <= rmax)) return false;
    if (nmin !== null && r.notes < nmin) return false;
    if (nmax !== null && r.notes > nmax) return false;
    if (lmin !== null && r.length < lmin) return false;
    if (lmax !== null && r.length > lmax) return false;
    if (npsmin !== null && r.nps < npsmin) return false;
    if ($('measured').checked && r.rating === null) return false;
    if ($('none-chords').checked && (r.doubles || r.triples)) return false;
    for (const [k] of FEATURES) {
      if ($('only-' + k).checked && !r[k]) return false;
      const m = num('min-' + k);
      if (m !== null && r[k] < m) return false;
    }
    return true;
  });
}
const fmtLen = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function render() {
  const list = filtered();
  const key = st.sort, dir = st.desc ? -1 : 1;
  list.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === y) return a.title.localeCompare(b.title);
    if (x === null) return 1; if (y === null) return -1; // unrated last
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  const sum = k => list.reduce((s, r) => s + r[k], 0);
  $('summary').innerHTML = `<span><b>${list.length}</b> of ${rows.length} songs</span>` +
    ['notes', 'taps', 'holds', 'rolls', 'doubles', 'triples', 'backing'].map(k => `<span>${k}: <b>${sum(k)}</b></span>`).join('') +
    `<span>charts with doubles: <b>${list.filter(r => r.doubles).length}</b></span><span>with triples: <b>${list.filter(r => r.triples).length}</b></span>`;
  $('tbl').innerHTML = '<thead><tr>' + COLS.map(([k, n, c]) => `<th data-k="${k}" class="${c || ''}${k === key ? ' sorted' + (st.desc ? ' desc' : '') : ''}">${n}</th>`).join('') + '</tr></thead><tbody>' +
    list.map(r => {
      const cell = k => `<td class="${r[k] === 0 ? 'z' : ''}">${r[k]}</td>`;
      const open = st.open.has(r.id);
      const max = Math.max(1, ...r.lanes);
      return `<tr class="row" data-id="${esc(r.id)}"><td title="${esc(r.id)}">${esc(r.title)}</td>` +
        `<td class="l">${esc(catName[r.category] || r.category)}</td>` +
        `<td>${r.rating === null ? '<span class="mut">n/a</span>' : r.rating.toFixed(1)}${r.estimated ? '*' : ''}</td><td>${r.bpm}</td><td>${fmtLen(r.length)}</td>` +
        ['notes', 'taps', 'holds', 'rolls', 'doubles', 'triples', 'backing', 'nps', 'peak'].map(cell).join('') + '</tr>' +
        (open ? `<tr class="detail"><td colspan="${COLS.length}"><div><b>${esc(r.title)}</b> <span class="mut">${esc(r.tag)} · ${r.stars} star${r.stars === 1 ? '' : 's'}</span></div>` +
          `<div>${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="mut">no weakness tags</span>'}</div>` +
          `<div class="mut">short holds ${r.shortHolds} · roll ticks ${r.rollTicks} · ${r.notes} playable + ${r.backing} auto-played backing</div>` +
          `<div class="bars">${r.lanes.map((n, l) => `<div style="height:${Math.round(40 * n / max)}px" title="lane ${l + 1}: ${n}">${n}</div>`).join('')}</div></td></tr>` : '');
    }).join('') + '</tbody>';
}
$('tbl').addEventListener('click', e => {
  const th = e.target.closest('th'), tr = e.target.closest('tr.row');
  if (th) { const k = th.dataset.k; st.desc = st.sort === k ? !st.desc : !['title', 'category'].includes(k); st.sort = k; }
  else if (tr) { const id = tr.dataset.id; st.open.has(id) ? st.open.delete(id) : st.open.add(id); }
  else return;
  render();
});
$('filters').addEventListener('input', render);
$('reset').addEventListener('click', () => { for (const el of $('filters').querySelectorAll('input,select')) { if (el.type === 'checkbox') el.checked = false; else el.value = ''; } render(); });
render();
}

const load = () => { rows = buildLibrary().map(chartStats); init(); };
fetch(new URL('./difficulty.json', import.meta.url))
  .then(r => r.ok ? r.json() : {}).catch(() => ({}))
  .then(d => { setMeasured(d); load(); });
