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
import { swingBeatStart, swingVolumeMult, swingDurMult } from './swing';
import { getAudioConfig } from './configLoader';

/** Play a metronome click sound at the given Web Audio timestamp. */
export function playClick(accent: boolean, ctx: AudioContext, volume: number, at?: number): OscillatorNode {
  if (ctx.state === 'suspended') ctx.resume();
  const met = getAudioConfig().metronome;
  const t = at ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = accent ? met.accentFreq : met.normalFreq;
  gain.gain.setValueAtTime(accent ? volume * met.accentGainMult : volume * met.normalGainMult, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + met.fadeOut);
  osc.start(t);
  osc.stop(t + met.fadeOut);
  return osc;
}

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
  duration?: number,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();
  const gc = getAudioConfig().guitar;
  const dur = duration ?? gc.defaultDuration;

  const sampleRate = ctx.sampleRate;
  const N = Math.round(sampleRate / frequency);
  if (N < 1) return { stop: () => {} };

  const totalSamples = Math.ceil(sampleRate * dur);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Initialise delay line with heavily filtered noise (round, thumby excitation)
  const delayLine = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delayLine[i] = Math.random() * 2 - 1;
  }
  // Pre-filter: N-pass moving average — very round attack, no pick transient
  for (let pass = 0; pass < gc.lpFilterPasses; pass++) {
    for (let i = 0; i < N - 1; i++) {
      delayLine[i] = gc.maCoeff * (delayLine[i] + delayLine[i + 1]);
    }
  }

  // KS loop: heavier LP bias for darker sustain + slower decay for body
  let idx = 0;
  for (let i = 0; i < totalSamples; i++) {
    data[i] = delayLine[idx];
    const next = (idx + 1) % N;
    delayLine[idx] = gc.decay * (gc.loopLpCoeffs[0] * delayLine[idx] + gc.loopLpCoeffs[1] * delayLine[next]);
    idx = next;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Soft attack envelope
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume * gc.attackGainMult, startTime + gc.softAttack);
  source.connect(gain);

  // Low-pass: deep treble cut — tone knob rolled off
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(frequency * 2, gc.lpFreqMax);
  lp.Q.value = gc.lpQ;
  gain.connect(lp);

  // Low-mid boost: fattens the body range
  const pk = ctx.createBiquadFilter();
  pk.type = 'peaking';
  pk.frequency.value = gc.peakFreq;
  pk.Q.value = gc.peakQ;
  pk.gain.value = gc.peakGain;
  lp.connect(pk);

  // High-shelf: further tame brightness
  const hs = ctx.createBiquadFilter();
  hs.type = 'highshelf';
  hs.frequency.value = gc.hsFreq;
  hs.gain.value = gc.hsGain;
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
  duration?: number,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();
  const sc = getAudioConfig().saxophone;
  const dur = duration ?? sc.defaultDuration;

  // Sawtooth oscillator — reed-like harmonic structure
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(frequency, startTime);

  // Vibrato LFO — delayed onset
  const vibrato = ctx.createOscillator();
  vibrato.type = 'sine';
  vibrato.frequency.value = sc.vibratoFreq;
  const vibratoGain = ctx.createGain();
  vibratoGain.gain.setValueAtTime(0, startTime);
  vibratoGain.gain.linearRampToValueAtTime(0, startTime + sc.vibratoDelay);
  vibratoGain.gain.linearRampToValueAtTime(sc.vibratoDepth, startTime + sc.vibratoOnset);
  vibrato.connect(vibratoGain);
  vibratoGain.connect(osc.frequency);
  vibrato.start(startTime);

  // Formant filters (parallel) — body + reed
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = sc.formant1.freq;
  f1.Q.value = sc.formant1.q;
  const f1Gain = ctx.createGain();
  f1Gain.gain.value = sc.formant1.gain;

  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = sc.formant2.freq;
  f2.Q.value = sc.formant2.q;
  const f2Gain = ctx.createGain();
  f2Gain.gain.value = sc.formant2.gain;

  osc.connect(f1);
  f1.connect(f1Gain);
  osc.connect(f2);
  f2.connect(f2Gain);

  // Warmth LP filter
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(frequency * 6, sc.warmthLpFreqMax);
  lp.Q.value = sc.warmthLpQ;
  f1Gain.connect(lp);
  f2Gain.connect(lp);

  // Envelope (slightly quieter than guitar to match perceived loudness)
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startTime);
  env.gain.linearRampToValueAtTime(volume * sc.attackGainMult, startTime + sc.attackDuration);
  env.gain.setValueAtTime(volume * sc.attackGainMult, startTime + dur - 0.05);
  env.gain.linearRampToValueAtTime(0, startTime + dur);
  lp.connect(env);
  env.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + dur + 0.01);
  vibrato.stop(startTime + dur + 0.01);

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
  duration?: number,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();
  const ec = getAudioConfig().electricPiano;
  const dur = duration ?? ec.defaultDuration;

  // Fundamental — clean sine
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(frequency, startTime);

  // 2nd harmonic — adds body, decays faster than fundamental
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(frequency * 2, startTime);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(volume * ec.harmonic2GainMult, startTime);
  g2.gain.exponentialRampToValueAtTime(0.001, startTime + dur * ec.harmonic2DecayRatio);
  osc2.connect(g2);

  // 3rd harmonic — subtle brightness on attack only
  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.setValueAtTime(frequency * 3, startTime);
  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(volume * ec.harmonic3GainMult, startTime);
  g3.gain.exponentialRampToValueAtTime(0.001, startTime + ec.harmonic3Decay);
  osc3.connect(g3);

  // Amplitude envelope: soft attack → smooth decay
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startTime);
  env.gain.linearRampToValueAtTime(volume * ec.attackGainMult, startTime + ec.attackDuration);
  env.gain.exponentialRampToValueAtTime(volume * ec.decayGainMult, startTime + ec.decayDuration);
  env.gain.exponentialRampToValueAtTime(volume * ec.releaseGainMult, startTime + dur);

  // Warmth LP
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(frequency * 6, ec.warmthLpFreqMax);
  lp.Q.value = ec.warmthLpQ;

  osc1.connect(lp);
  g2.connect(lp);
  g3.connect(lp);
  lp.connect(env);
  env.connect(ctx.destination);

  const stopAt = startTime + dur + 0.01;
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
  strumDelay?: number,
  duration?: number,
): { stop: () => void } {
  if (ctx.state === 'suspended') ctx.resume();
  const cs = getAudioConfig().chordStrum;
  const sd = strumDelay ?? cs.strumDelay;
  const dur = duration ?? cs.defaultDuration;

  // Sort bass (high stringIdx) → treble (low stringIdx)
  const sorted = [...notes].sort((a, b) => b.stringIdx - a.stringIdx);

  const handles = sorted.map((note, i) => {
    const freq = fretToFrequency(note.stringIdx, note.fret);
    return playEPNote(ctx, freq, volume, startTime + i * sd, dur);
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
  swingAmount = 0,
  bpm = 120,
  noLastSustain = false,
): { stop: () => void; totalDuration: number } {
  if (ctx.state === 'suspended') ctx.resume();

  const notes = phrase.notes.slice(0, maxNotes);
  const handles: { stop: () => void }[] = [];
  const beatDurSec = eighthNoteDur * 2; // one beat = two eighth notes

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.isRest) continue;
    const freq = fretToFrequency(n.stringIdx, n.fret);
    const bs = n.beatStart ?? 0;
    const d = n.duration ?? 'e';
    const swungBeat = swingBeatStart(bs, d, swingAmount, bpm);
    const volMult = swingVolumeMult(bs, d, swingAmount);
    const durMult = swingDurMult(bs, d, swingAmount);
    const rhythmDur = (n.durationBeats ?? RHYTHM_BEATS[d]) * beatDurSec;
    // Use swung beatStart for timing so audio reflects swing feel
    const noteStart = startTime + swungBeat * beatDurSec;
    // Last note sustains longer; others get slight overlap for legato
    const ph = getAudioConfig().phrase;
    const isLast = i === notes.length - 1;
    const baseDur = isLast && !noLastSustain ? rhythmDur * ph.lastNoteSustainMult : rhythmDur * ph.legatoMult;
    handles.push(playNote(ctx, freq, volume * volMult, noteStart, baseDur * durMult, instrument));
  }

  // Total duration: from first note to end of last note (with swing applied)
  const lastNote = notes[notes.length - 1];
  const lastBs = lastNote?.beatStart ?? 0;
  const lastD = lastNote?.duration ?? 'e';
  const lastSwung = swingBeatStart(lastBs, lastD, swingAmount, bpm);
  const lastDur = (lastNote?.durationBeats ?? RHYTHM_BEATS[lastD]) * beatDurSec;
  const totalDuration = lastSwung * beatDurSec + lastDur * swingDurMult(lastBs, lastD, swingAmount);

  return {
    stop() {
      handles.forEach(h => h.stop());
    },
    totalDuration,
  };
}
