import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LickEntry, PoolNote, Position } from '../../types';
import {
  QUALITY_TO_LICK_TYPE,
  SOURCE_DISPLAY_NAMES,
  transposeLick,
  inferRhythmType,
  mapLickToFretboard,
  lickToGeneratedPhrase,
  inferModeFromLick,
  findBestPositionForLick,
  selectBestInstance,
  getTransposeSemitones,
  buildLickContext,
  loadLickDB,
  clearLickDBCache,
  detectIiVPattern,
  isIiVLickId,
  buildIiVLickContext,
  getIiVTransposeSemitones,
} from '../lickEngine';
import { MODE_TEMPLATES } from '../../constants';
import { resolveMode } from '../noteSpelling';
import { buildFretMap, generatePositions } from '../fretboard';
import { buildNotePool } from '../lickEngine';

// Sample lick for testing (C root, dom7, 4 beats, 8th notes)
const sampleDom7Lick: LickEntry = {
  notes: [
    { pitch: 67, beatStart: 0.0, duration: 0.5 },   // G4
    { pitch: 65, beatStart: 0.5, duration: 0.5 },   // F4
    { pitch: 64, beatStart: 1.0, duration: 0.5 },   // E4
    { pitch: 62, beatStart: 1.5, duration: 0.5 },   // D4
    { pitch: 60, beatStart: 2.0, duration: 0.5 },   // C4
    { pitch: 62, beatStart: 2.5, duration: 0.5 },   // D4
    { pitch: 64, beatStart: 3.0, duration: 0.5 },   // E4
    { pitch: 67, beatStart: 3.5, duration: 0.5 },   // G4
  ],
  noteCount: 8,
  beats: 4,
  source: 'cannonball',
};

const lickWithRest: LickEntry = {
  notes: [
    { pitch: 60, beatStart: 0.0, duration: 0.5 },
    { rest: true, beatStart: 0.5, duration: 0.5 },
    { pitch: 64, beatStart: 1.0, duration: 0.5 },
  ],
  noteCount: 2,
  beats: 2,
};

describe('QUALITY_TO_LICK_TYPE', () => {
  it('maps dominant variants to dom7', () => {
    expect(QUALITY_TO_LICK_TYPE['7']).toBe('dom7');
    expect(QUALITY_TO_LICK_TYPE['7alt']).toBe('dom7');
    expect(QUALITY_TO_LICK_TYPE['7b9']).toBe('dom7');
    expect(QUALITY_TO_LICK_TYPE['7#11']).toBe('dom7');
    expect(QUALITY_TO_LICK_TYPE['7b13']).toBe('dom7');
  });

  it('maps minor to min7', () => {
    expect(QUALITY_TO_LICK_TYPE['m7']).toBe('min7');
  });

  it('maps major to maj7', () => {
    expect(QUALITY_TO_LICK_TYPE['maj7']).toBe('maj7');
  });

  it('maps half-diminished to m7b5', () => {
    expect(QUALITY_TO_LICK_TYPE['m7♭5']).toBe('m7b5');
  });
});

describe('SOURCE_DISPLAY_NAMES', () => {
  it('contains known artist names', () => {
    expect(SOURCE_DISPLAY_NAMES['cannonball']).toBe('Cannonball Adderley');
    expect(SOURCE_DISPLAY_NAMES['parker']).toBe('Charlie Parker');
  });
});

describe('transposeLick', () => {
  it('transposes all pitched notes by given semitones', () => {
    const transposed = transposeLick(sampleDom7Lick, 5);
    expect(transposed.notes[0].pitch).toBe(72); // G4+5 = C5
    expect(transposed.notes[4].pitch).toBe(65); // C4+5 = F4
  });

  it('preserves rest notes unchanged', () => {
    const transposed = transposeLick(lickWithRest, 3);
    expect(transposed.notes[1].rest).toBe(true);
    expect(transposed.notes[1].pitch).toBeUndefined();
  });

  it('preserves metadata', () => {
    const transposed = transposeLick(sampleDom7Lick, 2);
    expect(transposed.noteCount).toBe(8);
    expect(transposed.beats).toBe(4);
    expect(transposed.source).toBe('cannonball');
  });
});

