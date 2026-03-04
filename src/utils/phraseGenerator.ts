import type { Position, Mode, FretMap, PhraseNote, PhraseConfig, PhraseContour, GeneratedPhrase, ApproachType, ApproachGroupInfo, SkeletonMeta } from '../types';
import { OPEN_STRINGS } from '../constants';

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

interface PoolNote {
  noteName: string;
  stringIdx: number;
  fret: number;
  semitone: number;
  isChordTone: boolean;
  isApproach: boolean;  // chromatic note outside the scale
}

// ---------------------------------------------------------------------------
// Strong-resolution mapping (normal mode: where does this mode resolve to?)
// Value = mode-degree offset (0-based) of the resolution target's 3rd.
// E.g. Ionian (I) resolves to IV → Lydian's 3rd = scale degree 6 (idx 5).
// We store the target modeIdx offset so we can find the 3rd in the same parent scale.
// ---------------------------------------------------------------------------

/** Map from mode key → degree index of the "resolution target 3rd" within the
 *  parent diatonic scale.  For Diatonic modes the strong resolution is:
 *    I→IV, ii→V, iii→vi, IV→V, V→I, vi→ii, vii°→I
 *  The value is the 0-based index within mode.notes of the target's 3rd.
 */
const STRONG_RESOLUTION_DEGREE_IDX: Record<string, number> = {
  // Diatonic
  'ionian': 5,      // I→IV: IV's 3rd = scale degree 6 (idx 5)
  'dorian': 6,      // ii→V: V's 3rd = scale degree 7 (idx 6)
  'phrygian': 0,    // iii→vi: vi's 3rd = scale degree 1 (idx 0)
  'lydian': 6,      // IV→V: V's 3rd = scale degree 7 (idx 6)  (or vii°→same)
  'mixolydian': 2,  // V→I: I's 3rd = scale degree 3 (idx 2)
  'aeolian': 3,     // vi→ii: ii's 3rd = scale degree 4 (idx 3)
  'locrian': 2,     // vii°→I: I's 3rd = scale degree 3 (idx 2)
  // Melodic Minor family
  'melodic-minor': 4,   // i→iv: iv's 3rd = degree 5
  'dorian-b2': 6,
  'lydian-aug': 6,
  'lydian-dom': 2,
  'mixo-b6': 2,
  'locrian-nat2': 2,
  'altered': 2,
  // Harmonic Minor family
  'harmonic-minor': 4,
  'phrygian-dom': 2,
};

// ---------------------------------------------------------------------------
// Contour curves — normalised 0-1 pitch targets for beat positions 1-8
// ---------------------------------------------------------------------------

const CONTOUR_CURVES: Record<PhraseContour, number[]> = {
  'arch':          [0.3, 0.5, 0.7, 1.0, 0.9, 0.7, 0.5, 0.3],
  'reverse-arch':  [0.7, 0.5, 0.3, 0.0, 0.1, 0.3, 0.5, 0.7],
  'descending':    [1.0, 0.9, 0.8, 0.65, 0.5, 0.4, 0.25, 0.1],
  'wave':          [0.4, 0.8, 0.3, 0.7, 0.2, 0.6, 0.35, 0.5],
};

const ALL_CONTOURS: PhraseContour[] = ['arch', 'reverse-arch', 'descending', 'wave'];

/** Preferred contour transitions for macro-level coherence across phrases */
const CONTOUR_TRANSITIONS: Record<PhraseContour, PhraseContour[]> = {
  'arch':          ['descending', 'wave', 'reverse-arch'],   // peaked → falling/undulating
  'reverse-arch':  ['arch', 'wave', 'descending'],           // valley → rising
  'descending':    ['reverse-arch', 'arch', 'wave'],         // ended low → start low/rise
  'wave':          ['arch', 'descending', 'reverse-arch'],   // undulating → directed motion
};

// ---------------------------------------------------------------------------
// Arpeggio patterns — CT index sequences for skeleton harmonic direction
// ---------------------------------------------------------------------------

const ARPEGGIO_PATTERNS: { ctIndices: number[]; direction: 'asc' | 'desc' | 'mixed' }[] = [
  // ctIndices[0..3] → [beat1, beat3, beat5, goal]
  { ctIndices: [0, 1, 2, 3], direction: 'asc' },   // R-3-5-7
  { ctIndices: [1, 2, 3, 0], direction: 'asc' },   // 3-5-7-R
  { ctIndices: [2, 3, 0, 1], direction: 'asc' },   // 5-7-R-3
  { ctIndices: [3, 2, 1, 0], direction: 'desc' },  // 7-5-3-R
  { ctIndices: [0, 3, 2, 1], direction: 'desc' },  // R-7-5-3
  { ctIndices: [1, 0, 3, 2], direction: 'desc' },  // 3-R-7-5
  { ctIndices: [0, 2, 1, 3], direction: 'mixed' }, // R-5-3-7
  { ctIndices: [3, 1, 2, 0], direction: 'mixed' }, // 7-3-5-R
  { ctIndices: [1, 3, 0, 2], direction: 'mixed' }, // 3-7-R-5
];

const CONTOUR_PATTERN_AFFINITY: Record<PhraseContour, ('asc' | 'desc' | 'mixed')[]> = {
  'arch': ['asc', 'mixed'], 'reverse-arch': ['desc', 'mixed'],
  'descending': ['desc', 'mixed'], 'wave': ['mixed', 'asc', 'desc'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStrongBeat(beat: number, goalBeat = 8): boolean {
  if (beat === goalBeat) return true;
  if (beat === 1 || beat === 3) return true;
  if (beat === 5 && goalBeat >= 8) return true;
  return false;
}

/** Absolute pitch (semitone + octave info) for interval comparison.
 *  Uses fret as a proxy for octave height since we're on a guitar.  */
export function absolutePitch(note: { stringIdx: number; fret: number }): number {
  // MIDI-like: open string MIDI base + fret
  const OPEN_MIDI = [64, 59, 55, 50, 45, 40]; // 1E=E4, B=B3, G=G3, D=D3, A=A2, 6E=E2
  return OPEN_MIDI[note.stringIdx] + note.fret;
}

function semiInterval(a: PoolNote | PhraseNote, b: PoolNote | PhraseNote): number {
  return Math.abs(absolutePitch(a) - absolutePitch(b));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[0];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
// Note pool construction
// ---------------------------------------------------------------------------

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
        pool.push({
          noteName,
          stringIdx: s,
          fret,
          semitone: semi,
          isChordTone: ctSet.has(noteName),
          isApproach: false,
        });
      }
    }

    // Add chromatic approach notes (±1 fret outside the position for each string)
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
          // Only add if it's NOT in the scale (chromatic passing tone)
          const allScaleSemis = new Set(mode.semi);
          if (!allScaleSemis.has(semi)) {
            seen.add(key);
            // Derive note name from semitone
            const CHROMATIC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
            pool.push({
              noteName: CHROMATIC_NAMES[semi],
              stringIdx: s,
              fret,
              semitone: semi,
              isChordTone: false,
              isApproach: true,
            });
          }
        }
      }
    }
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Approach pattern helpers
// ---------------------------------------------------------------------------

/** Find approach notes for a target chord tone.
 *  Returns the approach notes IN ORDER (excluding the target itself).
 *  Each note is a PoolNote from the pool, or a chromatic note computed on-the-fly.
 */
export function getApproachNotes(
  target: PoolNote,
  pool: PoolNote[],
  approachType: ApproachType,
  mode: Mode,
): PoolNote[] | null {
  const find = (stringIdx: number, fret: number): PoolNote | null =>
    pool.find(n => n.stringIdx === stringIdx && n.fret === fret) ?? null;

  const chromatic = (stringIdx: number, fret: number): PoolNote | null => {
    if (fret < 0 || fret > 22) return null;
    const semi = (OPEN_STRINGS[stringIdx] + fret) % 12;
    const CHROMATIC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
    return {
      noteName: CHROMATIC_NAMES[semi],
      stringIdx,
      fret,
      semitone: semi,
      isChordTone: false,
      isApproach: true,
    };
  };

  switch (approachType) {
    case 'single-below': {
      const note = find(target.stringIdx, target.fret - 1) ?? chromatic(target.stringIdx, target.fret - 1);
      return note ? [note] : null;
    }
    case 'single-above': {
      const note = find(target.stringIdx, target.fret + 1) ?? chromatic(target.stringIdx, target.fret + 1);
      return note ? [note] : null;
    }
    case 'enclosure': {
      // Diatonic above: find the nearest scale tone above on the same string
      const above = pool.filter(n =>
        n.stringIdx === target.stringIdx && n.fret > target.fret && !n.isApproach
      ).sort((a, b) => a.fret - b.fret)[0];
      // Chromatic below
      const below = chromatic(target.stringIdx, target.fret - 1);
      if (!above || !below) return null;
      return [
        { ...above, isApproach: true },
        { ...below, isApproach: true },
      ];
    }
    case 'parker-enclosure': {
      // [CT+1] → [CT-2] → [CT-1] → CT
      const n1 = chromatic(target.stringIdx, target.fret + 1);
      const n2 = chromatic(target.stringIdx, target.fret - 2);
      const n3 = chromatic(target.stringIdx, target.fret - 1);
      if (!n1 || !n2 || !n3) return null;
      return [n1, n2, n3];
    }
    case 'b9-arpeggio': {
      // Only valid on dominant 7 chords
      if (mode.chordQuality !== '7' && mode.chordQuality !== '7b9' &&
          mode.chordQuality !== '7#11' && mode.chordQuality !== '7b13') return null;
      // b9→3→5→b7 arpeggio (dim7 from the 3rd)
      // We need these as pool notes near the target area
      const ctNotes = mode.chordTones; // [R, 3, 5, b7]
      const third = ctNotes[1];
      const fifth = ctNotes[2];
      const seventh = ctNotes[3];
      // Find b9 semitone (root + 1)
      const rootSemi = mode.semi[0];
      const b9Semi = (rootSemi + 1) % 12;
      // Collect the arpeggio notes near target's string area
      const arpNotes: PoolNote[] = [];
      const CHROMATIC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
      // b9
      const b9Note = pool.find(n => n.semitone === b9Semi && Math.abs(n.stringIdx - target.stringIdx) <= 2)
        ?? { noteName: CHROMATIC_NAMES[b9Semi], stringIdx: target.stringIdx, fret: -1, semitone: b9Semi, isChordTone: false, isApproach: true };
      if (b9Note.fret < 0) return null; // can't find on fretboard
      arpNotes.push({ ...b9Note, isApproach: true });
      // 3rd
      const thirdNote = pool.find(n => n.noteName === third && Math.abs(n.stringIdx - target.stringIdx) <= 2 && absolutePitch(n) > absolutePitch(b9Note));
      if (!thirdNote) return null;
      arpNotes.push({ ...thirdNote, isApproach: false, isChordTone: true });
      // 5th
      const fifthNote = pool.find(n => n.noteName === fifth && Math.abs(n.stringIdx - target.stringIdx) <= 2 && absolutePitch(n) > absolutePitch(thirdNote));
      if (!fifthNote) return null;
      arpNotes.push({ ...fifthNote, isApproach: false, isChordTone: true });
      // b7
      const seventhNote = pool.find(n => n.noteName === seventh && Math.abs(n.stringIdx - target.stringIdx) <= 2 && absolutePitch(n) > absolutePitch(fifthNote));
      if (!seventhNote) return null;
      arpNotes.push({ ...seventhNote, isApproach: false, isChordTone: true });
      return arpNotes;
    }
  }
}

