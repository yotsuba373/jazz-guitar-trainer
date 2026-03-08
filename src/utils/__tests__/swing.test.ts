import { describe, it, expect } from 'vitest';
import { swingBeatStart, swingVolumeMult, swingDurMult } from '../swing';

describe('swingBeatStart', () => {
  it('leaves on-beat eighth unchanged', () => {
    expect(swingBeatStart(0, 'e', 0.6, 120)).toBe(0);
    expect(swingBeatStart(1, 'e', 1.0, 120)).toBe(1);
    expect(swingBeatStart(2, 'e', 0.8, 120)).toBe(2);
  });

  it('shifts offbeat eighth later', () => {
    const result = swingBeatStart(0.5, 'e', 0.6, 120);
    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeLessThan(0.7);
  });

  it('shifts more with higher amount', () => {
    const low = swingBeatStart(0.5, 'e', 0.3, 120);
    const high = swingBeatStart(0.5, 'e', 1.0, 120);
    expect(high).toBeGreaterThan(low);
  });

  it('max shift reaches triplet feel', () => {
    const result = swingBeatStart(0.5, 'e', 1.0, 120);
    // 0.5 + 0.17 = 0.67 ≈ 2/3 (triplet)
    expect(result).toBeCloseTo(0.67, 2);
  });

  it('does not affect quarter notes', () => {
    expect(swingBeatStart(0.5, 'q', 1.0, 120)).toBe(0.5);
    expect(swingBeatStart(1.0, 'q', 1.0, 120)).toBe(1.0);
  });

  it('does not affect triplets', () => {
    expect(swingBeatStart(0.333, 't', 1.0, 120)).toBe(0.333);
    expect(swingBeatStart(0.667, 't', 1.0, 120)).toBe(0.667);
  });

  it('returns unchanged when amount=0', () => {
    expect(swingBeatStart(0.5, 'e', 0, 120)).toBe(0.5);
    expect(swingBeatStart(1.5, 'e', 0, 120)).toBe(1.5);
  });

  it('tempo compensation: BPM=240 reduces shift', () => {
    const normal = swingBeatStart(0.5, 'e', 1.0, 120);
    const fast = swingBeatStart(0.5, 'e', 1.0, 240);
    expect(fast - 0.5).toBeLessThan(normal - 0.5);
  });

  it('tempo compensation: BPM=280 → nearly zero shift', () => {
    const result = swingBeatStart(0.5, 'e', 1.0, 280);
    expect(result).toBeCloseTo(0.5, 2);
  });

  it('shifts 16th notes proportionally', () => {
    // 2nd sixteenth (frac ≈ 0.25)
    const s2 = swingBeatStart(0.25, 's', 1.0, 120);
    expect(s2).toBeGreaterThan(0.25);

    // 3rd sixteenth (frac ≈ 0.5, offbeat)
    const s3 = swingBeatStart(0.5, 's', 1.0, 120);
    expect(s3).toBeGreaterThan(0.5);

    // 4th sixteenth (frac ≈ 0.75)
    const s4 = swingBeatStart(0.75, 's', 1.0, 120);
    expect(s4).toBeGreaterThan(0.75);
  });
});

describe('swingVolumeMult', () => {
  it('boosts on-beat eighth volume', () => {
    expect(swingVolumeMult(0, 'e', 0.6)).toBeGreaterThan(1.0);
    expect(swingVolumeMult(1, 'e', 0.6)).toBeGreaterThan(1.0);
  });

  it('reduces offbeat eighth volume', () => {
    expect(swingVolumeMult(0.5, 'e', 0.6)).toBeLessThan(1.0);
    expect(swingVolumeMult(1.5, 'e', 0.6)).toBeLessThan(1.0);
  });

  it('does not affect quarter notes', () => {
    expect(swingVolumeMult(0, 'q', 1.0)).toBe(1.0);
    expect(swingVolumeMult(0.5, 'q', 1.0)).toBe(1.0);
  });

  it('does not affect triplets', () => {
    expect(swingVolumeMult(0.333, 't', 1.0)).toBe(1.0);
  });

  it('returns 1.0 when amount=0', () => {
    expect(swingVolumeMult(0, 'e', 0)).toBe(1.0);
    expect(swingVolumeMult(0.5, 'e', 0)).toBe(1.0);
  });

  it('max boost is +15%', () => {
    expect(swingVolumeMult(0, 'e', 1.0)).toBeCloseTo(1.15, 2);
  });

  it('max reduction is -20%', () => {
    expect(swingVolumeMult(0.5, 'e', 1.0)).toBeCloseTo(0.80, 2);
  });
});

describe('swingDurMult', () => {
  it('extends on-beat eighth duration', () => {
    expect(swingDurMult(0, 'e', 0.6)).toBeGreaterThan(1.0);
    expect(swingDurMult(1, 'e', 0.6)).toBeGreaterThan(1.0);
  });

  it('shortens offbeat eighth duration', () => {
    expect(swingDurMult(0.5, 'e', 0.6)).toBeLessThan(1.0);
    expect(swingDurMult(1.5, 'e', 0.6)).toBeLessThan(1.0);
  });

  it('does not affect quarter notes', () => {
    expect(swingDurMult(0, 'q', 1.0)).toBe(1.0);
  });

  it('does not affect triplets', () => {
    expect(swingDurMult(0.333, 't', 1.0)).toBe(1.0);
  });

  it('returns 1.0 when amount=0', () => {
    expect(swingDurMult(0, 'e', 0)).toBe(1.0);
    expect(swingDurMult(0.5, 'e', 0)).toBe(1.0);
  });

  it('max extension is +25%', () => {
    expect(swingDurMult(0, 'e', 1.0)).toBeCloseTo(1.25, 2);
  });

  it('max shortening is -30%', () => {
    expect(swingDurMult(0.5, 'e', 1.0)).toBeCloseTo(0.70, 2);
  });

  it('sixteenth offbeats are shortened', () => {
    expect(swingDurMult(0.25, 's', 1.0)).toBeLessThan(1.0);
    expect(swingDurMult(0.75, 's', 1.0)).toBeLessThan(1.0);
  });
});
