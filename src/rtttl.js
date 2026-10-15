// RTTTL parser: "name:d=4,o=5,b=125:8e6,8d6,p,4c#.,..." -> { name, bpm, warnings, notes[] }
//
// MIDI mapping: RTTTL octave N, note C == MIDI 12*(N+1). So c4 = 60 (middle C),
// a4 = 69 = 440 Hz, e5 = 76. Octaves 4..7 are accepted.

const SEMITONE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const VALID_DURATIONS = [1, 2, 4, 8, 16, 32];
// [duration][note][#][.][octave][.]  (dot is accepted in either position)
const TOKEN = /^(\d+)?([a-gp])(#)?(\.)?(\d+)?(\.)?$/;

const FALLBACK = { d: 4, o: 6, b: 63 };

export function parseRTTTL(text) {
  if (typeof text !== 'string') throw new Error('RTTTL input must be a string');
  const warnings = [];
  const parts = text.split(':');
  let name, defStr, noteStr;
  if (parts.length >= 3) {
    name = parts[0]; defStr = parts[1]; noteStr = parts.slice(2).join(':');
  } else if (parts.length === 2) {
    if (parts[0].includes('=')) { name = ''; defStr = parts[0]; }
    else { name = parts[0]; defStr = ''; warnings.push('Missing defaults section; using d=4,o=6,b=63'); }
    noteStr = parts[1];
  } else {
    throw new Error('No notes section found (expected name:defaults:notes)');
  }
  name = name.trim();

  // Defaults
  const def = { ...FALLBACK };
  for (const kv of defStr.replace(/\s+/g, '').toLowerCase().split(',')) {
    if (!kv) continue;
    const m = /^([dob])=(\d+)$/.exec(kv);
    if (!m) { warnings.push(`Ignored default "${kv}"`); continue; }
    const v = parseInt(m[2], 10);
    const ok = m[1] === 'd' ? VALID_DURATIONS.includes(v)
             : m[1] === 'o' ? v >= 4 && v <= 7
             : v >= 10 && v <= 900;
    if (ok) def[m[1]] = v; else warnings.push(`Invalid default ${kv}; using ${FALLBACK[m[1]]}`);
  }

  // Notes
  const notes = [];
  let beat = 0, playable = 0;
  for (const tok of noteStr.replace(/\s+/g, '').toLowerCase().split(',')) {
    if (!tok) continue;
    const m = TOKEN.exec(tok);
    if (!m) { warnings.push(`Skipped unknown token "${tok}"`); continue; }
    const dur = m[1] ? parseInt(m[1], 10) : def.d;
    if (!VALID_DURATIONS.includes(dur)) { warnings.push(`Skipped "${tok}": bad duration ${dur}`); continue; }
    const isRest = m[2] === 'p';
    const oct = m[5] ? parseInt(m[5], 10) : def.o;
    if (!isRest && (oct < 4 || oct > 7)) { warnings.push(`Skipped "${tok}": octave ${oct} out of range 4-7`); continue; }
    const dotted = !!(m[4] || m[6]); // a dot in either position counts once
    const durBeat = (4 / dur) * (dotted ? 1.5 : 1);
    const midi = isRest ? 0 : 12 * (oct + 1) + SEMITONE[m[2]] + (m[3] ? 1 : 0);
    notes.push({ midi, startBeat: beat, durBeat, isRest, dotted });
    beat += durBeat;
    if (!isRest) playable++;
  }
  if (playable === 0) throw new Error('No valid notes found');
  return { name, bpm: def.b, warnings, notes };
}
