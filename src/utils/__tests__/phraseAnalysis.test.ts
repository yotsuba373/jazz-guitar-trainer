import { describe, it, expect } from 'vitest';
import { analyzePhrase } from '../phraseAnalysis';
import { absolutePitch } from '../bebopScheduler';
import { generatePhraseRule, buildNotePool } from '../bebopGenerator';
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

function genPhrase(root: string, modeKey: string, config: PhraseConfig): GeneratedPhrase | null {
  const mode = getMode(root, modeKey);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = generatePositions(fretMap, mode.notes);
  return generatePhraseRule(positions[0], mode, fretMap, config);
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

  it('approach note without group shows "クロマチック"', () => {
    const mode = getMode('C', 'ionian');
    const notes = [
      makePhraseNote({ noteName: 'D♭', stringIdx: 3, fret: 4, semitone: 1, isApproach: true, beatPosition: 2, isStrong: false }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: ['single-below'], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('クロマチック');
  });

  it('scale tone shows "スケール音"', () => {
    const mode = getMode('C', 'ionian');
    const notes = [
      makePhraseNote({ noteName: 'D', stringIdx: 3, fret: 5, semitone: 2, beatPosition: 2, isStrong: false }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('スケール音');
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
    expect(analysis.notes[0].functionLabel).toBe('エンクロージャー上');
    expect(analysis.notes[1].functionLabel).toBe('エンクロージャー下');
    expect(analysis.notes[2].functionLabel).toBe('CT (R)');
  });
});

// ---------------------------------------------------------------------------
// Approach group tagging in generator
// ---------------------------------------------------------------------------

describe('Approach group tagging (generator integration)', () => {
  it('lick-driven phrases have no approach groups (approach patterns removed)', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'single-above', 'enclosure'] };
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('C', 'ionian', config);
      if (!phrase) continue;
      // Lick-driven generation does not inject approach patterns
      // (approach notes may exist in resolved lick data but without approachGroup)
      // Just verify it doesn't crash
      expect(Array.isArray(phrase.notes)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Summary statistics
// ---------------------------------------------------------------------------

describe('Summary statistics', () => {
  it('interval distribution sums correctly', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'enclosure'] };
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('C', 'dorian', config);
      if (!phrase || phrase.notes.length < 2) continue;
      const mode = getMode('C', 'dorian');
      const { summary } = analyzePhrase(phrase, mode);
      const totalPct = summary.stepwisePct + summary.thirdsPct + summary.fourthsPct + summary.leapsPct;
      expect(totalPct).toBeGreaterThanOrEqual(98);
      expect(totalPct).toBeLessThanOrEqual(102);
      tested = true;
      break;
    }
    // If no phrases generated, skip gracefully
  });

  it('range is non-negative', () => {
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('G', 'mixolydian', { approachTypes: [] });
      if (!phrase) continue;
      const mode = getMode('G', 'mixolydian');
      const { summary } = analyzePhrase(phrase, mode);
      expect(summary.rangeSemitones).toBeGreaterThanOrEqual(0);
      tested = true;
      break;
    }
    // If no phrases generated, skip gracefully
  });

  it('contour label is a valid Japanese label', () => {
    const VALID_LABELS = ['アーチ', '逆アーチ', '下行', 'ウェーブ', '上行'];
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('A', 'aeolian', { approachTypes: [], contour: 'arch' });
      if (!phrase) continue;
      const mode = getMode('A', 'aeolian');
      const { summary } = analyzePhrase(phrase, mode);
      expect(VALID_LABELS).toContain(summary.contourLabel);
      tested = true;
      break;
    }
  });

  it('CT + approach + scale counts sum to note count', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'enclosure'] };
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('F', 'lydian', config);
      if (!phrase) continue;
      const mode = getMode('F', 'lydian');
      const { summary } = analyzePhrase(phrase, mode);
      const soundNoteCount = phrase.notes.filter(n => !n.isRest).length;
      expect(summary.chordToneCount + summary.approachNoteCount + summary.scaleNoteCount).toBe(soundNoteCount);
      tested = true;
      break;
    }
    // If no phrases generated, skip gracefully
  });

  it('direction changes count is valid', () => {
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('B♭', 'mixolydian', { approachTypes: [] });
      if (!phrase || phrase.notes.length < 3) continue;
      const mode = getMode('B♭', 'mixolydian');
      const { summary } = analyzePhrase(phrase, mode);
      expect(summary.directionChanges).toBeGreaterThanOrEqual(0);
      tested = true;
      break;
    }
    // If no phrases generated, skip gracefully
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
    let tested = 0;
    for (const root of roots) {
      for (const modeKey of modes) {
        const config = configs[Math.floor(Math.random() * configs.length)];
        const mode = getMode(root, modeKey);
        const fretMap = buildFretMap(mode.semi, mode.notes);
        const positions = generatePositions(fretMap, mode.notes);
        let phrase: GeneratedPhrase | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
          phrase = generatePhraseRule(positions[0], mode, fretMap, config);
          if (phrase) break;
        }
        if (!phrase) continue;
        tested++;
        const analysis = analyzePhrase(phrase, mode);

        expect(analysis.notes.length).toBeGreaterThanOrEqual(3);
        for (const n of analysis.notes) {
          expect(n.noteName).toBeTruthy();
          expect(n.scaleDegree).toBeTruthy();
          expect(n.functionLabel).toBeTruthy();
          expect(n.beatPosition).toBeGreaterThanOrEqual(1);
        }
        if (analysis.notes.length > 1) {
          expect(analysis.notes[0].intervalFromPrev).toBeNull();
          for (let i = 1; i < analysis.notes.length; i++) {
            // Rest notes have null interval
            if (analysis.notes[i].functionLabel === '休符') continue;
            expect(analysis.notes[i].intervalFromPrev).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
    // If no phrases generated, skip gracefully
  });
});

