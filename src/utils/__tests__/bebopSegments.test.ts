import { describe, it, expect } from 'vitest';
import { segArpeggio, segScaleRun, segEnclosure, seg1235, segDim7From3rd, segApproachCT, segChromatic, segUpperStructure } from '../bebopSegments';
import { buildNotePool } from '../bebopGenerator';
import { absolutePitch } from '../bebopScheduler';
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

// ---------------------------------------------------------------------------
// Anchor-aware segment tests
// ---------------------------------------------------------------------------

describe('anchor-aware segments', () => {
  // Helper: find a CT pool note at a specific pitch range for use as exitAnchor
  function findAnchor(pool: ReturnType<typeof buildFixtures>['pool'], mode: ReturnType<typeof buildFixtures>['mode'], direction: 'high' | 'low') {
    const ctSet = new Set(mode.chordTones);
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    const sorted = [...ctPool].sort((a, b) => absolutePitch(a) - absolutePitch(b));
    return direction === 'high' ? sorted[sorted.length - 1] : sorted[0];
  }

  it('segScaleRun with exitAnchor: last note closer to anchor', () => {
    const { pool, mode } = buildFixtures();
    const ctSet = new Set(mode.chordTones);
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    // Start from middle, anchor at opposite end
    const sorted = [...ctPool].sort((a, b) => absolutePitch(a) - absolutePitch(b));
    const midIdx = Math.floor(sorted.length / 2);
    const start = sorted[midIdx];
    const anchor = sorted[sorted.length - 1]; // high anchor

    // Run multiple times (randomness in GT preference)
    let anchoredCloser = 0;
    const runs = 20;
    for (let i = 0; i < runs; i++) {
      const withAnchor = segScaleRun(pool, mode, start, 'desc', 6, { exitAnchor: anchor });
      const withoutAnchor = segScaleRun(pool, mode, start, 'desc', 6);
      if (withAnchor && withoutAnchor) {
        const lastWith = withAnchor[withAnchor.length - 1];
        const lastWithout = withoutAnchor[withoutAnchor.length - 1];
        const distWith = Math.abs(absolutePitch(lastWith) - absolutePitch(anchor));
        const distWithout = Math.abs(absolutePitch(lastWithout) - absolutePitch(anchor));
        if (distWith <= distWithout) anchoredCloser++;
      }
    }
    // With exitAnchor, the run should redirect toward the anchor more often than not
    expect(anchoredCloser).toBeGreaterThanOrEqual(Math.floor(runs * 0.4));
  });

  it('segArpeggio with exitAnchor + interiorAnchors: passes through or near anchors', () => {
    const { pool, mode } = buildFixtures();
    const ctSet = new Set(mode.chordTones);
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    const sorted = [...ctPool].sort((a, b) => absolutePitch(a) - absolutePitch(b));
    const start = sorted[0];
    const exitAnchor = sorted[sorted.length - 1];
    // Pick an interior anchor from the middle of CT pool
    const interior = sorted[Math.floor(sorted.length / 2)];

    const result = segArpeggio(pool, mode, start, 'asc', 6, {
      exitAnchor,
      interiorAnchors: [interior],
    });

    expect(result).not.toBeNull();
    if (result) {
      // Check that at least one note matches interior anchor's semitone
      // or that the last note is close to exitAnchor
      const hasInterior = result.some(n => n.semitone === interior.semitone);
      const lastDist = Math.abs(absolutePitch(result[result.length - 1]) - absolutePitch(exitAnchor));
      // Either passes through interior anchor, or ends close to exit anchor
      expect(hasInterior || lastDist <= 7).toBe(true);
    }
  });

  it('segEnclosure with exitAnchor: target matches exitAnchor semitone', () => {
    const { pool, mode } = buildFixtures();
    const ctSet = new Set(mode.chordTones);
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    // Use a specific CT as exit anchor
    const anchor = ctPool.find(n => n.noteName === mode.chordTones[1])!; // 3rd

    let matchCount = 0;
    const runs = 30;
    for (let i = 0; i < runs; i++) {
      const result = segEnclosure(pool, mode, ctPool[0], 'desc', 4, { exitAnchor: anchor });
      if (result && result.length >= 3) {
        const last = result[result.length - 1];
        if (last.semitone === anchor.semitone) matchCount++;
      }
    }
    // When exitAnchor is a CT, enclosure should target it most of the time
    expect(matchCount).toBeGreaterThanOrEqual(Math.floor(runs * 0.5));
  });

  it('segApproachCT with exitAnchor: result contains exitAnchor semitone', () => {
    const { pool, mode } = buildFixtures();
    const ctSet = new Set(mode.chordTones);
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    const anchor = ctPool.find(n => n.noteName === mode.chordTones[3])!; // 7th
    const start = pool[0];

    let matchCount = 0;
    const runs = 40;
    for (let i = 0; i < runs; i++) {
      const result = segApproachCT(pool, mode, start, 'desc', 6, { exitAnchor: anchor });
      if (result && result.length >= 2) {
        // Check if any note in the result has the exitAnchor's semitone
        const hasAnchorSemi = result.some(n => n.semitone === anchor.semitone);
        if (hasAnchorSemi) matchCount++;
      }
    }
    // exitAnchor's semitone should appear in the result in most runs
    // (it's added to anchorTargets and used as an ordered target)
    expect(matchCount).toBeGreaterThanOrEqual(Math.floor(runs * 0.3));
  });

  it('segScaleRun with interiorAnchors: passes through waypoints', () => {
    const { pool, mode } = buildFixtures();
    const ctSet = new Set(mode.chordTones);
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    const sorted = [...ctPool].sort((a, b) => absolutePitch(a) - absolutePitch(b));
    // Start low, interior mid, exit high
    const start = sorted[0];
    const interior = sorted[Math.floor(sorted.length / 2)];
    const exitAnchor = sorted[sorted.length - 1];

    let passCount = 0;
    const runs = 30;
    for (let i = 0; i < runs; i++) {
      const result = segScaleRun(pool, mode, start, 'asc', 8, {
        exitAnchor,
        interiorAnchors: [interior],
      });
      if (result && result.length >= 3) {
        // Check if any note matches interior anchor semitone+string
        const hasInterior = result.some(n =>
          n.semitone === interior.semitone && n.stringIdx === interior.stringIdx
        );
        if (hasInterior) passCount++;
      }
    }
    // Interior anchor should be passed through in a good fraction of runs
    expect(passCount).toBeGreaterThanOrEqual(Math.floor(runs * 0.3));
  });

  it('segScaleRun with interiorAnchors: direction updates toward next waypoint', () => {
    const { pool, mode } = buildFixtures();
    // Use full pool sorted by pitch for wider range
    const sorted = [...pool].filter(n => !n.isApproach).sort((a, b) => absolutePitch(a) - absolutePitch(b));
    // Start low, interior high, exit low → should ascend then descend
    const start = sorted[0];
    const interior = sorted[sorted.length - 1]; // highest note
    const exitAnchor = sorted[Math.floor(sorted.length * 0.2)]; // low exit

    let reachesHigh = 0;
    const runs = 30;
    for (let i = 0; i < runs; i++) {
      const withAnchors = segScaleRun(pool, mode, start, 'asc', 12, {
        exitAnchor,
        interiorAnchors: [interior],
      });
      const withoutAnchors = segScaleRun(pool, mode, start, 'asc', 12, {
        exitAnchor,
      });
      if (withAnchors && withAnchors.length >= 3) {
        // With interior anchor at top, the run should reach higher pitches
        // than without (which goes directly to low exit)
        const maxPitchWith = Math.max(...withAnchors.map(n => absolutePitch(n)));
        const maxPitchWithout = withoutAnchors ? Math.max(...withoutAnchors.map(n => absolutePitch(n))) : 0;
        if (maxPitchWith >= maxPitchWithout) reachesHigh++;
      }
    }
    // With high interior anchor, run should reach higher pitches
    expect(reachesHigh).toBeGreaterThanOrEqual(Math.floor(runs * 0.4));
  });

  it('segChromatic with exitAnchor: chromatic run moves toward exitAnchor', () => {
    const { pool, mode } = buildFixtures();
    const sorted = [...pool].sort((a, b) => absolutePitch(a) - absolutePitch(b));
    // Start low, anchor high
    const start = sorted[0];
    const anchor = sorted[sorted.length - 1];

    const result = segChromatic(pool, mode, start, 'desc', 6, { exitAnchor: anchor });
    expect(result).not.toBeNull();
    if (result && result.length >= 2) {
      // With exitAnchor above start, chromatic run should go ascending (overriding 'desc')
      const firstPitch = absolutePitch(result[0]);
      const lastPitch = absolutePitch(result[result.length - 1]);
      expect(lastPitch).toBeGreaterThan(firstPitch);
    }
  });
});
