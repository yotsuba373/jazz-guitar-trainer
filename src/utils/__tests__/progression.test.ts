import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseChordSymbol,
  normalizeChordSymbol,
  suggestMode,
  isDiatonic,
  chordRomanNumeral,
  computeEffectiveSelections,
  QUALITY_TO_MODES,
  rankPositionsByProximity,
  buildChordSlot,
  saveProgressions,
  loadProgressions,
  PRESET_PROGRESSIONS,
} from '../progression';
import { buildFretMap, generatePositions } from '../fretboard';
import { resolveMode } from '../noteSpelling';
import { MODE_TEMPLATES } from '../../constants';
import type { Position } from '../../types';

/* ── parseChordSymbol ──────────────────────────────────── */

describe('parseChordSymbol — base qualities', () => {
  it('Dm7 → D, m7', () => {
    expect(parseChordSymbol('Dm7')).toEqual({ rootName: 'D', quality: 'm7', suffix: 'm7' });
  });

  it('G7 → G, 7', () => {
    expect(parseChordSymbol('G7')).toEqual({ rootName: 'G', quality: '7', suffix: '7' });
  });

  it('Cmaj7 → C, maj7', () => {
    expect(parseChordSymbol('Cmaj7')).toEqual({ rootName: 'C', quality: 'maj7', suffix: 'maj7' });
  });

  it('B♭maj7 → B♭, maj7', () => {
    expect(parseChordSymbol('B♭maj7')).toEqual({ rootName: 'B♭', quality: 'maj7', suffix: 'maj7' });
  });

  it('Bbmaj7 (ASCII flat) → B♭, maj7', () => {
    expect(parseChordSymbol('Bbmaj7')).toEqual({ rootName: 'B♭', quality: 'maj7', suffix: 'maj7' });
  });

  it('F#m7b5 → G♭, m7♭5', () => {
    expect(parseChordSymbol('F#m7b5')).toEqual({ rootName: 'G♭', quality: 'm7♭5', suffix: 'm7b5' });
  });

  it('E♭m7 → E♭, m7', () => {
    expect(parseChordSymbol('E♭m7')).toEqual({ rootName: 'E♭', quality: 'm7', suffix: 'm7' });
  });

  it('returns null for empty string', () => {
    expect(parseChordSymbol('')).toBeNull();
  });

  it('bare root → maj7 (major triad)', () => {
    expect(parseChordSymbol('C')).toEqual({ rootName: 'C', quality: 'maj7', suffix: '' });
  });

  it('bare root with flat → maj7', () => {
    expect(parseChordSymbol('Bb')).toEqual({ rootName: 'B♭', quality: 'maj7', suffix: '' });
  });

  it('trims whitespace', () => {
    expect(parseChordSymbol('  Am7  ')).toEqual({ rootName: 'A', quality: 'm7', suffix: 'm7' });
  });

  it('CM7 → C, maj7 (M7 alias)', () => {
    expect(parseChordSymbol('CM7')).toEqual({ rootName: 'C', quality: 'maj7', suffix: 'M7' });
  });

  it('BbM7 → B♭, maj7 (M7 alias with flat)', () => {
    expect(parseChordSymbol('BbM7')).toEqual({ rootName: 'B♭', quality: 'maj7', suffix: 'M7' });
  });
});

