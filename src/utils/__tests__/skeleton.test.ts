import { describe, it, expect } from 'vitest';
import { buildSkeleton, chooseContour, contourCurve } from '../skeleton';
import { buildNotePool } from '../bebopGenerator';
import { absolutePitch } from '../bebopScheduler';
import { buildFretMap, generatePositions, resolveMode } from '../../utils';
import { MODE_TEMPLATES } from '../../constants';
import type { RootName, PoolNote } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildFixtures(rootName: RootName = 'C', modeKey = 'mixolydian') {
  const template = MODE_TEMPLATES.find(t => t.key === modeKey)!;
  const mode = resolveMode(rootName, template);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = generatePositions(fretMap, mode.notes);
  const pos = positions[0];
  const pool = buildNotePool(pos, mode, fretMap, true);
  const ctSet = new Set(mode.chordTones);
  const ctPool = pool.filter(n => ctSet.has(n.noteName));
  return { mode, fretMap, pos, pool, ctPool };
}

// ---------------------------------------------------------------------------
// chooseContour
// ---------------------------------------------------------------------------

describe('chooseContour', () => {
  it('ascending pitch diff favors ascending/reverse-arch', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const c = chooseContour(50, 60);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    // ascending + reverse-arch should dominate
    const favorable = (counts['ascending'] ?? 0) + (counts['reverse-arch'] ?? 0);
    expect(favorable).toBeGreaterThan(200);
  });

  it('descending pitch diff favors descending/arch', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const c = chooseContour(60, 50);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    const favorable = (counts['descending'] ?? 0) + (counts['arch'] ?? 0);
    expect(favorable).toBeGreaterThan(200);
  });

  it('similar pitch produces diverse contours', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(chooseContour(55, 56));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('penalizes consecutive same contour', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const c = chooseContour(55, 55, 'arch');
      counts[c] = (counts[c] ?? 0) + 1;
    }
    // arch should appear less than non-arch
    const archPct = (counts['arch'] ?? 0) / 500;
    expect(archPct).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// contourCurve
// ---------------------------------------------------------------------------

describe('contourCurve', () => {
  it('ascending: linear interpolation', () => {
    expect(contourCurve('ascending', 0, 50, 60)).toBe(50);
    expect(contourCurve('ascending', 1, 50, 60)).toBe(60);
    expect(contourCurve('ascending', 0.5, 50, 60)).toBe(55);
  });

  it('descending: linear interpolation', () => {
    expect(contourCurve('descending', 0, 60, 50)).toBe(60);
    expect(contourCurve('descending', 1, 60, 50)).toBe(50);
  });

  it('arch: peak at midpoint above both endpoints', () => {
    const mid = contourCurve('arch', 0.5, 50, 50);
    expect(mid).toBeGreaterThan(50);
    // Endpoints match
    expect(contourCurve('arch', 0, 50, 50)).toBe(50);
    expect(contourCurve('arch', 1, 50, 50)).toBe(50);
  });

  it('reverse-arch: valley at midpoint below both endpoints', () => {
    const mid = contourCurve('reverse-arch', 0.5, 50, 50);
    expect(mid).toBeLessThan(50);
  });

  it('wave: dip at 1/3, peak at 2/3', () => {
    const dip = contourCurve('wave', 1 / 3, 55, 55);
    const peak = contourCurve('wave', 2 / 3, 55, 55);
    expect(dip).toBeLessThan(55);
    expect(peak).toBeGreaterThan(55);
  });
});

// ---------------------------------------------------------------------------
// buildSkeleton
// ---------------------------------------------------------------------------

describe('buildSkeleton', () => {
  it('returns a skeleton with start and target slots', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const start = ctPool[0];
    const goal = ctPool[ctPool.length - 1];
    const skel = buildSkeleton(pool, ctPool, mode, start, goal, 4, 0.5);
    expect(skel).not.toBeNull();
    expect(skel!.slots.length).toBeGreaterThanOrEqual(2);
    expect(skel!.slots[0].role).toBe('start');
    expect(skel!.slots[skel!.slots.length - 1].role).toBe('target');
  });

  it('slots are sorted by beatPos', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const start = ctPool[0];
    const goal = ctPool[ctPool.length - 1];
    const skel = buildSkeleton(pool, ctPool, mode, start, goal, 4, 0.5);
    expect(skel).not.toBeNull();
    for (let i = 1; i < skel!.slots.length; i++) {
      expect(skel!.slots[i].beatPos).toBeGreaterThanOrEqual(skel!.slots[i - 1].beatPos);
    }
  });

  it('start slot has correct beatPos (beatOffset)', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 4, 0.5);
    expect(skel).not.toBeNull();
    expect(skel!.slots[0].beatPos).toBe(0.5);
  });

  it('target slot has correct beatPos (beatOffset + totalBeats)', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 4, 0.5);
    expect(skel).not.toBeNull();
    const last = skel!.slots[skel!.slots.length - 1];
    expect(last.beatPos).toBeCloseTo(4.5);
  });

  it('start and target are required', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 4, 0);
    expect(skel).not.toBeNull();
    expect(skel!.slots[0].required).toBe(true);
    expect(skel!.slots[skel!.slots.length - 1].required).toBe(true);
  });

  it('interior slots are CT notes', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const start = ctPool[0];
    const goal = ctPool[ctPool.length > 2 ? 2 : ctPool.length - 1];
    const skel = buildSkeleton(pool, ctPool, mode, start, goal, 4, 0.5);
    expect(skel).not.toBeNull();
    const ctSet = new Set(mode.chordTones);
    // All interior slots (not start/target) should be CTs
    for (const slot of skel!.slots) {
      if (slot.role === 'start' || slot.role === 'target') continue;
      expect(ctSet.has(slot.note.noteName)).toBe(true);
    }
  });

  it('playability: non-required consecutive slots within 12 semitones pitch distance', () => {
    const { pool, ctPool, mode } = buildFixtures();
    for (let run = 0; run < 20; run++) {
      const start = ctPool[Math.floor(Math.random() * ctPool.length)];
      const goal = ctPool[Math.floor(Math.random() * ctPool.length)];
      const skel = buildSkeleton(pool, ctPool, mode, start, goal, 4, 0.5);
      if (!skel) continue;
      for (let i = 1; i < skel.slots.length; i++) {
        // Skip pairs where both are required (start↔target — segments handle the gap)
        if (skel.slots[i].required && skel.slots[i - 1].required) continue;
        const pd = Math.abs(absolutePitch(skel.slots[i].note) - absolutePitch(skel.slots[i - 1].note));
        expect(pd).toBeLessThanOrEqual(12);
      }
    }
  });

  it('playability: non-required consecutive slots within 3 strings', () => {
    const { pool, ctPool, mode } = buildFixtures();
    for (let run = 0; run < 20; run++) {
      const start = ctPool[Math.floor(Math.random() * ctPool.length)];
      const goal = ctPool[Math.floor(Math.random() * ctPool.length)];
      const skel = buildSkeleton(pool, ctPool, mode, start, goal, 4, 0.5);
      if (!skel) continue;
      for (let i = 1; i < skel.slots.length; i++) {
        if (skel.slots[i].required && skel.slots[i - 1].required) continue;
        const sd = Math.abs(skel.slots[i].note.stringIdx - skel.slots[i - 1].note.stringIdx);
        expect(sd).toBeLessThanOrEqual(3);
      }
    }
  });

  it('works for 2-beat phrases', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 2, 0.5);
    expect(skel).not.toBeNull();
    expect(skel!.totalBeats).toBe(2);
    expect(skel!.slots.length).toBeGreaterThanOrEqual(2);
  });

  it('works for 3-beat phrases', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 3, 0.5);
    expect(skel).not.toBeNull();
    expect(skel!.totalBeats).toBe(3);
  });

  it('works for various modes', () => {
    const modes = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];
    for (const modeKey of modes) {
      const { pool, ctPool, mode } = buildFixtures('C', modeKey);
      if (ctPool.length < 2) continue;
      const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 4, 0.5);
      expect(skel).not.toBeNull();
    }
  });

  it('works for various keys', () => {
    const keys: RootName[] = ['C', 'D', 'E♭', 'G♭', 'A', 'B♭'];
    for (const key of keys) {
      const { pool, ctPool, mode } = buildFixtures(key, 'mixolydian');
      if (ctPool.length < 2) continue;
      const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 4, 0);
      expect(skel).not.toBeNull();
    }
  });

  it('strong beats prefer GT (3rd/7th) — statistical', () => {
    const { pool, ctPool, mode } = buildFixtures('C', 'mixolydian');
    const gtNames = new Set<string>();
    if (mode.chordTones.length >= 2) gtNames.add(mode.chordTones[1]);
    if (mode.chordTones.length >= 4) gtNames.add(mode.chordTones[3]);

    let totalStrong = 0;
    let gtOnStrong = 0;
    for (let run = 0; run < 100; run++) {
      const start = ctPool[Math.floor(Math.random() * ctPool.length)];
      const goal = ctPool[Math.floor(Math.random() * ctPool.length)];
      const skel = buildSkeleton(pool, ctPool, mode, start, goal, 4, 0.5);
      if (!skel) continue;
      for (const slot of skel.slots) {
        if (slot.role === 'start' || slot.role === 'target') continue;
        // Check if this is on a strong beat (even integer)
        if (Number.isInteger(slot.beatPos) && slot.beatPos % 2 === 0) {
          totalStrong++;
          if (gtNames.has(slot.note.noteName)) gtOnStrong++;
        }
      }
    }
    // GT should appear on at least 30% of strong beats
    if (totalStrong > 10) {
      expect(gtOnStrong / totalStrong).toBeGreaterThan(0.3);
    }
  });

  it('contour is set correctly', () => {
    const { pool, ctPool, mode } = buildFixtures();
    const skel = buildSkeleton(pool, ctPool, mode, ctPool[0], ctPool[1], 4, 0.5);
    expect(skel).not.toBeNull();
    expect(['arch', 'descending', 'ascending', 'wave', 'reverse-arch']).toContain(skel!.contour);
  });
});
