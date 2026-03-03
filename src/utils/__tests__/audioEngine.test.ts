import { describe, it, expect } from 'vitest';
import { fretToFrequency, OPEN_STRING_MIDI } from '../audioEngine';

describe('OPEN_STRING_MIDI', () => {
  it('has 6 entries matching standard guitar tuning (1E B G D A 6E)', () => {
    expect(OPEN_STRING_MIDI).toEqual([64, 59, 55, 50, 45, 40]);
  });
});

describe('fretToFrequency', () => {
  it('1E open (MIDI 64 = E4) ≈ 329.63 Hz', () => {
    expect(fretToFrequency(0, 0)).toBeCloseTo(329.63, 0);
  });

  it('1E fret 5 (MIDI 69 = A4) = 440 Hz', () => {
    expect(fretToFrequency(0, 5)).toBeCloseTo(440, 1);
  });

  it('B string open (MIDI 59 = B3) ≈ 246.94 Hz', () => {
    expect(fretToFrequency(1, 0)).toBeCloseTo(246.94, 0);
  });

  it('G string open (MIDI 55 = G3) ≈ 196.00 Hz', () => {
    expect(fretToFrequency(2, 0)).toBeCloseTo(196.0, 0);
  });

  it('D string open (MIDI 50 = D3) ≈ 146.83 Hz', () => {
    expect(fretToFrequency(3, 0)).toBeCloseTo(146.83, 0);
  });

  it('A string open (MIDI 45 = A2) = 110 Hz', () => {
    expect(fretToFrequency(4, 0)).toBeCloseTo(110, 1);
  });

  it('6E open (MIDI 40 = E2) ≈ 82.41 Hz', () => {
    expect(fretToFrequency(5, 0)).toBeCloseTo(82.41, 0);
  });

  it('fret 12 = one octave up (double frequency)', () => {
    const open = fretToFrequency(5, 0);
    const oct = fretToFrequency(5, 12);
    expect(oct).toBeCloseTo(open * 2, 1);
  });

  it('6E fret 5 (MIDI 45 = A2) = 110 Hz', () => {
    expect(fretToFrequency(5, 5)).toBeCloseTo(110, 1);
  });
});