describe('parseChordSymbol — extended chords', () => {
  // Major family → quality: 'maj7'
  it('C6 → maj7', () => {
    const r = parseChordSymbol('C6');
    expect(r).toMatchObject({ rootName: 'C', quality: 'maj7', suffix: '6' });
  });
  it('C69 → maj7', () => {
    expect(parseChordSymbol('C69')).toMatchObject({ quality: 'maj7', suffix: '69' });
  });
  it('Cmaj9 → maj7', () => {
    expect(parseChordSymbol('Cmaj9')).toMatchObject({ quality: 'maj7', suffix: 'maj9' });
  });
  it('Cmaj7#11 → maj7', () => {
    expect(parseChordSymbol('Cmaj7#11')).toMatchObject({ quality: 'maj7', suffix: 'maj7#11' });
  });
  it('CM9 → maj7', () => {
    expect(parseChordSymbol('CM9')).toMatchObject({ quality: 'maj7', suffix: 'M9' });
  });

  // Minor family → quality: 'm7'
  it('Cm → m7', () => {
    expect(parseChordSymbol('Cm')).toMatchObject({ rootName: 'C', quality: 'm7', suffix: 'm' });
  });
  it('Cm6 → m7', () => {
    expect(parseChordSymbol('Cm6')).toMatchObject({ quality: 'm7', suffix: 'm6' });
  });
  it('Cm9 → m7', () => {
    expect(parseChordSymbol('Cm9')).toMatchObject({ quality: 'm7', suffix: 'm9' });
  });
  it('Cm11 → m7', () => {
    expect(parseChordSymbol('Cm11')).toMatchObject({ quality: 'm7', suffix: 'm11' });
  });
  it('Cm/maj7 → m7', () => {
    expect(parseChordSymbol('Cm/maj7')).toMatchObject({ quality: 'm7', suffix: 'm/maj7' });
  });
  it('Cm69 → m7', () => {
    expect(parseChordSymbol('Cm69')).toMatchObject({ quality: 'm7', suffix: 'm69' });
  });

  // Dominant family → quality: '7'
  it('C7b9 → 7', () => {
    expect(parseChordSymbol('C7b9')).toMatchObject({ quality: '7', suffix: '7b9' });
  });
  it('C7#9 → 7', () => {
    expect(parseChordSymbol('C7#9')).toMatchObject({ quality: '7', suffix: '7#9' });
  });
  it('C7#11 → 7', () => {
    expect(parseChordSymbol('C7#11')).toMatchObject({ quality: '7', suffix: '7#11' });
  });
  it('C7b13 → 7', () => {
    expect(parseChordSymbol('C7b13')).toMatchObject({ quality: '7', suffix: '7b13' });
  });
  it('C7alt → 7', () => {
    expect(parseChordSymbol('C7alt')).toMatchObject({ quality: '7', suffix: '7alt' });
  });
  it('C7sus → 7', () => {
    expect(parseChordSymbol('C7sus')).toMatchObject({ quality: '7', suffix: '7sus' });
  });
  it('C7#5 → 7', () => {
    expect(parseChordSymbol('C7#5')).toMatchObject({ quality: '7', suffix: '7#5' });
  });
  it('C7b5 → 7', () => {
    expect(parseChordSymbol('C7b5')).toMatchObject({ quality: '7', suffix: '7b5' });
  });
  it('C9 → 7', () => {
    expect(parseChordSymbol('C9')).toMatchObject({ quality: '7', suffix: '9' });
  });
  it('C13 → 7', () => {
    expect(parseChordSymbol('C13')).toMatchObject({ quality: '7', suffix: '13' });
  });
  it('C9sus → 7', () => {
    expect(parseChordSymbol('C9sus')).toMatchObject({ quality: '7', suffix: '9sus' });
  });
  it('C13sus → 7', () => {
    expect(parseChordSymbol('C13sus')).toMatchObject({ quality: '7', suffix: '13sus' });
  });

  // Diminished → quality: 'dim' (Skip, not mapped to m7♭5)
  it('Cdim → dim', () => {
    expect(parseChordSymbol('Cdim')).toMatchObject({ quality: 'dim', suffix: 'dim' });
  });
  it('Cdim7 → dim', () => {
    expect(parseChordSymbol('Cdim7')).toMatchObject({ quality: 'dim', suffix: 'dim7' });
  });
  it('C07 → dim', () => {
    expect(parseChordSymbol('C07')).toMatchObject({ quality: 'dim', suffix: '07' });
  });

  // Half-diminished
  it('Cø7 → m7♭5', () => {
    expect(parseChordSymbol('Cø7')).toMatchObject({ quality: 'm7♭5', suffix: 'ø7' });
  });
  it('Cø → m7♭5', () => {
    expect(parseChordSymbol('Cø')).toMatchObject({ quality: 'm7♭5', suffix: 'ø' });
  });

  // Slash chords — strip bass note
  it('Fm7/Bb → root=F, quality=m7', () => {
    expect(parseChordSymbol('Fm7/Bb')).toMatchObject({ rootName: 'F', quality: 'm7', suffix: 'm7' });
  });
  it('Cmaj7/E → root=C, quality=maj7', () => {
    expect(parseChordSymbol('Cmaj7/E')).toMatchObject({ rootName: 'C', quality: 'maj7', suffix: 'maj7' });
  });
  it('Dm7b5/G → root=D, quality=m7♭5', () => {
    expect(parseChordSymbol('Dm7b5/G')).toMatchObject({ rootName: 'D', quality: 'm7♭5' });
  });

  // Augmented → dominant family
  it('Caug → 7', () => {
    expect(parseChordSymbol('Caug')).toMatchObject({ quality: '7', suffix: 'aug' });
  });
  it('Caug7 → 7', () => {
    expect(parseChordSymbol('Caug7')).toMatchObject({ quality: '7', suffix: 'aug7' });
  });
  it('C+7 → 7', () => {
    expect(parseChordSymbol('C+7')).toMatchObject({ quality: '7', suffix: '+7' });
  });
  it('C+ → 7', () => {
    expect(parseChordSymbol('C+')).toMatchObject({ quality: '7', suffix: '+' });
  });

  // Sus → dominant family
  it('Csus4 → 7', () => {
    expect(parseChordSymbol('Csus4')).toMatchObject({ quality: '7', suffix: 'sus4' });
  });
  it('Csus2 → 7', () => {
    expect(parseChordSymbol('Csus2')).toMatchObject({ quality: '7', suffix: 'sus2' });
  });
  it('Csus → 7', () => {
    expect(parseChordSymbol('Csus')).toMatchObject({ quality: '7', suffix: 'sus' });
  });

  // Add → major family
  it('Cadd9 → maj7', () => {
    expect(parseChordSymbol('Cadd9')).toMatchObject({ quality: 'maj7', suffix: 'add9' });
  });

  // Bare dash → minor family
  it('C- → m7', () => {
    expect(parseChordSymbol('C-')).toMatchObject({ quality: 'm7', suffix: '-' });
  });

  // Slash chord with bare triad
  it('C/E → maj7 (bare triad with slash bass)', () => {
    expect(parseChordSymbol('C/E')).toMatchObject({ rootName: 'C', quality: 'maj7', suffix: '' });
  });
});

