/**
 * Karplus-Strong guitar synthesis engine.
 *
 * Provides plucked-string audio for:
 *  - individual fretboard note clicks
 *  - chord strums during BPM auto-play
 *  - phrase note playback (auto-play in progression mode)
 *
 * Uses pre-rendered AudioBuffers (no AudioWorklet, no external files).
 */

import type { GeneratedPhrase } from '../types';

/** Guitar open-string MIDI note numbers (stringIdx 0 = 1E … 5 = 6E) */
export const OPEN_STRING_MIDI: readonly number[] = [64, 59, 55, 50, 45, 40];

/** Convert a fretboard position to frequency in Hz. */
export function fretToFrequency(stringIdx: number, fret: number): number {
  const midi = OPEN_STRING_MIDI[stringIdx] + fret;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Play a single Karplus-Strong plucked note.
 *
 * @returns handle with `stop()` to cut off early (50 ms gain fade-out).
 */
export function playKSNote(
  ctx: AudioContext,
  frequency: number,
  volume: number,
  startTime: number,
  duration = 2.0,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();

  const sampleRate = ctx.sampleRate;
  const N = Math.round(sampleRate / frequency);
  if (N < 1) return { stop: () => {} };

  const totalSamples = Math.ceil(sampleRate * duration);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Initialise delay line with heavily filtered noise (jazz-like soft excitation)
  const delayLine = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delayLine[i] = Math.random() * 2 - 1;
  }
  // Pre-filter: 6-pass moving average — kills high-freq transients for round attack
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < N - 1; i++) {
      delayLine[i] = 0.5 * (delayLine[i] + delayLine[i + 1]);
    }
  }

  // KS loop: weighted low-pass (0.4/0.6 bias = darker sustain) + decay
  const decay = 0.996;
  let idx = 0;
  for (let i = 0; i < totalSamples; i++) {
    data[i] = delayLine[idx];
    const next = (idx + 1) % N;
    delayLine[idx] = decay * (0.4 * delayLine[idx] + 0.6 * delayLine[next]);
    idx = next;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Soft attack envelope (fade in over 3ms to remove click)
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume * 1.0, startTime + 0.003);
  source.connect(gain);

  // Low-pass: aggressive treble cut for warm jazz tone
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(frequency * 2.5, 2200);
  lp.Q.value = 0.7;
  gain.connect(lp);

  // High-shelf: further tame brightness above 1.5 kHz
  const hs = ctx.createBiquadFilter();
  hs.type = 'highshelf';
  hs.frequency.value = 1500;
  hs.gain.value = -6;
  lp.connect(hs);

  hs.connect(ctx.destination);
  source.start(startTime);

  return {
    stop() {
      try {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
        source.stop(ctx.currentTime + 0.06);
      } catch { /* already stopped */ }
    },
  };
}

/**
 * Play a chord strum (multiple notes, bass → treble with slight stagger).
 *
 * @param strumDelay  seconds between successive strings (default 0.018 = 18 ms)
 * @returns composite handle whose `stop()` fades out all notes.
 */
export function playChordStrum(
  ctx: AudioContext,
  notes: { stringIdx: number; fret: number }[],
  volume: number,
  startTime: number,
  strumDelay = 0.018,
  duration = 2.0,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();

  // Sort bass (high stringIdx) → treble (low stringIdx)
  const sorted = [...notes].sort((a, b) => b.stringIdx - a.stringIdx);

  const handles = sorted.map((note, i) => {
    const freq = fretToFrequency(note.stringIdx, note.fret);
    return playKSNote(ctx, freq, volume, startTime + i * strumDelay, duration);
  });

  return {
    stop() {
      handles.forEach(h => h.stop());
    },
  };
}

/**
 * Schedule a phrase's notes for playback via Web Audio API.
 *
 * Each PhraseNote is played as a Karplus-Strong plucked note at precise
 * eighth-note intervals.  For chords shorter than 4 beats the caller
 * passes a reduced `maxNotes` so only the first N notes sound.
 *
 * @returns composite handle whose `stop()` fades out all scheduled notes.
 */
export function schedulePhrase(
  ctx: AudioContext,
  phrase: GeneratedPhrase,
  startTime: number,
  eighthNoteDur: number,
  volume: number,
  maxNotes = 8,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();

  const notes = phrase.notes.slice(0, maxNotes);
  const handles: { stop: () => void }[] = [];

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const freq = fretToFrequency(n.stringIdx, n.fret);
    const noteStart = startTime + i * eighthNoteDur;
    // Last note sustains longer; others get slight overlap for legato
    const dur = i < notes.length - 1 ? eighthNoteDur * 1.2 : eighthNoteDur * 2;
    handles.push(playKSNote(ctx, freq, volume, noteStart, dur));
  }

  return {
    stop() {
      handles.forEach(h => h.stop());
    },
  };
}
