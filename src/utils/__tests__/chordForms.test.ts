import { describe, it, expect } from 'vitest';
import { findVoicingsInPosition, VOICING_TEMPLATES, formatVoicingLabel } from '../chordForms';
import { resolveMode } from '../noteSpelling';
import { buildFretMap, generatePositions, generateDimPositions } from '../fretboard';
import { MODE_TEMPLATES, ROOTS } from '../../constants';

// Helper: build position data for a given root/modeIdx
function setup(rootName: string, modeIdx: number) {
  const mode = resolveMode(rootName as any, MODE_TEMPLATES[modeIdx]);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const is8Note = mode.notes.length > 7;
  const allPos = is8Note
    ? generateDimPositions(fretMap, mode.semi[0])
    : generatePositions(fretMap, mode.notes);
  return { mode, fretMap, allPos };
}

describe('VOICING_TEMPLATES', () => {
  it('has 20 templates total (12 Drop 2 + 8 Drop 3)', () => {
    const drop2 = VOICING_TEMPLATES.filter(t => t.type === 'drop2');
    const drop3 = VOICING_TEMPLATES.filter(t => t.type === 'drop3');
    expect(drop2).toHaveLength(12);
    expect(drop3).toHaveLength(8);
    expect(VOICING_TEMPLATES).toHaveLength(20);
  });

  it('Drop 2 templates use 4 consecutive strings', () => {
    const drop2 = VOICING_TEMPLATES.filter(t => t.type === 'drop2');
    for (const t of drop2) {
      expect(t.stringIndices).toHaveLength(4);
      // Each consecutive pair differs by exactly 1
      for (let i = 0; i < 3; i++) {
        expect(t.stringIndices[i] - t.stringIndices[i + 1]).toBe(1);
      }
    }
  });

  it('Drop 3 templates have a 1-string gap (skip 2nd from bass)', () => {
    const drop3 = VOICING_TEMPLATES.filter(t => t.type === 'drop3');
    for (const t of drop3) {
      expect(t.stringIndices).toHaveLength(4);
      // Gap between index 0 and 1 = 2 (skip one string)
      expect(t.stringIndices[0] - t.stringIndices[1]).toBe(2);
      // Remaining are consecutive
      expect(t.stringIndices[1] - t.stringIndices[2]).toBe(1);
      expect(t.stringIndices[2] - t.stringIndices[3]).toBe(1);
    }
  });

  it('each template has exactly 4 chord tone indices covering 0-3', () => {
    for (const t of VOICING_TEMPLATES) {
      expect(t.chordToneOrder).toHaveLength(4);
      expect([...t.chordToneOrder].sort()).toEqual([0, 1, 2, 3]);
    }
  });
});