/* ── QUALITY_TO_MODES ──────────────────────────────────── */

describe('QUALITY_TO_MODES', () => {
  it('covers all 4 chord qualities from MODE_TEMPLATES', () => {
    const qualities = new Set(MODE_TEMPLATES.map(t => t.chordQuality));
    for (const q of qualities) {
      expect(QUALITY_TO_MODES[q]).toBeDefined();
      expect(QUALITY_TO_MODES[q].length).toBeGreaterThan(0);
    }
  });

  it('each mapped index has the correct chordQuality (except dim→Locrian approximation)', () => {
    for (const [quality, indices] of Object.entries(QUALITY_TO_MODES)) {
      for (const idx of indices) {
        if (quality === 'dim') {
          // dim maps to Locrian (m7♭5) as an approximation
          expect(MODE_TEMPLATES[idx].chordQuality).toBe('m7♭5');
        } else {
          expect(MODE_TEMPLATES[idx].chordQuality).toBe(quality);
        }
      }
    }
  });

  it('dim maps to Locrian (index 6)', () => {
    expect(QUALITY_TO_MODES['dim']).toEqual([6]);
  });
});

/* ── rankPositionsByProximity ──────────────────────────── */

function positionsForMode(rootName: Parameters<typeof resolveMode>[0], modeIdx: number): Position[] {
  const mode = resolveMode(rootName, MODE_TEMPLATES[modeIdx]);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  return generatePositions(fretMap, mode.notes);
}

describe('rankPositionsByProximity', () => {
  const cIonianPos = positionsForMode('C', 0);

  it('returns Pos 1 first when prevPos is null', () => {
    const ranked = rankPositionsByProximity(cIonianPos, null);
    expect(ranked[0]).toBe(1);
    expect(ranked.length).toBe(7);
  });

  it('returns up to count positions', () => {
    const ranked = rankPositionsByProximity(cIonianPos, null, 3);
    expect(ranked.length).toBe(3);
  });

  it('closest position first when prevPos is provided', () => {
    const pos1 = cIonianPos.find(p => p.id === 1)!;
    const ranked = rankPositionsByProximity(cIonianPos, pos1);
    expect(ranked[0]).toBe(1);
  });

  it('returns different rankings for different prevPos', () => {
    const pos1 = cIonianPos.find(p => p.id === 1)!;
    const pos5 = cIonianPos.find(p => p.id === 5)!;
    const r1 = rankPositionsByProximity(cIonianPos, pos1);
    const r5 = rankPositionsByProximity(cIonianPos, pos5);
    expect(r1).not.toEqual(r5);
  });

  it('cross-key: Dm7 Dorian Pos 2 → G7 Mixolydian ranks Pos 6 first', () => {
    // Dm7 Dorian Pos 2 has instances at frets ~5-9 and ~17-21
    const dDorianPos = positionsForMode('D', 1);
    const prevPos = dDorianPos.find(p => p.id === 2)!;
    // G7 Mixolydian positions — rank by proximity to Dm7 Pos 2
    const gMixoPos = positionsForMode('G', 4);
    const ranked = rankPositionsByProximity(gMixoPos, prevPos);
    // Pos 6 (fret 5-9, 17-21) overlaps exactly → should be first
    expect(ranked[0]).toBe(6);
  });
});

