import type {
  LickDB, LickEntry, LickNote, PoolNote, PhraseNote,
  GeneratedPhrase, PhraseConfig, RhythmType, Mode, Position, FretMap,
} from '../types';
import { MODE_TEMPLATES } from '../constants';
import { QUALITY_TO_MODES } from './progression';
import { resolveMode } from './noteSpelling';
import { buildFretMap, generatePositions } from './fretboard';
import { absolutePitch } from './bebopScheduler';
import { buildNotePool } from './bebopGenerator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPEN_MIDI = [64, 59, 55, 50, 45, 40]; // 1E=E4, B=B3, G=G3, D=D3, A=A2, 6E=E2

/** Map chord quality (from parseChordSymbol) to lick DB type key */
export const QUALITY_TO_LICK_TYPE: Record<string, string> = {
  'maj7': 'maj7',
  'm7': 'min7',
  '7': 'dom7',
  '7alt': 'dom7',
  '7b9': 'dom7',
  '7#11': 'dom7',
  '7b13': 'dom7',
  'm7♭5': 'm7b5',
  'mMaj7': 'min7',   // fallback to minor licks
  'aug': 'maj7',     // fallback to major licks
  'dim': 'dom7',     // dim → dom7 fallback (dim7 = rootless dom7b9)
};

/** Display names for lick sources */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  cannonball: 'Cannonball Adderley',
  parker: 'Charlie Parker',
  coltrane: 'John Coltrane',
  rollins: 'Sonny Rollins',
  stitt: 'Sonny Stitt',
  dexter: 'Dexter Gordon',
  joe_pass: 'Joe Pass',
  wes: 'Wes Montgomery',
};

/** Root semitone values for each lick type (what key licks are stored in) */
const TYPE_ROOT_SEMITONE: Record<string, number> = {
  'dom7': 7,    // G (G7)
  'min7': 2,    // D (Dm7)
  'maj7': 0,    // C (Cmaj7)
  'm7b5': 2,    // D (Dm7b5)
};

// ---------------------------------------------------------------------------
// DB loading
// ---------------------------------------------------------------------------

let cachedDB: LickDB | null = null;

export async function loadLickDB(): Promise<LickDB> {
  if (cachedDB) return cachedDB;
  const resp = await fetch('/licks.json');
  if (!resp.ok) throw new Error(`Failed to load licks.json: ${resp.status}`);
  cachedDB = await resp.json() as LickDB;
  return cachedDB;
}

/** Clear cached DB (for testing) */
export function clearLickDBCache(): void {
  cachedDB = null;
}

// ---------------------------------------------------------------------------
// Transposition
// ---------------------------------------------------------------------------

/** Transpose a lick by given number of semitones. Returns a new LickEntry. */
export function transposeLick(lick: LickEntry, semitones: number): LickEntry {
  return {
    ...lick,
    notes: lick.notes.map((n: LickNote) =>
      n.rest ? n : { ...n, pitch: n.pitch! + semitones }
    ),
  };
}

// ---------------------------------------------------------------------------
// Rhythm type inference
// ---------------------------------------------------------------------------

export function inferRhythmType(durationBeats: number): RhythmType {
  if (durationBeats >= 0.9) return 'q';
  if (durationBeats >= 0.4) return 'e';
  if (Math.abs(durationBeats - 1 / 3) < 0.05) return 't';
  return 's';
}

// ---------------------------------------------------------------------------
// Fretboard mapping
// ---------------------------------------------------------------------------

/** Map a MIDI pitch to a fretboard location using the note pool.
 *  Falls back to raw fret calculation if no pool match found. */
