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
  getTransposeSemitones,
  loadLickDB,
  clearLickDBCache,
} from '../lickEngine';
import { MODE_TEMPLATES } from '../../constants';
import { resolveMode } from '../noteSpelling';
import { buildFretMap, generatePositions } from '../fretboard';
import { buildNotePool } from '../bebopGenerator';

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
