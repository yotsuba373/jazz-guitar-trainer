import type { Position, PositionInstance, RootName, ChordSlot, Progression } from '../types';
import { ROOTS } from '../constants';

/** Map chord quality → compatible MODE_TEMPLATES indices */
export const QUALITY_TO_MODES: Record<string, number[]> = {
  'maj7': [0, 3],    // Ionian, Lydian
  'm7':   [1, 2, 5], // Dorian, Phrygian, Aeolian
  '7':    [4],       // Mixolydian
  'm7♭5': [6],       // Locrian
};

const STORAGE_KEY = 'jazz-guitar-progressions';

// Root name lookup: support both Unicode accidentals and ASCII
const ROOT_LOOKUP: Record<string, RootName> = {};
for (const r of ROOTS) {
  ROOT_LOOKUP[r.name] = r.name;
  ROOT_LOOKUP[r.name.replace('♭', 'b')] = r.name;
}
// Sharp equivalents → flat names used in ROOTS
ROOT_LOOKUP['C#'] = 'D♭';
ROOT_LOOKUP['D#'] = 'E♭';
ROOT_LOOKUP['F#'] = 'G♭';
ROOT_LOOKUP['G#'] = 'A♭';
ROOT_LOOKUP['A#'] = 'B♭';

// Quality patterns ordered so longer patterns match first
const QUALITY_PATTERNS: [RegExp, string][] = [
  [/^maj7$/, 'maj7'],
  [/^m7♭5$/, 'm7♭5'],
  [/^m7b5$/, 'm7♭5'],
  [/^m7$/, 'm7'],
  [/^7$/, '7'],
];

/**
 * Parse a chord symbol like "Dm7", "B♭maj7", "F#m7b5" into root + quality.
 * Returns null for unsupported chord types.
 */
export function parseChordSymbol(
  symbol: string,
): { rootName: RootName; quality: string } | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;

  // Extract root: letter + optional accidental
  const rootMatch = trimmed.match(/^([A-G])([♭♯#b]?)/);
  if (!rootMatch) return null;

  const rootStr = rootMatch[1] + rootMatch[2];
  const rootName = ROOT_LOOKUP[rootStr];
  if (!rootName) return null;

  const qualityStr = trimmed.slice(rootMatch[0].length);
  if (!qualityStr) return null;

  for (const [pattern, quality] of QUALITY_PATTERNS) {
    if (pattern.test(qualityStr)) {
      return { rootName, quality };
    }
  }

  return null;
}

/**
 * Rank positions by fret proximity to the previous position.
 * Uses minimum distance between any instance pair (prev × candidate).
 * Returns posId[] sorted by closest first (up to `count` items).
 * If prevPos is null, returns Pos 1 first then ascending order.
 */
export function rankPositionsByProximity(
  allPos: Position[],
  prevPos: Position | null,
  count = 3,
): number[] {
  if (!prevPos) {
    return allPos.slice(0, count).map(p => p.id);
  }

  const ranked = allPos
    .map(p => ({ id: p.id, dist: minInstanceDistance(prevPos, p) }))
    .sort((a, b) => a.dist - b.dist || a.id - b.id);

  return ranked.slice(0, count).map(r => r.id);
}

function instCenter(inst: PositionInstance): number {
  return (inst.fretMin + inst.fretMax) / 2;
}

function minInstanceDistance(a: Position, b: Position): number {
  let min = Infinity;
  for (const ai of a.instances) {
    for (const bi of b.instances) {
      const d = Math.abs(instCenter(ai) - instCenter(bi));
      if (d < min) min = d;
    }
  }
  return min === Infinity ? 0 : min;
}

/**
 * Build a default ChordSlot from a parsed chord symbol.
 * modeIdx defaults to the first compatible mode, posId defaults to 1.
 */
export function buildChordSlot(
  symbol: string,
  parsed: { rootName: RootName; quality: string },
  prevPosId?: number,
): ChordSlot {
  const modes = QUALITY_TO_MODES[parsed.quality] ?? [];
  return {
    symbol,
    rootName: parsed.rootName,
    quality: parsed.quality,
    modeIdx: modes[0] ?? 0,
    posId: prevPosId ?? 1,
    posConfirmed: false,
  };
}

export function saveProgressions(progs: Progression[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progs));
}

export function loadProgressions(): Progression[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...PRESET_PROGRESSIONS];
    return JSON.parse(raw) as Progression[];
  } catch {
    return [...PRESET_PROGRESSIONS];
  }
}

export const PRESET_PROGRESSIONS: Progression[] = [
  {
    name: 'II-V-I in C',
    chords: [
      { symbol: 'Dm7', rootName: 'D', quality: 'm7', modeIdx: 1, posId: 1, posConfirmed: false },
      { symbol: 'G7', rootName: 'G', quality: '7', modeIdx: 4, posId: 1, posConfirmed: false },
      { symbol: 'Cmaj7', rootName: 'C', quality: 'maj7', modeIdx: 0, posId: 1, posConfirmed: false },
    ],
  },
  {
    name: 'II-V-I in F',
    chords: [
      { symbol: 'Gm7', rootName: 'G', quality: 'm7', modeIdx: 1, posId: 1, posConfirmed: false },
      { symbol: 'C7', rootName: 'C', quality: '7', modeIdx: 4, posId: 1, posConfirmed: false },
      { symbol: 'Fmaj7', rootName: 'F', quality: 'maj7', modeIdx: 0, posId: 1, posConfirmed: false },
    ],
  },
  {
    name: 'II-V-I in B♭',
    chords: [
      { symbol: 'Cm7', rootName: 'C', quality: 'm7', modeIdx: 1, posId: 1, posConfirmed: false },
      { symbol: 'F7', rootName: 'F', quality: '7', modeIdx: 4, posId: 1, posConfirmed: false },
      { symbol: 'B♭maj7', rootName: 'B♭', quality: 'maj7', modeIdx: 0, posId: 1, posConfirmed: false },
    ],
  },
];
