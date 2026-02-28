import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseChordSymbol,
  normalizeChordSymbol,
  suggestMode,
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

describe('parseChordSymbol', () => {
  it('Dm7 → D, m7', () => {
    expect(parseChordSymbol('Dm7')).toEqual({ rootName: 'D', quality: 'm7' });
  });

  it('G7 → G, 7', () => {
    expect(parseChordSymbol('G7')).toEqual({ rootName: 'G', quality: '7' });
  });

  it('Cmaj7 → C, maj7', () => {
    expect(parseChordSymbol('Cmaj7')).toEqual({ rootName: 'C', quality: 'maj7' });
  });

  it('B♭maj7 → B♭, maj7', () => {
    expect(parseChordSymbol('B♭maj7')).toEqual({ rootName: 'B♭', quality: 'maj7' });
  });

  it('Bbmaj7 (ASCII flat) → B♭, maj7', () => {
    expect(parseChordSymbol('Bbmaj7')).toEqual({ rootName: 'B♭', quality: 'maj7' });
  });

  it('F#m7b5 → G♭, m7♭5', () => {
    expect(parseChordSymbol('F#m7b5')).toEqual({ rootName: 'G♭', quality: 'm7♭5' });
  });

  it('E♭m7 → E♭, m7', () => {
    expect(parseChordSymbol('E♭m7')).toEqual({ rootName: 'E♭', quality: 'm7' });
  });

  it('returns null for unsupported quality (dim)', () => {
    expect(parseChordSymbol('Bdim')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseChordSymbol('')).toBeNull();
  });

  it('returns null for bare root (no quality)', () => {
    expect(parseChordSymbol('C')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseChordSymbol('  Am7  ')).toEqual({ rootName: 'A', quality: 'm7' });
  });

  it('CM7 → C, maj7 (M7 alias)', () => {
    expect(parseChordSymbol('CM7')).toEqual({ rootName: 'C', quality: 'maj7' });
  });

  it('BbM7 → B♭, maj7 (M7 alias with flat)', () => {
    expect(parseChordSymbol('BbM7')).toEqual({ rootName: 'B♭', quality: 'maj7' });
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

  it('each mapped index has the correct chordQuality', () => {
    for (const [quality, indices] of Object.entries(QUALITY_TO_MODES)) {
      for (const idx of indices) {
        expect(MODE_TEMPLATES[idx].chordQuality).toBe(quality);
      }
    }
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
    const slot = buildChordSlot('Dm7', { rootName: 'D', quality: 'm7' });
    expect(slot.symbol).toBe('Dm7'); // normalized
    expect(slot.rootName).toBe('D');
    expect(slot.quality).toBe('m7');
    expect(slot.modeIdx).toBe(1); // Dorian (first m7 mode)
    expect(slot.posId).toBe(1);
    expect(slot.posConfirmed).toBe(false);
    expect(slot.modeConfirmed).toBe(false);
  });

  it('uses prevPosId when provided', () => {
    const slot = buildChordSlot('G7', { rootName: 'G', quality: '7' }, 3);
    expect(slot.posId).toBe(3);
  });

  it('normalizes symbol: Cmaj7 → CM7', () => {
    const slot = buildChordSlot('Cmaj7', { rootName: 'C', quality: 'maj7' });
    expect(slot.symbol).toBe('CM7');
  });

  it('uses suggestMode when songKey is provided', () => {
    const slot = buildChordSlot('Dm7', { rootName: 'D', quality: 'm7' }, 1, 'C');
    expect(slot.modeIdx).toBe(1); // Dorian (II of C)
  });
});

/* ── normalizeChordSymbol ──────────────────────────────── */

describe('normalizeChordSymbol', () => {
  it('maj7 → M7', () => {
    expect(normalizeChordSymbol('Cmaj7', { rootName: 'C', quality: 'maj7' })).toBe('CM7');
  });

  it('m7 stays m7', () => {
    expect(normalizeChordSymbol('Dm7', { rootName: 'D', quality: 'm7' })).toBe('Dm7');
  });

  it('normalizes root: Db → D♭', () => {
    expect(normalizeChordSymbol('Dbmaj7', { rootName: 'D♭', quality: 'maj7' })).toBe('D♭M7');
  });

  it('7 stays 7', () => {
    expect(normalizeChordSymbol('G7', { rootName: 'G', quality: '7' })).toBe('G7');
  });

  it('m7♭5 stays m7♭5', () => {
    expect(normalizeChordSymbol('Bm7b5', { rootName: 'B', quality: 'm7♭5' })).toBe('Bm7♭5');
  });
});

/* ── suggestMode ──────────────────────────────────────── */

describe('suggestMode', () => {
  it('Dm7 in key of C → Dorian (1)', () => {
    expect(suggestMode('D', 'm7', 'C')).toBe(1);
  });

  it('G7 in key of C → Mixolydian (4)', () => {
    expect(suggestMode('G', '7', 'C')).toBe(4);
  });

  it('Em7 in key of C → Phrygian (2)', () => {
    expect(suggestMode('E', 'm7', 'C')).toBe(2);
  });

  it('Am7 in key of C → Aeolian (5)', () => {
    expect(suggestMode('A', 'm7', 'C')).toBe(5);
  });

  it('Bm7♭5 in key of C → Locrian (6)', () => {
    expect(suggestMode('B', 'm7♭5', 'C')).toBe(6);
  });

  it('CM7 in key of C → Ionian (0)', () => {
    expect(suggestMode('C', 'maj7', 'C')).toBe(0);
  });

  it('FM7 in key of C → Lydian (3)', () => {
    expect(suggestMode('F', 'maj7', 'C')).toBe(3);
  });

  it('non-diatonic: B♭7 in key of C → fallback Mixolydian (4)', () => {
    expect(suggestMode('B♭', '7', 'C')).toBe(4);
  });

  it('no songKey → fallback to QUALITY_TO_MODES first', () => {
    expect(suggestMode('D', 'm7')).toBe(1); // Dorian
    expect(suggestMode('G', '7')).toBe(4);  // Mixolydian
  });

  it('II-V-I in F: Gm7→Dorian, C7→Mixolydian, FM7→Ionian', () => {
    expect(suggestMode('G', 'm7', 'F')).toBe(1);  // Dorian
    expect(suggestMode('C', '7', 'F')).toBe(4);    // Mixolydian
    expect(suggestMode('F', 'maj7', 'F')).toBe(0); // Ionian
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
    const eff = computeEffectiveSelections(chords, 'B♭');

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
    const eff = computeEffectiveSelections(chords, 'C');
    expect(eff[0]).toEqual({ modeIdx: 1, posId: 3 });
    expect(eff[1]).toEqual({ modeIdx: 4, posId: 5 });
  });

  it('mode suggested from songKey when not confirmed', () => {
    const chords = [
      { symbol: 'Dm7', rootName: 'D' as const, quality: 'm7', modeIdx: 5, posId: 1, posConfirmed: false, modeConfirmed: false },
    ];
    const eff = computeEffectiveSelections(chords, 'C');
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