// ---------------------------------------------------------------------------
// Extension tones (9th, 13th) — allowed on strong beats for richer harmony
// Map: chord quality → array of scale degree indices (0-based) that are extensions
// ---------------------------------------------------------------------------

const EXTENSION_DEGREES: Record<string, number[]> = {
  'maj7':  [1, 5],  // 9th (degree 2) and 13th (degree 6)
  '7':     [1, 5],  // 9th and 13th
  'm7':    [1],     // 9th only (13th = ♭13 in Dorian, less common)
  'mMaj7': [1],     // 9th
  '7alt':  [],      // Altered tensions are already chord tones
  'dim7':  [],      // Symmetric — no extensions
};

function isExtensionTone(noteName: string, mode: Mode): boolean {
  const indices = EXTENSION_DEGREES[mode.chordQuality];
  if (!indices || indices.length === 0) return false;
  return indices.some(idx => mode.notes[idx] === noteName);
}

// ---------------------------------------------------------------------------
// Bebop passing tones — chromatic notes that create bebop-scale feel
// Map: mode key → semitone value (0-11) of the bebop passing tone
// ---------------------------------------------------------------------------

const BEBOP_PASSING: Record<string, number> = {
  'mixolydian': 11, // natural 7th (between ♭7 and R)
  'dorian':      3, // natural 3rd (between ♭3 and 4)
  'ionian':     10, // ♭7 (between 6 and 7)
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function intervalScore(interval: number): number {
  if (interval <= 2) return 60;   // stepwise
  if (interval <= 4) return 25;   // thirds
  if (interval === 5) return 10;  // fourths
  return 5;                       // fifths+
}

function contourScore(
  candidate: PoolNote,
  beatIdx: number,      // 0-based index into the contour curve
  contour: PhraseContour,
  pitchRange: { min: number; max: number },
): number {
  const curve = CONTOUR_CURVES[contour];
  const target = curve[beatIdx];
  const range = pitchRange.max - pitchRange.min || 1;
  const normalised = (absolutePitch(candidate) - pitchRange.min) / range;
  const diff = Math.abs(normalised - target);
  return Math.max(0, 22 - diff * 44);
}

function directionScore(
  candidate: PoolNote,
  prevNote: PoolNote | PhraseNote,
  prevPrevNote: PoolNote | PhraseNote | null,
  consecutiveSameDir: number,
): number {
  const curDir = absolutePitch(candidate) - absolutePitch(prevNote);
  if (prevPrevNote === null) return 0;
  const prevDir = absolutePitch(prevNote) - absolutePitch(prevPrevNote);
  const sameDirection = (curDir > 0 && prevDir > 0) || (curDir < 0 && prevDir < 0);

  if (sameDirection) {
    // Bebop lines often have 3-4 note scalar runs (Parker staple)
    if (consecutiveSameDir >= 4) return -25; // 5+ notes: loses phrase shape
    if (consecutiveSameDir >= 3) return 0;   // 4 notes: neutral
    return 5; // 2-3 note runs: natural scalar passages
  } else {
    // Direction change — creates melodic interest
    return 15;
  }
}

/** Minimum semitone distance from candidate to any instance of goalNoteName in the pool */
function nearestGoalDist(candidate: PoolNote, goalNoteName: string, ctPool: PoolNote[]): number {
  const instances = ctPool.filter(n => n.noteName === goalNoteName);
  if (instances.length === 0) return Infinity;
  return Math.min(...instances.map(n => Math.abs(absolutePitch(candidate) - absolutePitch(n))));
}

/** Find the closest physical instance of a note name relative to a reference position */
function nearestInstance(
  noteName: string,
  ref: { stringIdx: number; fret: number },
  pool: PoolNote[],
): PoolNote | null {
  const candidates = pool.filter(n => n.noteName === noteName);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, n) => {
    const distN = Math.abs(absolutePitch(n) - absolutePitch(ref));
    const distB = Math.abs(absolutePitch(best) - absolutePitch(ref));
    return distN < distB ? n : best;
  });
}

function goalProximityScore(
  candidate: PoolNote,
  goalNoteName: string,
  ctPool: PoolNote[],
  beatPosition: number,
  goalBeat = 8,
): number {
  // Approach zone: last 2 beats before goal (or last 1 for short phrases)
  const approachStart = goalBeat <= 4 ? goalBeat - 1 : goalBeat - 2;
  if (beatPosition < approachStart) return 0;
  const dist = nearestGoalDist(candidate, goalNoteName, ctPool);
  if (dist === Infinity) return 0;
  if (beatPosition === goalBeat - 1) {
    // Penultimate beat: strong pull towards goal
    if (dist <= 5) {
      let bonus = (20 - dist * 3) * 2.5;
      // Half-step approach: chromatic resolution is the strongest bebop device
      if (dist === 1) bonus += 15;
      return bonus;
    }
    return -dist * 3; // penalise being far from goal
  }
  return Math.max(0, (20 - dist * 3));
}

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------