/* ── buildChordSlot ────────────────────────────────────── */

describe('buildChordSlot', () => {
  it('builds slot with first compatible mode and default posId', () => {
    const slot = buildChordSlot('Dm7', { rootName: 'D', quality: 'm7', suffix: 'm7' });
    expect(slot.symbol).toBe('Dm7');
    expect(slot.rootName).toBe('D');
    expect(slot.quality).toBe('m7');
    expect(slot.modeIdx).toBe(1); // Dorian (first m7 mode)
    expect(slot.posId).toBe(1);
    expect(slot.posConfirmed).toBe(false);
    expect(slot.modeConfirmed).toBe(false);
  });

  it('uses prevPosId when provided', () => {
    const slot = buildChordSlot('G7', { rootName: 'G', quality: '7', suffix: '7' }, 3);
    expect(slot.posId).toBe(3);
  });

  it('preserves suffix in symbol: Cmaj7 → Cmaj7', () => {
    const slot = buildChordSlot('Cmaj7', { rootName: 'C', quality: 'maj7', suffix: 'maj7' });
    expect(slot.symbol).toBe('Cmaj7');
  });

  it('preserves extended suffix: C7b9 → C7b9', () => {
    const slot = buildChordSlot('C7b9', { rootName: 'C', quality: '7', suffix: '7b9' });
    expect(slot.symbol).toBe('C7b9');
    expect(slot.quality).toBe('7');
  });

  it('uses suggestMode when songKey is provided', () => {
    const slot = buildChordSlot('Dm7', { rootName: 'D', quality: 'm7', suffix: 'm7' }, 1, { root: 'C', minor: false });
    expect(slot.modeIdx).toBe(1); // Dorian (II of C)
  });

  it('bare triad: C in key of C → maj7 (I)', () => {
    const slot = buildChordSlot('C', { rootName: 'C', quality: 'maj7', suffix: '' }, 1, { root: 'C', minor: false });
    expect(slot.quality).toBe('maj7');
    expect(slot.modeIdx).toBe(0); // Ionian
  });

  it('bare triad: G in key of C → 7 (V, dominant)', () => {
    const slot = buildChordSlot('G', { rootName: 'G', quality: 'maj7', suffix: '' }, 1, { root: 'C', minor: false });
    expect(slot.quality).toBe('7');
    expect(slot.modeIdx).toBe(4); // Mixolydian
  });

  it('bare triad: D in key of C → m7 (ii, minor)', () => {
    const slot = buildChordSlot('D', { rootName: 'D', quality: 'maj7', suffix: '' }, 1, { root: 'C', minor: false });
    expect(slot.quality).toBe('m7');
    expect(slot.modeIdx).toBe(1); // Dorian
  });

  it('bare triad: B in key of C → m7♭5 (vii)', () => {
    const slot = buildChordSlot('B', { rootName: 'B', quality: 'maj7', suffix: '' }, 1, { root: 'C', minor: false });
    expect(slot.quality).toBe('m7♭5');
    expect(slot.modeIdx).toBe(6); // Locrian
  });

  it('bare triad: non-diatonic without key → defaults to maj7', () => {
    const slot = buildChordSlot('C', { rootName: 'C', quality: 'maj7', suffix: '' });
    expect(slot.quality).toBe('maj7');
  });

  it('bare triad: F in key of C → maj7 (IV)', () => {
    const slot = buildChordSlot('F', { rootName: 'F', quality: 'maj7', suffix: '' }, 1, { root: 'C', minor: false });
    expect(slot.quality).toBe('maj7');
    expect(slot.modeIdx).toBe(3); // Lydian
  });
});

/* ── normalizeChordSymbol ──────────────────────────────── */

