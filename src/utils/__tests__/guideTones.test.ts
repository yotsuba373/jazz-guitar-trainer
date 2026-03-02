import { describe, it, expect } from 'vitest';
import { getGuideTones, findNoteLocations, classifyResolution } from '../guideTones';
import { resolveMode } from '../noteSpelling';
import { buildFretMap } from '../fretboard';
import { MODE_TEMPLATES } from '../../constants';

/* ── getGuideTones ─────────────────────────────────────── */

describe('getGuideTones', () => {
  it('C Ionian → 3rd=E, 7th=B', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]); // Ionian
    const gt = getGuideTones(mode);
    expect(gt.third).toBe('E');
    expect(gt.seventh).toBe('B');
  });

  it('D Dorian → 3rd=F, 7th=C', () => {
    const mode = resolveMode('D', MODE_TEMPLATES[1]); // Dorian
    const gt = getGuideTones(mode);
    expect(gt.third).toBe('F');
    expect(gt.seventh).toBe('C');
  });

  it('G Mixolydian → 3rd=B, 7th=F', () => {
    const mode = resolveMode('G', MODE_TEMPLATES[4]); // Mixolydian
    const gt = getGuideTones(mode);
    expect(gt.third).toBe('B');
    expect(gt.seventh).toBe('F');
  });

  it('E Phrygian → 3rd=G, 7th=D', () => {
    const mode = resolveMode('E', MODE_TEMPLATES[2]); // Phrygian
    const gt = getGuideTones(mode);
    expect(gt.third).toBe('G');
    expect(gt.seventh).toBe('D');
  });

  it('B Locrian → 3rd=D, 7th=A', () => {
    const mode = resolveMode('B', MODE_TEMPLATES[6]); // Locrian
    const gt = getGuideTones(mode);
    expect(gt.third).toBe('D');
    expect(gt.seventh).toBe('A');
  });

  it('A♭ Lydian → 3rd=C, 7th=G', () => {
    const mode = resolveMode('A♭', MODE_TEMPLATES[3]); // Lydian
    const gt = getGuideTones(mode);
    expect(gt.third).toBe('C');
    expect(gt.seventh).toBe('G');
  });
});

/* ── classifyResolution ────────────────────────────────── */

describe('classifyResolution', () => {
  it('Dm7→G7: 7th=C(0) → 3rd=B(11) = half-step-down', () => {
    // C=0, B=11 → diff=(11-0+12)%12=11
    expect(classifyResolution(0, 11)).toBe('half-step-down');
  });

  it('G7→CM7: 7th=F(5) → 3rd=E(4) = half-step-down', () => {
    // F=5, E=4 → diff=(4-5+12)%12=11
    expect(classifyResolution(5, 4)).toBe('half-step-down');
  });

  it('half-step-up: diff=1', () => {
    // E.g., semi 4 → 5
    expect(classifyResolution(4, 5)).toBe('half-step-up');
  });

  it('common-tone: same pitch', () => {
    expect(classifyResolution(7, 7)).toBe('common-tone');
  });

  it('common-tone: wrapping (0, 12→0)', () => {
    expect(classifyResolution(0, 0)).toBe('common-tone');
  });

  it('other: whole step down (diff=10)', () => {
    expect(classifyResolution(5, 3)).toBe('other');
  });

  it('other: tritone (diff=6)', () => {
    expect(classifyResolution(0, 6)).toBe('other');
  });
});

/* ── findNoteLocations ─────────────────────────────────── */

describe('findNoteLocations', () => {
  it('finds C on C Ionian fretMap', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]);
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const locs = findNoteLocations('C', fretMap);
    expect(locs.length).toBeGreaterThan(0);
    // C should appear on multiple strings
    const strings = new Set(locs.map(l => l.stringIdx));
    expect(strings.size).toBeGreaterThanOrEqual(4);
  });

  it('returns empty for non-scale note without semitone fallback', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]); // C Ionian = no sharps/flats
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const locs = findNoteLocations('C#', fretMap);
    expect(locs.length).toBe(0);
  });

  it('uses semitone fallback for non-scale note', () => {
    const mode = resolveMode('C', MODE_TEMPLATES[0]);
    const fretMap = buildFretMap(mode.semi, mode.notes);
    // C# = semitone 1
    const locs = findNoteLocations('C#', fretMap, 1);
    expect(locs.length).toBeGreaterThan(0);
  });

  it('all locations have valid fret numbers', () => {
    const mode = resolveMode('G', MODE_TEMPLATES[4]); // G Mixolydian
    const fretMap = buildFretMap(mode.semi, mode.notes);
    const locs = findNoteLocations('F', fretMap);
    for (const loc of locs) {
      expect(loc.fret).toBeGreaterThanOrEqual(0);
      expect(loc.fret).toBeLessThanOrEqual(22);
      expect(loc.stringIdx).toBeGreaterThanOrEqual(0);
      expect(loc.stringIdx).toBeLessThanOrEqual(5);
    }
  });
});

/* ── II-V-I voice leading integration ──────────────────── */

describe('II-V-I voice leading (Dm7 → G7 → CM7)', () => {
  const dm7 = resolveMode('D', MODE_TEMPLATES[1]);  // Dorian
  const g7  = resolveMode('G', MODE_TEMPLATES[4]);  // Mixolydian
  const cm7 = resolveMode('C', MODE_TEMPLATES[0]);  // Ionian

  const dm7GT = getGuideTones(dm7);
  const g7GT  = getGuideTones(g7);
  const cm7GT = getGuideTones(cm7);

  it('Dm7 guide tones: 3rd=F, 7th=C', () => {
    expect(dm7GT).toEqual({ third: 'F', seventh: 'C' });
  });

  it('G7 guide tones: 3rd=B, 7th=F', () => {
    expect(g7GT).toEqual({ third: 'B', seventh: 'F' });
  });

  it('CM7 guide tones: 3rd=E, 7th=B', () => {
    expect(cm7GT).toEqual({ third: 'E', seventh: 'B' });
  });

  it('Dm7→G7: 7th(C) → 3rd(B) = half-step-down', () => {
    const prevSevSemi = dm7.semi[dm7.notes.indexOf(dm7GT.seventh)];
    const curThirdSemi = g7.semi[g7.notes.indexOf(g7GT.third)];
    expect(classifyResolution(prevSevSemi, curThirdSemi)).toBe('half-step-down');
  });

  it('G7→CM7: 7th(F) → 3rd(E) = half-step-down', () => {
    const prevSevSemi = g7.semi[g7.notes.indexOf(g7GT.seventh)];
    const curThirdSemi = cm7.semi[cm7.notes.indexOf(cm7GT.third)];
    expect(classifyResolution(prevSevSemi, curThirdSemi)).toBe('half-step-down');
  });
});