function mapPitchToFret(
  midiPitch: number,
  pool: PoolNote[],
  prevStringIdx: number | null,
): { stringIdx: number; fret: number; noteName: string; semitone: number; isChordTone: boolean; isApproach: boolean; poolMatch: boolean } {
  // Find all pool notes matching this pitch
  const candidates = pool.filter(p => absolutePitch(p) === midiPitch);

  if (candidates.length > 0) {
    // Pick closest string to previous note
    if (prevStringIdx != null) {
      candidates.sort((a, b) =>
        Math.abs(a.stringIdx - prevStringIdx) - Math.abs(b.stringIdx - prevStringIdx)
      );
    }
    const best = candidates[0];
    return { ...best, poolMatch: true };
  }

  // Fallback: calculate fret on each string, pick best
  const CHROMATIC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const semitone = ((midiPitch % 12) + 12) % 12;
  const noteName = CHROMATIC_NAMES[semitone];

  let bestString = 0;
  let bestFret = midiPitch - OPEN_MIDI[0];
  let bestDist = Infinity;

  for (let s = 0; s < 6; s++) {
    const fret = midiPitch - OPEN_MIDI[s];
    if (fret < 0 || fret > 21) continue;
    const dist = prevStringIdx != null ? Math.abs(s - prevStringIdx) : s;
    if (dist < bestDist || (dist === bestDist && fret < bestFret)) {
      bestDist = dist;
      bestString = s;
      bestFret = fret;
    }
  }

  return {
    stringIdx: bestString,
    fret: bestFret,
    noteName,
    semitone,
    isChordTone: false,
    isApproach: true,
    poolMatch: false,
  };
}

/** Map an entire lick to fretboard coordinates using the note pool. */
export function mapLickToFretboard(
  lick: LickEntry,
  pool: PoolNote[],
  transposeSemitones: number,
): Array<{ stringIdx: number; fret: number; noteName: string; semitone: number; isChordTone: boolean; isApproach: boolean } | null> {
  let prevStringIdx: number | null = null;
  return lick.notes.map((n: LickNote) => {
    if (n.rest) return null;
    const midiPitch = n.pitch! + transposeSemitones;
    const mapped = mapPitchToFret(midiPitch, pool, prevStringIdx);
    prevStringIdx = mapped.stringIdx;
    return mapped;
  });
}

// ---------------------------------------------------------------------------
// Mode inference
// ---------------------------------------------------------------------------