describe('normalizeChordSymbol', () => {
  it('preserves suffix: maj7', () => {
    expect(normalizeChordSymbol('Cmaj7', { rootName: 'C', quality: 'maj7', suffix: 'maj7' })).toBe('Cmaj7');
  });

  it('preserves suffix: m7', () => {
    expect(normalizeChordSymbol('Dm7', { rootName: 'D', quality: 'm7', suffix: 'm7' })).toBe('Dm7');
  });

  it('normalizes root: Db → D♭, preserves suffix', () => {
    expect(normalizeChordSymbol('Dbmaj7', { rootName: 'D♭', quality: 'maj7', suffix: 'maj7' })).toBe('D♭maj7');
  });

  it('preserves suffix: 7', () => {
    expect(normalizeChordSymbol('G7', { rootName: 'G', quality: '7', suffix: '7' })).toBe('G7');
  });

  it('preserves extended suffix: 7b9', () => {
    expect(normalizeChordSymbol('C7b9', { rootName: 'C', quality: '7', suffix: '7b9' })).toBe('C7b9');
  });

  it('preserves extended suffix: dim7', () => {
    expect(normalizeChordSymbol('Cdim7', { rootName: 'C', quality: 'dim', suffix: 'dim7' })).toBe('Cdim7');
  });

  it('normalizes root with extended suffix: Bb7#9 → B♭7#9', () => {
    expect(normalizeChordSymbol('Bb7#9', { rootName: 'B♭', quality: '7', suffix: '7#9' })).toBe('B♭7#9');
  });
});

/* ── suggestMode ──────────────────────────────────────── */

describe('suggestMode', () => {
  it('Dm7 in key of C → Dorian (1)', () => {
    expect(suggestMode('D', 'm7', { root: 'C', minor: false })).toBe(1);
  });

  it('G7 in key of C → Mixolydian (4)', () => {
    expect(suggestMode('G', '7', { root: 'C', minor: false })).toBe(4);
  });

  it('Em7 in key of C → Phrygian (2)', () => {
    expect(suggestMode('E', 'm7', { root: 'C', minor: false })).toBe(2);
  });

  it('Am7 in key of C → Aeolian (5)', () => {
    expect(suggestMode('A', 'm7', { root: 'C', minor: false })).toBe(5);
  });

  it('Bm7♭5 in key of C → Locrian (6)', () => {
    expect(suggestMode('B', 'm7♭5', { root: 'C', minor: false })).toBe(6);
  });

  it('CM7 in key of C → Ionian (0)', () => {
    expect(suggestMode('C', 'maj7', { root: 'C', minor: false })).toBe(0);
  });

  it('FM7 in key of C → Lydian (3)', () => {
    expect(suggestMode('F', 'maj7', { root: 'C', minor: false })).toBe(3);
  });

  it('non-diatonic: B♭7 in key of C → fallback Mixolydian (4)', () => {
    expect(suggestMode('B♭', '7', { root: 'C', minor: false })).toBe(4);
  });

  it('no songKey → fallback to QUALITY_TO_MODES first', () => {
    expect(suggestMode('D', 'm7')).toBe(1); // Dorian
    expect(suggestMode('G', '7')).toBe(4);  // Mixolydian
  });

  it('II-V-I in F: Gm7→Dorian, C7→Mixolydian, FM7→Ionian', () => {
    expect(suggestMode('G', 'm7', { root: 'F', minor: false })).toBe(1);  // Dorian
    expect(suggestMode('C', '7', { root: 'F', minor: false })).toBe(4);    // Mixolydian
    expect(suggestMode('F', 'maj7', { root: 'F', minor: false })).toBe(0); // Ionian
  });

  it('minor key: Am → relative major C, Am7→Aeolian (5)', () => {
    expect(suggestMode('A', 'm7', { root: 'A', minor: true })).toBe(5);
  });

  it('minor key: Dm7 in Am → Dorian (1)', () => {
    expect(suggestMode('D', 'm7', { root: 'A', minor: true })).toBe(1);
  });

  it('minor key: Em7 in Am → Phrygian (2)', () => {
    expect(suggestMode('E', 'm7', { root: 'A', minor: true })).toBe(2);
  });

  it('minor key: CM7 in Am → Ionian (0)', () => {
    expect(suggestMode('C', 'maj7', { root: 'A', minor: true })).toBe(0);
  });

  it('minor key: FM7 in Am → Lydian (3)', () => {
    expect(suggestMode('F', 'maj7', { root: 'A', minor: true })).toBe(3);
  });

  it('minor key: G7 in Am → Mixolydian (4)', () => {
    expect(suggestMode('G', '7', { root: 'A', minor: true })).toBe(4);
  });

  it('minor key: Bm7♭5 in Am → Locrian (6)', () => {
    expect(suggestMode('B', 'm7♭5', { root: 'A', minor: true })).toBe(6);
  });
});

