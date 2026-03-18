/**
 * Multi-dimensional swing transformation.
 *
 * Applies timing + dynamics + articulation to turn straight eighth-note
 * phrases into swinging performances. All three dimensions are controlled
 * by a single `amount` parameter (0 = straight, 1 = full swing).
 *
 * Key design: beatStart values in the phrase data stay straight.
 * Swing is applied at playback / animation time only.
 */

import { getAudioConfig } from './configLoader';

/** Clamp value to [lo, hi] */
function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

/**
 * Is this beat position an offbeat eighth note?
 * Fractional part ≈ 0.5 → offbeat eighth.
 */
function isOffbeatEighth(beatStart: number): boolean {
  const frac = beatStart - Math.floor(beatStart);
  return Math.abs(frac - 0.5) < getAudioConfig().swing.eighthThreshold;
}

/**
 * Is this beat position an offbeat sixteenth? (frac ≈ 0.25 or 0.75)
 */
function isOffbeatSixteenth(beatStart: number): boolean {
  const frac = beatStart - Math.floor(beatStart);
  const thr = getAudioConfig().swing.sixteenthThreshold;
  return Math.abs(frac - 0.25) < thr || Math.abs(frac - 0.75) < thr;
}

/**
 * Compute effective swing amount with tempo compensation.
 * At high tempos (>200 BPM), swing naturally narrows.
 * Based on Friberg & Sundström (2002) research.
 */
function effectiveAmount(amount: number, bpm: number): number {
  const sc = getAudioConfig().swing;
  if (bpm <= sc.tempoCompThreshold) return amount;
  return amount * clamp(1 - (bpm - sc.tempoCompThreshold) / sc.tempoCompRange, 0, 1);
}

/**
 * Apply swing timing to a beat position.
 *
 * - Quarter notes ('q') and triplets ('t') are not affected.
 * - Offbeat eighths are pushed later (long-short feel).
 * - Offbeat sixteenths are proportionally repositioned.
 * - Amount 0 = straight, 1 = full triplet swing.
 */
export function swingBeatStart(
  beatStart: number,
  duration: string,
  amount: number,
  bpm: number,
): number {
  if (amount <= 0) return beatStart;
  if (duration === 'q' || duration === 't') return beatStart;

  const ea = effectiveAmount(amount, bpm);
  const sc = getAudioConfig().swing;

  if (duration === 'e' && isOffbeatEighth(beatStart)) {
    return beatStart + ea * sc.timing.offbeatEighthShift;
  }

  if (duration === 's') {
    const frac = beatStart - Math.floor(beatStart);
    if (Math.abs(frac - 0.25) < sc.sixteenthThreshold) {
      return beatStart + ea * sc.timing.sixteenth2ndShift;
    }
    if (Math.abs(frac - 0.5) < sc.eighthThreshold) {
      return beatStart + ea * sc.timing.offbeatEighthShift;
    }
    if (Math.abs(frac - 0.75) < sc.sixteenthThreshold) {
      return beatStart + ea * sc.timing.sixteenth4thShift;
    }
  }

  return beatStart;
}

/**
 * Volume multiplier for swing dynamics.
 *
 * - Downbeat eighths: louder (up to +15%)
 * - Offbeat eighths: softer (up to -20%)
 * - Quarter notes and triplets: unchanged.
 */
export function swingVolumeMult(
  beatStart: number,
  duration: string,
  amount: number,
): number {
  if (amount <= 0) return 1.0;
  if (duration === 'q' || duration === 't') return 1.0;

  const sc = getAudioConfig().swing;

  if (duration === 'e') {
    if (isOffbeatEighth(beatStart)) {
      return 1.0 - amount * sc.dynamics.offbeatEighthCut;
    }
    const frac = beatStart - Math.floor(beatStart);
    if (Math.abs(frac) < sc.eighthThreshold || Math.abs(frac - 1.0) < sc.eighthThreshold) {
      return 1.0 + amount * sc.dynamics.onbeatEighthBoost;
    }
  }

  if (duration === 's') {
    if (isOffbeatSixteenth(beatStart) || isOffbeatEighth(beatStart)) {
      return 1.0 - amount * sc.dynamics.sixteenthCut;
    }
  }

  return 1.0;
}

/**
 * Duration multiplier for swing articulation.
 *
 * - Downbeat eighths: longer (legato, up to +25%)
 * - Offbeat eighths: shorter (staccato-ish, up to -30%)
 * - Quarter notes and triplets: unchanged.
 */
export function swingDurMult(
  beatStart: number,
  duration: string,
  amount: number,
): number {
  if (amount <= 0) return 1.0;
  if (duration === 'q' || duration === 't') return 1.0;

  const sc = getAudioConfig().swing;

  if (duration === 'e') {
    if (isOffbeatEighth(beatStart)) {
      return 1.0 - amount * sc.articulation.offbeatEighthShorten;
    }
    const frac = beatStart - Math.floor(beatStart);
    if (Math.abs(frac) < sc.eighthThreshold || Math.abs(frac - 1.0) < sc.eighthThreshold) {
      return 1.0 + amount * sc.articulation.onbeatEighthLengthen;
    }
  }

  if (duration === 's') {
    if (isOffbeatSixteenth(beatStart) || isOffbeatEighth(beatStart)) {
      return 1.0 - amount * sc.articulation.sixteenthShorten;
    }
  }

  return 1.0;
}