/** Infer the best mode for a lick given its chord quality and root semitone. */
export function inferModeFromLick(
  lick: LickEntry,
  quality: string,
  targetRootSemitone: number,
): number {
  const candidates = QUALITY_TO_MODES[quality];
  if (!candidates || candidates.length === 0) return 0;
  if (candidates.length === 1) return candidates[0];

  // Get the lick's stored root semitone
  const lickType = QUALITY_TO_LICK_TYPE[quality] ?? quality;
  const storedRootSemitone = TYPE_ROOT_SEMITONE[lickType] ?? 0;
  const transposeSemitones = targetRootSemitone - storedRootSemitone;

  // Extract pitch classes from lick (transposed to target key)
  const pitchClasses = new Set<number>();
  for (const n of lick.notes) {
    if (n.rest || n.pitch == null) continue;
    pitchClasses.add(((n.pitch + transposeSemitones) % 12 + 12) % 12);
  }

  // Score each candidate mode by how many lick pitch classes are in the scale
  const ROOTS_MAP: Record<string, number> = {
    'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
    'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  };

  // Find root name from target semitone
  const CHROMATIC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const rootName = CHROMATIC_NAMES[targetRootSemitone % 12];

  let bestIdx = candidates[0];
  let bestScore = -1;

  for (const modeIdx of candidates) {
    const template = MODE_TEMPLATES[modeIdx];
    const scaleSemis = new Set(template.semi.map(s => (s + (ROOTS_MAP[rootName] ?? 0)) % 12));
    let score = 0;
    for (const pc of pitchClasses) {
      if (scaleSemis.has(pc)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = modeIdx;
    }
  }

  return bestIdx;
}

// ---------------------------------------------------------------------------
// Position selection
// ---------------------------------------------------------------------------

/** Find the best position for a lick's notes. Returns posId. */
export function findBestPositionForLick(
  lick: LickEntry,
  allPositions: Position[],
  transposeSemitones: number,
  prevPosId?: number,
): number {
  if (allPositions.length === 0) return 1;

  // Get transposed MIDI pitches
  const pitches = lick.notes
    .filter((n: LickNote) => !n.rest && n.pitch != null)
    .map((n: LickNote) => n.pitch! + transposeSemitones);

  let bestPosId = allPositions[0].id;
  let bestScore = -1;

  for (const pos of allPositions) {
    // Build set of absolute pitches in this position
    const posPitches = new Set<number>();
    for (const inst of pos.instances) {
      for (let s = 0; s < 6; s++) {
        const notes = inst.strings[s];
        if (!notes) continue;
        for (const [, fret] of notes) {
          posPitches.add(OPEN_MIDI[s] + fret);
        }
      }
    }

    // Count how many lick pitches are in this position
    let score = 0;
    for (const p of pitches) {
      if (posPitches.has(p)) score++;
    }

    // Tiebreak: prefer position closer to previous
    const isBetter = score > bestScore ||
      (score === bestScore && prevPosId != null &&
        Math.abs(pos.id - prevPosId) < Math.abs(bestPosId - prevPosId));

    if (isBetter) {
      bestScore = score;
      bestPosId = pos.id;
    }
  }

  return bestPosId;
}

// ---------------------------------------------------------------------------
// Lick → GeneratedPhrase conversion
// ---------------------------------------------------------------------------

/** Convert a lick entry into a GeneratedPhrase for display and playback. */
export function lickToGeneratedPhrase(
  lick: LickEntry,
  posId: number,
  modeKey: string,
  rootName: string,
  pool: PoolNote[],
  transposeSemitones: number,
): GeneratedPhrase {
  const mapped = mapLickToFretboard(lick, pool, transposeSemitones);

  const notes: PhraseNote[] = lick.notes.map((n: LickNote, i: number) => {
    const m = mapped[i];
    if (n.rest || !m) {
      return {
        noteName: '',
        stringIdx: 0,
        fret: 0,
        semitone: 0,
        isChordTone: false,
        isApproach: false,
        isRest: true,
        beatPosition: Math.floor(n.beatStart * 2) + 1,
        isStrong: n.beatStart % 1 === 0 && (Math.floor(n.beatStart) % 2 === 0),
        duration: inferRhythmType(n.duration),
        beatStart: n.beatStart,
        segmentIdx: 0,
      };
    }

    const beatPos = Math.floor(n.beatStart * 2) + 1;
    return {
      noteName: m.noteName,
      stringIdx: m.stringIdx,
      fret: m.fret,
      semitone: m.semitone,
      isChordTone: m.isChordTone,
      isApproach: m.isApproach,
      beatPosition: beatPos,
      isStrong: n.beatStart % 1 === 0 && (Math.floor(n.beatStart) % 2 === 0),
      duration: inferRhythmType(n.duration),
      beatStart: n.beatStart,
      segmentIdx: 0,
    };
  });

  const config: PhraseConfig = {
    approachTypes: [],
  };

  return {
    notes,
    posId,
    modeKey,
    rootName,
    config,
    totalBeats: lick.beats,
  };
}

// ---------------------------------------------------------------------------
// Full pipeline: chord → transposed lick → GeneratedPhrase
// ---------------------------------------------------------------------------

/** Compute transposition semitones from lick's stored key to target chord root. */
export function getTransposeSemitones(quality: string, targetRootSemitone: number): number {
  const lickType = QUALITY_TO_LICK_TYPE[quality] ?? quality;
  const storedRootSemitone = TYPE_ROOT_SEMITONE[lickType] ?? 0;
  return targetRootSemitone - storedRootSemitone;
}

/** Build everything needed to display a lick for a given chord.
 *  Returns null if no matching lick type. */
export function buildLickContext(
  lick: LickEntry,
  quality: string,
  rootName: string,
  rootSemitone: number,
): {
  modeIdx: number;
  mode: Mode;
  fretMap: FretMap;
  positions: Position[];
  posId: number;
  pool: PoolNote[];
  transposeSemitones: number;
  phrase: GeneratedPhrase;
} | null {
  const transposeSemitones = getTransposeSemitones(quality, rootSemitone);

  // Infer best mode
  const modeIdx = inferModeFromLick(lick, quality, rootSemitone);
  const template = MODE_TEMPLATES[modeIdx];
  const mode = resolveMode(rootName as any, template);

  // 8-note scales not supported for lick mapping
  if (mode.notes.length > 7) return null;

  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = generatePositions(fretMap, mode.notes);

  // Find best position
  const posId = findBestPositionForLick(lick, positions, transposeSemitones);
  const pos = positions.find(p => p.id === posId);
  if (!pos) return null;

  // Build note pool (with chromatic for approach notes)
  const pool = buildNotePool(pos, mode, fretMap, true);

  // Convert to GeneratedPhrase
  const phrase = lickToGeneratedPhrase(
    lick, posId, template.key, rootName, pool, transposeSemitones,
  );

  return { modeIdx, mode, fretMap, positions, posId, pool, transposeSemitones, phrase };
}
