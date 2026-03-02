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

  it('every 7-note scale has 7 unique letter names (A-G)', () => {
    for (const root of ROOTS) {
      for (const tmpl of MODE_TEMPLATES.filter(t => t.semi.length === 7)) {
        const notes = spellScale(root.name, tmpl.semi);
        const letters = notes.map(n => n[0]);
        expect(new Set(letters).size).toBe(7);
      }
    }
  });

  // 8-note diminished scales
  it('C Diminished W-H → 8 notes, no double accidentals', () => {
    const notes = spellScale('C', [0,2,3,5,6,8,9,11]);
    expect(notes.length).toBe(8);
    // No double accidentals (## or ♭♭)
    for (const n of notes) {
      expect(n).not.toMatch(/##|♭♭/);
    }
  });

  it('C Diminished H-W → 8 notes, no double accidentals', () => {
    const notes = spellScale('C', [0,1,3,4,6,7,9,10]);
    expect(notes.length).toBe(8);
    for (const n of notes) {
      expect(n).not.toMatch(/##|♭♭/);
    }
  });

  it('8-note scales have exactly one repeated letter', () => {
    for (const root of ROOTS) {
      for (const tmpl of MODE_TEMPLATES.filter(t => t.semi.length === 8)) {
        const notes = spellScale(root.name, tmpl.semi);
        expect(notes.length).toBe(8);
        const letters = notes.map(n => n[0]);
        // 7 unique letters from 8 notes → exactly one repeated
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

  // New modes: melodic minor family + Phrygian Dominant
  it('C Melodic Minor chord = CmMaj7, tones = C E♭ G B', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[7]);
    expect(mode.chord).toBe('CmMaj7');
    expect(mode.chordTones).toEqual(['C', 'E♭', 'G', 'B']);
    expect(mode.degrees['E♭']).toBe('♭3');
    expect(mode.degrees['B']).toBe('7');
  });

  it('C Altered chord tones = C F♭ G♭ B♭ (1 3 ♭5 ♭7 via [0,3,4,6])', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[13]);
    // Altered scale: C D♭ E♭ F♭ G♭ A♭ B♭
    expect(mode.notes[0]).toBe('C');
    // chordDegreesIdx [0,3,4,6] → root, natural 3 (Fb=E enharmonic), ♭5 (Gb), ♭7 (Bb)
    expect(mode.chordTones).toEqual(['C', 'F♭', 'G♭', 'B♭']);
  });

  it('C Phrygian Dominant: 1 ♭2 3 4 5 ♭6 ♭7', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[15]);
    expect(mode.notes).toEqual(['C', 'D♭', 'E', 'F', 'G', 'A♭', 'B♭']);
    expect(mode.degrees['D♭']).toBe('♭2');
    expect(mode.degrees['E']).toBe('3');
    expect(mode.degrees['A♭']).toBe('♭6');
    expect(mode.degrees['B♭']).toBe('♭7');
  });

  it('C Harmonic Minor: 1 2 ♭3 4 5 ♭6 7', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[14]);
    expect(mode.notes).toEqual(['C', 'D', 'E♭', 'F', 'G', 'A♭', 'B']);
    expect(mode.chord).toBe('CmMaj7');
    expect(mode.chordTones).toEqual(['C', 'E♭', 'G', 'B']);
    expect(mode.degrees['A♭']).toBe('♭6');
    expect(mode.degrees['B']).toBe('7');
  });

  it('C Lydian Augmented: 1 2 3 #4 #5 6 7', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[9]);
    expect(mode.notes).toEqual(['C', 'D', 'E', 'F#', 'G#', 'A', 'B']);
    expect(mode.degrees['F#']).toBe('#4');
    expect(mode.degrees['G#']).toBe('#5');
  });

  // Diminished scales (8-note, customDegrees)
  it('C Diminished W-H: 8 notes with customDegrees', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[16]);
    expect(mode.notes.length).toBe(8);
    expect(mode.chordQuality).toBe('dim');
    // customDegrees: ['1','2','♭3','4','♭5','♭6','6','7']
    expect(mode.degrees[mode.notes[0]]).toBe('1');
    expect(mode.degrees[mode.notes[2]]).toBe('♭3');
    expect(mode.degrees[mode.notes[4]]).toBe('♭5');
    expect(mode.degrees[mode.notes[7]]).toBe('7');
    // 4 chord tones
    expect(mode.chordTones.length).toBe(4);
  });

  it('C Diminished H-W: 8 notes with customDegrees', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[17]);
    expect(mode.notes.length).toBe(8);
    expect(mode.chordQuality).toBe('7');
    // customDegrees: ['1','♭2','♭3','3','♭5','5','6','♭7']
    expect(mode.degrees[mode.notes[0]]).toBe('1');
    expect(mode.degrees[mode.notes[1]]).toBe('♭2');
    expect(mode.degrees[mode.notes[3]]).toBe('3');
    expect(mode.degrees[mode.notes[7]]).toBe('♭7');
    expect(mode.chordTones.length).toBe(4);
  });
});
