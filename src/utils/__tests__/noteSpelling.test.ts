import { describe, it, expect } from 'vitest';
import { spellScale, buildDegreeMap, resolveMode } from '../noteSpelling';
import { MODE_TEMPLATES, ROOTS } from '../../constants';

/* ── spellScale ─────────────────────────────────────────── */

describe('spellScale', () => {
  const IONIAN = [0, 2, 4, 5, 7, 9, 11];

  it('C Ionian → C D E F G A B', () => {
    expect(spellScale('C', IONIAN)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });

  it('D♭ Ionian → D♭ E♭ F G♭ A♭ B♭ C', () => {
    expect(spellScale('D♭', IONIAN)).toEqual(['D♭', 'E♭', 'F', 'G♭', 'A♭', 'B♭', 'C']);
  });

  it('G Ionian → G A B C D E F#', () => {
    expect(spellScale('G', IONIAN)).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F#']);
  });

  it('every scale has 7 unique letter names (A-G)', () => {
    for (const root of ROOTS) {
      for (const tmpl of MODE_TEMPLATES) {
        const notes = spellScale(root.name, tmpl.semi);
        const letters = notes.map(n => n[0]);
        expect(new Set(letters).size).toBe(7);
      }
    }
  });
});

/* ── buildDegreeMap ─────────────────────────────────────── */

describe('buildDegreeMap', () => {
  it('Ionian degrees are all natural (1-7)', () => {
    const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const map = buildDegreeMap([0, 2, 4, 5, 7, 9, 11], notes);
    expect(map).toEqual({ C: '1', D: '2', E: '3', F: '4', G: '5', A: '6', B: '7' });
  });

  it('Dorian has ♭3 and ♭7', () => {
    const notes = ['D', 'E', 'F', 'G', 'A', 'B', 'C'];
    const map = buildDegreeMap([0, 2, 3, 5, 7, 9, 10], notes);
    expect(map['F']).toBe('♭3');
    expect(map['C']).toBe('♭7');
  });
});

/* ── resolveMode ────────────────────────────────────────── */

describe('resolveMode', () => {
  it('C Ionian chord = CM7, tones = C E G B', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]);
    expect(mode.chord).toBe('CM7');
    expect(mode.chordTones).toEqual(['C', 'E', 'G', 'B']);
  });

  it('D Dorian chord = Dm7, tones = D F A C', () => {
    const mode = resolveMode('D', MODE_TEMPLATES[1]);
    expect(mode.chord).toBe('Dm7');
    expect(mode.chordTones).toEqual(['D', 'F', 'A', 'C']);
  });

  it('B♭ Mixolydian notes are correctly spelled', () => {
    const mode = resolveMode('B♭', MODE_TEMPLATES[4]);
    expect(mode.notes[0]).toBe('B♭');
    // Mixolydian has ♭7
    expect(mode.degrees[mode.notes[6]]).toBe('♭7');
  });
});