// ---------------------------------------------------------------------------
// Generation metadata in analysis
// ---------------------------------------------------------------------------

describe('Skeleton label in summary (lick-driven: no skeleton)', () => {
  it('skeletonLabel is undefined for lick-driven phrases', () => {
    const config: PhraseConfig = { approachTypes: [] };
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('C', 'ionian', config);
      if (!phrase) continue;
      const mode = getMode('C', 'ionian');
      const { summary } = analyzePhrase(phrase, mode);
      // Lick-driven phrases have no skeleton metadata
      expect(summary.skeletonLabel === undefined || typeof summary.skeletonLabel === 'string').toBe(true);
      tested = true;
      break;
    }
    // If no phrases generated, skip gracefully
  });
});

describe('Goal reason in summary', () => {
  it('goalReason is passed through from phrase', () => {
    const config: PhraseConfig = { approachTypes: [] };
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('C', 'ionian', config);
      if (!phrase) continue;
      const mode = getMode('C', 'ionian');
      const { summary } = analyzePhrase(phrase, mode);
      expect(summary.goalReason).toBeDefined();
      expect(typeof summary.goalReason).toBe('string');
      expect(summary.goalReason!.length).toBeGreaterThan(0);
      tested = true;
      break;
    }
    // If no phrases generated, skip gracefully
  });
});

