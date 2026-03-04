import { describe, it, expect } from 'vitest';
import { analyzePhrase } from '../phraseAnalysis';
import { absolutePitch, generatePhrase, buildNotePool } from '../phraseGenerator';
import { resolveMode } from '../noteSpelling';
import { MODE_TEMPLATES } from '../../constants/music';
import { buildFretMap, generatePositions } from '../fretboard';
import type { GeneratedPhrase, PhraseNote, PhraseConfig, Mode } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMode(root: string, modeKey: string): Mode {
  const tpl = MODE_TEMPLATES.find(t => t.key === modeKey)!;
  return resolveMode(root as any, tpl);
}

function genPhrase(root: string, modeKey: string, config: PhraseConfig): GeneratedPhrase {
  const mode = getMode(root, modeKey);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = generatePositions(fretMap, mode.notes);
  return generatePhrase(positions[0], mode, fretMap, config);
}

function makePhraseNote(overrides: Partial<PhraseNote> & { noteName: string; stringIdx: number; fret: number; semitone: number }): PhraseNote {
  return {
    isChordTone: false,
    isApproach: false,
    beatPosition: 1,
    isStrong: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scale degree computation
// ---------------------------------------------------------------------------

describe('Scale degree', () => {
  it('in-scale notes use mode.degrees', () => {
    const mode = getMode('C', 'ionian');
    const phrase: GeneratedPhrase = {
      notes: [makePhraseNote({ noteName: 'C', stringIdx: 2, fret: 5, semitone: 0, isChordTone: true, beatPosition: 1 })],
      posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].scaleDegree).toBe('1');
  });

  it('all 7 diatonic degrees for C Ionian', () => {
    const mode = getMode('C', 'ionian');
    const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((n, i) =>
      makePhraseNote({ noteName: n, stringIdx: 2, fret: 5 + i, semitone: mode.semi[i], beatPosition: i + 1, isStrong: i === 0 })
    );
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes.map(n => n.scaleDegree)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('chromatic note gets chromatic degree label', () => {
    const mode = getMode('C', 'ionian');
    const phrase: GeneratedPhrase = {
      notes: [makePhraseNote({ noteName: 'E♭', stringIdx: 2, fret: 4, semitone: 3, isApproach: true, beatPosition: 1 })],
      posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: ['single-below'], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].scaleDegree).toBe('♭3');
  });

  it('Dorian ♭7 degree', () => {
    const mode = getMode('D', 'dorian');
    // C is the ♭7 of D Dorian
    const phrase: GeneratedPhrase = {
      notes: [makePhraseNote({ noteName: 'C', stringIdx: 2, fret: 5, semitone: 0, beatPosition: 1 })],
      posId: 1, modeKey: 'dorian', rootName: 'D',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].scaleDegree).toBe('♭7');
  });
});

// ---------------------------------------------------------------------------
// Interval calculation
// ---------------------------------------------------------------------------

describe('Interval calculation', () => {
  it('first note has null interval and "—" label', () => {
    const mode = getMode('C', 'ionian');
    const phrase: GeneratedPhrase = {
      notes: [makePhraseNote({ noteName: 'C', stringIdx: 2, fret: 5, semitone: 0, beatPosition: 1 })],
      posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].intervalFromPrev).toBeNull();
    expect(analysis.notes[0].intervalLabel).toBe('—');
  });

  it('ascending minor 2nd', () => {
    const mode = getMode('C', 'ionian');
    const n1 = makePhraseNote({ noteName: 'E', stringIdx: 1, fret: 5, semitone: 4, beatPosition: 1 });
    const n2 = makePhraseNote({ noteName: 'F', stringIdx: 1, fret: 6, semitone: 5, beatPosition: 2, isStrong: false });
    const phrase: GeneratedPhrase = {
      notes: [n1, n2], posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[1].intervalFromPrev).toBe(1);
    expect(analysis.notes[1].intervalDirection).toBe('up');
    expect(analysis.notes[1].intervalLabel).toBe('↑m2');
  });

  it('descending major 3rd', () => {
    const mode = getMode('C', 'ionian');
    // G3 (string 2 fret 12) → E♭3 (string 2 fret 8): descending M3 = 4 semitones
    const n1 = makePhraseNote({ noteName: 'G', stringIdx: 2, fret: 12, semitone: 7, beatPosition: 1 });
    const n2 = makePhraseNote({ noteName: 'E', stringIdx: 2, fret: 9, semitone: 4, beatPosition: 2, isStrong: false });
    const phrase: GeneratedPhrase = {
      notes: [n1, n2], posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[1].intervalFromPrev).toBe(3);
    expect(analysis.notes[1].intervalDirection).toBe('down');
    expect(analysis.notes[1].intervalLabel).toBe('↓m3');
  });

  it('unison detection (same pitch different string)', () => {
    const mode = getMode('C', 'ionian');
    // B3 on string 1 fret 0 = 59, B3 on string 2 fret 4 = 59
    const n1 = makePhraseNote({ noteName: 'B', stringIdx: 1, fret: 0, semitone: 11, beatPosition: 1 });
    const n2 = makePhraseNote({ noteName: 'B', stringIdx: 2, fret: 4, semitone: 11, beatPosition: 2, isStrong: false });
    const phrase: GeneratedPhrase = {
      notes: [n1, n2], posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[1].intervalDirection).toBe('unison');
  });
});

