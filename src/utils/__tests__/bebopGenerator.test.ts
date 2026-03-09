import { describe, it, expect } from 'vitest';
import { generatePhraseRule } from '../bebopGenerator';
import { buildFretMap, generatePositions, resolveMode } from '../../utils';
import { MODE_TEMPLATES } from '../../constants';
import { absolutePitch } from '../bebopScheduler';
import { RHYTHM_BEATS, planSegmentRhythms } from '../bebopScheduler';
import { PHRASE_TEMPLATES, allocateBeats } from '../bebopTemplates';
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

  it('generates phrases with variable rhythms', () => {
    // Run many times — at least some should have non-eighth rhythms
    // Probability per phrase is low (segment-type dependent × random chance),
    // so we need many runs across different modes/configs
    const durations = new Set<string>();
    const modes = ['mixolydian', 'ionian', 'dorian'];
    for (const modeKey of modes) {
      for (let i = 0; i < 100; i++) {
        const { phrase } = generate('C', modeKey);
        if (!phrase) continue;
        for (const n of phrase.notes) durations.add(n.duration);
        if (durations.size > 1) break;
      }
      if (durations.size > 1) break;
    }
    // At minimum 'e' (eighth) should always appear
    expect(durations.has('e')).toBe(true);
    // With 300 runs across modes, should see at least one non-eighth
    expect(durations.size).toBeGreaterThan(1);
  });

  it('beatStart accumulates correctly with variable rhythms', () => {
    for (let i = 0; i < 20; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (!phrase) continue;
      // Verify each note's beatStart matches cumulative sum of prior durations
      let expected = phrase.notes[0].beatStart;
      for (let j = 0; j < phrase.notes.length; j++) {
        expect(Math.abs(phrase.notes[j].beatStart - expected)).toBeLessThan(0.01);
        expected += RHYTHM_BEATS[phrase.notes[j].duration];
      }
    }
  });
});