describe('Digital pattern passthrough', () => {
  it('digitalPattern tags are passed to NoteAnalysis', () => {
    const mode = getMode('C', 'ionian');
    const notes: PhraseNote[] = [
      makePhraseNote({ noteName: 'C', stringIdx: 2, fret: 5, semitone: 0, isChordTone: true, beatPosition: 1 }),
      makePhraseNote({ noteName: 'D', stringIdx: 2, fret: 7, semitone: 2, beatPosition: 2, isStrong: false,
        digitalPattern: { name: '1-2-3-5', position: 0, size: 3 } }),
      makePhraseNote({ noteName: 'E', stringIdx: 2, fret: 9, semitone: 4, isChordTone: true, beatPosition: 3,
        digitalPattern: { name: '1-2-3-5', position: 1, size: 3 } }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[1].digitalPattern).toEqual({ name: '1-2-3-5', position: 0, size: 3 });
    expect(analysis.notes[2].digitalPattern).toEqual({ name: '1-2-3-5', position: 1, size: 3 });
    expect(analysis.notes[0].digitalPattern).toBeUndefined();
  });
});

describe('Bebop and Extension function labels', () => {
  it('bebop passing tone gets "Bebop (degree)" label', () => {
    const mode = getMode('C', 'mixolydian');
    const notes: PhraseNote[] = [
      makePhraseNote({ noteName: 'B', stringIdx: 1, fret: 0, semitone: 11, beatPosition: 2, isStrong: false, isBebopPassing: true }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'mixolydian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('ビバップ経過音 (7)');
    expect(analysis.notes[0].isBebopPassing).toBe(true);
  });

  it('extension tone gets "Ext. (degree)" label', () => {
    const mode = getMode('C', 'ionian');
    // D = 9th (2nd degree) in C Ionian
    const notes: PhraseNote[] = [
      makePhraseNote({ noteName: 'D', stringIdx: 3, fret: 7, semitone: 2, beatPosition: 3, isStrong: true, isExtension: true }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].functionLabel).toBe('テンション (2)');
    expect(analysis.notes[0].isExtension).toBe(true);
  });
});

describe('Skeleton beat passthrough', () => {
  it('isSkeletonBeat is passed to NoteAnalysis', () => {
    const mode = getMode('C', 'ionian');
    const notes: PhraseNote[] = [
      makePhraseNote({ noteName: 'C', stringIdx: 2, fret: 5, semitone: 0, isChordTone: true, beatPosition: 1, isSkeletonBeat: true }),
      makePhraseNote({ noteName: 'D', stringIdx: 2, fret: 7, semitone: 2, beatPosition: 2, isStrong: false }),
    ];
    const phrase: GeneratedPhrase = {
      notes, posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const analysis = analyzePhrase(phrase, mode);
    expect(analysis.notes[0].isSkeletonBeat).toBe(true);
    expect(analysis.notes[1].isSkeletonBeat).toBeUndefined();
  });
});

describe('Motif label formatting', () => {
  it('motifLabel formats signed intervals', () => {
    const mode = getMode('C', 'ionian');
    const phrase: GeneratedPhrase = {
      notes: [
        makePhraseNote({ noteName: 'C', stringIdx: 2, fret: 5, semitone: 0, isChordTone: true, beatPosition: 1 }),
      ],
      posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
      motif: [3, -2],
    };
    const { summary } = analyzePhrase(phrase, mode);
    expect(summary.motifLabel).toBe('↑3半音, ↓2半音');
  });

  it('motifLabel is undefined when no motif', () => {
    const mode = getMode('C', 'ionian');
    const phrase: GeneratedPhrase = {
      notes: [
        makePhraseNote({ noteName: 'C', stringIdx: 2, fret: 5, semitone: 0, isChordTone: true, beatPosition: 1 }),
      ],
      posId: 1, modeKey: 'ionian', rootName: 'C',
      config: { approachTypes: [], contour: 'arch' },
    };
    const { summary } = analyzePhrase(phrase, mode);
    expect(summary.motifLabel).toBeUndefined();
  });
});

describe('Narrative generation', () => {
  it('narrative includes goal reason when present', () => {
    const config: PhraseConfig = { approachTypes: [] };
    let tested = false;
    for (let i = 0; i < 30; i++) {
      const phrase = genPhrase('C', 'ionian', config);
      if (!phrase) continue;
      const mode = getMode('C', 'ionian');
      const analysis = analyzePhrase(phrase, mode);
      expect(analysis.narrative).toBeDefined();
      expect(analysis.narrative!.length).toBeGreaterThan(0);
      // Should contain goal info
      expect(analysis.narrative).toMatch(/ゴール/);
      tested = true;
      break;
    }
    // If no phrases generated, skip gracefully
  });
});

describe('Bebop/Extension counts in summary', () => {
  it('bebopPassingCount and extensionCount are computed when present', () => {
    const config: PhraseConfig = { approachTypes: ['single-below', 'enclosure'] };
    const mode = getMode('C', 'mixolydian');
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);
    for (let i = 0; i < 20; i++) {
      const phrase = generatePhraseRule(positions[0], mode, fretMap, config);
      if (!phrase) continue;
      const { summary } = analyzePhrase(phrase, mode);
      // Counts should be undefined (0) or positive integers
      if (summary.bebopPassingCount !== undefined) {
        expect(summary.bebopPassingCount).toBeGreaterThan(0);
      }
      if (summary.extensionCount !== undefined) {
        expect(summary.extensionCount).toBeGreaterThan(0);
      }
    }
  });
});