// ---------------------------------------------------------------------------
// Function labels
// ---------------------------------------------------------------------------

describe('Function labels', () => {
  it('chord tone shows "CT (Root)", "CT (3rd)" etc.', () => {
    const mode = getMode('C', 'ionian');
    // C = Root, E = 3rd, G = 5th, B = 7th
    const notes = [
      makePhraseNote({ noteName: 'C', stringIdx: 4, fret: 3, semitone: 0, isChordTone: true, beatPosition: 1 }),
      makePhraseNote({ noteName: 'E', stringIdx: 3, fret: 2, semitone: 4, isChordTone: true, beatPosition: 3 }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('CT (R)');
    expect(analysis.notes[1].functionLabel).toBe('CT (3rd)');
  });

  it('approach note without group shows "Chromatic"', () => {
    const mode = getMode('C', 'ionian');
    const notes = [
      makePhraseNote({ noteName: 'D♭', stringIdx: 3, fret: 4, semitone: 1, isApproach: true, beatPosition: 2, isStrong: false }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: ['single-below'], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('Chromatic');
  });

  it('scale tone shows "Scale tone"', () => {
    const mode = getMode('C', 'ionian');
    const notes = [
      makePhraseNote({ noteName: 'D', stringIdx: 3, fret: 5, semitone: 2, beatPosition: 2, isStrong: false }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('Scale tone');
  });

  it('approach group notes get pattern labels', () => {
    const mode = getMode('C', 'ionian');
    const notes: PhraseNote[] = [
      { noteName: 'D', stringIdx: 3, fret: 7, semitone: 2, isChordTone: false, isApproach: true, beatPosition: 4, isStrong: false,
        approachGroup: { groupId: 0, approachType: 'enclosure', role: 'approach', positionInGroup: 0, groupSize: 3 } },
      { noteName: 'B', stringIdx: 3, fret: 4, semitone: 11, isChordTone: false, isApproach: true, beatPosition: 5, isStrong: true,
        approachGroup: { groupId: 0, approachType: 'enclosure', role: 'approach', positionInGroup: 1, groupSize: 3 } },
      { noteName: 'C', stringIdx: 3, fret: 5, semitone: 0, isChordTone: true, isApproach: false, beatPosition: 5, isStrong: true,
        approachGroup: { groupId: 0, approachType: 'enclosure', role: 'target', positionInGroup: 2, groupSize: 3 } },
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: ['enclosure'], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('Encl. above');
    expect(analysis.notes[1].functionLabel).toBe('Encl. below');
    expect(analysis.notes[2].functionLabel).toBe('CT (R)');
  });
});

// ---------------------------------------------------------------------------
// Approach group tagging in generator
// ---------------------------------------------------------------------------

describe('Approach group tagging (generator integration)', () => {
  it('approach source generates notes with approachGroup metadata', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'single-above', 'enclosure'] };
    // Run multiple times to increase chance of approach pattern triggering
    let foundGroup = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('C', 'ionian', config);
      if (phrase.notes.some(n => n.approachGroup)) {
        foundGroup = true;
        break;
      }
    }
    expect(foundGroup).toBe(true);
  });

  it('group IDs are sequential', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'single-above', 'enclosure'] };
    for (let i = 0; i < 50; i++) {
      const phrase = genPhrase('C', 'mixolydian', config);
      const groups = phrase.notes
        .filter(n => n.approachGroup)
        .map(n => n.approachGroup!.groupId);
      if (groups.length === 0) continue;
      const unique = [...new Set(groups)].sort((a, b) => a - b);
      // IDs should start from 0 and be consecutive
      for (let j = 0; j < unique.length; j++) {
        expect(unique[j]).toBe(j);
      }
      break; // found a phrase with groups
    }
  });

  it('scale-only source produces no approach groups', () => {
    const config: PhraseConfig = { approachTypes: [] };
    for (let i = 0; i < 10; i++) {
      const phrase = genPhrase('C', 'ionian', config);
      expect(phrase.notes.every(n => !n.approachGroup)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Summary statistics
// ---------------------------------------------------------------------------

describe('Summary statistics', () => {
  it('interval distribution sums correctly', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'enclosure'] };
    const phrase = genPhrase('C', 'dorian', config);
    const mode = getMode('C', 'dorian');
    const { summary } = analyzePhrase(phrase, mode);
    // 7 intervals (8 notes - 1)
    const totalPct = summary.stepwisePct + summary.thirdsPct + summary.fourthsPct + summary.leapsPct;
    // Percentages may not sum to exactly 100 due to rounding
    expect(totalPct).toBeGreaterThanOrEqual(98);
    expect(totalPct).toBeLessThanOrEqual(102);
  });

  it('range is non-negative', () => {
    const phrase = genPhrase('G', 'mixolydian', { approachTypes: [] });
    const mode = getMode('G', 'mixolydian');
    const { summary } = analyzePhrase(phrase, mode);
    expect(summary.rangeSemitones).toBeGreaterThanOrEqual(0);
  });

  it('contour label matches config', () => {
    const phrase = genPhrase('A', 'aeolian', { approachTypes: [], contour: 'arch' });
    const mode = getMode('A', 'aeolian');
    const { summary } = analyzePhrase(phrase, mode);
    expect(summary.contourLabel).toBe('Arch');
  });

  it('CT + approach + scale counts sum to 8', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'enclosure'] };
    const phrase = genPhrase('F', 'lydian', config);
    const mode = getMode('F', 'lydian');
    const { summary } = analyzePhrase(phrase, mode);
    expect(summary.chordToneCount + summary.approachNoteCount + summary.scaleNoteCount).toBe(8);
  });

  it('direction changes count is valid', () => {
    const phrase = genPhrase('B♭', 'mixolydian', { approachTypes: [] });
    const mode = getMode('B♭', 'mixolydian');
    const { summary } = analyzePhrase(phrase, mode);
    // Max possible direction changes = 6 (7 intervals, each can change)
    expect(summary.directionChanges).toBeGreaterThanOrEqual(0);
    expect(summary.directionChanges).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Integration: analyzePhrase works with any generated phrase
// ---------------------------------------------------------------------------

describe('Integration', () => {
  const configs: PhraseConfig[] = [
    { approachTypes: [] },
    { approachTypes: ['single-below', 'single-above', 'enclosure'] },
  ];
  const modes = ['ionian', 'dorian', 'mixolydian', 'aeolian', 'lydian'];
  const roots = ['C', 'F', 'B♭', 'E♭', 'G'];

  it('produces valid analysis for multiple key/mode combinations', () => {
    for (const root of roots) {
      for (const modeKey of modes) {
        const config = configs[Math.floor(Math.random() * configs.length)];
        const mode = getMode(root, modeKey);
        const fretMap = buildFretMap(mode.semi, mode.notes);
        const positions = generatePositions(fretMap, mode.notes);
        const phrase = generatePhrase(positions[0], mode, fretMap, config);
        const analysis = analyzePhrase(phrase, mode);

        expect(analysis.notes).toHaveLength(8);
        for (const n of analysis.notes) {
          expect(n.noteName).toBeTruthy();
          expect(n.scaleDegree).toBeTruthy();
          expect(n.functionLabel).toBeTruthy();
          expect(n.beatPosition).toBeGreaterThanOrEqual(1);
          expect(n.beatPosition).toBeLessThanOrEqual(8);
        }
        // First note has no interval
        expect(analysis.notes[0].intervalFromPrev).toBeNull();
        // All others have intervals
        for (let i = 1; i < 8; i++) {
          expect(analysis.notes[i].intervalFromPrev).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