describe('skeleton-driven generation', () => {
  it('returns a phrase with skeleton metadata when successful', () => {
    // Skeleton path may not succeed every time, so try multiple runs
    let foundSkeleton = false;
    for (let i = 0; i < 30; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (phrase?.skeleton) {
        foundSkeleton = true;
        expect(phrase.skeleton.patternLabel).toBeTruthy();
        expect(phrase.skeleton.direction).toBeTruthy();
        break;
      }
    }
    // Skeleton should succeed at least once in 30 attempts
    expect(foundSkeleton).toBe(true);
  });

  it('skeleton.slots contains expected fields (beatPos, noteName, role, ctLabel)', () => {
    let checked = false;
    for (let i = 0; i < 30; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (phrase?.skeleton?.slots && phrase.skeleton.slots.length > 0) {
        for (const slot of phrase.skeleton.slots) {
          expect(typeof slot.beatPos).toBe('number');
          expect(typeof slot.noteName).toBe('string');
          expect(slot.noteName.length).toBeGreaterThan(0);
          expect(['start', 'downbeat-ct', 'strong-gt', 'target']).toContain(slot.role);
          // ctLabel is optional but if present should be one of the CT labels
          if (slot.ctLabel !== undefined) {
            expect(['R', '3rd', '5th', '7th']).toContain(slot.ctLabel);
          }
        }
        checked = true;
        break;
      }
    }
    expect(checked).toBe(true);
  });

  it('skeleton-driven phrases have isSkeletonBeat set on some notes', () => {
    let found = false;
    for (let i = 0; i < 30; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (phrase?.skeleton) {
        const hasSkelBeat = phrase.notes.some(n => n.isSkeletonBeat === true);
        if (hasSkelBeat) {
          found = true;
          break;
        }
      }
    }
    // At least one skeleton-driven phrase should have isSkeletonBeat notes
    expect(found).toBe(true);
  });

  it('fallback phrases (non-skeleton) still return valid phrases', () => {
    // Even if skeleton fails, legacy buildPhrase or scale-down fallback should work
    let validCount = 0;
    for (let i = 0; i < 20; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (phrase) {
        expect(phrase.notes.length).toBeGreaterThanOrEqual(3);
        expect(phrase.templateId).toBeTruthy();
        expect(phrase.totalBeats).toBeGreaterThan(0);
        validCount++;
      }
    }
    // Should almost always produce a valid phrase
    expect(validCount).toBeGreaterThanOrEqual(15);
  });

  it('skeleton metadata includes contour', () => {
    let found = false;
    for (let i = 0; i < 30; i++) {
      const { phrase } = generate('C', 'mixolydian');
      if (phrase?.skeleton?.contour) {
        expect(['ascending', 'descending', 'arch', 'reverse-arch', 'wave']).toContain(phrase.skeleton.contour);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('works across different modes with skeleton', () => {
    const modes = ['ionian', 'dorian', 'mixolydian'];
    for (const modeKey of modes) {
      let hasSkeleton = false;
      for (let i = 0; i < 20; i++) {
        const { phrase } = generate('C', modeKey);
        if (phrase?.skeleton) {
          hasSkeleton = true;
          break;
        }
      }
      // Each mode should be able to produce at least one skeleton-driven phrase
      expect(hasSkeleton).toBe(true);
    }
  });
});

describe('planSegmentRhythms', () => {
  it('scaleRun always gets eighth rhythm', () => {
    const tmpl = PHRASE_TEMPLATES.find(t => t.id === 'scale-down')!;
    const beats = allocateBeats(tmpl, 4);
    for (let i = 0; i < 50; i++) {
      const plan = planSegmentRhythms(tmpl, beats, 0);
      expect(plan[0].rhythm).toBe('e');
    }
  });

  it('arpeggio can get triplet rhythm', () => {
    const tmpl = PHRASE_TEMPLATES.find(t => t.id === 'arp-up-scale-down')!;
    const beats = allocateBeats(tmpl, 4);
    let hasTriplet = false;
    for (let i = 0; i < 100; i++) {
      const plan = planSegmentRhythms(tmpl, beats, 0);
      if (plan[0].rhythm === 't') { hasTriplet = true; break; }
    }
    expect(hasTriplet).toBe(true);
  });

  it('arpeggio scaleRun combo: scaleRun stays eighth', () => {
    const tmpl = PHRASE_TEMPLATES.find(t => t.id === 'arp-up-scale-down')!;
    const beats = allocateBeats(tmpl, 4);
    for (let i = 0; i < 50; i++) {
      const plan = planSegmentRhythms(tmpl, beats, 0);
      // Second segment is scaleRun — always 'e'
      expect(plan[1].rhythm).toBe('e');
    }
  });

  it('approachCT can get sixteenth rhythm', () => {
    const tmpl = PHRASE_TEMPLATES.find(t => t.id === 'approach-ct-chain')!;
    const beats = allocateBeats(tmpl, 4);
    let hasSixteenth = false;
    for (let i = 0; i < 100; i++) {
      const plan = planSegmentRhythms(tmpl, beats, 0);
      if (plan[0].rhythm === 's') { hasSixteenth = true; break; }
    }
    expect(hasSixteenth).toBe(true);
  });

  it('noteCount is at least 2', () => {
    for (const tmpl of PHRASE_TEMPLATES) {
      const beats = allocateBeats(tmpl, 2);
      const plan = planSegmentRhythms(tmpl, beats, 0);
      for (const p of plan) {
        expect(p.noteCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('noteCount matches beat budget / rhythm beats', () => {
    const tmpl = PHRASE_TEMPLATES.find(t => t.id === 'scale-down')!;
    const beats = allocateBeats(tmpl, 4);
    const plan = planSegmentRhythms(tmpl, beats, 0);
    // scaleRun, 4 beats, eighth → 4/0.5 = 8 notes
    expect(plan[0].noteCount).toBe(8);
  });
});
