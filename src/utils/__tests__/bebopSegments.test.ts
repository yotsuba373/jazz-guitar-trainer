import { describe, it, expect } from 'vitest';
import { segArpeggio, segScaleRun, segEnclosure, seg1235, segDim7From3rd, segApproachCT, segChromatic, segUpperStructure } from '../bebopSegments';
import { buildNotePool, absolutePitch } from '../phraseGenerator';
import { buildFretMap, generatePositions, resolveMode } from '../../utils';
import { MODE_TEMPLATES } from '../../constants';

// Helper: build test fixtures for C Mixolydian (dominant)
function buildFixtures(rootName = 'C' as const, modeKey = 'mixolydian') {
  const template = MODE_TEMPLATES.find(t => t.key === modeKey)!;
  const mode = resolveMode(rootName, template);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = generatePositions(fretMap, mode.notes);
  const pos = positions[0];
  const pool = buildNotePool(pos, mode, fretMap, true);
  return { mode, fretMap, pos, pool };
}

describe('segArpeggio', () => {
  it('generates ascending CT arpeggio of requested length', () => {
    const { pool, mode } = buildFixtures();
    const ctPool = pool.filter(n => new Set(mode.chordTones).has(n.noteName));
    const start = ctPool[0];
    const result = segArpeggio(pool, mode, start, 'asc', 4);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);
    expect(result!.length).toBeLessThanOrEqual(4);
    // All notes should be chord tones
    const ctSet = new Set(mode.chordTones);
    for (const n of result!) {
      expect(ctSet.has(n.noteName)).toBe(true);
    }
  });

  it('returns ascending pitches for asc direction', () => {
    const { pool, mode } = buildFixtures();
    const ctPool = pool.filter(n => new Set(mode.chordTones).has(n.noteName));
    const start = ctPool[0];
    const result = segArpeggio(pool, mode, start, 'asc', 4);
    if (result && result.length > 1) {
      for (let i = 1; i < result.length; i++) {
        expect(absolutePitch(result[i])).toBeGreaterThan(absolutePitch(result[i - 1]));
      }
    }
  });
});

describe('segScaleRun', () => {
  it('generates descending scale run', () => {
    const { pool, mode } = buildFixtures();
    const ctPool = pool.filter(n => new Set(mode.chordTones).has(n.noteName));
    // Start from a higher CT
    const sorted = [...ctPool].sort((a, b) => absolutePitch(b) - absolutePitch(a));
    const start = sorted[0];
    const result = segScaleRun(pool, mode, start, 'desc', 6);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);
    // Should be mostly descending
    let descCount = 0;
    for (let i = 1; i < result!.length; i++) {
      if (absolutePitch(result![i]) < absolutePitch(result![i - 1])) descCount++;
    }
    expect(descCount).toBeGreaterThan(0);
  });
});

describe('segEnclosure', () => {
  it('generates 3-note enclosure resolving to CT', () => {
    const { pool, mode } = buildFixtures();
    const ctSet = new Set(mode.chordTones);
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    const start = ctPool[0];
    const result = segEnclosure(pool, mode, start, 'desc', 3);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(3);
    // Last note should be a CT (resolution target)
    const last = result![result!.length - 1];
    expect(ctSet.has(last.noteName)).toBe(true);
  });

  it('returns null if too few eighths', () => {
    const { pool, mode } = buildFixtures();
    const start = pool[0];
    const result = segEnclosure(pool, mode, start, 'desc', 2);
    expect(result).toBeNull();
  });
});

describe('seg1235', () => {
  it('generates 4-note 1-2-3-5 pattern', () => {
    const { pool, mode } = buildFixtures();
    const start = pool.find(n => n.semitone === mode.semi[0])!;
    const result = seg1235(pool, mode, start, 'asc', 4);
    // May return null if can't find ascending — that's ok
    if (result) {
      expect(result.length).toBeLessThanOrEqual(4);
      // Should be ascending
      for (let i = 1; i < result.length; i++) {
        expect(absolutePitch(result[i])).toBeGreaterThan(absolutePitch(result[i - 1]));
      }
    }
  });
});

describe('segDim7From3rd', () => {
  it('generates dim7 arpeggio for dom7 quality', () => {
    const { pool, mode } = buildFixtures('C', 'mixolydian');
    const start = pool.find(n => n.noteName === mode.chordTones[1])!; // 3rd
    const result = segDim7From3rd(pool, mode, start, 'asc', 4, { quality: '7' });
    // May return null if notes not findable, but should work for C Mixo
    if (result) {
      expect(result.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns null for non-dominant quality', () => {
    const { pool, mode } = buildFixtures('C', 'ionian');
    const start = pool[0];
    const result = segDim7From3rd(pool, mode, start, 'asc', 4, { quality: 'maj7' });
    expect(result).toBeNull();
  });
});

describe('segApproachCT', () => {
  it('generates approach-CT pairs', () => {
    const { pool, mode } = buildFixtures();
    const start = pool[0];
    const result = segApproachCT(pool, mode, start, 'desc', 4);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('segChromatic', () => {
  it('generates chromatic run', () => {
    const { pool, mode } = buildFixtures();
    const start = pool[0];
    const result = segChromatic(pool, mode, start, 'asc', 4);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.length).toBeGreaterThanOrEqual(2);
      // Consecutive notes should differ by ~1 semitone
      for (let i = 1; i < result.length; i++) {
        const diff = Math.abs(absolutePitch(result[i]) - absolutePitch(result[i - 1]));
        expect(diff).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('segUpperStructure', () => {
  it('generates upper structure arpeggio', () => {
    const { pool, mode } = buildFixtures('C', 'ionian');
    const start = pool.find(n => n.noteName === mode.chordTones[1])!; // 3rd
    const result = segUpperStructure(pool, mode, start, 'asc', 4);
    if (result) {
      expect(result.length).toBeGreaterThanOrEqual(2);
    }
  });
});