export function generatePhrase(
  position: Position,
  mode: Mode,
  fretMap: FretMap,
  config: PhraseConfig,
  targetThirdNote?: string,
): GeneratedPhrase {
  const includeChromatic = config.approachTypes.length > 0;
  const pool = buildNotePool(position, mode, fretMap, includeChromatic);
  const ctSet = new Set(mode.chordTones);
  const ctPool = pool.filter(n => n.isChordTone);

  if (ctPool.length === 0) {
    throw new Error('No chord tones found in position');
  }

  // --- Contour selection (with macro-coherence when chained) ---
  const contour = config.contour
    ?? (config.prevContour
      ? pickWeighted(CONTOUR_TRANSITIONS[config.prevContour], [3, 2, 1])
      : pickRandom(ALL_CONTOURS));

  // Use first instance for compact range (avoid spanning multiple octaves)
  const firstInst = position.instances[0];
  const instPool = pool.filter(n =>
    n.fret >= firstInst.fretMin - 1 && n.fret <= firstInst.fretMax + 1
  );
  const instCtPool = instPool.filter(n => n.isChordTone);
  const activePool = instPool.length > 6 ? instPool : pool;
  const activeCtPool = instCtPool.length >= 2 ? instCtPool : ctPool;

  // --- Pitch range of the active pool ---
  const pitches = activePool.map(absolutePitch);
  const pitchRange = { min: Math.min(...pitches), max: Math.max(...pitches) };

  // --- Phrase length & goal beat ---
  const totalBeats = config.phraseLength ?? 8;
  const goalBeat = Math.min(totalBeats, 8);

  // --- Goal note ---
  const goalResult = chooseGoalNote(activeCtPool, mode, targetThirdNote, config.nextChordContext);
  const goalNote = goalResult.note;

  // --- CT skeleton: pre-plan strong-beat CTs for phrase direction ---
  const skeleton = planCtSkeleton(activeCtPool, goalNote, contour, pitchRange, config.startHint, totalBeats, mode);

  // --- Start note (beat 1) from skeleton ---
  const startNote = skeleton.beat1;

  // --- Generate notes for beats 2..(goalBeat-1), then goal at goalBeat ---
  const notes: PhraseNote[] = [];
  notes.push(poolToPhraseNote(startNote, 1));

  let consecutiveSameDir = 0;
  let goalFilled = false; // track if approach pattern already filled the goal beat
  let approachGroupId = 0;
  let prevStrongNote: PoolNote | PhraseNote = startNote; // track last CT on strong beat
  let patternUsed = false; // 1 digital pattern per phrase

  // Beat 1: try digital pattern from skeleton start
  if (goalBeat >= 6 && !patternUsed) {
    const committed = tryDigitalPattern(1, startNote, mode, activeCtPool, activePool, goalBeat, skeleton);
    if (committed) {
      // Tag beat-1 note as digital pattern start (position: -1 indicates the anchor note)
      if (committed.length > 0 && committed[0].digitalPattern) {
        notes[0].digitalPattern = { name: committed[0].digitalPattern.name, position: -1, size: committed[0].digitalPattern.size };
      }
      for (const cn of committed) {
        notes.push(cn);
        if (cn.beatPosition === goalBeat) goalFilled = true;
        if (cn.isStrong) prevStrongNote = cn;
      }
      patternUsed = true;
    }
  }

  for (let beat = 2; beat <= goalBeat - 1; beat++) {
    // Skip if this beat was already filled by an approach pattern or digital pattern
    if (notes.some(n => n.beatPosition === beat)) continue;

    const prevNote = notes[notes.length - 1];
    const prevPrevNote = notes.length >= 2 ? notes[notes.length - 2] : null;
    const strong = isStrongBeat(beat, goalBeat);

    // --- Try digital pattern on strong beats ---
    if (strong && !patternUsed && beat <= goalBeat - 2) {
      const skeletonNote = beat === 3 ? skeleton.beat3
        : beat === 5 ? skeleton.beat5 : null;
      if (skeletonNote) {
        const committed = tryDigitalPattern(beat, skeletonNote, mode, activeCtPool, activePool, goalBeat, skeleton);
        if (committed) {
          const startPN = poolToPhraseNote(skeletonNote, beat);
          if (committed.length > 0 && committed[0].digitalPattern) {
            startPN.digitalPattern = { name: committed[0].digitalPattern.name, position: -1, size: committed[0].digitalPattern.size };
          }
          notes.push(startPN);
          for (const cn of committed) {
            notes.push(cn);
            if (cn.beatPosition === goalBeat) goalFilled = true;
            if (cn.isStrong) prevStrongNote = cn;
          }
          patternUsed = true;
          continue;
        }
      }
    }

    // --- Try approach pattern commitment ---
    if (!strong && includeChromatic && config.approachTypes.length > 0) {
      const committed = tryApproachCommitment(
        beat, activePool, activeCtPool, mode, config, notes, goalNote, approachGroupId, goalBeat,
      );
      if (committed) {
        approachGroupId = committed.nextGroupId;
        for (const cn of committed.notes) {
          notes.push(cn);
          if (cn.beatPosition === goalBeat) goalFilled = true;
          if (cn.isStrong) prevStrongNote = cn;
        }
        // Update direction tracking
        if (notes.length >= 2) {
          const last = notes[notes.length - 1];
          const secondLast = notes[notes.length - 2];
          const d = absolutePitch(last) - absolutePitch(secondLast);
          if (notes.length >= 3) {
            const thirdLast = notes[notes.length - 3];
            const pd = absolutePitch(secondLast) - absolutePitch(thirdLast);
            if ((d > 0 && pd > 0) || (d < 0 && pd < 0)) {
              consecutiveSameDir = Math.min(consecutiveSameDir + committed.notes.length, 5);
            } else {
              consecutiveSameDir = 1;
            }
          }
        }
        continue;
      }
    }

    // --- Normal candidate scoring ---
    const candidates = getCandidates(prevNote, activePool, strong, ctSet, notes, mode);
    if (candidates.length === 0) {
      // Fallback: any CT in the active pool that isn't same note
      const fallback = activeCtPool.filter(n =>
        !(n.stringIdx === prevNote.stringIdx && n.fret === prevNote.fret) &&
        absolutePitch(n) !== absolutePitch(prevNote)
      );
      if (fallback.length > 0) {
        const note = pickRandom(fallback);
        notes.push(poolToPhraseNote(note, beat));
        consecutiveSameDir = 0;
        continue;
      }
      // Absolute fallback: at least avoid same (stringIdx, fret)
      const lastResort = activeCtPool.filter(n =>
        !(n.stringIdx === prevNote.stringIdx && n.fret === prevNote.fret)
      );
      notes.push(poolToPhraseNote(
        lastResort.length > 0 ? pickRandom(lastResort) : pickRandom(activeCtPool),
        beat,
      ));
      consecutiveSameDir = 0;
      continue;
    }

    // Compute once per beat for pitch variety scoring
    const usedPitchClasses = new Set(notes.map(n => n.semitone));

    const weights = candidates.map(c => {
      const interval = semiInterval(prevNote, c);
      let score = intervalScore(interval);
      score += contourScore(c, beat - 1, contour, pitchRange);
      score += directionScore(c, prevNote, prevPrevNote, consecutiveSameDir);
      score += goalProximityScore(c, goalNote.noteName, activeCtPool, beat, goalBeat);

      // Voice leading to next chord: in late beats, bonus for approaching next 3rd
      if (config.nextChordContext && beat >= goalBeat - 2 && beat < goalBeat) {
        const nextThirdSemi = findSemitone(config.nextChordContext.thirdNote);
        if (nextThirdSemi !== null) {
          const dist = Math.min(
            Math.abs(c.semitone - nextThirdSemi),
            12 - Math.abs(c.semitone - nextThirdSemi),
          );
          if (dist === 1) score += 20;      // half-step to next 3rd
          else if (dist === 0) score += 10;  // common tone
        }
      }

      // String distance penalty (heavier to keep phrases compact)
      const strDist = Math.abs(c.stringIdx - prevNote.stringIdx);
      score -= strDist * 15;

      // Large interval penalty (keep Parker-like compactness)
      if (interval >= 6) score -= 25;
      if (interval >= 8) score -= 35;
      if (interval >= 10) score -= 20; // extra penalty for 10+ semitones

      // Penalise returning to the same pitch as 2 notes ago (A→B→A oscillation)
      // -90 ensures net negative even with stepwise(60) + dirChange(15) + passing(10) bonuses
      if (prevPrevNote && absolutePitch(c) === absolutePitch(prevPrevNote)) {
        score -= 90;
      }

      // Same note-name oscillation at different octaves (B3→C4→B4 harmonic monotony)
      if (prevPrevNote && c.noteName === prevPrevNote.noteName &&
          absolutePitch(c) !== absolutePitch(prevPrevNote)) {
        score -= 35;
      }

      // Extended oscillation: also check 3 notes back (A→B→C→A)
      if (notes.length >= 3) {
        const threeBack = notes[notes.length - 3];
        if (absolutePitch(c) === absolutePitch(threeBack)) score -= 45;
      }

      // Near-oscillation: returning within 1 semitone of 2-back note
      // (e.g. C→D→C# still sounds like aimless motion)
      if (prevPrevNote) {
        const ppDist = Math.abs(absolutePitch(c) - absolutePitch(prevPrevNote));
        if (ppDist === 1) score -= 15;
      }

      // Weak-beat echo: on weak beats, avoid returning to the same note name
      // as the previous weak beat (prevents D→E→D→E alternation patterns)
      if (!strong && notes.length >= 3) {
        // Find last weak-beat note
        for (let k = notes.length - 1; k >= Math.max(0, notes.length - 3); k--) {
          if (!isStrongBeat(notes[k].beatPosition) && notes[k].noteName === c.noteName) {
            score -= 25;
            break;
          }
        }
      }

      // CT variety: penalise reusing the same CT on consecutive strong beats
      if (strong && c.noteName === prevStrongNote.noteName) {
        score -= 50;
      }

      // Pitch-class monotony: if last 3 notes use only 2 distinct note names,
      // penalise continuing with either name (prevents B↔C↔B↔C patterns)
      // Must exceed skeleton adherence bonus (+40) to be effective
      if (notes.length >= 3) {
        const recentNameArr = [
          notes[notes.length - 1].noteName,
          notes[notes.length - 2].noteName,
          notes[notes.length - 3].noteName,
        ];
        const recentNames = new Set(recentNameArr);
        if (recentNames.size <= 2 && recentNames.has(c.noteName)) {
          score -= 55;
          // Extra penalty if the 2 names are semitone-adjacent (e.g. B↔C, E↔F)
          if (recentNames.size === 2) {
            const [n1, n2] = [...recentNames];
            const pool1 = activePool.find(p => p.noteName === n1);
            const pool2 = activePool.find(p => p.noteName === n2);
            if (pool1 && pool2) {
              const semDist = Math.abs(pool1.semitone - pool2.semitone);
              if (semDist === 1 || semDist === 11) score -= 15;
            }
          }
        }
      }

      // Extended monotony: 4-note window (catches beat 6 in B→C→B→C→B patterns)
      if (notes.length >= 4) {
        const fourNames = new Set([
          notes[notes.length - 1].noteName, notes[notes.length - 2].noteName,
          notes[notes.length - 3].noteName, notes[notes.length - 4].noteName,
        ]);
        if (fourNames.size <= 2 && fourNames.has(c.noteName)) {
          score -= 30;
        }
      }

      // Guide tone preference: 3rd and 7th on strong beats are melodically richer
      if (strong) {
        const ctIdx = mode.chordTones.indexOf(c.noteName);
        if (ctIdx === 1 || ctIdx === 3) {
          score += 25;
          if (beat === 1 || beat === 3) score += 10;
        }
        // Extension tone: 9th/13th are allowed but penalised vs CTs
        // (filter admits them, but scoring prefers actual chord tones)
        if (!c.isChordTone && isExtensionTone(c.noteName, mode)) {
          score -= 10;
        }
      }

      // Pitch variety: bonus for introducing a new pitch class
      if (!usedPitchClasses.has(c.semitone)) score += 8;

      // Motif similarity: on beats 2-4, reward matching the previous phrase's motif
      if (config.prevMotif && config.prevMotif.length > 0 && beat >= 2 && beat <= 4) {
        const motifIdx = beat - 2; // beat 2→index 0, beat 3→index 1
        if (motifIdx < config.prevMotif.length) {
          const expectedInterval = config.prevMotif[motifIdx];
          const actualInterval = absolutePitch(c) - absolutePitch(prevNote);
          if (actualInterval === expectedInterval) score += 12;  // exact match
          else if (Math.abs(actualInterval - expectedInterval) <= 1) score += 6;  // near match
        }
      }

      // Scalar run continuation: reward extending a stepwise passage
      if (prevPrevNote) {
        const prevStep = absolutePitch(prevNote) - absolutePitch(prevPrevNote);
        const curStep = absolutePitch(c) - absolutePitch(prevNote);
        if (Math.abs(prevStep) <= 2 && prevStep !== 0 &&
            Math.abs(curStep) <= 2 && curStep !== 0 &&
            ((prevStep > 0 && curStep > 0) || (prevStep < 0 && curStep < 0))) {
          score += 14;
        }
      }

      // Bebop passing tone: on weak beats during scalar passages, bonus for
      // the characteristic bebop-scale chromatic note (e.g. nat7 in Mixolydian)
      if (!strong && !c.isChordTone && !c.isApproach) {
        const bpSemi = BEBOP_PASSING[mode.key];
        if (bpSemi !== undefined && c.semitone === bpSemi) {
          // Only reward during scalar motion (stepwise from previous note)
          const stepFromPrev = Math.abs(absolutePitch(c) - absolutePitch(prevNote));
          if (stepFromPrev <= 2 && stepFromPrev > 0) score += 20;
        }
      }

      // CT outline progression: reward consecutive strong-beat CTs forming arpeggio
      if (strong && prevStrongNote) {
        const prevCtIdx = mode.chordTones.indexOf(prevStrongNote.noteName);
        const curCtIdx = mode.chordTones.indexOf(c.noteName);
        if (prevCtIdx >= 0 && curCtIdx >= 0 && prevCtIdx !== curCtIdx) {
          const diff = Math.abs(curCtIdx - prevCtIdx);
          if (diff === 1 || diff === 3) score += 12;  // adjacent CT (R→3, 5→7 etc.)
          else if (diff === 2) score += 6;             // skip-one (R→5, 3→7)
        }
      }

      // Arpeggio fragment: 3+ consecutive CTs with different names → strong chord outline
      if (c.isChordTone && notes.length >= 2) {
        const n1 = notes[notes.length - 1];
        const n2 = notes[notes.length - 2];
        if (n1.isChordTone && n2.isChordTone) {
          const names = new Set([n2.noteName, n1.noteName, c.noteName]);
          if (names.size === 3) {
            score += 18;
            const idx0 = mode.chordTones.indexOf(n2.noteName);
            const idx1 = mode.chordTones.indexOf(n1.noteName);
            const idx2 = mode.chordTones.indexOf(c.noteName);
            if (idx0 >= 0 && idx1 >= 0 && idx2 >= 0) {
              const d1 = ((idx1 - idx0) + 4) % 4;
              const d2 = ((idx2 - idx1) + 4) % 4;
              if (d1 === d2) score += 8;
            }
          }
        }
      }

      // Skeleton adherence: strong bonus for matching the pre-planned CT
      // But scale down if it would require a large leap from previous note
      if (strong) {
        const skeletonTarget = beat === 3 ? (skeleton.beat3 ?? null)
          : beat === 5 ? (skeleton.beat5 ?? null) : null;
        if (skeletonTarget && c.noteName === skeletonTarget.noteName) {
          // Reduce skeleton bonus when leap from prev note is large
          const leapToSkel = interval;
          const skelBonus = leapToSkel >= 7 ? 25 : 50; // halve bonus for large leaps
          score += skelBonus;
          // Extra bonus for the exact planned instance (same string/fret region)
          const skelDist = Math.abs(absolutePitch(c) - absolutePitch(skeletonTarget));
          if (skelDist <= 2) score += 25;
        }
      }

      // Narrow-zone stagnation: penalise if last 3 notes + candidate within 3 semitones
      if (notes.length >= 3) {
        const recent = [
          absolutePitch(notes[notes.length - 3]),
          absolutePitch(notes[notes.length - 2]),
          absolutePitch(notes[notes.length - 1]),
          absolutePitch(c),
        ];
        const hi = Math.max(...recent);
        const lo = Math.min(...recent);
        if (hi - lo <= 2) score -= 20; // extreme stagnation (nearly same pitch)
        if (hi - lo <= 3) score -= 35;
        // Extended stagnation: 5 notes within 4 semitones
        if (notes.length >= 4) {
          const ext = [absolutePitch(notes[notes.length - 4]), ...recent];
          const ehi = Math.max(...ext);
          const elo = Math.min(...ext);
          if (ehi - elo <= 4) score -= 20;
        }
      }

      // Passing tone quality: weak beats should move towards the next skeleton CT
      if (!strong && beat < goalBeat - 1) {
        const nextSkeletonNote = beat <= 2 ? (skeleton.beat3 ?? skeleton.goal)
          : beat <= 4 ? (skeleton.beat5 ?? skeleton.goal) : skeleton.goal;
        const targetPitch = absolutePitch(nextSkeletonNote);
        const prevDist = Math.abs(absolutePitch(prevNote) - targetPitch);
        const curDist = Math.abs(absolutePitch(c) - targetPitch);
        if (curDist < prevDist) {
          score += 18;
          if (curDist <= 1) score += 10; // half-step approach to skeleton
        }
        if (curDist > prevDist + 2) score -= 10; // moving away from skeleton
      }

      // Late-phrase goal approach: beats near goal should move monotonically towards it
      // This reduces oscillation near the phrase end (Parker's lines resolve smoothly)
      const approachZoneStart = goalBeat <= 4 ? goalBeat - 1 : goalBeat - 2;
      if (beat >= approachZoneStart) {
        const goalInstances = activeCtPool.filter(n => n.noteName === goalNote.noteName);
        if (goalInstances.length > 0) {
          const nearestGoalPitch = goalInstances.reduce((best, n) =>
            Math.abs(absolutePitch(n) - absolutePitch(prevNote)) <
            Math.abs(absolutePitch(best) - absolutePitch(prevNote)) ? n : best
          );
          const goalP = absolutePitch(nearestGoalPitch);
          const prevP = absolutePitch(prevNote);
          const curP = absolutePitch(c);
          // Reward moving closer to goal (monotonic approach)
          if (Math.abs(curP - goalP) < Math.abs(prevP - goalP)) score += 15;
          // Penalise moving away from goal in late beats
          if (Math.abs(curP - goalP) > Math.abs(prevP - goalP)) {
            score -= beat === goalBeat - 1 ? 15 : 8;
          }
          // Strong bonus for being exactly 1-2 semitones from goal (setup for resolution)
          if (beat === goalBeat - 1 && Math.abs(curP - goalP) <= 2 && Math.abs(curP - goalP) > 0) {
            score += 20;
          }
        }
      }

      return Math.max(1, score);
    });

    const chosen = pickWeighted(candidates, weights);
    const chosenPN = poolToPhraseNote(chosen, beat);
    // Mark bebop passing tone
    if (!strong && !chosen.isChordTone && !chosen.isApproach) {
      const bpSemi = BEBOP_PASSING[mode.key];
      if (bpSemi !== undefined && chosen.semitone === bpSemi) {
        const stepFromPrev = Math.abs(absolutePitch(chosen) - absolutePitch(prevNote));
        if (stepFromPrev <= 2 && stepFromPrev > 0) chosenPN.isBebopPassing = true;
      }
    }
    notes.push(chosenPN);
    if (isStrongBeat(beat, goalBeat)) prevStrongNote = chosen;

    // Update direction tracking
    const dir = absolutePitch(chosen) - absolutePitch(prevNote);
    if (prevPrevNote) {
      const prevDir = absolutePitch(prevNote) - absolutePitch(prevPrevNote);
      if ((dir > 0 && prevDir > 0) || (dir < 0 && prevDir < 0)) {
        consecutiveSameDir++;
      } else {
        consecutiveSameDir = 1;
      }
    } else {
      consecutiveSameDir = 1;
    }
  }

  // --- Goal beat: resolution note (only if not already filled by approach pattern) ---
  // Late resolution: pick the closest instance of goalNote's note name to the penultimate beat
  if (!goalFilled) {
    const lastNote = notes[notes.length - 1];
    let resolvedGoal = nearestInstance(goalNote.noteName, lastNote, activeCtPool) ?? goalNote;

    // Distance guard: if resolved goal is too far from previous note (>7st), pick a
    // closer CT, preferring VL-compatible ones (half-step from next chord's 3rd)
    const goalDist = Math.abs(absolutePitch(resolvedGoal) - absolutePitch(lastNote));
    if (goalDist > 7) {
      let closerCTs = activeCtPool
        .filter(n =>
          !(n.stringIdx === lastNote.stringIdx && n.fret === lastNote.fret) &&
          absolutePitch(n) !== absolutePitch(lastNote)
        )
        .sort((a, b) =>
          Math.abs(absolutePitch(a) - absolutePitch(lastNote)) -
          Math.abs(absolutePitch(b) - absolutePitch(lastNote))
        );

      // If we have VL context, prefer CTs that are half-step from next 3rd
      if (config.nextChordContext) {
        const nextThirdSemi = findSemitone(config.nextChordContext.thirdNote);
        if (nextThirdSemi !== null) {
          const vlCompatible = closerCTs.filter(n => {
            const d = Math.min(
              Math.abs(n.semitone - nextThirdSemi),
              12 - Math.abs(n.semitone - nextThirdSemi),
            );
            return d <= 1; // half-step or unison with next 3rd
          });
          if (vlCompatible.length > 0 &&
              Math.abs(absolutePitch(vlCompatible[0]) - absolutePitch(lastNote)) < goalDist) {
            closerCTs = vlCompatible;
          }
        }
      }

      if (closerCTs.length > 0 &&
          Math.abs(absolutePitch(closerCTs[0]) - absolutePitch(lastNote)) < goalDist) {
        resolvedGoal = closerCTs[0];
      }
    }

    // Avoid same-note repetition with penultimate note
    if (lastNote && lastNote.stringIdx === resolvedGoal.stringIdx && lastNote.fret === resolvedGoal.fret) {
      const altCTs = activeCtPool.filter(n =>
        !(n.stringIdx === lastNote.stringIdx && n.fret === lastNote.fret) &&
        absolutePitch(n) !== absolutePitch(lastNote)
      );
      if (altCTs.length > 0) {
        altCTs.sort((a, b) =>
          Math.abs(absolutePitch(a) - absolutePitch(lastNote)) -
          Math.abs(absolutePitch(b) - absolutePitch(lastNote))
        );
        notes.push(poolToPhraseNote(altCTs[0], goalBeat));
      } else {
        notes.push(poolToPhraseNote(resolvedGoal, goalBeat));
      }
    } else {
      notes.push(poolToPhraseNote(resolvedGoal, goalBeat));
    }
  }

  // Sort by beat position to ensure correct order
  notes.sort((a, b) => a.beatPosition - b.beatPosition);

  // Post-processing: fix any remaining consecutive same-note pairs
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1];
    const cur = notes[i];
    if (prev.stringIdx === cur.stringIdx && prev.fret === cur.fret) {
      // Replace current with an alternative from the pool
      const strong = isStrongBeat(cur.beatPosition, goalBeat);
      const alts = (strong ? activeCtPool : activePool).filter(n =>
        !n.isApproach &&
        !(n.stringIdx === prev.stringIdx && n.fret === prev.fret) &&
        absolutePitch(n) !== absolutePitch(prev) &&
        (i + 1 >= notes.length || !(n.stringIdx === notes[i + 1].stringIdx && n.fret === notes[i + 1].fret))
      );
      if (alts.length > 0) {
        const alt = pickRandom(alts);
        notes[i] = poolToPhraseNote(alt, cur.beatPosition);
      }
    }
  }

  // Mark skeleton beats (1, 3, 5, goalBeat) — after post-processing to survive note replacements
  const skelBeats = new Set([1, skeleton.goalBeat]);
  if (skeleton.beat3) skelBeats.add(3);
  if (skeleton.beat5) skelBeats.add(5);
  for (const n of notes) {
    if (skelBeats.has(n.beatPosition)) n.isSkeletonBeat = true;
  }

  // Mark extension tones (9th/13th) on strong beats
  for (const n of notes) {
    if (n.isStrong && !n.isChordTone && !n.isApproach && isExtensionTone(n.noteName, mode)) {
      n.isExtension = true;
    }
  }

  // Extract motivic pattern from opening notes (beats 1-3: 2 intervals)
  const motif: number[] = [];
  for (let i = 1; i < Math.min(3, notes.length); i++) {
    motif.push(absolutePitch(notes[i]) - absolutePitch(notes[i - 1]));
  }

  return {
    notes,
    posId: position.id,
    modeKey: mode.key,
    rootName: mode.notes[0],
    config: { ...config, contour },
    motif,
    skeleton: skeleton.patternMeta,
    goalReason: goalResult.reason,
  };
}

