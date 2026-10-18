// Cloud sync: merging the shared document (settings, favourites, my songs) that every device edits. Pure functions,
// no DOM, no storage. Scores and stats are per device instead and are combined by their own stores
// (combineScores in scores.js, combineStats in stats.js). See docs/CLOUD.md.

const isNum = v => typeof v === 'number' && isFinite(v);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// Settings that follow the player across devices. Everything else in settings.js stays per device: volume,
// calibration (audio latency is the device's), controller bindings, the last selected song, the old custom slot.
export const SYNCED_SETTINGS = ['lang', 'voice', 'scrollTime', 'invert', 'backing', 'rollAudio', 'preview', 'idleGags', 'juice', 'haptics', 'comboPopup', 'perfOverlay', 'netTracker',
  'view', 'mods', 'tutorialDone', 'tutorialLessons', 'msgSeen'];

export const blankShared = () => ({ v: 1, settings: {}, settingsT: {}, favorites: {}, songs: {}, gone: {}, resetAt: 0 });

// Anything -> a well-formed shared document (values are sanitized again by their owners when applied).
export function cleanShared(raw) {
  const d = blankShared();
  if (!isObj(raw)) return d;
  if (isObj(raw.settings)) for (const k of SYNCED_SETTINGS) if (k in raw.settings) d.settings[k] = raw.settings[k];
  if (isObj(raw.settingsT)) for (const k of SYNCED_SETTINGS) if (isNum(raw.settingsT[k])) d.settingsT[k] = raw.settingsT[k];
  if (isObj(raw.favorites)) {
    for (const [id, f] of Object.entries(raw.favorites)) {
      if (id && id.length <= 200 && isObj(f) && isNum(f.t)) d.favorites[id] = { on: f.on === true, t: f.t };
    }
  }
  if (isObj(raw.songs)) {
    for (const [uid, s] of Object.entries(raw.songs)) {
      if (uid && uid.length <= 40 && isObj(s) && typeof s.rtttl === 'string') {
        d.songs[uid] = { name: String(s.name || ''), rtttl: s.rtttl, updated: isNum(s.updated) ? s.updated : 0, rating: s.rating || null };
      }
    }
  }
  if (isObj(raw.gone)) for (const [uid, t] of Object.entries(raw.gone)) if (uid && uid.length <= 40 && isNum(t)) d.gone[uid] = t;
  d.resetAt = isNum(raw.resetAt) ? raw.resetAt : 0;
  return d;
}

const newer = (a, b, ta, tb) => (tb > ta ? b : a);

// Two shared documents -> the merged one. Commutative and idempotent: merging in any order gives the same result.
export function mergeShared(a, b) {
  a = cleanShared(a); b = cleanShared(b);
  const m = blankShared();
  for (const k of SYNCED_SETTINGS) {
    const inA = k in a.settings, inB = k in b.settings;
    if (!inA && !inB) continue;
    const ta = a.settingsT[k] || 0, tb = b.settingsT[k] || 0;
    if (k === 'msgSeen' && Array.isArray(a.settings[k]) && Array.isArray(b.settings[k])) {
      m.settings[k] = [...new Set([...a.settings[k], ...b.settings[k]])].sort(); // read messages stay read
    } else if (!inB) m.settings[k] = a.settings[k];
    else if (!inA) m.settings[k] = b.settings[k];
    else if (ta === tb) m.settings[k] = JSON.stringify(a.settings[k]) <= JSON.stringify(b.settings[k]) ? a.settings[k] : b.settings[k];
    else m.settings[k] = newer(a.settings[k], b.settings[k], ta, tb);
    const t = Math.max(ta, tb);
    if (t) m.settingsT[k] = t;
  }
  for (const id of new Set([...Object.keys(a.favorites), ...Object.keys(b.favorites)])) {
    const fa = a.favorites[id], fb = b.favorites[id];
    // On a tie, "on" wins: unfavouriting has to be a later decision.
    m.favorites[id] = !fa ? fb : !fb ? fa : fa.t !== fb.t ? newer(fa, fb, fa.t, fb.t) : (fa.on ? fa : fb);
  }
  for (const uid of new Set([...Object.keys(a.gone), ...Object.keys(b.gone)])) m.gone[uid] = Math.max(a.gone[uid] || 0, b.gone[uid] || 0);
  for (const uid of new Set([...Object.keys(a.songs), ...Object.keys(b.songs)])) {
    const sa = a.songs[uid], sb = b.songs[uid];
    let s = !sa ? sb : !sb ? sa : sa.updated !== sb.updated ? newer(sa, sb, sa.updated, sb.updated)
      : (!!sb.rating > !!sa.rating || (!!sb.rating === !!sa.rating && JSON.stringify(sb) < JSON.stringify(sa))) ? sb : sa;
    if (m.gone[uid] !== undefined && m.gone[uid] >= s.updated) continue; // deleted after its last edit
    m.songs[uid] = s;
  }
  // The same melody saved on two devices (e.g. one share link opened on both) is kept once: the smaller uid wins.
  const byText = new Map();
  for (const uid of Object.keys(m.songs).sort()) {
    const t = m.songs[uid].rtttl.trim();
    if (byText.has(t)) { m.gone[uid] = Math.max(m.gone[uid] || 0, m.songs[uid].updated); delete m.songs[uid]; } else byText.set(t, uid);
  }
  m.resetAt = Math.max(a.resetAt, b.resetAt);
  return m;
}

// Player names, checked the same way by the game (before a rename goes up) and the API: 3-16 characters the LCD font
// has, inner runs of spaces folded. -> the clean name, or '' when it doesn't fit.
const NAME = /^[A-Za-z0-9_.-](?:[A-Za-z0-9 _.-]{1,14})[A-Za-z0-9_.-]$/;
export function cleanName(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return NAME.test(s) ? s : '';
}

// Stable text form, for "did anything change?" checks.
export const sharedKey = doc => canon(cleanShared(doc));
export function sameShared(a, b) {
  return sharedKey(a) === sharedKey(b);
}

// The first device to fill an empty profile sets the starting point: its never-changed settings and old favourite
// marks get a time, so another device's never-changed ones (time 0) don't win a coin toss against them.
export function stampUnset(doc, t) {
  const d = cleanShared(doc);
  for (const k of Object.keys(d.settings)) d.settingsT[k] ||= t;
  for (const f of Object.values(d.favorites)) f.t ||= t;
  return d;
}
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
