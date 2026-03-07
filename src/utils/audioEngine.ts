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

import type { GeneratedPhrase, InstrumentType } from '../types';

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

  // Initialise delay line with heavily filtered noise (round, thumby excitation)
  const delayLine = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delayLine[i] = Math.random() * 2 - 1;
  }
  // Pre-filter: 10-pass moving average — very round attack, no pick transient
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < N - 1; i++) {
      delayLine[i] = 0.5 * (delayLine[i] + delayLine[i + 1]);
    }
  }

  // KS loop: heavier LP bias (0.3/0.7) for darker sustain + slower decay for body
  const decay = 0.9975;
  let idx = 0;
  for (let i = 0; i < totalSamples; i++) {
    data[i] = delayLine[idx];
    const next = (idx + 1) % N;
    delayLine[idx] = decay * (0.3 * delayLine[idx] + 0.7 * delayLine[next]);
    idx = next;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Soft attack envelope (fade in over 5ms — rounder than pick)
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume * 1.2, startTime + 0.005);
  source.connect(gain);

  // Low-pass: deep treble cut — tone knob rolled off
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(frequency * 2, 1800);
  lp.Q.value = 0.6;
  gain.connect(lp);

  // Low-mid boost: fattens the 200-400 Hz body range
  const pk = ctx.createBiquadFilter();
  pk.type = 'peaking';
  pk.frequency.value = 300;
  pk.Q.value = 0.8;
  pk.gain.value = 4;
  lp.connect(pk);

  // High-shelf: further tame brightness above 1.2 kHz
  const hs = ctx.createBiquadFilter();
  hs.type = 'highshelf';
  hs.frequency.value = 1200;
  hs.gain.value = -9;
  pk.connect(hs);

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
 * Play a single saxophone-like note using sawtooth + formant filters + vibrato.
 */
export function playSaxNote(
  ctx: AudioContext,
  frequency: number,
  volume: number,
  startTime: number,
  duration = 2.0,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();

  // Sawtooth oscillator — reed-like harmonic structure
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(frequency, startTime);

  // Vibrato LFO — delayed onset
  const vibrato = ctx.createOscillator();
  vibrato.type = 'sine';
  vibrato.frequency.value = 5.5;
  const vibratoGain = ctx.createGain();
  vibratoGain.gain.setValueAtTime(0, startTime);
  vibratoGain.gain.linearRampToValueAtTime(0, startTime + 0.15);
  vibratoGain.gain.linearRampToValueAtTime(3, startTime + 0.4);
  vibrato.connect(vibratoGain);
  vibratoGain.connect(osc.frequency);
  vibrato.start(startTime);

  // Formant filters (parallel) — body + reed
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 500;
  f1.Q.value = 2;
  const f1Gain = ctx.createGain();
  f1Gain.gain.value = 0.6;

  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 1400;
  f2.Q.value = 3;
  const f2Gain = ctx.createGain();
  f2Gain.gain.value = 0.4;

  osc.connect(f1);
  f1.connect(f1Gain);
  osc.connect(f2);
  f2.connect(f2Gain);

  // Warmth LP filter
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(frequency * 6, 4000);
  lp.Q.value = 0.7;
  f1Gain.connect(lp);
  f2Gain.connect(lp);

  // Envelope (slightly quieter than guitar to match perceived loudness)
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startTime);
  env.gain.linearRampToValueAtTime(volume * 0.55, startTime + 0.02);
  env.gain.setValueAtTime(volume * 0.55, startTime + duration - 0.05);
  env.gain.linearRampToValueAtTime(0, startTime + duration);
  lp.connect(env);
  env.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
  vibrato.stop(startTime + duration + 0.01);

  return {
    stop() {
      try {
        env.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
        osc.stop(ctx.currentTime + 0.06);
        vibrato.stop(ctx.currentTime + 0.06);
      } catch { /* already stopped */ }
    },
  };
}

/**
 * Play a single electric piano note.
 *
 * Clean sine-based tone with a soft 2nd harmonic for warmth.
 * Gentle attack, smooth exponential decay — simple and warm,
 * like a generic stage piano / DX-style EP patch.
 */