// ---------------------------------------------------------------------------
// Goal & start note selection
// ---------------------------------------------------------------------------

interface GoalResult { note: PoolNote; reason: string }

function chooseGoalNote(
  ctPool: PoolNote[],
  mode: Mode,
  targetThirdNote?: string,
  nextChordContext?: PhraseConfig['nextChordContext'],
): GoalResult {
  if (targetThirdNote) {
    // Progression mode with nextChordContext: prefer current 7th resolving to next 3rd
    if (nextChordContext) {
      const nextThirdSemi = findSemitone(nextChordContext.thirdNote);
      if (nextThirdSemi !== null) {
        // Current chord's 7th that resolves by half-step to next chord's 3rd
        const seventh = mode.chordTones[3];
        const seventhCTs = ctPool.filter(n => n.noteName === seventh);
        if (seventhCTs.length > 0) {
          const seventhSemi = seventhCTs[0].semitone;
          const diff = ((nextThirdSemi - seventhSemi) + 12) % 12;
          if (diff === 1 || diff === 11) {
            // 7th→3rd half-step resolution: strong preference (70%)
            if (Math.random() < 0.70) return { note: pickRandom(seventhCTs), reason: '7th→次3rd半音解決' };
          }
        }
      }
    }
    // Progression mode: find CT that can approach the target 3rd
    // Prefer CT that is a half-step away from targetThirdNote
    const targetSemi = findSemitone(targetThirdNote);
    if (targetSemi !== null) {
      // CTs that are 1 semitone from the target 3rd (ideal voice leading)
      const halfStepCTs = ctPool.filter(n => {
        const diff = ((targetSemi - n.semitone) + 12) % 12;
        return diff === 1 || diff === 11;
      });
      if (halfStepCTs.length > 0) return { note: pickRandom(halfStepCTs), reason: '次3rdへ半音VL' };
    }
    // Fallback: any CT that IS the target 3rd
    const exact = ctPool.filter(n => n.noteName === targetThirdNote);
    if (exact.length > 0) return { note: pickRandom(exact), reason: '次3rd一致' };
  }

  // Normal mode: use strong resolution mapping
  const degIdx = STRONG_RESOLUTION_DEGREE_IDX[mode.key];
  if (degIdx !== undefined && degIdx < mode.notes.length) {
    // Prefer CTs that are a half-step from the resolution target
    const targetSemi = mode.semi[degIdx];
    const halfStepCTs = ctPool.filter(n => {
      const diff = ((targetSemi - n.semitone) + 12) % 12;
      return diff === 1 || diff === 11;
    });
    if (halfStepCTs.length > 0) return { note: pickRandom(halfStepCTs), reason: '強進行→半音解決' };
  }

  // Fallback: prefer 3rd or 7th
  const preferred = ctPool.filter(n =>
    n.noteName === mode.chordTones[1] || n.noteName === mode.chordTones[3]
  );
  if (preferred.length > 0) return { note: pickRandom(preferred), reason: '3rd/7th優先' };

  return { note: pickRandom(ctPool), reason: 'CT (ランダム)' };
}

