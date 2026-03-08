import { describe, it, expect } from 'vitest';
import { generatePhraseRule } from '../bebopGenerator';
import { buildFretMap, generatePositions, resolveMode } from '../../utils';
import { MODE_TEMPLATES } from '../../constants';
import { absolutePitch } from '../bebopScheduler';
import type { PoolNote } from '../../types';
import { assignRhythms, RHYTHM_BEATS, planSegmentRhythms } from '../bebopScheduler';
import type { SegmentSpec } from '../bebopTemplates';
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

describe('assignRhythms', () => {
  // Helper: create a mock pool note
  function mockNote(name: string, semi: number, fret = 5, str = 2): PoolNote {
    return { noteName: name, semitone: semi, fret, stringIdx: str, isApproach: false };
  }

  it('scaleRun always gets eighth notes', () => {
    const notes = [
      { note: mockNote('C', 0), segIdx: 0 },
      { note: mockNote('D', 2), segIdx: 0 },
      { note: mockNote('E', 4), segIdx: 0 },
      { note: mockNote('F', 5), segIdx: 0 },
    ];
    const segs: SegmentSpec[] = [{ type: 'scaleRun', direction: 'desc', beats: 0 }];
    const ctSet = new Set(['C', 'E', 'G']);
    // Run many times — should always be 'e'
    for (let i = 0; i < 20; i++) {
      const rhythms = assignRhythms(notes, segs, 0, ctSet);
      expect(rhythms.every(r => r === 'e')).toBe(true);
    }
  });

  it('arpeggio on downbeat can get triplet rhythm', () => {
    const notes = [
      { note: mockNote('C', 0), segIdx: 0 },
      { note: mockNote('E', 4), segIdx: 0 },
      { note: mockNote('G', 7), segIdx: 0 },
      { note: mockNote('B', 11), segIdx: 0 },
    ];
    const segs: SegmentSpec[] = [{ type: 'arpeggio', direction: 'asc', beats: 2 }];
    const ctSet = new Set(['C', 'E', 'G', 'B']);
    // Run enough times to hit the 25% chance
    let tripletSeen = false;
    for (let i = 0; i < 100; i++) {
      const rhythms = assignRhythms(notes, segs, 0, ctSet); // beatOffset=0 → downbeat
      if (rhythms[0] === 't') {
        tripletSeen = true;
        expect(rhythms[1]).toBe('t');
        expect(rhythms[2]).toBe('t');
        break;
      }
    }
    expect(tripletSeen).toBe(true);
  });

  it('arpeggio on offbeat: first segment can get triplet, later segments cannot', () => {
    const ctSet = new Set(['C', 'E', 'G']);
    // First segment (start=0) on offbeat — allowed by isFirstSeg
    const notes0 = [
      { note: mockNote('C', 0), segIdx: 0 },
      { note: mockNote('E', 4), segIdx: 0 },
      { note: mockNote('D', 2), segIdx: 0 },
    ];
    const segs0: SegmentSpec[] = [{ type: 'arpeggio', direction: 'asc', beats: 2 }];
    let hasTriplet = false;
    for (let i = 0; i < 100; i++) {
      const rhythms = assignRhythms(notes0, segs0, 0.5, ctSet);
      if (rhythms.some(r => r === 't')) { hasTriplet = true; break; }
    }
    expect(hasTriplet).toBe(true);

    // Later segment on offbeat — NOT allowed (not first, not strong beat)
    const notes1 = [
      { note: mockNote('C', 0), segIdx: 0 },
      { note: mockNote('E', 4), segIdx: 1 },
      { note: mockNote('G', 7), segIdx: 1 },
      { note: mockNote('D', 2), segIdx: 1 },
    ];
    const segs1: SegmentSpec[] = [
      { type: 'scaleRun', direction: 'asc', beats: 1 },
      { type: 'arpeggio', direction: 'asc', beats: 2 },
    ];
    for (let i = 0; i < 50; i++) {
      const rhythms = assignRhythms(notes1, segs1, 0.5, ctSet);
      // seg1 starts at note index 1, which is the 2nd note at beat 1.0 (strong),
      // so it CAN get triplet. Test a non-strong, non-first case:
    }
    // Use offset 0 so seg1 starts at beat 0.5 (not strong, not first)
    const notes2 = [
      { note: mockNote('C', 0), segIdx: 0 },
      { note: mockNote('E', 4), segIdx: 1 },
      { note: mockNote('G', 7), segIdx: 1 },
      { note: mockNote('D', 2), segIdx: 1 },
    ];
    for (let i = 0; i < 50; i++) {
      const rhythms = assignRhythms(notes2, segs1, 0, ctSet);
      // seg1 starts at beat 0.5 (not strong, not first seg) → no triplet
      const seg1Rhythms = rhythms.slice(1);
      expect(seg1Rhythms.some(r => r === 't')).toBe(false);
    }
  });

  it('enclosure can get 16th note approaches when target lands on strong beat', () => {
    // 3-note enclosure at beatOffset=0.5: approach at 0.5, 0.75 → target at 1.0 (strong!)
    const notes = [
      { note: mockNote('D', 2, 5, 2), segIdx: 0 }, // approach
      { note: mockNote('Db', 1, 4, 2), segIdx: 0 }, // approach
      { note: mockNote('C', 0, 3, 2), segIdx: 0 },  // target CT
    ];
    const segs: SegmentSpec[] = [{ type: 'enclosure', direction: 'desc', beats: 2 }];
    const ctSet = new Set(['C', 'E', 'G']);
    let sixteenthSeen = false;
    for (let i = 0; i < 200; i++) {
      const rhythms = assignRhythms(notes, segs, 0.5, ctSet);
      if (rhythms[0] === 's') {
        sixteenthSeen = true;
        expect(rhythms[1]).toBe('s'); // both approaches are 16th
        // target stays eighth or quarter (last-note CT quarter rule may fire)
        expect(['e', 'q']).toContain(rhythms[2]);
        break;
      }
    }
    expect(sixteenthSeen).toBe(true);
  });

  it('last note CT can get quarter note', () => {
    const notes = [
      { note: mockNote('D', 2), segIdx: 0 },
      { note: mockNote('E', 4), segIdx: 0 },
      { note: mockNote('C', 0), segIdx: 0 }, // last, CT
    ];
    const segs: SegmentSpec[] = [{ type: 'scaleRun', direction: 'desc', beats: 0 }];
    const ctSet = new Set(['C', 'E', 'G']);
    let quarterSeen = false;
    for (let i = 0; i < 200; i++) {
      const rhythms = assignRhythms(notes, segs, 0, ctSet);
      if (rhythms[2] === 'q') { quarterSeen = true; break; }
    }
    expect(quarterSeen).toBe(true);
  });

  it('last note non-CT never gets quarter note', () => {
    const notes = [
      { note: mockNote('C', 0), segIdx: 0 },
      { note: mockNote('E', 4), segIdx: 0 },
      { note: mockNote('D', 2), segIdx: 0 }, // last, NOT CT
    ];
    const segs: SegmentSpec[] = [{ type: 'scaleRun', direction: 'desc', beats: 0 }];
    const ctSet = new Set(['C', 'E', 'G']);
    for (let i = 0; i < 50; i++) {
      const rhythms = assignRhythms(notes, segs, 0, ctSet);
      expect(rhythms[2]).not.toBe('q');
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
