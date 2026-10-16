import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRTTTL } from '../src/rtttl.js';
import { encodeSong, decodeSong, decodeShare } from '../src/share.js';
import { SONGS } from '../src/songs.js';

const midis = s => parseRTTTL(s).notes.filter(n => !n.isRest).map(n => n.midi);

test('rtttl: missing defaults section falls back to d=4,o=6,b=63 with a warning', () => {
  const s = parseRTTTL('x:c,d');
  assert.equal(s.bpm, 63);
  assert.equal(s.notes[0].durBeat, 1);
  assert.equal(s.notes[0].midi, 84);
  assert.ok(s.warnings.some(w => /Missing defaults/.test(w)));
});

test('rtttl: two-part input with "=" is defaults + notes with an empty name', () => {
  const s = parseRTTTL('b=100:c,d');
  assert.equal(s.name, '');
  assert.equal(s.bpm, 100);
  assert.deepEqual(s.warnings, []);
});

test('rtttl: partial defaults keep fallbacks for the rest; empty name is fine', () => {
  const s = parseRTTTL('x:b=100:c,d');
  assert.equal(s.notes[0].durBeat, 1);
  assert.equal(s.notes[0].midi, 84);
  assert.equal(s.bpm, 100);
  const e = parseRTTTL(':d=4,o=5,b=63:c');
  assert.equal(e.name, '');
  assert.equal(e.bpm, 63);
});

test('rtttl: invalid and unknown defaults warn and fall back', () => {
  const cases = [
    ['d=3', /Invalid default d=3; using 4/],
    ['o=3', /Invalid default o=3; using 6/],
    ['o=8', /Invalid default o=8; using 6/],
    ['b=9', /Invalid default b=9; using 63/],
    ['b=901', /Invalid default b=901; using 63/],
    ['z=1', /Ignored default "z=1"/],
    ['d=x', /Ignored default "d=x"/],
  ];
  for (const [def, re] of cases) {
    const s = parseRTTTL(`t:${def}:c`);
    assert.ok(s.warnings.some(w => re.test(w)), def + ' -> ' + JSON.stringify(s.warnings));
  }
  const edge = parseRTTTL('t:d=32,o=7,b=900:c');
  assert.deepEqual(edge.warnings, []);
  assert.equal(edge.bpm, 900);
  assert.equal(edge.notes[0].durBeat, 0.125);
  assert.equal(edge.notes[0].midi, 12 * 8);
  assert.equal(parseRTTTL('t:b=10:c').bpm, 10);
});

test('rtttl: dots count once, in either position', () => {
  const n = parseRTTTL('t:d=4,o=5,b=120:8c.,8c.5,8c5.,c').notes;
  assert.equal(n[0].durBeat, 0.75);
  assert.equal(n[1].durBeat, 0.75);
  assert.equal(n[2].durBeat, 0.75);
  assert.ok(n[0].dotted && !n[3].dotted);
  assert.equal(n[3].durBeat, 1);
});

test('rtttl: sharps, rests and start beats', () => {
  const n = parseRTTTL('t:d=4,o=5,b=120:c#,a#6,p,2p,f#').notes;
  assert.deepEqual([n[0].midi, n[1].midi, n[4].midi], [73, 94, 78]);
  assert.ok(n[2].isRest && n[3].isRest);
  assert.equal(n[3].startBeat, 3);
  assert.equal(n[4].startBeat, 5);
});

test('rtttl: messy input yields warnings, not exceptions', () => {
  const s = parseRTTTL('  Messy Song : D=8 , O=6, b=200 :  8C , xx, 3c, 4h5, ,16E7 ,32g#4, , p ');
  assert.equal(s.name, 'Messy Song');
  assert.deepEqual(midis('  Messy Song : D=8 , O=6, b=200 :  8C , xx, 3c, 4h5, ,16E7 ,32g#4, , p '), [84, 100, 68]);
  assert.equal(s.warnings.length, 3);
  assert.ok(s.warnings.some(w => /unknown token "xx"/.test(w)));
  assert.ok(s.warnings.some(w => /bad duration 3/.test(w)));
  assert.ok(s.warnings.some(w => /unknown token "4h5"/.test(w)));
});

test('rtttl: out-of-range octaves are skipped, but rests ignore octave', () => {
  const s = parseRTTTL('t:d=4,o=5,b=120:c3,c8,c,p9');
  assert.equal(s.notes.filter(n => !n.isRest).length, 1);
  assert.equal(s.warnings.filter(w => /out of range/.test(w)).length, 2);
  assert.ok(s.notes.some(n => n.isRest), 'p9 stays a rest');
});

test('rtttl: colons inside the notes section are kept, not split', () => {
  const s = parseRTTTL('t:d=4,o=5,b=120:c,d:e');
  assert.ok(s.warnings.some(w => /unknown token "d:e"/.test(w)), 'the colon stays in the notes section');
  assert.equal(s.notes.length, 1);
});

test('rtttl: unusable input throws', () => {
  for (const bad of ['just text', 'a:d=4:', 'a:d=4:p,p', 'a:d=4:zz', '']) {
    assert.throws(() => parseRTTTL(bad), bad);
  }
  for (const bad of [42, null, undefined, {}]) assert.throws(() => parseRTTTL(bad), /string/);
});

test('rtttl: Ode to Joy sanity', () => {
  const ode = SONGS[0].rtttl;
  assert.deepEqual(midis(ode).slice(0, 5), [76, 76, 77, 79, 79]);
  const notes = parseRTTTL(ode).notes;
  const last = notes[notes.length - 1];
  assert.equal(last.startBeat + last.durBeat, 32);
  assert.equal(parseRTTTL(ode).bpm, 140);
});

test('rtttl: every built-in song parses without warnings', () => {
  for (const s of SONGS) assert.deepEqual(parseRTTTL(s.rtttl).warnings, [], s.id);
});

test('share: unicode round trip, url-safe alphabet, built-ins', () => {
  const str = 'Ünï ♪:d=4,o=5,b=120:c,d,e#,p';
  const h = encodeSong(str);
  assert.equal(decodeSong(h), str);
  assert.ok(h.startsWith('#s='));
  assert.ok(!/[+/=]/.test(h.slice(3)));
  for (const s of SONGS) assert.equal(decodeSong(encodeSong(s.rtttl)), s.rtttl, s.id);
});

test('share: garbled hashes decode to null, never throw', () => {
  for (const g of ['', '#', '#s=', '#s=!!!', '#s=%%%', '#x=abc', '#s=/////', '#s=_w', '#s=/w', null, undefined, 42]) {
    assert.equal(decodeSong(g), null, String(g));
    assert.equal(decodeShare(g), null, String(g));
  }
});

test('share: hash without leading # and trailing params still decode', () => {
  const h = encodeSong('a:d=4:c');
  assert.equal(decodeSong(h.slice(1)), 'a:d=4:c');
  assert.equal(decodeSong(h + '&junk=1'), 'a:d=4:c');
});