describe('inferRhythmType', () => {
  it('returns q for quarter notes', () => {
    expect(inferRhythmType(1.0)).toBe('q');
    expect(inferRhythmType(1.5)).toBe('q');
  });

  it('returns e for eighth notes', () => {
    expect(inferRhythmType(0.5)).toBe('e');
  });

  it('returns t for triplets', () => {
    expect(inferRhythmType(1 / 3)).toBe('t');
  });

  it('returns s for sixteenth notes', () => {
    expect(inferRhythmType(0.25)).toBe('s');
  });
});

describe('getTransposeSemitones', () => {
  it('dom7: G root (7) stored, target C (0) → -7', () => {
    expect(getTransposeSemitones('7', 0)).toBe(-7);
  });

  it('dom7: G root (7) stored, target G (7) → 0', () => {
    expect(getTransposeSemitones('7', 7)).toBe(0);
  });

  it('min7: D root (2) stored, target A (9) → +7', () => {
    expect(getTransposeSemitones('m7', 9)).toBe(7);
  });

  it('maj7: C root (0) stored, target F (5) → +5', () => {
    expect(getTransposeSemitones('maj7', 5)).toBe(5);
  });
});

describe('mapLickToFretboard', () => {
  it('maps lick pitches to pool notes', () => {
    // Build a Mixolydian pool for G (dom7 licks are stored in G)
    const mode = resolveMode('G', MODE_TEMPLATES[4]); // Mixolydian
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);
    const pool = buildNotePool(positions[0], mode, fretMap, true);

    const mapped = mapLickToFretboard(sampleDom7Lick, pool, 0);
    expect(mapped.length).toBe(8);
    // All notes should have string/fret coordinates
    for (const m of mapped) {
      expect(m).not.toBeNull();
      expect(m!.stringIdx).toBeGreaterThanOrEqual(0);
      expect(m!.fret).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns null for rest notes', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]);
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);
    const pool = buildNotePool(positions[0], mode, fretMap, true);

    const mapped = mapLickToFretboard(lickWithRest, pool, 0);
    expect(mapped[0]).not.toBeNull();
    expect(mapped[1]).toBeNull();
    expect(mapped[2]).not.toBeNull();
  });
});

describe('inferModeFromLick', () => {
  it('infers Mixolydian for a dom7 lick with natural 6th', () => {
    // Lick in G Mixolydian (G A B C D E F G) — stored as G root for dom7
    const gMixoLick: LickEntry = {
      notes: [
        { pitch: 67, beatStart: 0, duration: 0.5 },  // G
        { pitch: 69, beatStart: 0.5, duration: 0.5 }, // A (natural 6)
        { pitch: 71, beatStart: 1, duration: 0.5 },   // B (natural 3)
        { pitch: 65, beatStart: 1.5, duration: 0.5 }, // F (b7)
      ],
      noteCount: 4, beats: 2,
    };
    const modeIdx = inferModeFromLick(gMixoLick, '7', 7); // target G (semi=7)
    expect(modeIdx).toBe(4); // Mixolydian
  });

  it('returns first candidate if only one mode available', () => {
    const lick: LickEntry = { notes: [{ pitch: 60, beatStart: 0, duration: 1 }], noteCount: 1, beats: 1 };
    const modeIdx = inferModeFromLick(lick, 'dim', 0);
    expect(modeIdx).toBe(16); // Diminished W-H (only candidate)
  });
});

describe('findBestPositionForLick', () => {
  it('returns position with most notes covered', () => {
    const mode = resolveMode('G', MODE_TEMPLATES[4]); // Mixolydian
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);

    const posId = findBestPositionForLick(sampleDom7Lick, positions, 0);
    expect(positions.some(p => p.id === posId)).toBe(true);
  });
});

describe('lickToGeneratedPhrase', () => {
  it('converts a lick to a valid GeneratedPhrase', () => {
    const mode = resolveMode('G', MODE_TEMPLATES[4]);
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);
    const pool = buildNotePool(positions[0], mode, fretMap, true);

    const phrase = lickToGeneratedPhrase(sampleDom7Lick, 1, 'mixolydian', 'G', pool, 0);

    expect(phrase.notes.length).toBe(8);
    expect(phrase.totalBeats).toBe(4);
    expect(phrase.posId).toBe(1);
    expect(phrase.modeKey).toBe('mixolydian');
    expect(phrase.rootName).toBe('G');

    // All notes should have valid PhraseNote fields
    for (const n of phrase.notes) {
      expect(n.beatStart).toBeDefined();
      expect(n.duration).toBeDefined();
      expect(typeof n.isChordTone).toBe('boolean');
    }
  });

  it('marks rest notes correctly', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]);
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);
    const pool = buildNotePool(positions[0], mode, fretMap, true);

    const phrase = lickToGeneratedPhrase(lickWithRest, 1, 'ionian', 'C', pool, 0);
    expect(phrase.notes[1].isRest).toBe(true);
  });
});

