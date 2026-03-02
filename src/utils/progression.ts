import type { Position, PositionInstance, RootName, SongKey, ChordSlot, Progression } from '../types';
import { ROOTS, MODE_TEMPLATES } from '../constants';
import { resolveMode } from './noteSpelling';
import { buildFretMap, generatePositions, generateDimPositions } from './fretboard';

/** Map chord quality → compatible MODE_TEMPLATES indices */
export const QUALITY_TO_MODES: Record<string, number[]> = {
  'maj7':  [0, 3],              // Ionian, Lydian
  'm7':    [1, 2, 5, 8],        // Dorian, Phrygian, Aeolian, Dorian ♭2
  '7':     [4, 10, 11, 15, 13, 17], // Mixolydian, Lydian Dom, Mixo♭6, Phryg Dom, Altered, Dim H-W
  'm7♭5':  [6, 12],             // Locrian, Locrian ♯2
  'dim':   [16],                 // Diminished W-H
  'mMaj7': [7, 14],             // Melodic Minor, Harmonic Minor
  'aug':   [9],                 // Lydian Augmented
  '7alt':  [13],                // Altered
  '7b9':   [15, 13, 17],         // Phrygian Dominant, Altered, Dim H-W
  '7#11':  [10, 13],            // Lydian Dominant, Altered
  '7b13':  [11, 15, 13],         // Mixolydian ♭6, Phrygian Dominant, Altered
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

// Quality patterns: [regex, mapped quality family]
// Order matters: longer/more-specific patterns first
const QUALITY_PATTERNS: [RegExp, string][] = [
  // --- half-diminished (before m7 to avoid partial match) ---
  [/^m7[♭b]5/, 'm7♭5'],
  [/^[øo]7?$/, 'm7♭5'],

  // --- diminished (separate from m7♭5, Skip for now) ---
  [/^dim/, 'dim'],
  [/^0[7]?$/, 'dim'],

  // --- augmented: specific before general ---
  [/^aug7/, '7alt'],       // aug7 = dom aug → Altered (b7 + #5)
  [/^aug/, 'aug'],         // aug, augmaj7 → Lydian Aug (7 + #5)
  [/^\+7/, '7alt'],        // +7 = dom aug → Altered
  [/^\+$/, 'aug'],         // + = bare triad → Lydian Aug

  // --- mMaj7 (before m7 to catch m/maj7, mM7 first) ---
  [/^m\/maj7/, 'mMaj7'],
  [/^mM7/, 'mMaj7'],
  [/^m\(maj7\)/, 'mMaj7'],

  // --- minor family (m6 etc. before generic m7) ---
  [/^mi7/, 'm7'],
  [/^-7/, 'm7'],
  [/^m6/, 'm7'],
  [/^m9/, 'm7'],
  [/^m11/, 'm7'],
  [/^m13/, 'm7'],
  [/^m69/, 'm7'],
  [/^m7/, 'm7'],
  [/^m$/, 'm7'],
  [/^-$/, 'm7'],

  // --- major family ---
  [/^[△Δ]7/, 'maj7'],
  [/^M[79]/, 'maj7'],
  [/^maj[79]/, 'maj7'],
  [/^maj1[13]/, 'maj7'],
  [/^69$/, 'maj7'],
  [/^6$/, 'maj7'],
  [/^add/, 'maj7'],

  // --- sus → dominant function ---
  [/^sus[24]?$/, '7'],

  // --- specific dominant variants (before generic ^7) ---
  [/^7alt/, '7alt'],
  [/^7[♭b]9/, '7b9'],
  [/^7[#♯]9/, '7alt'],
  [/^7[#♯]5/, '7alt'],     // 7#5 → Altered (has #5 + b7)
  [/^7[♭b]5/, '7alt'],     // 7b5 → Altered (has b5, no natural 5)
  [/^7[#♯]11/, '7#11'],
  [/^7[♭b]13/, '7b13'],

  // --- dominant family (generic catch-all) ---
  [/^7/, '7'],
  [/^9/, '7'],
  [/^13/, '7'],
  [/^11$/, '7'],
];

/**
 * Parse a chord symbol like "Dm7", "C7b9", "F#m7b5" into root + quality + suffix.
 * quality = mapped family for mode suggestion (maj7/m7/7/m7♭5/dim).
 * suffix = original quality string for display (e.g. "7b9", "m6", "dim7").
 * Returns null for unrecognized chord types.
 */
export function parseChordSymbol(
  symbol: string,
): { rootName: RootName; quality: string; suffix: string } | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;

  // Extract root: letter + optional accidental
  const rootMatch = trimmed.match(/^([A-G])([♭♯#b]?)/);
  if (!rootMatch) return null;

  const rootStr = rootMatch[1] + rootMatch[2];
  const rootName = ROOT_LOOKUP[rootStr];
  if (!rootName) return null;

  // Strip slash bass note (e.g. "m7/Bb" → "m7")
  const qualityStr = trimmed.slice(rootMatch[0].length).replace(/\/[A-G][♭♯#b]?$/, '');

  // Bare major triad (e.g. "C", "F", "Bb") → treat as maj7
  if (!qualityStr) return { rootName, quality: 'maj7', suffix: '' };

  for (const [pattern, quality] of QUALITY_PATTERNS) {
    if (pattern.test(qualityStr)) {
      return { rootName, quality, suffix: qualityStr };
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
  count = 7,
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
 * Normalize a chord symbol for display: root in Unicode + original suffix.
 * e.g. "Dbmaj7" → "D♭maj7", "Bb7b9" → "B♭7b9", "F#dim7" → "G♭dim7"
 */
export function normalizeChordSymbol(
  _symbol: string,
  parsed: { rootName: RootName; quality: string; suffix: string },
): string {
  return parsed.rootName + parsed.suffix;
}

/** Major scale semitone → degree index mapping */
const MAJOR_SEMI_TO_DEG: Record<number, number> = {
  0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6,
};

/** Semitone → Roman numeral base (uppercase) */
const SEMI_TO_ROMAN: Record<number, string> = {
  0: 'I', 1: '♭II', 2: 'II', 3: '♭III', 4: 'III', 5: 'IV',
  6: '#IV', 7: 'V', 8: '♭VI', 9: 'VI', 10: '♭VII', 11: 'VII',
};

/**
 * Compute the Roman numeral label for a chord in a given key.
 * Uses uppercase for maj7/7, lowercase for m7/m7♭5.
 * Returns null if no song key is set.
 */
export function chordRomanNumeral(
  chordRoot: RootName,
  quality: string,
  songKey?: SongKey,
): { numeral: string; diatonic: boolean } | null {
  if (!songKey) return null;

  let effectiveRoot = songKey.root;
  if (songKey.minor) {
    const rootSemi = ROOTS.find(r => r.name === songKey.root)?.semitone;
    if (rootSemi == null) return null;
    const majorSemi = (rootSemi + 3) % 12;
    effectiveRoot = ROOTS.find(r => r.semitone === majorSemi)?.name ?? songKey.root;
  }

  const keySemi = ROOTS.find(r => r.name === effectiveRoot)?.semitone;
  const chordSemi = ROOTS.find(r => r.name === chordRoot)?.semitone;
  if (keySemi == null || chordSemi == null) return null;

  const interval = (chordSemi - keySemi + 12) % 12;
  const roman = SEMI_TO_ROMAN[interval] ?? '?';

  // Diatonic check
  const degIdx = MAJOR_SEMI_TO_DEG[interval];
  const diatonic = degIdx != null && MODE_TEMPLATES[degIdx]?.chordQuality === quality;

  // Case: lowercase for minor qualities
  const isMinor = quality === 'm7' || quality === 'm7♭5' || quality === 'dim' || quality === 'mMaj7';
  let numeral = isMinor ? roman.replace(/[IVX]+/, m => m.toLowerCase()) : roman;
  if (quality === 'm7♭5' || quality === 'dim') numeral += '\u00B0'; // degree sign °

  return { numeral, diatonic };
}

/**
 * Suggest the best mode for a chord based on the song key.
 * Uses diatonic analysis: if the chord root is a scale degree of the key,
 * pick the mode that corresponds to that degree.
 * Falls back to QUALITY_TO_MODES[0] for non-diatonic chords or when no key is set.
 */
export function suggestMode(
  chordRoot: RootName,
  quality: string,
  songKey?: SongKey,
): number {
  const fallback = (QUALITY_TO_MODES[quality] ?? [])[0] ?? 0;
  if (!songKey) return fallback;

  // Minor key → convert to relative major (root + 3 semitones)
  let effectiveRoot = songKey.root;
  if (songKey.minor) {
    const rootSemi = ROOTS.find(r => r.name === songKey.root)?.semitone;
    if (rootSemi == null) return fallback;
    const majorSemi = (rootSemi + 3) % 12;
    effectiveRoot = ROOTS.find(r => r.semitone === majorSemi)?.name ?? songKey.root;
  }

  const keySemi = ROOTS.find(r => r.name === effectiveRoot)?.semitone;
  const chordSemi = ROOTS.find(r => r.name === chordRoot)?.semitone;
  if (keySemi == null || chordSemi == null) return fallback;

  const interval = (chordSemi - keySemi + 12) % 12;
  const degIdx = MAJOR_SEMI_TO_DEG[interval];
  if (degIdx == null) return fallback; // non-diatonic interval

  // Check if this degree's mode matches the chord quality
  const tmpl = MODE_TEMPLATES[degIdx];
  if (tmpl && tmpl.chordQuality === quality) return degIdx;

  return fallback;
}

/**
 * Check if a chord is diatonic to the given song key.
 * A chord is diatonic when its root is a scale degree AND its quality
 * matches the expected diatonic quality for that degree.
 */
export function isDiatonic(
  chordRoot: RootName,
  quality: string,
  songKey?: SongKey,
): boolean {
  if (!songKey) return false;

  let effectiveRoot = songKey.root;
  if (songKey.minor) {
    const rootSemi = ROOTS.find(r => r.name === songKey.root)?.semitone;
    if (rootSemi == null) return false;
    const majorSemi = (rootSemi + 3) % 12;
    effectiveRoot = ROOTS.find(r => r.semitone === majorSemi)?.name ?? songKey.root;
  }

  const keySemi = ROOTS.find(r => r.name === effectiveRoot)?.semitone;
  const chordSemi = ROOTS.find(r => r.name === chordRoot)?.semitone;
  if (keySemi == null || chordSemi == null) return false;

  const interval = (chordSemi - keySemi + 12) % 12;
  const degIdx = MAJOR_SEMI_TO_DEG[interval];
  if (degIdx == null) return false;

  const tmpl = MODE_TEMPLATES[degIdx];
  return tmpl != null && tmpl.chordQuality === quality;
}

/** Effective mode and position for a chord after resolving auto-suggestions */
export interface EffectiveChord {
  modeIdx: number;
  posId: number;
}

/**
 * Compute effective modeIdx and posId for every chord in a progression,
 * resolving the auto-suggestion chain: each unconfirmed chord's position
 * is ranked against the effective (not stored) position of the previous chord.
 */
export function computeEffectiveSelections(
  chords: ChordSlot[],
  songKey?: SongKey,
): EffectiveChord[] {
  const results: EffectiveChord[] = [];

  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];

    if (!QUALITY_TO_MODES[c.quality]) {
      results.push({ modeIdx: c.modeIdx, posId: c.posId });
      continue;
    }

    const modeIdx = c.modeConfirmed
      ? c.modeIdx
      : suggestMode(c.rootName, c.quality, songKey);

    let posId: number;
    if (c.posConfirmed) {
      posId = c.posId;
    } else {
      const mode = resolveMode(c.rootName, MODE_TEMPLATES[modeIdx]);
      const fretMap = buildFretMap(mode.semi, mode.notes);
      const is8Note = mode.notes.length > 7;
      const curAllPos = is8Note
        ? generateDimPositions(fretMap, mode.semi[0])
        : generatePositions(fretMap, mode.notes);

      let prevPos: Position | null = null;
      if (i > 0) {
        const prevChord = chords[i - 1];
        const prevEff = results[i - 1];
        if (QUALITY_TO_MODES[prevChord.quality]) {
          const prevMode = resolveMode(prevChord.rootName, MODE_TEMPLATES[prevEff.modeIdx]);
          const prevFretMap = buildFretMap(prevMode.semi, prevMode.notes);
          const prevIs8 = prevMode.notes.length > 7;
          const prevAllPos = prevIs8
            ? generateDimPositions(prevFretMap, prevMode.semi[0])
            : generatePositions(prevFretMap, prevMode.notes);
          prevPos = prevAllPos.find(p => p.id === prevEff.posId) ?? null;
        }
      }

      const ranked = rankPositionsByProximity(curAllPos, prevPos);
      posId = ranked[0] ?? 1;
    }

    results.push({ modeIdx, posId });
  }

  return results;
}

/**
 * For bare triads (suffix === ''), infer the chord quality from the
 * diatonic context.  e.g. "C" in key of F → V → '7' (Mixolydian),
 * "D" in key of C → ii → 'm7' (Dorian).
 * Falls back to 'maj7' when no key is set or the root is non-diatonic.
 */
function inferBareTriadQuality(rootName: RootName, songKey?: SongKey): string {
  if (!songKey) return 'maj7';

  let effectiveRoot = songKey.root;
  if (songKey.minor) {
    const rootSemi = ROOTS.find(r => r.name === songKey.root)?.semitone;
    if (rootSemi == null) return 'maj7';
    const majorSemi = (rootSemi + 3) % 12;
    effectiveRoot = ROOTS.find(r => r.semitone === majorSemi)?.name ?? songKey.root;
  }

  const keySemi = ROOTS.find(r => r.name === effectiveRoot)?.semitone;
  const chordSemi = ROOTS.find(r => r.name === rootName)?.semitone;
  if (keySemi == null || chordSemi == null) return 'maj7';

  const interval = (chordSemi - keySemi + 12) % 12;
  const degIdx = MAJOR_SEMI_TO_DEG[interval];
  if (degIdx == null) return 'maj7'; // non-diatonic → default major

  return MODE_TEMPLATES[degIdx].chordQuality;
}

/**
 * Build a default ChordSlot from a parsed chord symbol.
 * modeIdx defaults to suggestMode result, posId defaults to 1.
 * For bare triads (suffix === ''), the quality is inferred from the song key.
 */
export function buildChordSlot(
  symbol: string,
  parsed: { rootName: RootName; quality: string; suffix: string },
  prevPosId?: number,
  songKey?: SongKey,
): ChordSlot {
  const quality = parsed.suffix === ''
    ? inferBareTriadQuality(parsed.rootName, songKey)
    : parsed.quality;
  return {
    symbol: normalizeChordSymbol(symbol, parsed),
    rootName: parsed.rootName,
    quality,
    modeIdx: suggestMode(parsed.rootName, quality, songKey),
    posId: prevPosId ?? 1,
    posConfirmed: false,
    modeConfirmed: false,
  };
}

export function saveProgressions(progs: Progression[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progs));
}

export function loadProgressions(): Progression[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...PRESET_PROGRESSIONS];
    const progs = JSON.parse(raw) as Progression[];
    for (const p of progs) {
      // Migrate old format: songKey was RootName string, now SongKey object
      if (typeof p.songKey === 'string') {
        p.songKey = { root: p.songKey as RootName, minor: false };
      }
      // Migrate old chord symbols: maj7 → M7
      for (const c of p.chords) {
        c.symbol = c.symbol.replace(/maj7$/, 'M7');
      }
    }
    return progs;
  } catch {
    return [...PRESET_PROGRESSIONS];
  }
}

export const PRESET_PROGRESSIONS: Progression[] = [
  {
    name: 'II-V-I in C',
    songKey: { root: 'C', minor: false },
    chords: [
      { symbol: 'Dm7', rootName: 'D', quality: 'm7', modeIdx: 1, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'G7', rootName: 'G', quality: '7', modeIdx: 4, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'CM7', rootName: 'C', quality: 'maj7', modeIdx: 0, posId: 1, posConfirmed: false, modeConfirmed: false },
    ],
  },
  {
    name: 'II-V-I in F',
    songKey: { root: 'F', minor: false },
    chords: [
      { symbol: 'Gm7', rootName: 'G', quality: 'm7', modeIdx: 1, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'C7', rootName: 'C', quality: '7', modeIdx: 4, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'FM7', rootName: 'F', quality: 'maj7', modeIdx: 0, posId: 1, posConfirmed: false, modeConfirmed: false },
    ],
  },
  {
    name: 'II-V-I in B♭',
    songKey: { root: 'B♭', minor: false },
    chords: [
      { symbol: 'Cm7', rootName: 'C', quality: 'm7', modeIdx: 1, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'F7', rootName: 'F', quality: '7', modeIdx: 4, posId: 1, posConfirmed: false, modeConfirmed: false },
      { symbol: 'B♭M7', rootName: 'B♭', quality: 'maj7', modeIdx: 0, posId: 1, posConfirmed: false, modeConfirmed: false },
    ],
  },
];