// ---------------------------------------------------------------------------
// CT skeleton — pre-plan strong-beat chord tones for phrase direction
// ---------------------------------------------------------------------------

interface CtSkeleton {
  beat1: PoolNote;
  beat3?: PoolNote;   // present when goalBeat >= 6
  beat5?: PoolNote;   // present when goalBeat >= 8
  goal: PoolNote;     // the resolution note (was beat8)
  goalBeat: number;   // 4, 6, or 8
  patternMeta?: SkeletonMeta;  // metadata about the chosen arpeggio pattern
}

function planCtSkeleton(
  ctPool: PoolNote[],
  goalNote: PoolNote,
  contour: PhraseContour,
  pitchRange: { min: number; max: number },
  startHint?: { noteName: string; stringIdx: number; fret: number; semitone: number },
  phraseLength = 8,
  mode?: Mode,
): CtSkeleton {
  const curve = CONTOUR_CURVES[contour];
  const goalBeat = Math.min(phraseLength, 8) as 4 | 6 | 8;

  const targetPitch = (beatIdx: number) =>
    pitchRange.min + curve[beatIdx] * (pitchRange.max - pitchRange.min);

  // If no mode provided, fallback to contour-only approach
  if (!mode) {
    const beat1TargetPitch = startHint ? absolutePitch(startHint) : targetPitch(0);
    const beat1 = pickCtNearPitch(ctPool, beat1TargetPitch, [goalNote]);
    const beat3 = goalBeat >= 6
      ? pickCtNearPitch(ctPool, targetPitch(2), [beat1, goalNote], beat1)
      : undefined;
    const beat5 = goalBeat >= 8
      ? pickCtNearPitch(ctPool, targetPitch(4), [beat1, beat3!, goalNote], beat3)
      : undefined;
    return { beat1, beat3, beat5, goal: goalNote, goalBeat };
  }

  // --- Arpeggio pattern selection ---
  const goalCtIdx = mode.chordTones.indexOf(goalNote.noteName);
  const affineDirs = CONTOUR_PATTERN_AFFINITY[contour];

  // Determine ideal beat 1 CT from startHint (strong coupling for phrase continuity)
  let idealBeat1CtIdx: number | null = null;
  if (startHint?.noteName) {
    idealBeat1CtIdx = findIdealBeat1CtIdx(startHint, mode, ctPool);
  }

  const patternWeights = ARPEGGIO_PATTERNS.map(p => {
    let w = 1;
    // Direction affinity with contour
    const dirIdx = affineDirs.indexOf(p.direction);
    if (dirIdx >= 0) w += 3 - dirIdx;
    // Goal CT match
    if (goalCtIdx >= 0 && p.ctIndices[3] === goalCtIdx) w += 4;
    // Guide tone emphasis: beats 1,3 with 3rd or 7th (ctIdx 1 or 3)
    if (p.ctIndices[0] === 1 || p.ctIndices[0] === 3) w += 3;
    if (p.ctIndices[1] === 1 || p.ctIndices[1] === 3) w += 3;
    // StartHint continuity: strong coupling (replaces old +3/+1 proximity)
    if (idealBeat1CtIdx !== null) {
      if (p.ctIndices[0] === idealBeat1CtIdx) {
        w += 12;
      } else {
        w = Math.max(1, Math.floor(w * 0.4));
      }
    }
    return Math.max(1, w);
  });

  const chosenPattern = pickWeighted(ARPEGGIO_PATTERNS, patternWeights);

  // Build pattern label (e.g. "R→3→5→7")
  const CT_LABEL_SHORT = ['R', '3', '5', '7'];
  const patternMeta: SkeletonMeta = {
    patternLabel: chosenPattern.ctIndices.map(i => CT_LABEL_SHORT[i]).join('→'),
    direction: chosenPattern.direction,
    continuityCtIdx: idealBeat1CtIdx ?? undefined,
  };

  // Resolve each skeleton beat to a physical position
  const beat1TargetPitch = startHint ? absolutePitch(startHint) : targetPitch(0);
  const beat1CtName = mode.chordTones[chosenPattern.ctIndices[0]];
  const beat1 = startHint
    ? resolveSkeletonBeatStrict(beat1CtName, ctPool, beat1TargetPitch)
    : resolveSkeletonBeat(beat1CtName, ctPool, beat1TargetPitch, []);

  let beat3: PoolNote | undefined;
  if (goalBeat >= 6) {
    const beat3CtName = mode.chordTones[chosenPattern.ctIndices[1]];
    beat3 = resolveSkeletonBeat(beat3CtName, ctPool, targetPitch(2), [beat1], beat1);
  }

  let beat5: PoolNote | undefined;
  if (goalBeat >= 8) {
    const beat5CtName = mode.chordTones[chosenPattern.ctIndices[2]];
    beat5 = resolveSkeletonBeat(beat5CtName, ctPool, targetPitch(4), [beat1, beat3!], beat3);
  }

  return { beat1, beat3, beat5, goal: goalNote, goalBeat, patternMeta };
}

