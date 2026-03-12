import type {
  LickDB, LickEntry, LickNote, PoolNote, PhraseNote,
  GeneratedPhrase, PhraseConfig, RhythmType, Mode, Position, FretMap,
} from '../types';
import { MODE_TEMPLATES } from '../constants';
import { QUALITY_TO_MODES } from './progression';
import { resolveMode } from './noteSpelling';
import { buildFretMap, generatePositions, generateDimPositions } from './fretboard';
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
  prevFret: number | null,
): { stringIdx: number; fret: number; noteName: string; semitone: number; isChordTone: boolean; isApproach: boolean; poolMatch: boolean } {
  // Find all pool notes matching this pitch
  const candidates = pool.filter(p => absolutePitch(p) === midiPitch);

  if (candidates.length > 0) {
    // Sort by combined score: string distance × 10 + fret distance
    candidates.sort((a, b) => {
      if (prevStringIdx != null) {
        const sDist = (d: PoolNote) => Math.abs(d.stringIdx - prevStringIdx!);
        const fDist = (d: PoolNote) => prevFret != null ? Math.abs(d.fret - prevFret!) : 0;
        const scoreA = sDist(a) * 10 + fDist(a);
        const scoreB = sDist(b) * 10 + fDist(b);
        return scoreA - scoreB;
      }
      // First note: prefer middle strings (G=2, D=3)
      const centerDist = (d: PoolNote) => Math.abs(d.stringIdx - 2.5);
      return centerDist(a) - centerDist(b);
    });
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
    const sDist = prevStringIdx != null ? Math.abs(s - prevStringIdx) : Math.abs(s - 2.5);
    const fDist = prevFret != null ? Math.abs(fret - prevFret) : 0;
    const dist = sDist * 10 + fDist;
    if (dist < bestDist) {
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

/** Map an entire lick to fretboard coordinates using the note pool.
 *  If some pitches fall outside the pool, tries shifting the entire
 *  lick ±1 octave to maximize pool coverage.
 *  @param extraShift - additional semitone shift (e.g. +12 for 8va) applied before auto-octave logic */
export function mapLickToFretboard(
  lick: LickEntry,
  pool: PoolNote[],
  transposeSemitones: number,
  extraShift = 0,
): Array<{ stringIdx: number; fret: number; noteName: string; semitone: number; isChordTone: boolean; isApproach: boolean } | null> {
  // Build set of available pitches in pool for quick lookup
  const poolPitches = new Set(pool.map(p => absolutePitch(p)));

  // Count how many pitched notes are covered at each octave offset
  const pitched = lick.notes.filter(n => !n.rest && n.pitch != null);
  const basePitches = pitched.map(n => n.pitch! + transposeSemitones + extraShift);

  let bestOctaveShift = 0;
  let bestCoverage = 0;
  for (const shift of [0, -12, 12]) {
    let cov = 0;
    for (const p of basePitches) {
      if (poolPitches.has(p + shift)) cov++;
    }
    if (cov > bestCoverage) {
      bestCoverage = cov;
      bestOctaveShift = shift;
    }
  }

  let prevStringIdx: number | null = null;
  let prevFret: number | null = null;
  return lick.notes.map((n: LickNote) => {
    if (n.rest) return null;
    const midiPitch = n.pitch! + transposeSemitones + extraShift + bestOctaveShift;
    const mapped = mapPitchToFret(midiPitch, pool, prevStringIdx, prevFret);
    prevStringIdx = mapped.stringIdx;
    prevFret = mapped.fret;
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

/** Infer top mode candidates (up to 3) with weighted scoring.
 *  On-beat and long notes contribute more to the score. */
export function inferModeCandidates(
  lick: LickEntry,
  quality: string,
  targetRootSemitone: number,
): { modeIdx: number; score: number; total: number }[] {
  const candidates = QUALITY_TO_MODES[quality];
  if (!candidates || candidates.length === 0) return [];

  const lickType = QUALITY_TO_LICK_TYPE[quality] ?? quality;
  const storedRootSemitone = TYPE_ROOT_SEMITONE[lickType] ?? 0;
  const transposeSemitones = targetRootSemitone - storedRootSemitone;

  // Compute average duration for weighting
  const pitched = lick.notes.filter(n => !n.rest && n.pitch != null);
  if (pitched.length === 0) return candidates.slice(0, 3).map(m => ({ modeIdx: m, score: 0, total: 0 }));
  const avgDur = pitched.reduce((s, n) => s + n.duration, 0) / pitched.length;

  // Precompute per-note weight and pitch class
  const noteData = pitched.map(n => {
    const pc = ((n.pitch! + transposeSemitones) % 12 + 12) % 12;
    const onBeat = Number.isInteger(n.beatStart);
    const longNote = n.duration >= avgDur;
    const w = (onBeat ? 2 : 1) * (longNote ? 2 : 1);
    return { pc, w };
  });
  const totalWeight = noteData.reduce((s, d) => s + d.w, 0);

  const CHROMATIC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const rootName = CHROMATIC_NAMES[targetRootSemitone % 12];
  const ROOTS_MAP: Record<string, number> = {
    'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
    'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  };
  const rootOffset = ROOTS_MAP[rootName] ?? 0;

  const scored = candidates.map(modeIdx => {
    const scaleSemis = new Set(MODE_TEMPLATES[modeIdx].semi.map(s => (s + rootOffset) % 12));
    let score = 0;
    for (const d of noteData) {
      if (scaleSemis.has(d.pc)) score += d.w;
    }
    return { modeIdx, score, total: totalWeight };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Position selection
// ---------------------------------------------------------------------------

/** Find the best position for a lick's notes. Returns posId.
 *  Evaluates each instance separately to avoid inflated scores from
 *  combining pitches across octave-separated instances. */
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

  if (pitches.length === 0) return allPositions[0].id;

  let bestPosId = allPositions[0].id;
  let bestScore = -1;

  for (const pos of allPositions) {
    // Score each instance separately, take the best
    let posScore = 0;
    for (const inst of pos.instances) {
      const instPitches = new Set<number>();
      for (let s = 0; s < 6; s++) {
        const notes = inst.strings[s];
        if (!notes) continue;
        for (const [, fret] of notes) {
          instPitches.add(OPEN_MIDI[s] + fret);
        }
      }

      let score = 0;
      for (const p of pitches) {
        if (instPitches.has(p)) score++;
      }
      if (score > posScore) posScore = score;
    }

    // Tiebreak: prefer position closer to previous
    const isBetter = posScore > bestScore ||
      (posScore === bestScore && prevPosId != null &&
        Math.abs(pos.id - prevPosId) < Math.abs(bestPosId - prevPosId));

    if (isBetter) {
      bestScore = posScore;
      bestPosId = pos.id;
    }
  }

  return bestPosId;
}

// ---------------------------------------------------------------------------
// Lick → GeneratedPhrase conversion
// ---------------------------------------------------------------------------

/** Convert a lick entry into a GeneratedPhrase for display and playback.
 *  @param extraShift - additional semitone shift (e.g. +12 for 8va) */
export function lickToGeneratedPhrase(
  lick: LickEntry,
  posId: number,
  modeKey: string,
  rootName: string,
  pool: PoolNote[],
  transposeSemitones: number,
  extraShift = 0,
): GeneratedPhrase {
  const mapped = mapLickToFretboard(lick, pool, transposeSemitones, extraShift);

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
// Instance selection
// ---------------------------------------------------------------------------

/** Select the best instance of a position for a given set of MIDI pitches.
 *  Considers ±1 octave shift for the entire lick to maximize coverage.
 *  Prefers majority coverage with low-fret bias (or high-fret if preferHigh). */
export function selectBestInstance(pos: Position, lickPitches: number[], preferHigh = false): number {
  if (pos.instances.length <= 1) return 0;
  if (lickPitches.length === 0) return 0;

  let bestIdx = 0;
  let bestCov = -1;
  let bestFret = preferHigh ? -1 : Infinity;

  for (let i = 0; i < pos.instances.length; i++) {
    const inst = pos.instances[i];
    const instPitches = new Set<number>();
    for (let s = 0; s < 6; s++) {
      const notes = inst.strings[s];
      if (!notes) continue;
      for (const [, fret] of notes) {
        instPitches.add(OPEN_MIDI[s] + fret);
      }
    }
    // Best coverage across octave shifts
    let cov = 0;
    for (const shift of [0, -12, 12]) {
      let c = 0;
      for (const p of lickPitches) if (instPitches.has(p + shift)) c++;
      if (c > cov) cov = c;
    }

    // Prefer higher coverage; tiebreak by fret preference
    const fretBetter = preferHigh
      ? inst.fretMin > bestFret
      : inst.fretMin < bestFret;
    if (cov > bestCov || (cov === bestCov && fretBetter)) {
      bestCov = cov;
      bestIdx = i;
      bestFret = inst.fretMin;
    }
  }

  return bestIdx;
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
 *  Returns null if no matching lick type.
 *  @param preferHigh - prefer high-fret instance when multiple exist */
export function buildLickContext(
  lick: LickEntry,
  quality: string,
  rootName: string,
  rootSemitone: number,
  preferHigh = false,
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

  const fretMap = buildFretMap(mode.semi, mode.notes);

  // 8-note scales (dim W-H / H-W) use generateDimPositions
  const positions = mode.notes.length > 7
    ? generateDimPositions(fretMap, mode.semi[0])
    : generatePositions(fretMap, mode.notes);

  // Find best position
  const posId = findBestPositionForLick(lick, positions, transposeSemitones);
  const pos = positions.find(p => p.id === posId);
  if (!pos) return null;

  // When preferHigh, shift pitches +12 so they land in the high instance
  const extraShift = preferHigh ? 12 : 0;
  const lickPitches = lick.notes
    .filter(n => !n.rest && n.pitch != null)
    .map(n => n.pitch! + transposeSemitones + extraShift);

  // Select best instance for the (possibly shifted) pitches
  const bestInstIdx = selectBestInstance(pos, lickPitches, preferHigh);

  // Build a single-instance position for pool building
  const singleInstPos: Position = {
    ...pos,
    instances: [pos.instances[bestInstIdx]],
  };

  // Build note pool (with chromatic for approach notes)
  const pool = buildNotePool(singleInstPos, mode, fretMap, true);

  // Convert to GeneratedPhrase
  const phrase = lickToGeneratedPhrase(
    lick, posId, template.key, rootName, pool, transposeSemitones, extraShift,
  );

  return { modeIdx, mode, fretMap, positions, posId, pool, transposeSemitones, phrase };
}