/* ── isDiatonic ──────────────────────────────────────── */

describe('isDiatonic', () => {
  it('all diatonic chords in C major return true', () => {
    const key = { root: 'C' as const, minor: false };
    expect(isDiatonic('C', 'maj7', key)).toBe(true);   // I
    expect(isDiatonic('D', 'm7', key)).toBe(true);      // ii
    expect(isDiatonic('E', 'm7', key)).toBe(true);      // iii
    expect(isDiatonic('F', 'maj7', key)).toBe(true);    // IV
    expect(isDiatonic('G', '7', key)).toBe(true);       // V
    expect(isDiatonic('A', 'm7', key)).toBe(true);      // vi
    expect(isDiatonic('B', 'm7♭5', key)).toBe(true);    // vii
  });

  it('non-diatonic chord returns false', () => {
    const key = { root: 'C' as const, minor: false };
    expect(isDiatonic('B♭', '7', key)).toBe(false);     // ♭VII7
    expect(isDiatonic('E♭', 'maj7', key)).toBe(false);  // ♭III
  });

  it('wrong quality for diatonic root returns false', () => {
    const key = { root: 'C' as const, minor: false };
    expect(isDiatonic('D', '7', key)).toBe(false);      // D is ii but '7' is not m7
    expect(isDiatonic('G', 'maj7', key)).toBe(false);   // G is V but maj7 is not 7
  });

  it('returns false when no songKey', () => {
    expect(isDiatonic('C', 'maj7')).toBe(false);
  });

  it('minor key: Am diatonic chords', () => {
    const key = { root: 'A' as const, minor: true };
    expect(isDiatonic('A', 'm7', key)).toBe(true);      // i
    expect(isDiatonic('B', 'm7♭5', key)).toBe(true);    // ii°
    expect(isDiatonic('C', 'maj7', key)).toBe(true);    // III
    expect(isDiatonic('D', 'm7', key)).toBe(true);      // iv
    expect(isDiatonic('E', 'm7', key)).toBe(true);      // v
    expect(isDiatonic('F', 'maj7', key)).toBe(true);    // VI
    expect(isDiatonic('G', '7', key)).toBe(true);       // VII
  });

  it('minor key: non-diatonic returns false', () => {
    const key = { root: 'A' as const, minor: true };
    expect(isDiatonic('F', '7', key)).toBe(false);
  });
});

/* ── chordRomanNumeral ───────────────────────────────── */

describe('chordRomanNumeral', () => {
  const cMaj = { root: 'C' as const, minor: false };

  it('diatonic chords in C major', () => {
    expect(chordRomanNumeral('C', 'maj7', cMaj)).toEqual({ numeral: 'I', diatonic: true });
    expect(chordRomanNumeral('D', 'm7', cMaj)).toEqual({ numeral: 'ii', diatonic: true });
    expect(chordRomanNumeral('E', 'm7', cMaj)).toEqual({ numeral: 'iii', diatonic: true });
    expect(chordRomanNumeral('F', 'maj7', cMaj)).toEqual({ numeral: 'IV', diatonic: true });
    expect(chordRomanNumeral('G', '7', cMaj)).toEqual({ numeral: 'V', diatonic: true });
    expect(chordRomanNumeral('A', 'm7', cMaj)).toEqual({ numeral: 'vi', diatonic: true });
    expect(chordRomanNumeral('B', 'm7♭5', cMaj)).toEqual({ numeral: 'vii°', diatonic: true });
  });

  it('non-diatonic chords show accidentals', () => {
    expect(chordRomanNumeral('B♭', '7', cMaj)).toEqual({ numeral: '♭VII', diatonic: false });
    expect(chordRomanNumeral('E♭', 'maj7', cMaj)).toEqual({ numeral: '♭III', diatonic: false });
    expect(chordRomanNumeral('A♭', 'maj7', cMaj)).toEqual({ numeral: '♭VI', diatonic: false });
  });

  it('wrong quality for diatonic root is non-diatonic', () => {
    expect(chordRomanNumeral('D', '7', cMaj)).toEqual({ numeral: 'II', diatonic: false });
    expect(chordRomanNumeral('G', 'maj7', cMaj)).toEqual({ numeral: 'V', diatonic: false });
  });

  it('returns null when no songKey', () => {
    expect(chordRomanNumeral('C', 'maj7')).toBeNull();
  });

  it('minor key: Am diatonic chords', () => {
    const aMin = { root: 'A' as const, minor: true };
    expect(chordRomanNumeral('A', 'm7', aMin)).toEqual({ numeral: 'vi', diatonic: true });
    expect(chordRomanNumeral('D', 'm7', aMin)).toEqual({ numeral: 'ii', diatonic: true });
    expect(chordRomanNumeral('G', '7', aMin)).toEqual({ numeral: 'V', diatonic: true });
    expect(chordRomanNumeral('C', 'maj7', aMin)).toEqual({ numeral: 'I', diatonic: true });
  });

  it('dim chord: lowercase + degree sign', () => {
    expect(chordRomanNumeral('D', 'dim', cMaj)).toEqual({ numeral: 'ii°', diatonic: false });
    expect(chordRomanNumeral('B', 'dim', cMaj)).toEqual({ numeral: 'vii°', diatonic: false });
  });
});