function resolveSkeletonBeat(
  ctName: string,
  ctPool: PoolNote[],
  targetPitch: number,
  avoid: PoolNote[],
  prevBeat?: PoolNote,
): PoolNote {
  const candidates = ctPool.filter(n => n.noteName === ctName &&
    !avoid.some(a => a.stringIdx === n.stringIdx && a.fret === n.fret));
  if (candidates.length === 0) {
    return pickCtNearPitch(ctPool, targetPitch, avoid, prevBeat);
  }
  const weights = candidates.map(c => {
    const dist = Math.abs(absolutePitch(c) - targetPitch);
    let w = Math.max(1, 30 - dist * 2);
    for (const a of avoid) {
      const aDist = Math.abs(absolutePitch(c) - absolutePitch(a));
      if (aDist > 0 && aDist <= 2) w -= 15;
    }
    // Inter-skeleton proximity: penalise large gaps from previous skeleton beat
    if (prevBeat) {
      const interDist = Math.abs(absolutePitch(c) - absolutePitch(prevBeat));
      if (interDist > 10) w = Math.max(1, Math.floor(w * 0.15));
      else if (interDist > 7) w = Math.max(1, Math.floor(w * 0.4));
    }
    return Math.max(1, w);
  });
  return pickWeighted(candidates, weights);
}

// ---------------------------------------------------------------------------
// startHint continuity helpers
// ---------------------------------------------------------------------------

/** Find the CT index closest to startHint pitch, preferring half-step resolution */
function findIdealBeat1CtIdx(
  startHint: { noteName: string; stringIdx: number; fret: number; semitone: number },
  mode: Mode,
  ctPool: PoolNote[],
): number | null {
  const hintPitch = absolutePitch(startHint);
  let bestCtIdx = -1;
  let bestDist = Infinity;

  for (let ci = 0; ci < mode.chordTones.length; ci++) {
    const ctName = mode.chordTones[ci];
    const instances = ctPool.filter(n => n.noteName === ctName);
    if (instances.length === 0) continue;
    const minDist = Math.min(...instances.map(n => Math.abs(absolutePitch(n) - hintPitch)));
    // Half-step resolution priority (pitch class distance ≤ 1)
    const semiDist = Math.min(
      ((startHint.semitone - instances[0].semitone) + 12) % 12,
      ((instances[0].semitone - startHint.semitone) + 12) % 12,
    );
    const effectiveDist = semiDist <= 1 ? Math.min(minDist, 0.5) : minDist;
    if (effectiveDist < bestDist) {
      bestDist = effectiveDist;
      bestCtIdx = ci;
    }
  }
  return bestCtIdx >= 0 ? bestCtIdx : null;
}

/** Resolve skeleton beat with exponential decay for strict proximity to target */
function resolveSkeletonBeatStrict(
  ctName: string, ctPool: PoolNote[], targetPitch: number,
): PoolNote {
  const candidates = ctPool.filter(n => n.noteName === ctName);
  if (candidates.length <= 1) {
    return candidates[0] ?? [...ctPool].sort((a, b) =>
      Math.abs(absolutePitch(a) - targetPitch) - Math.abs(absolutePitch(b) - targetPitch))[0];
  }
  // Exponential decay: 3st → 37%, 6st → 14%, 9st → 5%
  const weights = candidates.map(c =>
    Math.max(0.01, Math.exp(-Math.abs(absolutePitch(c) - targetPitch) / 3)));
  return pickWeighted(candidates, weights);
}

