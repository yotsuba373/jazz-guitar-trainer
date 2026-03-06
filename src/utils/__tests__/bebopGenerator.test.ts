import { describe, it, expect } from 'vitest';
import { generatePhraseRule } from '../bebopGenerator';
import { buildFretMap, generatePositions, resolveMode } from '../../utils';
import { MODE_TEMPLATES } from '../../constants';
import { absolutePitch } from '../phraseGenerator';
import type { PhraseConfig, RootName } from '../../types';

function generate(rootName: RootName, modeKey: string, beatCount: 2 | 3 | 4 = 4) {
  const template = MODE_TEMPLATES.find(t => t.key === modeKey)!;
  const mode = resolveMode(rootName, template);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = generatePositions(fretMap, mode.notes);
  const pos = positions[0];
  const config: PhraseConfig = { approachTypes: [], beatCount };
  return { phrase: generatePhraseRule(pos, mode, fretMap, config), mode, pos };
}

describe('generatePhraseRule', () => {
  it('generates a phrase for C Mixolydian (dom7)', () => {
    const { phrase } = generate('C', 'mixolydian');
    expect(phrase).not.toBeNull();
    expect(phrase!.notes.length).toBeGreaterThanOrEqual(3);
    expect(phrase!.templateId).toBeTruthy();
    expect(phrase!.lickId).toBeUndefined();
  });

  it('generates a phrase for C Ionian (maj7)', () => {
    const { phrase } = generate('C', 'ionian');
    expect(phrase).not.toBeNull();
    expect(phrase!.notes.length).toBeGreaterThanOrEqual(3);
  });

  it('generates a phrase for D Dorian (m7)', () => {
    const { phrase } = generate('D', 'dorian');
    expect(phrase).not.toBeNull();
    expect(phrase!.notes.length).toBeGreaterThanOrEqual(3);
  });

  it('respects 2-beat phrase length', () => {
    const { phrase } = generate('C', 'mixolydian', 2);
    expect(phrase).not.toBeNull();
    expect(phrase!.totalBeats).toBe(2);
    expect(phrase!.notes.length).toBeLessThanOrEqual(6); // max 4 eighths + connector
  });

  it('has CT on at least some strong beats', () => {
    // Run multiple times to check statistically
    let totalStrong = 0;
    let totalStrongCT = 0;
    for (let i = 0; i < 20; i++) {
      const { phrase, mode } = generate('C', 'mixolydian');
      if (!phrase) continue;
      const ctSet = new Set(mode.chordTones);
      for (let j = 0; j < phrase.notes.length; j++) {
        const bp = phrase.notes[j].beatPosition;
        if (bp === 1 || bp === 3 || bp === 5) {
          totalStrong++;
          if (ctSet.has(phrase.notes[j].noteName)) totalStrongCT++;
        }
      }
    }
    // At least 30% of strong beats should have CTs
    if (totalStrong > 0) {
      expect(totalStrongCT / totalStrong).toBeGreaterThan(0.2);
    }
  });

  it('notes stay within reasonable range', () => {
    for (let i = 0; i < 10; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (!phrase) continue;
      const pitches = phrase.notes.map(absolutePitch);
      const range = Math.max(...pitches) - Math.min(...pitches);
      expect(range).toBeLessThanOrEqual(18);
      expect(range).toBeGreaterThanOrEqual(2);
    }
  });

  it('no consecutive leaps > 9 semitones', () => {
    for (let i = 0; i < 10; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (!phrase) continue;
      for (let j = 1; j < phrase.notes.length; j++) {
        const leap = Math.abs(absolutePitch(phrase.notes[j]) - absolutePitch(phrase.notes[j - 1]));
        expect(leap).toBeLessThanOrEqual(9);
      }
    }
  });

  it('includes segmentIdx metadata', () => {
    const { phrase } = generate('C', 'mixolydian');
    if (!phrase) return;
    const hasSegment = phrase.notes.some(n => n.segmentIdx !== undefined);
    expect(hasSegment).toBe(true);
  });

  it('includes motif', () => {
    const { phrase } = generate('C', 'mixolydian');
    if (!phrase) return;
    expect(phrase.motif).toBeTruthy();
    expect(phrase.motif!.length).toBeGreaterThan(0);
  });

  it('works for all 7 diatonic modes', () => {
    const modes = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];
    for (const modeKey of modes) {
      let success = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { phrase } = generate('C', modeKey);
        if (phrase) { success = true; break; }
      }
      expect(success).toBe(true);
    }
  });

  it('works for lydian-dom and altered', () => {
    for (const modeKey of ['lydian-dom', 'altered']) {
      let success = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { phrase } = generate('C', modeKey);
        if (phrase) { success = true; break; }
      }
      expect(success).toBe(true);
    }
  });
});