/* ── computeEffectiveSelections ────────────────────────── */

describe('computeEffectiveSelections', () => {
  it('chain: unconfirmed positions propagate effective values', () => {
    // II-V-I in Bb: Cm7 → F7 → BbM7, all unconfirmed
    const chords = [
      { symbol: 'Cm7', rootName: 'C' as const, quality: 'm7', modeIdx: 1, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'F7', rootName: 'F' as const, quality: '7', modeIdx: 4, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'B♭M7', rootName: 'B♭' as const, quality: 'maj7', modeIdx: 0, posId: 1, posConfirmed: false, modeConfirmed: false },
    ];
    const eff = computeEffectiveSelections(chords, { root: 'B♭', minor: false });

    // All 3 should have resolved effective posId (not the stored posId=1)
    expect(eff.length).toBe(3);
    // First chord: no prev → Pos 1
    expect(eff[0].posId).toBe(1);
    // Second chord: ranked against effective Cm7 Pos 1 (not stored posId)
    // Third chord: ranked against effective F7 pos (not stored posId=1)
    // The key point: eff[2] should be ranked against eff[1], not against stored posId=1
    // Verify chain consistency: each effective posId is a valid position id (1-7)
    for (const e of eff) {
      expect(e.posId).toBeGreaterThanOrEqual(1);
      expect(e.posId).toBeLessThanOrEqual(7);
    }
  });

  it('confirmed values are preserved', () => {
    const chords = [
      { symbol: 'Dm7', rootName: 'D' as const, quality: 'm7', modeIdx: 1, posId: 3, posConfirmed: true, modeConfirmed: true },
      { symbol: 'G7', rootName: 'G' as const, quality: '7', modeIdx: 4, posId: 5, posConfirmed: true, modeConfirmed: true },
    ];
    const eff = computeEffectiveSelections(chords, { root: 'C', minor: false });
    expect(eff[0]).toEqual({ modeIdx: 1, posId: 3 });
    expect(eff[1]).toEqual({ modeIdx: 4, posId: 5 });
  });

  it('mode suggested from songKey when not confirmed', () => {
    const chords = [
      { symbol: 'Dm7', rootName: 'D' as const, quality: 'm7', modeIdx: 5, posId: 1, posConfirmed: false, modeConfirmed: false },
    ];
    const eff = computeEffectiveSelections(chords, { root: 'C', minor: false });
    // D in key of C → Dorian (1), not stored Aeolian (5)
    expect(eff[0].modeIdx).toBe(1);
  });
});

/* ── localStorage round-trip ───────────────────────────── */

describe('saveProgressions / loadProgressions', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem(key: string) { return store[key] ?? null; },
      setItem(key: string, val: string) { store[key] = val; },
      removeItem(key: string) { delete store[key]; },
    });
  });

  it('round-trips progressions', () => {
    const progs = [PRESET_PROGRESSIONS[0]];
    saveProgressions(progs);
    const loaded = loadProgressions();
    expect(loaded).toEqual(progs);
  });

  it('returns presets when nothing saved', () => {
    const loaded = loadProgressions();
    expect(loaded).toEqual(PRESET_PROGRESSIONS);
  });
});