export function playEPNote(
  ctx: AudioContext,
  frequency: number,
  volume: number,
  startTime: number,
  duration = 2.0,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();

  // Fundamental — clean sine
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(frequency, startTime);

  // 2nd harmonic — adds body, decays faster than fundamental
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(frequency * 2, startTime);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(volume * 0.18, startTime);
  g2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.6);
  osc2.connect(g2);

  // 3rd harmonic — subtle brightness on attack only
  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.setValueAtTime(frequency * 3, startTime);
  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(volume * 0.06, startTime);
  g3.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);
  osc3.connect(g3);

  // Amplitude envelope: soft attack → smooth decay
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startTime);
  env.gain.linearRampToValueAtTime(volume * 0.4, startTime + 0.01);
  env.gain.exponentialRampToValueAtTime(volume * 0.2, startTime + 0.2);
  env.gain.exponentialRampToValueAtTime(volume * 0.01, startTime + duration);

  // Warmth LP
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(frequency * 6, 4500);
  lp.Q.value = 0.5;

  osc1.connect(lp);
  g2.connect(lp);
  g3.connect(lp);
  lp.connect(env);
  env.connect(ctx.destination);

  const stopAt = startTime + duration + 0.01;
  osc1.start(startTime);  osc1.stop(stopAt);
  osc2.start(startTime);  osc2.stop(stopAt);
  osc3.start(startTime);  osc3.stop(stopAt);

  return {
    stop() {
      try {
        env.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
        osc1.stop(ctx.currentTime + 0.06);
        osc2.stop(ctx.currentTime + 0.06);
        osc3.stop(ctx.currentTime + 0.06);
      } catch { /* already stopped */ }
    },
  };
}

/**
 * Play a single note with the specified instrument synthesis.
 */
export function playNote(
  ctx: AudioContext,
  frequency: number,
  volume: number,
  startTime: number,
  duration: number,
  instrument: InstrumentType,
): { stop: () => void } {
  switch (instrument) {
    case 'saxophone': return playSaxNote(ctx, frequency, volume, startTime, duration);
    default:          return playKSNote(ctx, frequency, volume, startTime, duration);
  }
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
    return playEPNote(ctx, freq, volume, startTime + i * strumDelay, duration);
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
/** Rhythm type duration in beats */
const RHYTHM_BEATS: Record<string, number> = {
  'q': 1.0, 't': 1/3, 'e': 0.5, 's': 0.25,
};

export function schedulePhrase(
  ctx: AudioContext,
  phrase: GeneratedPhrase,
  startTime: number,
  eighthNoteDur: number,
  volume: number,
  maxNotes = 99,
  instrument: InstrumentType = 'guitar',
): { stop: () => void; totalDuration: number } {
  if (ctx.state === 'suspended') ctx.resume();

  const notes = phrase.notes.slice(0, maxNotes);
  const handles: { stop: () => void }[] = [];
  const beatDurSec = eighthNoteDur * 2; // one beat = two eighth notes

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.isRest) continue;
    const freq = fretToFrequency(n.stringIdx, n.fret);
    const rhythmDur = RHYTHM_BEATS[n.duration ?? 'e'] * beatDurSec;
    // Use beatStart for timing so audio syncs with animation & metronome
    const noteStart = startTime + (n.beatStart ?? 0) * beatDurSec;
    // Last note sustains longer; others get slight overlap for legato
    const dur = i < notes.length - 1 ? rhythmDur * 1.2 : rhythmDur * 2;
    handles.push(playNote(ctx, freq, volume, noteStart, dur, instrument));
  }

  // Total duration: from first note to end of last note
  const lastNote = notes[notes.length - 1];
  const lastStart = (lastNote?.beatStart ?? 0) * beatDurSec;
  const lastDur = RHYTHM_BEATS[lastNote?.duration ?? 'e'] * beatDurSec;
  const totalDuration = lastStart + lastDur;

  return {
    stop() {
      handles.forEach(h => h.stop());
    },
    totalDuration,
  };
}
