/**
 * Karplus-Strong guitar synthesis engine.
 *
 * Provides plucked-string audio for:
 *  - individual fretboard note clicks
 *  - chord strums during BPM auto-play
 *
 * Uses pre-rendered AudioBuffers (no AudioWorklet, no external files).
 */

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

  // Initialise delay line with band-limited noise (excitation burst)
  const delayLine = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delayLine[i] = Math.random() * 2 - 1;
  }

  // KS loop: averaging low-pass + decay
  const decay = 0.996;
  let idx = 0;
  for (let i = 0; i < totalSamples; i++) {
    data[i] = delayLine[idx];
    const next = (idx + 1) % N;
    delayLine[idx] = decay * 0.5 * (delayLine[idx] + delayLine[next]);
    idx = next;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(ctx.destination);
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