function pickCtNearPitch(
  ctPool: PoolNote[],
  targetPitch: number,
  avoid: PoolNote[],
  prevBeat?: PoolNote,
): PoolNote {
  const avoidNames = new Set(avoid.map(n => n.noteName));
  const candidates = ctPool.filter(n =>
    !avoid.some(a => a.stringIdx === n.stringIdx && a.fret === n.fret) &&
    absolutePitch(n) !== absolutePitch(avoid[0]) // avoid same pitch as primary avoid
  );
  if (candidates.length === 0) return pickRandom(ctPool);

  const weights = candidates.map(c => {
    const dist = Math.abs(absolutePitch(c) - targetPitch);
    let w = Math.max(1, 30 - dist * 2);
    // Prefer different CT name for arpeggio variety
    if (!avoidNames.has(c.noteName)) w += 15;
    // Discourage semi/whole-tone clusters in skeleton (prevents B↔C oscillation)
    for (const a of avoid) {
      const aDist = Math.abs(absolutePitch(c) - absolutePitch(a));
      if (aDist > 0 && aDist <= 2) w -= 15;
    }
    // Inter-skeleton proximity: penalise large gaps from previous skeleton beat
    if (prevBeat) {
      const interDist = Math.abs(absolutePitch(c) - absolutePitch(prevBeat));
      if (interDist > 10) w = Math.max(1, Math.floor(w * 0.15));
      else if (interDist > 7) w = Math.max(1, Math.floor(w * 0.4));
    }
    return Math.max(1, w);
  });
  return pickWeighted(candidates, weights);
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

function getCandidates(
  prevNote: PhraseNote | PoolNote,
  pool: PoolNote[],
  strong: boolean,
  _ctSet: Set<string>,
  _existingNotes: PhraseNote[],
  mode: Mode,
): PoolNote[] {
  // Reachable: same string ±4 frets, adjacent strings within position, max 2-string jump
  const result = pool.filter(n => {
    // No same-note repetition (same string+fret)
    if (n.stringIdx === prevNote.stringIdx && n.fret === prevNote.fret) return false;

    // No enharmonic same-pitch repetition (different string, same absolute pitch)
    if (absolutePitch(n) === absolutePitch(prevNote)) return false;

    // Strong beat: must be chord tone or extension (9th/13th)
    if (strong && !n.isChordTone && !isExtensionTone(n.noteName, mode)) return false;

    // Reachability: max 2 string jump, tight fret constraints for compactness
    const strDist = Math.abs(n.stringIdx - prevNote.stringIdx);
    if (strDist > 2) return false;

    // Same string: max ±3 frets (stepwise and thirds)
    if (strDist === 0 && Math.abs(n.fret - prevNote.fret) > 3) return false;

    // Adjacent string: max ±3 frets (keeps phrases compact)
    if (strDist === 1 && Math.abs(n.fret - prevNote.fret) > 3) return false;

    // 2-string jump: max ±2 frets (only for close notes)
    if (strDist === 2 && Math.abs(n.fret - prevNote.fret) > 2) return false;

    // Approach notes only enter via tryApproachCommitment(), never via normal selection
    if (n.isApproach) return false;

    return true;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Approach pattern commitment
// ---------------------------------------------------------------------------

interface CommittedApproach {
  notes: PhraseNote[];
  upToBeat: number;
  nextGroupId: number;
}

function tryApproachCommitment(
  currentBeat: number,
  pool: PoolNote[],
  ctPool: PoolNote[],
  mode: Mode,
  config: PhraseConfig,
  existingNotes: PhraseNote[],
  goalNote: PoolNote,
  groupId: number,
  goalBeat = 8,
): CommittedApproach | null {
  // Only attempt approach if we're on a weak beat and a strong beat follows soon
  const nextStrongBeat = currentBeat === 2 ? 3
    : (currentBeat === 4 && goalBeat >= 6) ? 5
    : (currentBeat >= goalBeat - 2 && currentBeat < goalBeat && !isStrongBeat(currentBeat, goalBeat)) ? goalBeat
    : null;
  if (nextStrongBeat === null) return null;

  const beatsAvailable = nextStrongBeat - currentBeat; // 1 for single, 2 for enclosure, etc.
  const prevNote = existingNotes[existingNotes.length - 1];

  // Choose the target CT for the strong beat
  // For goal beat: pick the nearest instance of goalNote's name to current position
  const targetCT = nextStrongBeat === goalBeat
    ? (nearestInstance(goalNote.noteName, prevNote, ctPool) ?? goalNote)
    : pickNearbyChordTone(prevNote, ctPool, mode);

  if (!targetCT) return null;

  // Context-dependent approach probability: higher near goal, lower early
  // Always attempt approach to goal beat for smooth phrase endings
  if (nextStrongBeat !== goalBeat) {
    const approachProb =
      nextStrongBeat === 5        ? 0.50 :  // beat 5 approach zone
      nextStrongBeat === 3        ? 0.35 :  // early phrase: less approach
                                    0.45;   // default
    if (Math.random() > approachProb) return null;
  }

  // Shuffle and try approach types
  const shuffled = [...config.approachTypes].sort(() => Math.random() - 0.5);

  for (const aType of shuffled) {
    const patternNotes = getApproachNotes(targetCT, pool, aType, mode);
    if (!patternNotes) continue;

    const patternLength = patternNotes.length; // does NOT include the target

    // Check if we have enough beats: pattern notes fill weak beats, target on strong beat
    if (patternLength > beatsAvailable) continue;

    // If pattern is shorter than available beats, pad with normal generation
    // For simplicity, we only commit if pattern fits exactly or with 1 beat gap
    if (patternLength === beatsAvailable) {
      // Perfect fit: all approach notes then target on strong beat
      // Check for same-note repetition with previous note
      const firstApproach = patternNotes[0];
      if (firstApproach.stringIdx === prevNote.stringIdx && firstApproach.fret === prevNote.fret) continue;
      if (absolutePitch(firstApproach) === absolutePitch(prevNote)) continue;
      // Reject if first approach note is too far from previous note
      const distToFirst = semiInterval(prevNote, firstApproach);
      const strDistToFirst = Math.abs(firstApproach.stringIdx - prevNote.stringIdx);
      if (distToFirst > 5 || strDistToFirst > 2) continue;
      const groupSize = patternNotes.length + 1; // approach notes + target
      const result: PhraseNote[] = [];
      for (let i = 0; i < patternNotes.length; i++) {
        const ag: ApproachGroupInfo = { groupId, approachType: aType, role: 'approach', positionInGroup: i, groupSize };
        result.push(poolToPhraseNote(
          { ...patternNotes[i], isApproach: true },
          currentBeat + i,
          ag,
        ));
      }
      const tAg: ApproachGroupInfo = { groupId, approachType: aType, role: 'target', positionInGroup: patternNotes.length, groupSize };
      result.push(poolToPhraseNote(targetCT, nextStrongBeat, tAg));
      return { notes: result, upToBeat: nextStrongBeat, nextGroupId: groupId + 1 };
    }

    // If pattern is 1 note and we have 2 beats available, use single approach + skip
    if (patternLength === 1 && beatsAvailable === 2) {
      // Place approach on currentBeat+1 (closer to target), use a scale tone for currentBeat
      const scaleFiller = pool.filter(n =>
        !n.isApproach && n.stringIdx === prevNote.stringIdx &&
        Math.abs(n.fret - prevNote.fret) <= 3 &&
        !(n.stringIdx === prevNote.stringIdx && n.fret === prevNote.fret) &&
        absolutePitch(n) !== absolutePitch(prevNote)
      );
      if (scaleFiller.length > 0) {
        const filler = pickRandom(scaleFiller);
        if (absolutePitch(patternNotes[0]) !== absolutePitch(filler) &&
            semiInterval(filler, patternNotes[0]) <= 5) {
          const ag0: ApproachGroupInfo = { groupId, approachType: aType, role: 'approach', positionInGroup: 0, groupSize: 2 };
          const ag1: ApproachGroupInfo = { groupId, approachType: aType, role: 'target', positionInGroup: 1, groupSize: 2 };
          return {
            notes: [
              poolToPhraseNote(filler, currentBeat),
              poolToPhraseNote({ ...patternNotes[0], isApproach: true }, currentBeat + 1, ag0),
              poolToPhraseNote(targetCT, nextStrongBeat, ag1),
            ],
            upToBeat: nextStrongBeat,
            nextGroupId: groupId + 1,
          };
        }
      }
    }
  }

  return null;
}

function pickNearbyChordTone(
  prevNote: PhraseNote | PoolNote,
  ctPool: PoolNote[],
  mode?: Mode,
): PoolNote | null {
  // Pick a CT that is reachable from the previous note (compact range)
  const reachable = ctPool.filter(n => {
    // No same-note repetition
    if (n.stringIdx === prevNote.stringIdx && n.fret === prevNote.fret) return false;
    if (absolutePitch(n) === absolutePitch(prevNote)) return false;
    const strDist = Math.abs(n.stringIdx - prevNote.stringIdx);
    if (strDist > 2) return false;
    const fretDist = Math.abs(n.fret - prevNote.fret);
    if (strDist === 0 && fretDist > 4) return false;
    if (strDist === 1 && fretDist > 3) return false;
    if (strDist === 2 && fretDist > 2) return false;
    return true;
  });
  const fallbackPool = ctPool.filter(n =>
    !(n.stringIdx === prevNote.stringIdx && n.fret === prevNote.fret) &&
    absolutePitch(n) !== absolutePitch(prevNote)
  );
  if (reachable.length === 0) return fallbackPool.length > 0 ? pickRandom(fallbackPool) : null;

  // Weight by proximity + guide tone preference
  const weights = reachable.map(n => {
    const dist = semiInterval(prevNote, n);
    let w = Math.max(1, 20 - dist * 2);
    // Enclosures targeting 3rd/7th are melodically strongest
    if (mode) {
      const ctIdx = mode.chordTones.indexOf(n.noteName);
      if (ctIdx === 1 || ctIdx === 3) w += 12;
    }
    return w;
  });
  return pickWeighted(reachable, weights);
}

// ---------------------------------------------------------------------------
// Digital patterns — Parker vocabulary (multi-note commit)
// ---------------------------------------------------------------------------

type PatternStep =
  | { type: 'ct'; idx: number }
  | { type: 'scaleDeg'; offset: number };

interface DigitalPattern {
  name: string;
  startCtIdx: number[];
  steps: PatternStep[];
  direction: 'asc' | 'desc' | 'mixed';
}

const DIGITAL_PATTERNS: DigitalPattern[] = [
  // A. Ascending digital patterns (Parker's bread & butter)
  { name: '1-2-3-5', startCtIdx: [0],
    steps: [{type:'scaleDeg',offset:+1}, {type:'scaleDeg',offset:+1}, {type:'ct',idx:2}],
    direction: 'asc' },
  { name: '3-5-7-9', startCtIdx: [1],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:3}, {type:'scaleDeg',offset:+1}],
    direction: 'asc' },
  { name: '5-7-R-2', startCtIdx: [2],
    steps: [{type:'ct',idx:3}, {type:'ct',idx:0}, {type:'scaleDeg',offset:+1}],
    direction: 'asc' },
  { name: '7-R-2-3', startCtIdx: [3],
    steps: [{type:'ct',idx:0}, {type:'scaleDeg',offset:+1}, {type:'ct',idx:1}],
    direction: 'asc' },

  // B. Descending digital patterns
  { name: '7-5-3-R', startCtIdx: [3],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:1}, {type:'ct',idx:0}],
    direction: 'desc' },
  { name: '5-3-R-7', startCtIdx: [2],
    steps: [{type:'ct',idx:1}, {type:'ct',idx:0}, {type:'ct',idx:3}],
    direction: 'desc' },
  { name: 'R-7-5-3', startCtIdx: [0],
    steps: [{type:'ct',idx:3}, {type:'ct',idx:2}, {type:'ct',idx:1}],
    direction: 'desc' },
  { name: '9-7-5-3', startCtIdx: [0],
    steps: [{type:'scaleDeg',offset:-1}, {type:'ct',idx:2}, {type:'ct',idx:1}],
    direction: 'desc' },
  { name: '3-R-7-5', startCtIdx: [1],
    steps: [{type:'ct',idx:0}, {type:'ct',idx:3}, {type:'ct',idx:2}],
    direction: 'desc' },
  { name: '5-3-R-2', startCtIdx: [2],
    steps: [{type:'ct',idx:1}, {type:'ct',idx:0}, {type:'scaleDeg',offset:-1}],
    direction: 'desc' },
  { name: '3-2-R-7', startCtIdx: [1],
    steps: [{type:'scaleDeg',offset:-1}, {type:'ct',idx:0}, {type:'ct',idx:3}],
    direction: 'desc' },

  // C. Scalar runs (CT start → 3 stepwise notes)
  { name: 'scale-asc-3', startCtIdx: [0,1,2,3],
    steps: [{type:'scaleDeg',offset:+1}, {type:'scaleDeg',offset:+1}, {type:'scaleDeg',offset:+1}],
    direction: 'asc' },
  { name: 'scale-desc-3', startCtIdx: [0,1,2,3],
    steps: [{type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}],
    direction: 'desc' },

  // D. Hybrid patterns (Parker signature: arp + scale resolution)
  { name: 'R-3-5-step-down', startCtIdx: [0],
    steps: [{type:'ct',idx:1}, {type:'ct',idx:2}, {type:'scaleDeg',offset:-1}],
    direction: 'asc' },
  { name: '3-5-7-step-down', startCtIdx: [1],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:3}, {type:'scaleDeg',offset:-1}],
    direction: 'asc' },
  { name: 'R-pivot-5-3', startCtIdx: [0],
    steps: [{type:'scaleDeg',offset:-1}, {type:'ct',idx:2}, {type:'ct',idx:1}],
    direction: 'desc' },
  { name: 'R-3-5-step-up', startCtIdx: [0],
    steps: [{type:'ct',idx:1}, {type:'ct',idx:2}, {type:'scaleDeg',offset:+1}],
    direction: 'asc' },
  { name: '7-5-step-up-3', startCtIdx: [3],
    steps: [{type:'ct',idx:2}, {type:'scaleDeg',offset:+1}, {type:'ct',idx:1}],
    direction: 'mixed' },
  { name: '5-6-7-R', startCtIdx: [2],
    steps: [{type:'scaleDeg',offset:+1}, {type:'ct',idx:3}, {type:'ct',idx:0}],
    direction: 'asc' },

  // E. Extended patterns (5 notes = 4 steps) — Parker-style longer runs
  { name: 'R-2-3-5-7', startCtIdx: [0],
    steps: [{type:'scaleDeg',offset:+1}, {type:'ct',idx:1}, {type:'ct',idx:2}, {type:'ct',idx:3}],
    direction: 'asc' },
  { name: 'R-3-5-7-9', startCtIdx: [0],
    steps: [{type:'ct',idx:1}, {type:'ct',idx:2}, {type:'ct',idx:3}, {type:'scaleDeg',offset:+1}],
    direction: 'asc' },
  { name: '7-5-3-R-below7', startCtIdx: [3],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:1}, {type:'ct',idx:0}, {type:'ct',idx:3}],
    direction: 'desc' },
  { name: '3-5-7-R-step-down', startCtIdx: [1],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:3}, {type:'ct',idx:0}, {type:'scaleDeg',offset:-1}],
    direction: 'asc' },
  { name: 'scale-asc-4', startCtIdx: [0,1,2,3],
    steps: [{type:'scaleDeg',offset:+1}, {type:'scaleDeg',offset:+1}, {type:'scaleDeg',offset:+1}, {type:'scaleDeg',offset:+1}],
    direction: 'asc' },
  { name: 'scale-desc-4', startCtIdx: [0,1,2,3],
    steps: [{type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}],
    direction: 'desc' },
  { name: 'R-3-5-3-7', startCtIdx: [0],
    steps: [{type:'ct',idx:1}, {type:'ct',idx:2}, {type:'ct',idx:1}, {type:'ct',idx:3}],
    direction: 'mixed' },
  { name: '7-5-3-step-up-R', startCtIdx: [3],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:1}, {type:'scaleDeg',offset:+1}, {type:'ct',idx:0}],
    direction: 'desc' },
  { name: '5-7-R-2-3', startCtIdx: [2],
    steps: [{type:'ct',idx:3}, {type:'ct',idx:0}, {type:'scaleDeg',offset:+1}, {type:'ct',idx:1}],
    direction: 'asc' },
  { name: '3-5-3-R-7', startCtIdx: [1],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:1}, {type:'ct',idx:0}, {type:'ct',idx:3}],
    direction: 'mixed' },

  // F. Extended patterns (6 notes = 5 steps) — bebop-scale runs
  { name: 'R-2-3-5-7-R', startCtIdx: [0],
    steps: [{type:'scaleDeg',offset:+1}, {type:'ct',idx:1}, {type:'ct',idx:2}, {type:'ct',idx:3}, {type:'ct',idx:0}],
    direction: 'asc' },
  { name: 'scale-desc-5', startCtIdx: [0,1,2,3],
    steps: [{type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}, {type:'scaleDeg',offset:-1}],
    direction: 'desc' },
  { name: '7-5-3-R-2-3', startCtIdx: [3],
    steps: [{type:'ct',idx:2}, {type:'ct',idx:1}, {type:'ct',idx:0}, {type:'scaleDeg',offset:+1}, {type:'ct',idx:1}],
    direction: 'desc' },
  { name: 'R-3-5-7-5-3', startCtIdx: [0],
    steps: [{type:'ct',idx:1}, {type:'ct',idx:2}, {type:'ct',idx:3}, {type:'ct',idx:2}, {type:'ct',idx:1}],
    direction: 'mixed' },
];