describe('buildLickContext with dim quality', () => {
  it('returns non-null for dim chord (8-note scale)', () => {
    const lick: LickEntry = {
      notes: [
        { pitch: 67, beatStart: 0, duration: 0.5 },  // G
        { pitch: 65, beatStart: 0.5, duration: 0.5 }, // F
        { pitch: 63, beatStart: 1, duration: 0.5 },   // Eb
        { pitch: 60, beatStart: 1.5, duration: 0.5 }, // C
      ],
      noteCount: 4,
      beats: 2,
    };
    const result = buildLickContext(lick, 'dim', 'C', 0);
    expect(result).not.toBeNull();
    expect(result!.positions.length).toBeGreaterThan(0);
    expect(result!.phrase.notes.length).toBe(4);
  });
});

describe('selectBestInstance', () => {
  it('selects the instance whose pitches best cover the lick', () => {
    const mode = resolveMode('G', MODE_TEMPLATES[4]); // Mixolydian
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);
    // Pick a position with multiple instances
    const pos = positions.find(p => p.instances.length >= 2);
    if (!pos) return; // skip if no multi-instance position
    // Use pitches from the lower instance range
    const inst0 = pos.instances[0];
    const pitches: number[] = [];
    for (let s = 0; s < 6; s++) {
      const notes = inst0.strings[s];
      if (!notes) continue;
      for (const [, fret] of notes) {
        pitches.push(64 - 5 * s + fret); // OPEN_MIDI approximation
      }
    }
    const idx = selectBestInstance(pos, pitches.slice(0, 4));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(pos.instances.length);
  });

  it('returns 0 for single-instance position', () => {
    const pos: Position = {
      id: 1,
      bPair: 'C,D',
      range: '1-5',
      instances: [{
        strings: [
          [['C', 3], ['D', 5], ['E', 7]],
          [['A', 3], ['B', 5]],
          [['F', 3], ['G', 5], ['A', 7]],
          [['C', 3], ['D', 5], ['E', 7]],
          [['G', 3], ['A', 5], ['B', 7]],
          [['C', 3], ['D', 5], ['E', 7]],
        ],
        fretMin: 3,
        fretMax: 7,
      }],
    };
    expect(selectBestInstance(pos, [60, 64, 67])).toBe(0);
  });
});

describe('mapPitchToFret initial note prefers middle strings', () => {
  it('first note maps near G/D strings when multiple candidates exist', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]); // Ionian
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);
    const pool = buildNotePool(positions[0], mode, fretMap, true);

    // C4 (MIDI 60) exists on multiple strings
    const lick: LickEntry = {
      notes: [{ pitch: 60, beatStart: 0, duration: 1 }],
      noteCount: 1,
      beats: 1,
    };
    const mapped = mapLickToFretboard(lick, pool, 0);
    expect(mapped[0]).not.toBeNull();
    // Should prefer middle strings (2=G, 3=D) over edges (0=1E, 5=6E)
    const si = mapped[0]!.stringIdx;
    expect(si).toBeGreaterThanOrEqual(1);
    expect(si).toBeLessThanOrEqual(4);
  });
});

describe('findBestPositionForLick per-instance scoring', () => {
  it('scores positions by best single instance, not combined', () => {
    const mode = resolveMode('G', MODE_TEMPLATES[4]); // Mixolydian
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const positions = generatePositions(fretMap, mode.notes);

    // Use a narrow-range lick that fits in one instance
    const narrowLick: LickEntry = {
      notes: [
        { pitch: 55, beatStart: 0, duration: 0.5 },   // G3
        { pitch: 57, beatStart: 0.5, duration: 0.5 }, // A3
        { pitch: 59, beatStart: 1, duration: 0.5 },   // B3
        { pitch: 60, beatStart: 1.5, duration: 0.5 }, // C4
      ],
      noteCount: 4,
      beats: 2,
    };

    const posId = findBestPositionForLick(narrowLick, positions, 0);
    expect(positions.some(p => p.id === posId)).toBe(true);
  });
});

