import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseChordSymbol,
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
    expect(ranked.length).toBe(3);
  });

  it('returns up to count positions', () => {
    const ranked = rankPositionsByProximity(cIonianPos, null, 5);
    expect(ranked.length).toBe(5);
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
    expect(slot.symbol).toBe('Dm7');
    expect(slot.rootName).toBe('D');
    expect(slot.quality).toBe('m7');
    expect(slot.modeIdx).toBe(1); // Dorian (first m7 mode)
    expect(slot.posId).toBe(1);
    expect(slot.posConfirmed).toBe(false);
  });

  it('uses prevPosId when provided', () => {
    const slot = buildChordSlot('G7', { rootName: 'G', quality: '7' }, 3);
    expect(slot.posId).toBe(3);
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