function pickByDirection(candidates: PoolNote[], ref: PoolNote, dir: 'asc' | 'desc' | 'mixed'): PoolNote | null {
  const refP = absolutePitch(ref);
  if (dir === 'mixed') {
    return candidates.length > 0
      ? candidates.reduce((best, n) =>
          Math.abs(absolutePitch(n) - refP) < Math.abs(absolutePitch(best) - refP) ? n : best)
      : null;
  }
  const filtered = dir === 'asc'
    ? candidates.filter(n => absolutePitch(n) > refP)
    : candidates.filter(n => absolutePitch(n) < refP);
  if (filtered.length === 0) {
    return candidates.length > 0
      ? candidates.reduce((best, n) =>
          Math.abs(absolutePitch(n) - refP) < Math.abs(absolutePitch(best) - refP) ? n : best)
      : null;
  }
  return filtered.reduce((best, n) =>
    Math.abs(absolutePitch(n) - refP) < Math.abs(absolutePitch(best) - refP) ? n : best);
}

function findScaleDegreeNeighbor(ref: PoolNote, offset: number, pool: PoolNote[]): PoolNote | null {
  const refP = absolutePitch(ref);
  const scaleTones = pool.filter(n => !n.isApproach && absolutePitch(n) !== refP);
  if (offset > 0) {
    const above = scaleTones.filter(n => absolutePitch(n) > refP)
      .sort((a, b) => absolutePitch(a) - absolutePitch(b));
    return above[offset - 1] ?? null;
  } else {
    const below = scaleTones.filter(n => absolutePitch(n) < refP)
      .sort((a, b) => absolutePitch(b) - absolutePitch(a));
    return below[(-offset) - 1] ?? null;
  }
}

function tryDigitalPattern(
  beat: number,
  currentNote: PoolNote,
  mode: Mode,
  ctPool: PoolNote[],
  pool: PoolNote[],
  goalBeat: number,
  _skeleton: CtSkeleton,
): PhraseNote[] | null {
  if (Math.random() > 0.42) return null;

  const ctIdx = mode.chordTones.indexOf(currentNote.noteName);
  if (ctIdx < 0) return null;

  const beatsRemaining = goalBeat - beat;
  const compatible = DIGITAL_PATTERNS.filter(p =>
    p.startCtIdx.includes(ctIdx) &&
    p.steps.length <= beatsRemaining
  );
  if (compatible.length === 0) return null;

  const pattern = pickRandom(compatible);
  const result: PhraseNote[] = [];
  let prevNote = currentNote;

  for (let i = 0; i < pattern.steps.length; i++) {
    const step = pattern.steps[i];
    let nextNote: PoolNote | null = null;

    if (step.type === 'ct') {
      const targetName = mode.chordTones[step.idx];
      const candidates = ctPool.filter(n => n.noteName === targetName);
      nextNote = pickByDirection(candidates, prevNote, pattern.direction);
    } else {
      nextNote = findScaleDegreeNeighbor(prevNote, step.offset, pool);
    }

    if (!nextNote) return null;

    // Strong beats must have chord tones or extensions — substitute if needed
    const resultBeat = beat + i + 1;
    if (isStrongBeat(resultBeat, goalBeat) && !nextNote.isChordTone && !isExtensionTone(nextNote.noteName, mode)) {
      const nearCT = pickByDirection(
        ctPool.filter(n => semiInterval(prevNote, n) <= 7 && Math.abs(n.stringIdx - prevNote.stringIdx) <= 2),
        prevNote,
        pattern.direction,
      );
      if (nearCT) {
        nextNote = nearCT;
      } else {
        return null;
      }
    }

    if (Math.abs(nextNote.stringIdx - prevNote.stringIdx) > 2) return null;
    if (semiInterval(prevNote, nextNote) > 7) return null;

    const pn = poolToPhraseNote(nextNote, resultBeat);
    pn.digitalPattern = { name: pattern.name, position: i, size: pattern.steps.length };
    result.push(pn);
    prevNote = nextNote;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function poolToPhraseNote(note: PoolNote, beatPosition: number, approachGroup?: ApproachGroupInfo): PhraseNote {
  const pn: PhraseNote = {
    noteName: note.noteName,
    stringIdx: note.stringIdx,
    fret: note.fret,
    semitone: note.semitone,
    isChordTone: note.isChordTone,
    isApproach: note.isApproach,
    beatPosition,
    isStrong: isStrongBeat(beatPosition),
  };
  if (approachGroup) pn.approachGroup = approachGroup;
  return pn;
}

const SEMI_MAP: Record<string, number> = {
  'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
  'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  'C#': 1, 'D#': 3, 'F#': 6, 'G#': 8, 'A#': 10,
};

function findSemitone(noteName: string): number | null {
  return SEMI_MAP[noteName] ?? null;
}