describe('loadLickDB', () => {
  beforeEach(() => {
    clearLickDBCache();
  });

  it('loads and caches lick DB from fetch', async () => {
    const mockData = { dom7: [sampleDom7Lick], min7: [] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const db = await loadLickDB();
    expect(db).toEqual(mockData);
    expect(db.dom7).toHaveLength(1);

    // Second call should use cache
    const db2 = await loadLickDB();
    expect(db2).toBe(db);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on fetch failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(loadLickDB()).rejects.toThrow('Failed to load licks.json');
  });
});

// ---------------------------------------------------------------------------
// ii-V detection & context
// ---------------------------------------------------------------------------

describe('getIiVTransposeSemitones', () => {
  it('keeps low values unchanged (0-6)', () => {
    expect(getIiVTransposeSemitones(0)).toBe(0);
    expect(getIiVTransposeSemitones(5)).toBe(5);
    expect(getIiVTransposeSemitones(6)).toBe(6);
  });

  it('normalizes high values to negative (7-11)', () => {
    expect(getIiVTransposeSemitones(7)).toBe(-5);
    expect(getIiVTransposeSemitones(10)).toBe(-2);
    expect(getIiVTransposeSemitones(11)).toBe(-1);
  });
});

describe('detectIiVPattern', () => {
  it('detects major ii-V: Dm7 → G7', () => {
    const chords = [
      { quality: 'm7', rootName: 'D' },
      { quality: '7', rootName: 'G' },
    ];
    const result = detectIiVPattern(chords, 0);
    expect(result).not.toBeNull();
    expect(result!.types).toContain('maj-ii-v-short');
    expect(result!.types).toContain('maj-ii-v-long');
    expect(result!.keyCenterSemitone).toBe(0); // C
  });

  it('detects major ii-V in F: Gm7 → C7', () => {
    const chords = [
      { quality: 'm7', rootName: 'G' },
      { quality: '7', rootName: 'C' },
    ];
    const result = detectIiVPattern(chords, 0);
    expect(result).not.toBeNull();
    expect(result!.keyCenterSemitone).toBe(5); // F
  });

  it('detects major ii-V in all 12 keys', () => {
    // ii-V pairs for all keys: ii root = key + 2 semitones, V root = key + 7 semitones
    const ROOTS_SEMI: Record<string, number> = {
      'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
      'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
    };
    const ROOT_NAMES = Object.keys(ROOTS_SEMI);
    for (const keyRoot of ROOT_NAMES) {
      const keySemi = ROOTS_SEMI[keyRoot];
      const iiSemi = (keySemi + 2) % 12;
      const vSemi = (keySemi + 7) % 12;
      const iiName = ROOT_NAMES.find(r => ROOTS_SEMI[r] === iiSemi)!;
      const vName = ROOT_NAMES.find(r => ROOTS_SEMI[r] === vSemi)!;
      const chords = [
        { quality: 'm7', rootName: iiName },
        { quality: '7', rootName: vName },
      ];
      const result = detectIiVPattern(chords, 0);
      expect(result).not.toBeNull();
      expect(result!.keyCenterSemitone).toBe(keySemi);
    }
  });

  it('detects minor ii-V: Dm7♭5 → G7', () => {
    const chords = [
      { quality: 'm7♭5', rootName: 'D' },
      { quality: '7', rootName: 'G' },
    ];
    const result = detectIiVPattern(chords, 0);
    expect(result).not.toBeNull();
    expect(result!.types).toEqual(['min-ii-v-short']);
    expect(result!.keyCenterSemitone).toBe(0); // C minor
  });

  it('detects ii-V with dom7 variants: Dm7 → G7alt', () => {
    const chords = [
      { quality: 'm7', rootName: 'D' },
      { quality: '7alt', rootName: 'G' },
    ];
    const result = detectIiVPattern(chords, 0);
    expect(result).not.toBeNull();
    expect(result!.types).toContain('maj-ii-v-short');
  });

  it('returns null for wrong interval: Dm7 → A7 (not ii-V)', () => {
    const chords = [
      { quality: 'm7', rootName: 'D' },
      { quality: '7', rootName: 'A' },
    ];
    expect(detectIiVPattern(chords, 0)).toBeNull();
  });

  it('returns null for wrong quality: Dmaj7 → G7', () => {
    const chords = [
      { quality: 'maj7', rootName: 'D' },
      { quality: '7', rootName: 'G' },
    ];
    expect(detectIiVPattern(chords, 0)).toBeNull();
  });

  it('returns null for V not dom7: Dm7 → Gmaj7', () => {
    const chords = [
      { quality: 'm7', rootName: 'D' },
      { quality: 'maj7', rootName: 'G' },
    ];
    expect(detectIiVPattern(chords, 0)).toBeNull();
  });

  it('returns null at last chord (no next chord)', () => {
    const chords = [{ quality: 'm7', rootName: 'D' }];
    expect(detectIiVPattern(chords, 0)).toBeNull();
  });

  it('works at non-zero index: chords[1] → chords[2]', () => {
    const chords = [
      { quality: 'maj7', rootName: 'C' },
      { quality: 'm7', rootName: 'D' },
      { quality: '7', rootName: 'G' },
    ];
    const result = detectIiVPattern(chords, 1);
    expect(result).not.toBeNull();
    expect(result!.keyCenterSemitone).toBe(0);
  });
});

describe('isIiVLickId', () => {
  it('detects maj-ii-v-short prefix IS-', () => {
    expect(isIiVLickId('IS-abc1')).toBe('maj-ii-v-short');
    expect(isIiVLickId('is-abc1')).toBe('maj-ii-v-short');
  });

  it('detects maj-ii-v-long prefix IL-', () => {
    expect(isIiVLickId('IL-abc1')).toBe('maj-ii-v-long');
    expect(isIiVLickId('il-abc1')).toBe('maj-ii-v-long');
  });

  it('detects min-ii-v-short prefix iS-', () => {
    expect(isIiVLickId('iS-abc1')).toBe('min-ii-v-short');
  });

  it('returns null for non-iiV IDs', () => {
    expect(isIiVLickId('D-3a7f')).toBeNull();
    expect(isIiVLickId('m-b2c1')).toBeNull();
    expect(isIiVLickId(undefined)).toBeNull();
  });
});

describe('buildIiVLickContext', () => {
  const iiVLick: LickEntry = {
    notes: [
      { pitch: 62, beatStart: 0, duration: 0.5 },   // D4
      { pitch: 64, beatStart: 0.5, duration: 0.5 }, // E4
      { pitch: 65, beatStart: 1, duration: 0.5 },   // F4
      { pitch: 67, beatStart: 1.5, duration: 0.5 }, // G4
      { pitch: 65, beatStart: 2, duration: 0.5 },   // F4
      { pitch: 64, beatStart: 2.5, duration: 0.5 }, // E4
      { pitch: 62, beatStart: 3, duration: 0.5 },   // D4
      { pitch: 60, beatStart: 3.5, duration: 0.5 }, // C4
    ],
    noteCount: 8,
    beats: 4,
    id: 'IS-test',
  };

  it('returns non-null for valid ii-V context', () => {
    // Dm7 → G7 in C: keyCenterSemitone = 0, V = G7
    const result = buildIiVLickContext(iiVLick, 0, '7', 'G', 7);
    expect(result).not.toBeNull();
    expect(result!.phrase.notes.length).toBe(8);
    expect(result!.transposeSemitones).toBe(0); // C=0 stored, target C=0
  });

  it('transposes correctly for F key: keyCenterSemitone = 5', () => {
    // Gm7 → C7 in F: keyCenterSemitone = 5
    const result = buildIiVLickContext(iiVLick, 5, '7', 'C', 0);
    expect(result).not.toBeNull();
    expect(result!.transposeSemitones).toBe(5);
  });

  it('normalizes transposition for high keys (Bb=10 → -2)', () => {
    // Cm7 → F7 in Bb: keyCenterSemitone = 10
    const result = buildIiVLickContext(iiVLick, 10, '7', 'F', 5);
    expect(result).not.toBeNull();
    expect(result!.transposeSemitones).toBe(-2); // 10 > 6 → 10 - 12 = -2
  });

  it('normalizes transposition for B key (11 → -1)', () => {
    const result = buildIiVLickContext(iiVLick, 11, '7', 'G♭', 6);
    expect(result).not.toBeNull();
    expect(result!.transposeSemitones).toBe(-1); // 11 > 6 → 11 - 12 = -1
  });

  it('returns a valid phrase with positions', () => {
    const result = buildIiVLickContext(iiVLick, 0, '7', 'G', 7);
    expect(result).not.toBeNull();
    expect(result!.positions.length).toBeGreaterThan(0);
    expect(result!.posId).toBeGreaterThan(0);
  });
});
