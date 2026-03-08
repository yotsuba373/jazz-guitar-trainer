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
  return Math.abs(frac - 0.5) < 0.08;
}

/**
 * Is this beat position an offbeat sixteenth? (frac ≈ 0.25 or 0.75)
 */
function isOffbeatSixteenth(beatStart: number): boolean {
  const frac = beatStart - Math.floor(beatStart);
  return Math.abs(frac - 0.25) < 0.06 || Math.abs(frac - 0.75) < 0.06;
}

/**
 * Compute effective swing amount with tempo compensation.
 * At high tempos (>200 BPM), swing naturally narrows.
 * Based on Friberg & Sundström (2002) research.
 */
function effectiveAmount(amount: number, bpm: number): number {
  if (bpm <= 200) return amount;
  return amount * clamp(1 - (bpm - 200) / 80, 0, 1);
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

  if (duration === 'e' && isOffbeatEighth(beatStart)) {
    // Shift offbeat eighth: max shift 0.17 beats (reaches triplet feel at amount=1)
    return beatStart + ea * 0.17;
  }

  if (duration === 's') {
    // Sixteenths: proportional repositioning
    const frac = beatStart - Math.floor(beatStart);
    if (Math.abs(frac - 0.25) < 0.06) {
      // 2nd sixteenth: slight push
      return beatStart + ea * 0.04;
    }
    if (Math.abs(frac - 0.5) < 0.08) {
      // 3rd sixteenth (offbeat): same as eighth offbeat
      return beatStart + ea * 0.17;
    }
    if (Math.abs(frac - 0.75) < 0.06) {
      // 4th sixteenth: proportional
      return beatStart + ea * 0.08;
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

  if (duration === 'e') {
    if (isOffbeatEighth(beatStart)) {
      return 1.0 - amount * 0.20;
    }
    // On-beat eighth
    const frac = beatStart - Math.floor(beatStart);
    if (Math.abs(frac) < 0.08 || Math.abs(frac - 1.0) < 0.08) {
      return 1.0 + amount * 0.15;
    }
  }

  if (duration === 's') {
    if (isOffbeatSixteenth(beatStart) || isOffbeatEighth(beatStart)) {
      return 1.0 - amount * 0.15;
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

  if (duration === 'e') {
    if (isOffbeatEighth(beatStart)) {
      return 1.0 - amount * 0.30;
    }
    const frac = beatStart - Math.floor(beatStart);
    if (Math.abs(frac) < 0.08 || Math.abs(frac - 1.0) < 0.08) {
      return 1.0 + amount * 0.25;
    }
  }

  if (duration === 's') {
    if (isOffbeatSixteenth(beatStart) || isOffbeatEighth(beatStart)) {
      return 1.0 - amount * 0.20;
    }
  }

  return 1.0;
}
