import { describe, it, expect } from 'vitest';
import { buildFretMap, generatePositions } from '../fretboard';
import { resolveMode } from '../noteSpelling';
import { MODE_TEMPLATES, ROOTS } from '../../constants';
import type { RootName } from '../../types';

/* ── helpers ────────────────────────────────────────────── */

function positionsFor(rootName: RootName, modeIdx: number) {
  const mode = resolveMode(rootName, MODE_TEMPLATES[modeIdx]);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  return { mode, fretMap, positions: generatePositions(fretMap, mode.notes) };
}

/** Get the first-note degree index on a string for Pos 1 instance 0 */
function firstDegOfString(
  rootName: RootName,
  modeIdx: number,
  strIdx: number,
): number {
  const { mode, positions } = positionsFor(rootName, modeIdx);
  const inst = positions[0].instances[0];
  const notes = inst.strings[strIdx];
  if (!notes) return -1;
  return mode.notes.indexOf(notes[0][0]);
}

/* ── buildFretMap ───────────────────────────────────────── */

describe('buildFretMap', () => {
  it('C Ionian: all 6 strings have notes within frets 0-22', () => {
    const { fretMap } = positionsFor('C', 0);
    expect(fretMap).toHaveLength(6);
    for (const strNotes of fretMap) {
      expect(strNotes.length).toBeGreaterThan(0);
      for (const [, fret] of strNotes) {
        expect(fret).toBeGreaterThanOrEqual(0);
        expect(fret).toBeLessThanOrEqual(22);
      }
    }
  });

  it('notes contain only scale note names', () => {
    const { mode, fretMap } = positionsFor('C', 0);
    const nameSet = new Set(mode.notes);
    for (const strNotes of fretMap) {
      for (const [name] of strNotes) {
        expect(nameSet.has(name)).toBe(true);
      }
    }
  });
});

/* ── C Ionian Pos 1 reference (CLAUDE.md) ──────────────── */

describe('C Ionian Pos 1 reference', () => {
  it('matches exact notes and frets from CLAUDE.md', () => {
    const { positions } = positionsFor('C', 0);
    const pos1 = positions[0];
    expect(pos1.id).toBe(1);

    // Find the instance that contains fret 1 (lowest)
    const inst = pos1.instances.find(i => i.fretMin <= 1)!;
    expect(inst).toBeDefined();

    // 1E: F(1), G(3), A(5)
    expect(inst.strings[0]).toEqual([['F', 1, 5], ['G', 3, 7], ['A', 5, 9]]);
    // B:  D(3), E(5)
    expect(inst.strings[1]).toEqual([['D', 3, 2], ['E', 5, 4]]);
    // G:  A(2), B(4), C(5)
    expect(inst.strings[2]).toEqual([['A', 2, 9], ['B', 4, 11], ['C', 5, 0]]);
    // D:  E(2), F(3), G(5)
    expect(inst.strings[3]).toEqual([['E', 2, 4], ['F', 3, 5], ['G', 5, 7]]);
    // A:  B(2), C(3), D(5)
    expect(inst.strings[4]).toEqual([['B', 2, 11], ['C', 3, 0], ['D', 5, 2]]);
    // 6E = 1E
    expect(inst.strings[5]).toEqual(inst.strings[0]);
  });
});

/* ── degree offset invariant (all 84 patterns) ─────────── */

describe('degree offset invariant: all 12 keys × 7 modes', () => {
  // Expected: E=3, G=5, D=2, A=6 for Pos 1
  const EXPECTED = { e: 3, g: 5, d: 2, a: 6 };

  for (const root of ROOTS) {
    for (let mi = 0; mi < MODE_TEMPLATES.length; mi++) {
      const modeName = MODE_TEMPLATES[mi].name;

      it(`${root.name} ${modeName}: eDeg0=3 gDeg0=5 dDeg0=2 aDeg0=6`, () => {
        expect(firstDegOfString(root.name, mi, 0)).toBe(EXPECTED.e); // 1E
        expect(firstDegOfString(root.name, mi, 2)).toBe(EXPECTED.g); // G
        expect(firstDegOfString(root.name, mi, 3)).toBe(EXPECTED.d); // D
        expect(firstDegOfString(root.name, mi, 4)).toBe(EXPECTED.a); // A
      });
    }
  }
});

/* ── position structure ─────────────────────────────────── */

describe('position structure: all keys × modes', () => {
  for (const root of ROOTS) {
    for (let mi = 0; mi < MODE_TEMPLATES.length; mi++) {
      const modeName = MODE_TEMPLATES[mi].name;

      it(`${root.name} ${modeName}: 7 positions, valid note counts`, () => {
        const { positions } = positionsFor(root.name, mi);
        expect(positions).toHaveLength(7);

        for (const pos of positions) {
          expect(pos.instances.length).toBeGreaterThanOrEqual(1);

          for (const inst of pos.instances) {
            expect(inst.strings).toHaveLength(6);
            // B string (index 1): 2 notes
            expect(inst.strings[1]).toHaveLength(2);
            // Other strings: 3 notes each
            for (const sIdx of [0, 2, 3, 4, 5]) {
              expect(inst.strings[sIdx]).toHaveLength(3);
            }
            // 6E = 1E
            expect(inst.strings[5]).toEqual(inst.strings[0]);
          }
        }
      });
    }
  }
});

/* ── B-string pair degrees ──────────────────────────────── */

describe('B-string pair degrees', () => {
  it('C Ionian: Pos N has B-pair starting at degree N (1-indexed, wrapping)', () => {
    const { positions } = positionsFor('C', 0);
    // Pos 1: deg 1,2 → D,E; Pos 2: deg 2,3 → E,F; ... Pos 7: deg 0,1 → C,D
    const expectedPairs = [
      ['D', 'E'], ['E', 'F'], ['F', 'G'], ['G', 'A'],
      ['A', 'B'], ['B', 'C'], ['C', 'D'],
    ];
    for (let i = 0; i < 7; i++) {
      const inst = positions[i].instances[0];
      const bNotes = inst.strings[1]!;
      expect([bNotes[0][0], bNotes[1][0]]).toEqual(expectedPairs[i]);
    }
  });
});
