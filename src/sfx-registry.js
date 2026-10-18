// Every sound effect of Synth as data, for Settings › Developer › Sound library and its coverage test.
// Each entry names the Synth method it exercises, so a new SFX method that is not registered here fails tests/sfx-registry.test.mjs.
import { VOICES } from './synth.js';

// Synth methods that are plumbing rather than sounds; playNote is covered by one entry per voice.
export const SFX_EXCLUDED = ['constructor', 'ensure', 'wake', 'setVolume', 'setFocusMuted', 'getAudioClock', 'getLatency', 'stopAll', 'playNote'];

const PREVIEW_MIDI = 72; // C5, for the instrument voices and the ping
const entry = (category, method, label, play) => ({ id: `${method}:${label}`, category, method, label, play });
const each = (category, method, args, call = (s, a) => s[method](a), name = a => String(a)) =>
  args.map(a => entry(category, method, `${method} ${name(a)}`, s => call(s, a)));

export const SFX_CATEGORIES = ['Menu', 'Feedback', 'Instruments', 'Notes', 'Metronome', 'Results', 'Favorites'];

export const SFX_REGISTRY = [
  ...each('Menu', 'menuBlip', [0, 1, 2, 3, 4, 5, 6]),
  entry('Menu', 'keyClick', 'keyClick', s => s.keyClick()),
  ...each('Menu', 'tickUp', [0, 4, 7, 11]),
  entry('Feedback', 'blocked', 'blocked', s => s.blocked()),
  entry('Feedback', 'chirp', 'chirp', s => s.chirp()),
  entry('Feedback', 'breakSlide', 'breakSlide', s => s.breakSlide()),
  ...each('Notes', 'ping', [60, 72, 84]),
  ...VOICES.map(v => entry('Instruments', 'playNote', `note ${v}`, s => {
    const was = s.voice;
    s.voice = v;
    s.playNote({ midi: PREVIEW_MIDI, when: s.ctx.currentTime, duration: 0.4 });
    s.voice = was;
  })),
  entry('Notes', 'playMiss', 'playMiss', s => s.playMiss(PREVIEW_MIDI, s.ctx.currentTime)),
  ...each('Notes', 'playStray', [0, 1, 2, 3], (s, a) => s.playStray(a, s.ctx.currentTime), a => `lane ${a}`),
  entry('Metronome', 'tick', 'tick', s => s.tick({ when: s.ctx.currentTime })),
  entry('Metronome', 'tick', 'tick accent', s => s.tick({ when: s.ctx.currentTime, accent: true })),
  ...each('Results', 'stinger', ['S', 'A', 'B', 'C', 'D'], (s, a) => s.stinger(a), a => `grade ${a}`),
  entry('Results', 'jingle', 'jingle', s => s.jingle()),
  entry('Favorites', 'favAdd', 'favAdd', s => s.favAdd()),
  entry('Favorites', 'favBreak', 'favBreak', s => s.favBreak()),
];

// Plays one registry entry on its own: the audio context is started (a click is a user gesture) and any running preview is cut.
export function playSfx(synth, e) {
  synth.ensure();
  synth.stopAll();
  e.play(synth);
}
