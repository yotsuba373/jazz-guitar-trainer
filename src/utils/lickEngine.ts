import type {
  LickDB, LickEntry, LickNote, PoolNote, PhraseNote,
  GeneratedPhrase, RhythmType, Mode, Position, FretMap,
} from '../types';
import { MODE_TEMPLATES, OPEN_STRINGS, CHROMATIC_NAMES, NOTE_TO_SEMI } from '../constants';
import { QUALITY_TO_MODES } from './progression';
import { resolveMode } from './noteSpelling';
import { buildFretMap, generatePositions, generateDimPositions } from './fretboard';

// ---------------------------------------------------------------------------
// Shared helpers (moved from bebopScheduler / bebopGenerator)
// ---------------------------------------------------------------------------

/** Absolute pitch (semitone + octave info) for interval comparison.
 *  Uses fret as a proxy for octave height since we're on a guitar. */
export function absolutePitch(note: { stringIdx: number; fret: number }): number {
  const OPEN_MIDI_ABS = [64, 59, 55, 50, 45, 40]; // 1E=E4, B=B3, G=G3, D=D3, A=A2, 6E=E2
  return OPEN_MIDI_ABS[note.stringIdx] + note.fret;
}

/** Build note pool for a position (scale + optional chromatic approach notes). */
export function buildNotePool(
  position: Position,
  mode: Mode,
  _fretMap: FretMap,
  includeChromatic: boolean,
): PoolNote[] {
  const ctSet = new Set(mode.chordTones);
  const pool: PoolNote[] = [];
  const seen = new Set<string>();

  for (const inst of position.instances) {
    for (let s = 0; s < 6; s++) {
      const notes = inst.strings[s];
      if (!notes) continue;
      for (const [noteName, fret, semi] of notes) {
        const key = `${s}:${fret}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pool.push({ noteName, stringIdx: s, fret, semitone: semi, isChordTone: ctSet.has(noteName), isApproach: false });
      }
    }

    if (includeChromatic) {
      for (let s = 0; s < 6; s++) {
        const strNotes = inst.strings[s];
        if (!strNotes) continue;
        const minFret = Math.max(0, inst.fretMin - 1);
        const maxFret = inst.fretMax + 1;
        for (let fret = minFret; fret <= maxFret; fret++) {
          const key = `${s}:${fret}`;
          if (seen.has(key)) continue;
          const semi = (OPEN_STRINGS[s] + fret) % 12;
          const allScaleSemis = new Set(mode.semi);
          if (!allScaleSemis.has(semi)) {
            seen.add(key);

            pool.push({ noteName: CHROMATIC_NAMES[semi], stringIdx: s, fret, semitone: semi, isChordTone: false, isApproach: true });
          }
        }
      }
    }
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPEN_MIDI = [64, 59, 55, 50, 45, 40]; // 1E=E4, B=B3, G=G3, D=D3, A=A2, 6E=E2
const OCTAVE_SHIFTS = [0, -12, 12, -24, 24];

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

/** Lick DB stores all pitches relative to C root (semitone 0).
 *  parse_licks.py already transposes from the performance key to C.
 *  So transposition to a target chord = just targetRootSemitone. */

// ---------------------------------------------------------------------------
// DB loading
// ---------------------------------------------------------------------------

let cachedDB: LickDB | null = null;

export async function loadLickDB(): Promise<LickDB> {
  if (cachedDB) return cachedDB;
  const resp = await fetch('/licks.generated.json');
  if (!resp.ok) throw new Error(`Failed to load licks.generated.json: ${resp.status}`);
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
  poolCenterFret: number,
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
      // First note: prefer middle strings, biased toward pool's fret center
      const centerDist = (d: PoolNote) => Math.abs(d.stringIdx - 2.5);
      const fretDist = (d: PoolNote) => Math.abs(d.fret - poolCenterFret);
      return (centerDist(a) * 10 + fretDist(a)) - (centerDist(b) * 10 + fretDist(b));
    });
    const best = candidates[0];
    return { ...best, poolMatch: true };
  }

  // Fallback: calculate fret on each string, pick best

  const semitone = ((midiPitch % 12) + 12) % 12;
  const noteName = CHROMATIC_NAMES[semitone];

  let bestString = 0;
  let bestFret = midiPitch - OPEN_MIDI[0];
  let bestDist = Infinity;

  for (let s = 0; s < 6; s++) {
    const fret = midiPitch - OPEN_MIDI[s];
    if (fret < 0 || fret > 21) continue;
    const sDist = prevStringIdx != null ? Math.abs(s - prevStringIdx) : Math.abs(s - 2.5);
    const fDist = prevFret != null ? Math.abs(fret - prevFret) : Math.abs(fret - poolCenterFret);
    // With previous context, string proximity dominates (×10).
    // For first note (no prev), fret proximity to pool center dominates (×3)
    // to avoid jumping to a far-away fret on a "central" string.
    const dist = prevStringIdx != null ? sDist * 10 + fDist : sDist + fDist * 3;
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
 *  @param alternateOctave - when true, use the second-best octave placement instead of the default */
export function mapLickToFretboard(
  lick: LickEntry,
  pool: PoolNote[],
  transposeSemitones: number,
  alternateOctave = false,
): Array<{ stringIdx: number; fret: number; noteName: string; semitone: number; isChordTone: boolean; isApproach: boolean } | null> {
  const chosenShift = pickOctaveShift(lick, pool, transposeSemitones, alternateOctave);

  // Compute pool's fret centroid for first-note bias
  const poolCenterFret = pool.length > 0
    ? pool.reduce((sum, p) => sum + p.fret, 0) / pool.length
    : 5;

  let prevStringIdx: number | null = null;
  let prevFret: number | null = null;
  return lick.notes.map((n: LickNote) => {
    if (n.rest) return null;
    const midiPitch = n.pitch! + transposeSemitones + chosenShift;
    const mapped = mapPitchToFret(midiPitch, pool, prevStringIdx, prevFret, poolCenterFret);
    prevStringIdx = mapped.stringIdx;
    prevFret = mapped.fret;
    return mapped;
  });
}

/** Compute coverage for each octave shift candidate and return sorted results. */
function octaveCoverages(
  lick: LickEntry, pool: PoolNote[], transposeSemitones: number,
): Array<{ shift: number; coverage: number }> {
  const poolPitches = new Set(pool.map(p => absolutePitch(p)));
  const pitched = lick.notes.filter(n => !n.rest && n.pitch != null);
  const basePitches = pitched.map(n => n.pitch! + transposeSemitones);

  const results: Array<{ shift: number; coverage: number }> = [];
  for (const shift of OCTAVE_SHIFTS) {
    let cov = 0;
    for (const p of basePitches) if (poolPitches.has(p + shift)) cov++;
    results.push({ shift, coverage: cov });
  }
  // Sort descending by coverage
  results.sort((a, b) => b.coverage - a.coverage);
  return results;
}

/** Best viable octave shift (≥80% coverage). Returns { defaultShift, upShift? }.
 *  When multiple shifts share the best coverage, the highest pitch becomes 8va
 *  and the next highest becomes default.  Otherwise upShift = any viable shift
 *  above the default. */
function pickOctaveShifts(
  lick: LickEntry, pool: PoolNote[], transposeSemitones: number,
): { defaultShift: number; upShift: number | null } {
  const ranked = octaveCoverages(lick, pool, transposeSemitones);
  const total = lick.notes.filter(n => !n.rest && n.pitch != null).length;
  if (total === 0) return { defaultShift: 0, upShift: null };

  const viable = ranked.filter(r => r.coverage >= total * 0.8);
  if (viable.length === 0) return { defaultShift: ranked[0].shift, upShift: null };

  const bestCov = viable[0].coverage;
  const ties = viable.filter(r => r.coverage === bestCov);

  if (ties.length >= 2) {
    // Sort ties by shift descending — highest = 8va, next = default
    ties.sort((a, b) => b.shift - a.shift);
    return { defaultShift: ties[1].shift, upShift: ties[0].shift };
  }

  // No tie: default = best coverage, 8va = any viable shift above default
  const defaultShift = viable[0].shift;
  const up = viable.find(r => r.shift > defaultShift);
  return { defaultShift, upShift: up ? up.shift : null };
}

/** Pick the octave shift.  Default = best coverage; 8va = viable shift above it.
 *  If no higher viable shift exists, 8va is disabled and both return the same. */
function pickOctaveShift(
  lick: LickEntry, pool: PoolNote[], transposeSemitones: number, octaveUp: boolean,
): number {
  const { defaultShift, upShift } = pickOctaveShifts(lick, pool, transposeSemitones);
  if (octaveUp && upShift != null) return upShift;
  return defaultShift;
}

/** Check if 8va is available: a viable shift strictly above the default must exist. */
export function hasAlternateOctave(
  lick: LickEntry, pool: PoolNote[], transposeSemitones: number,
): boolean {
  const { upShift } = pickOctaveShifts(lick, pool, transposeSemitones);
  return upShift != null;
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

  // Extract pitch classes from lick (transposed to target key)
  const pitchClasses = new Set<number>();
  for (const n of lick.notes) {
    if (n.rest || n.pitch == null) continue;
    pitchClasses.add(((n.pitch + targetRootSemitone) % 12 + 12) % 12);
  }

  // Score each candidate mode by how many lick pitch classes are in the scale

  // Find root name from target semitone

  const rootName = CHROMATIC_NAMES[targetRootSemitone % 12];

  let bestIdx = candidates[0];
  let bestScore = -1;

  for (const modeIdx of candidates) {
    const template = MODE_TEMPLATES[modeIdx];
    const scaleSemis = new Set(template.semi.map(s => (s + (NOTE_TO_SEMI[rootName] ?? 0)) % 12));
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

  // Compute average duration for weighting
  const pitched = lick.notes.filter(n => !n.rest && n.pitch != null);
  if (pitched.length === 0) return candidates.slice(0, 3).map(m => ({ modeIdx: m, score: 0, total: 0 }));
  const avgDur = pitched.reduce((s, n) => s + n.duration, 0) / pitched.length;

  // Precompute per-note weight and pitch class
  const noteData = pitched.map(n => {
    const pc = ((n.pitch! + targetRootSemitone) % 12 + 12) % 12;
    const onBeat = Number.isInteger(n.beatStart);
    const longNote = n.duration >= avgDur;
    const w = (onBeat ? 2 : 1) * (longNote ? 2 : 1);
    return { pc, w };
  });
  const totalWeight = noteData.reduce((s, d) => s + d.w, 0);


  const rootName = CHROMATIC_NAMES[targetRootSemitone % 12];
  const rootOffset = NOTE_TO_SEMI[rootName] ?? 0;

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
 *  @param alternateOctave - use second-best octave placement within same instance */
export function lickToGeneratedPhrase(
  lick: LickEntry,
  posId: number,
  modeKey: string,
  rootName: string,
  pool: PoolNote[],
  transposeSemitones: number,
  alternateOctave = false,
): GeneratedPhrase {
  const mapped = mapLickToFretboard(lick, pool, transposeSemitones, alternateOctave);

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
        durationBeats: n.duration,
        beatStart: n.beatStart,
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
      durationBeats: n.duration,
      beatStart: n.beatStart,
    };
  });

  return {
    notes,
    posId,
    modeKey,
    rootName,
    totalBeats: lick.beats,
    anacrusis: lick.anacrusis,
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

  // When preferHigh is explicitly set, simply pick the highest-fret instance
  if (preferHigh) {
    let highIdx = 0;
    let highFret = -1;
    for (let i = 0; i < pos.instances.length; i++) {
      if (pos.instances[i].fretMin > highFret) {
        highFret = pos.instances[i].fretMin;
        highIdx = i;
      }
    }
    return highIdx;
  }

  // Default (preferHigh=false): pick the lowest-fret instance,
  // symmetric with preferHigh=true which picks the highest.
  // Only fall back to coverage-based selection if the low instance has zero coverage.
  let lowIdx = 0;
  let lowFret = Infinity;
  for (let i = 0; i < pos.instances.length; i++) {
    if (pos.instances[i].fretMin < lowFret) {
      lowFret = pos.instances[i].fretMin;
      lowIdx = i;
    }
  }

  // Verify the low-fret instance can cover at least one lick pitch
  const lowInst = pos.instances[lowIdx];
  const lowPitches = new Set<number>();
  for (let s = 0; s < 6; s++) {
    const notes = lowInst.strings[s];
    if (!notes) continue;
    for (const [, fret] of notes) lowPitches.add(OPEN_MIDI[s] + fret);
  }
  let lowCov = 0;
  for (const shift of OCTAVE_SHIFTS) {
    let c = 0;
    for (const p of lickPitches) if (lowPitches.has(p + shift)) c++;
    if (c > lowCov) lowCov = c;
  }
  if (lowCov > 0) return lowIdx;

  // Low-fret instance has zero coverage — fall back to best coverage
  let bestIdx = 0;
  let bestCov = -1;
  for (let i = 0; i < pos.instances.length; i++) {
    const inst = pos.instances[i];
    const instPitches = new Set<number>();
    for (let s = 0; s < 6; s++) {
      const notes = inst.strings[s];
      if (!notes) continue;
      for (const [, fret] of notes) instPitches.add(OPEN_MIDI[s] + fret);
    }
    let cov = 0;
    for (const shift of OCTAVE_SHIFTS) {
      let c = 0;
      for (const p of lickPitches) if (instPitches.has(p + shift)) c++;
      if (c > cov) cov = c;
    }
    if (cov > bestCov) {
      bestCov = cov;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ---------------------------------------------------------------------------
// Lick slicing (extract a beat range from a lick)
// ---------------------------------------------------------------------------

/** Extract a portion of a lick from `offset` for `beats` duration.
 *  Notes outside the range are dropped; remaining notes get beatStart shifted by -offset.
 *  Anacrusis is preserved only for the first slice (offset === 0). */
export function sliceLick(lick: LickEntry, offset: number, beats: number): LickEntry {
  const end = offset + beats;
  const slicedNotes = lick.notes
    .filter(n => n.beatStart >= offset && n.beatStart < end)
    .map(n => ({ ...n, beatStart: n.beatStart - offset }));

  return {
    ...lick,
    notes: slicedNotes,
    noteCount: slicedNotes.filter(n => !n.rest).length,
    beats,
    anacrusis: offset === 0 ? lick.anacrusis : undefined,
  };
}

// ---------------------------------------------------------------------------
// Full pipeline: chord → transposed lick → GeneratedPhrase
// ---------------------------------------------------------------------------

/** Compute transposition semitones from lick's stored key (C root) to target chord root. */
export function getTransposeSemitones(_quality: string, targetRootSemitone: number): number {
  return targetRootSemitone;
}

/** Compute transposition semitones for ii-V lick.
 *  Normalizes to [-6, 5] range to avoid octave displacement
 *  (e.g., Bb key → -2 instead of +10). */
export function getIiVTransposeSemitones(keyCenterSemitone: number): number {
  const t = keyCenterSemitone % 12;
  return t > 6 ? t - 12 : t;
}

/** Build everything needed to display a lick for a given chord.
 *  Returns null if no matching lick type.
 *  @param alternateOctave - use second-best octave placement within the same instance
 *  @param preferHighInstance - prefer high-fret instance when multiple exist
 *  @param overrideTransposeSemitones - override transposition (used for split ii-V licks) */
export function buildLickContext(
  lick: LickEntry,
  quality: string,
  rootName: string,
  rootSemitone: number,
  alternateOctave = false,
  preferHighInstance = false,
  overrideTransposeSemitones?: number,
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
  const transposeSemitones = overrideTransposeSemitones ?? getTransposeSemitones(quality, rootSemitone);

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

  const lickPitches = lick.notes
    .filter(n => !n.rest && n.pitch != null)
    .map(n => n.pitch! + transposeSemitones);

  // Instance selection: preferHighInstance selects high-fret instance independently of octave
  const bestInstIdx = selectBestInstance(pos, lickPitches, preferHighInstance);

  // Build a single-instance position for pool building
  const singleInstPos: Position = {
    ...pos,
    instances: [pos.instances[bestInstIdx]],
  };

  // Build note pool (with chromatic for approach notes)
  const pool = buildNotePool(singleInstPos, mode, fretMap, true);

  // Convert to GeneratedPhrase
  const phrase = lickToGeneratedPhrase(
    lick, posId, template.key, rootName, pool, transposeSemitones, alternateOctave,
  );

  return { modeIdx, mode, fretMap, positions, posId, pool, transposeSemitones, phrase };
}

// ---------------------------------------------------------------------------
// ii-V detection & context
// ---------------------------------------------------------------------------

export type IiVType = 'maj-ii-v-short' | 'maj-ii-v-long' | 'min-ii-v-short';

export interface IiVDetection {
  types: IiVType[];
  keyCenterSemitone: number;
}

/** DOM7 qualities that can serve as V chord */
const DOM7_QUALITIES = new Set(['7', '7alt', '7b9', '7#11', '7b13']);

/** Detect a ii-V pattern starting at chords[idx].
 *  Returns null if the pattern doesn't match. */
export function detectIiVPattern(
  chords: { quality: string; rootName: string }[],
  idx: number,
): IiVDetection | null {
  if (idx + 1 >= chords.length) return null;
  const ii = chords[idx];
  const V = chords[idx + 1];
  if (!DOM7_QUALITIES.has(V.quality)) return null;

  const iiRoot = NOTE_TO_SEMI[ii.rootName];
  const vRoot = NOTE_TO_SEMI[V.rootName];
  if (iiRoot == null || vRoot == null) return null;

  // ii root should be P5 (7 semitones) above V root (e.g., Dm7→G7: D-G = 7)
  if ((iiRoot - vRoot + 12) % 12 !== 7) return null;

  const keyCenterSemitone = (vRoot + 5) % 12; // I = V + P4 down = V + 5

  if (ii.quality === 'm7') {
    return { types: ['maj-ii-v-short', 'maj-ii-v-long'], keyCenterSemitone };
  }
  if (ii.quality === 'm7♭5') {
    return { types: ['min-ii-v-short'], keyCenterSemitone };
  }
  return null;
}

/** Check if a lick ID belongs to an ii-V type (prefix IS-/IL-/is-). */
export function isIiVLickId(id: string | undefined): IiVType | null {
  if (!id) return null;
  if (id.startsWith('IS-')) return 'maj-ii-v-short';
  if (id.startsWith('IL-') || id.startsWith('il-')) return 'maj-ii-v-long';
  if (id.startsWith('is-') || id.startsWith('iS-')) return 'min-ii-v-short';
  return null;
}

/** Build context for an ii-V lick. Uses V chord's mode/position for mapping. */
export function buildIiVLickContext(
  lick: LickEntry,
  keyCenterSemitone: number,
  vQuality: string,
  vRootName: string,
  vRootSemitone: number,
  alternateOctave = false,
  preferHighInstance = false,
): ReturnType<typeof buildLickContext> {
  // ii-V licks are stored in C=0; transpose to target key center
  // Normalize to [-6, 5] to avoid octave displacement
  const transposeSemitones = getIiVTransposeSemitones(keyCenterSemitone);

  // Use V chord's quality/root for mode inference
  const modeIdx = inferModeFromLick(lick, vQuality, vRootSemitone);
  const template = MODE_TEMPLATES[modeIdx];
  const mode = resolveMode(vRootName as any, template);

  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = mode.notes.length > 7
    ? generateDimPositions(fretMap, mode.semi[0])
    : generatePositions(fretMap, mode.notes);

  const posId = findBestPositionForLick(lick, positions, transposeSemitones);
  const pos = positions.find(p => p.id === posId);
  if (!pos) return null;

  const lickPitches = lick.notes
    .filter(n => !n.rest && n.pitch != null)
    .map(n => n.pitch! + transposeSemitones);

  const bestInstIdx = selectBestInstance(pos, lickPitches, preferHighInstance);
  const singleInstPos: Position = {
    ...pos,
    instances: [pos.instances[bestInstIdx]],
  };

  const pool = buildNotePool(singleInstPos, mode, fretMap, true);

  const phrase = lickToGeneratedPhrase(
    lick, posId, template.key, vRootName, pool, transposeSemitones, alternateOctave,
  );

  return { modeIdx, mode, fretMap, positions, posId, pool, transposeSemitones, phrase };
}