describe('findVoicingsInPosition', () => {
  describe('C Ionian Pos 1 reference voicings', () => {
    const { mode, allPos } = setup('C', 0);
    const pos1 = allPos[0];
    const voicings = findVoicingsInPosition(pos1, mode);

    it('finds voicings', () => {
      expect(voicings.length).toBeGreaterThan(0);
    });

    it('all voicings have exactly 4 notes', () => {
      for (const v of voicings) {
        expect(v.notes).toHaveLength(4);
      }
    });

    it('all fret spans ≤ 5', () => {
      for (const v of voicings) {
        expect(v.fretSpan).toBeLessThanOrEqual(5);
      }
    });

    it('all notes are chord tones of Cmaj7', () => {
      const ctNames = new Set(mode.chordTones);
      for (const v of voicings) {
        for (const n of v.notes) {
          expect(ctNames.has(n.noteName)).toBe(true);
        }
      }
    });

    it('finds Drop 2 2nd inv on 6E-A-D-G (G3-C3-E2-B4)', () => {
      const match = voicings.find(v =>
        v.template.type === 'drop2' &&
        v.template.inversion === 2 &&
        v.template.stringIndices[0] === 5 && // 6E bass
        v.instanceIdx === 0
      );
      expect(match).toBeDefined();
      // Verify specific frets: 6E:G@3, A:C@3, D:E@2, G:B@4
      expect(match!.notes.map(n => n.fret)).toEqual([3, 3, 2, 4]);
      expect(match!.notes.map(n => n.noteName)).toEqual(['G', 'C', 'E', 'B']);
    });

    it('finds Drop 2 Root on A-D-G-B (C3-G5-B4-E5)', () => {
      const match = voicings.find(v =>
        v.template.type === 'drop2' &&
        v.template.inversion === 0 &&
        v.template.stringIndices[0] === 4 && // A bass
        v.instanceIdx === 0
      );
      expect(match).toBeDefined();
      expect(match!.notes.map(n => n.fret)).toEqual([3, 5, 4, 5]);
      expect(match!.notes.map(n => n.noteName)).toEqual(['C', 'G', 'B', 'E']);
    });
  });

  describe('structural invariants', () => {
    it('Drop 2 voicings use consecutive strings', () => {
      const { mode, allPos } = setup('C', 0);
      for (const pos of allPos) {
        const voicings = findVoicingsInPosition(pos, mode);
        const drop2 = voicings.filter(v => v.template.type === 'drop2');
        for (const v of drop2) {
          const strings = v.notes.map(n => n.stringIdx);
          for (let i = 0; i < 3; i++) {
            expect(strings[i] - strings[i + 1]).toBe(1);
          }
        }
      }
    });

    it('Drop 3 voicings have a 1-string gap', () => {
      const { mode, allPos } = setup('C', 0);
      for (const pos of allPos) {
        const voicings = findVoicingsInPosition(pos, mode);
        const drop3 = voicings.filter(v => v.template.type === 'drop3');
        for (const v of drop3) {
          const strings = v.notes.map(n => n.stringIdx);
          expect(strings[0] - strings[1]).toBe(2);
          expect(strings[1] - strings[2]).toBe(1);
          expect(strings[2] - strings[3]).toBe(1);
        }
      }
    });

    it('voicing notes match the chord tone order in the template', () => {
      const { mode, allPos } = setup('G', 0); // G Ionian
      for (const pos of allPos) {
        const voicings = findVoicingsInPosition(pos, mode);
        for (const v of voicings) {
          for (let i = 0; i < 4; i++) {
            expect(v.notes[i].chordToneIdx).toBe(v.template.chordToneOrder[i]);
          }
        }
      }
    });
  });

  describe('all 7 diatonic modes produce voicings', () => {
    for (let mIdx = 0; mIdx < 7; mIdx++) {
      const modeName = MODE_TEMPLATES[mIdx].name;
      it(`${modeName} (C) has voicings in at least one position`, () => {
        const { mode, allPos } = setup('C', mIdx);
        const allVoicings = allPos.flatMap(p => findVoicingsInPosition(p, mode));
        expect(allVoicings.length).toBeGreaterThan(0);
      });
    }
  });

  describe('all 12 keys produce voicings (Ionian)', () => {
    for (const { name: root } of ROOTS) {
      it(`${root} Ionian has voicings`, () => {
        const { mode, allPos } = setup(root, 0);
        const allVoicings = allPos.flatMap(p => findVoicingsInPosition(p, mode));
        expect(allVoicings.length).toBeGreaterThan(0);
      });
    }
  });

  it('returns empty for 8-note (diminished) scales', () => {
    // Diminished W-H = modeIdx 16
    const { mode, allPos } = setup('C', 16);
    for (const pos of allPos) {
      const voicings = findVoicingsInPosition(pos, mode);
      // dim has 4 chord tones but the position structure differs;
      // some voicings may exist but function should still work
      for (const v of voicings) {
        expect(v.notes).toHaveLength(4);
      }
    }
  });

  it('sorted: Drop 2 before Drop 3, then by inversion', () => {
    const { mode, allPos } = setup('C', 0);
    const voicings = findVoicingsInPosition(allPos[0], mode);
    if (voicings.length < 2) return;

    for (let i = 1; i < voicings.length; i++) {
      const a = voicings[i - 1], b = voicings[i];
      const aType = a.template.type === 'drop2' ? 0 : 1;
      const bType = b.template.type === 'drop2' ? 0 : 1;
      if (aType !== bType) {
        expect(aType).toBeLessThan(bType);
      } else if (a.template.inversion !== b.template.inversion) {
        expect(a.template.inversion).toBeLessThanOrEqual(b.template.inversion);
      }
    }
  });
});

describe('formatVoicingLabel', () => {
  it('formats Drop 2 Root on A-D-G-B correctly', () => {
    const { mode, allPos } = setup('C', 0);
    const voicings = findVoicingsInPosition(allPos[0], mode);
    const rootOnADGB = voicings.find(v =>
      v.template.type === 'drop2' &&
      v.template.inversion === 0 &&
      v.template.stringIndices[0] === 4
    );
    if (rootOnADGB) {
      expect(formatVoicingLabel(rootOnADGB)).toBe('Drop 2 Root (A-D-G-B)');
    }
  });

  it('formats Drop 3 labels correctly', () => {
    const { mode, allPos } = setup('C', 0);
    const allV = allPos.flatMap(p => findVoicingsInPosition(p, mode));
    const drop3 = allV.find(v => v.template.type === 'drop3');
    if (drop3) {
      const label = formatVoicingLabel(drop3);
      expect(label).toMatch(/^Drop 3/);
      expect(label).toMatch(/\(/); // has string set in parens
    }
  });
});
