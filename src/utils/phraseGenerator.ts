import type { Position, Mode, FretMap, PhraseNote, PhraseConfig, PhraseContour, GeneratedPhrase, ApproachType } from '../types';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStrongBeat(beat: number): boolean {
  return beat === 1 || beat === 3 || beat === 5 || beat === 8;
}

/** Absolute pitch (semitone + octave info) for interval comparison.
 *  Uses fret as a proxy for octave height since we're on a guitar.  */
function absolutePitch(note: { stringIdx: number; fret: number }): number {
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
  return Math.max(0, 20 - diff * 40);
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
    if (consecutiveSameDir >= 3) return -25; // penalise long runs
    if (consecutiveSameDir >= 2) return -10;
    return 5; // mild continuity bonus
  } else {
    // Direction change — generally good
    return 15;
  }
}

function goalProximityScore(
  candidate: PoolNote,
  goalNote: PoolNote,
  beatPosition: number,
): number {
  if (beatPosition < 6) return 0;
  const dist = Math.abs(absolutePitch(candidate) - absolutePitch(goalNote));
  const weight = beatPosition === 7 ? 1.5 : 1.0;
  return Math.max(0, (20 - dist * 3)) * weight;
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
  const includeChromatic = config.source === 'approach' || config.source === 'both';
  const pool = buildNotePool(position, mode, fretMap, includeChromatic);
  const ctSet = new Set(mode.chordTones);
  const ctPool = pool.filter(n => n.isChordTone);

  if (ctPool.length === 0) {
    throw new Error('No chord tones found in position');
  }

  // --- Contour selection ---
  const contour = config.contour ?? pickRandom(ALL_CONTOURS);

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

  // --- Goal note (beat 8) ---
  const goalNote = chooseGoalNote(activeCtPool, mode, targetThirdNote);

  // --- Start note (beat 1) ---
  const startNote = chooseStartNote(activeCtPool, goalNote, contour, pitchRange);

  // --- Generate notes for beats 2-7 (beat 8 = goal) ---
  const notes: PhraseNote[] = [];
  notes.push(poolToPhraseNote(startNote, 1));

  let consecutiveSameDir = 0;
  let beat8Filled = false; // track if approach pattern already filled beat 8

  for (let beat = 2; beat <= 7; beat++) {
    // Skip if this beat was already filled by an approach pattern
    if (notes.some(n => n.beatPosition === beat)) continue;

    const prevNote = notes[notes.length - 1];
    const prevPrevNote = notes.length >= 2 ? notes[notes.length - 2] : null;
    const strong = isStrongBeat(beat);

    // --- Try approach pattern commitment ---
    if (!strong && includeChromatic && config.approachTypes.length > 0) {
      const committed = tryApproachCommitment(
        beat, activePool, activeCtPool, mode, config, notes, goalNote,
      );
      if (committed) {
        for (const cn of committed.notes) {
          notes.push(cn);
          if (cn.beatPosition === 8) beat8Filled = true;
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
    const candidates = getCandidates(prevNote, activePool, strong, ctSet, notes);
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

    const weights = candidates.map(c => {
      const interval = semiInterval(prevNote, c);
      let score = intervalScore(interval);
      score += contourScore(c, beat - 1, contour, pitchRange);
      score += directionScore(c, prevNote, prevPrevNote, consecutiveSameDir);
      score += goalProximityScore(c, goalNote, beat);

      // String distance penalty (heavier to keep phrases compact)
      const strDist = Math.abs(c.stringIdx - prevNote.stringIdx);
      score -= strDist * 15;

      // Large interval penalty (keep Parker-like compactness)
      if (interval >= 6) score -= 20;
      if (interval >= 8) score -= 30;

      return Math.max(1, score);
    });

    const chosen = pickWeighted(candidates, weights);
    notes.push(poolToPhraseNote(chosen, beat));

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

  // --- Beat 8: goal note (only if not already filled by approach pattern) ---
  if (!beat8Filled) {
    const lastNote = notes[notes.length - 1];
    // Avoid same-note repetition with beat 7
    if (lastNote && lastNote.stringIdx === goalNote.stringIdx && lastNote.fret === goalNote.fret) {
      // Pick an alternative CT that's different
      const altCTs = activeCtPool.filter(n =>
        !(n.stringIdx === lastNote.stringIdx && n.fret === lastNote.fret) &&
        absolutePitch(n) !== absolutePitch(lastNote)
      );
      if (altCTs.length > 0) {
        notes.push(poolToPhraseNote(pickRandom(altCTs), 8));
      } else {
        notes.push(poolToPhraseNote(goalNote, 8));
      }
    } else {
      notes.push(poolToPhraseNote(goalNote, 8));
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
      const strong = isStrongBeat(cur.beatPosition);
      const alts = (strong ? activeCtPool : activePool).filter(n =>
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

  return {
    notes,
    posId: position.id,
    modeKey: mode.key,
    rootName: mode.notes[0],
    config: { ...config, contour },
  };
}

// ---------------------------------------------------------------------------
// Goal & start note selection
// ---------------------------------------------------------------------------

function chooseGoalNote(
  ctPool: PoolNote[],
  mode: Mode,
  targetThirdNote?: string,
): PoolNote {
  if (targetThirdNote) {
    // Progression mode: find CT that can approach the target 3rd
    // Prefer CT that is a half-step away from targetThirdNote
    const targetSemi = findSemitone(targetThirdNote);
    if (targetSemi !== null) {
      // CTs that are 1 semitone from the target 3rd (ideal voice leading)
      const halfStepCTs = ctPool.filter(n => {
        const diff = ((targetSemi - n.semitone) + 12) % 12;
        return diff === 1 || diff === 11;
      });
      if (halfStepCTs.length > 0) return pickRandom(halfStepCTs);
    }
    // Fallback: any CT that IS the target 3rd
    const exact = ctPool.filter(n => n.noteName === targetThirdNote);
    if (exact.length > 0) return pickRandom(exact);
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
    if (halfStepCTs.length > 0) return pickRandom(halfStepCTs);
  }

  // Fallback: prefer 3rd or 7th
  const preferred = ctPool.filter(n =>
    n.noteName === mode.chordTones[1] || n.noteName === mode.chordTones[3]
  );
  if (preferred.length > 0) return pickRandom(preferred);

  return pickRandom(ctPool);
}

function chooseStartNote(
  ctPool: PoolNote[],
  goalNote: PoolNote,
  contour: PhraseContour,
  pitchRange: { min: number; max: number },
): PoolNote {
  // Filter out the exact goal note position, and keep within reachable range of goal
  // (max ~16 semitones away to keep phrase compact)
  const goalPitch = absolutePitch(goalNote);
  const candidates = ctPool.filter(n => {
    if (n.stringIdx === goalNote.stringIdx && n.fret === goalNote.fret) return false;
    // Same absolute pitch (different string) is also excluded
    if (absolutePitch(n) === goalPitch) return false;
    // Keep within compact range (~1 octave)
    const dist = Math.abs(absolutePitch(n) - goalPitch);
    return dist <= 12;
  });
  if (candidates.length === 0) {
    // Fallback: any CT different from goal
    const fallback = ctPool.filter(n =>
      !(n.stringIdx === goalNote.stringIdx && n.fret === goalNote.fret) &&
      absolutePitch(n) !== goalPitch
    );
    return fallback.length > 0 ? pickRandom(fallback) : ctPool[0];
  }

  // Weight based on contour: arch wants lower start, descending wants higher start
  const curve = CONTOUR_CURVES[contour];
  const targetPitch = pitchRange.min + curve[0] * (pitchRange.max - pitchRange.min);

  const weights = candidates.map(c => {
    const diff = Math.abs(absolutePitch(c) - targetPitch);
    return Math.max(1, 30 - diff * 2);
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
): PoolNote[] {
  // Reachable: same string ±4 frets, adjacent strings within position, max 2-string jump
  const result = pool.filter(n => {
    // No same-note repetition (same string+fret)
    if (n.stringIdx === prevNote.stringIdx && n.fret === prevNote.fret) return false;

    // No enharmonic same-pitch repetition (different string, same absolute pitch)
    if (absolutePitch(n) === absolutePitch(prevNote)) return false;

    // Strong beat: must be chord tone
    if (strong && !n.isChordTone) return false;

    // Reachability: max 2 string jump, tight fret constraints for compactness
    const strDist = Math.abs(n.stringIdx - prevNote.stringIdx);
    if (strDist > 2) return false;

    // Same string: max ±3 frets (stepwise and thirds)
    if (strDist === 0 && Math.abs(n.fret - prevNote.fret) > 3) return false;

    // Adjacent string: max ±3 frets (keeps phrases compact)
    if (strDist === 1 && Math.abs(n.fret - prevNote.fret) > 3) return false;

    // 2-string jump: max ±2 frets (only for close notes)
    if (strDist === 2 && Math.abs(n.fret - prevNote.fret) > 2) return false;

    // Avoid chromatic approach notes on strong beats (already handled by CT check)
    // On weak beats, allow approach notes only if source includes approach
    if (n.isApproach && strong) return false;

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
}

function tryApproachCommitment(
  currentBeat: number,
  pool: PoolNote[],
  ctPool: PoolNote[],
  mode: Mode,
  config: PhraseConfig,
  existingNotes: PhraseNote[],
  goalNote: PoolNote,
): CommittedApproach | null {
  // Only attempt approach if we're on a weak beat and a strong beat follows soon
  const nextStrongBeat = currentBeat === 2 ? 3 : currentBeat === 4 ? 5 : currentBeat === 6 ? 8 : null;
  if (nextStrongBeat === null) return null;

  const beatsAvailable = nextStrongBeat - currentBeat; // 1 for single, 2 for enclosure, etc.
  const prevNote = existingNotes[existingNotes.length - 1];

  // Choose the target CT for the strong beat
  const targetCT = nextStrongBeat === 8
    ? goalNote
    : pickNearbyChordTone(prevNote, ctPool);

  if (!targetCT) return null;

  // Random approach decision (not every weak beat should trigger an approach)
  if (Math.random() > 0.45) return null;

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
      const result: PhraseNote[] = [];
      for (let i = 0; i < patternNotes.length; i++) {
        result.push(poolToPhraseNote(
          { ...patternNotes[i], isApproach: true },
          currentBeat + i,
        ));
      }
      result.push(poolToPhraseNote(targetCT, nextStrongBeat));
      return { notes: result, upToBeat: nextStrongBeat };
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
        if (absolutePitch(patternNotes[0]) !== absolutePitch(filler)) {
          return {
            notes: [
              poolToPhraseNote(filler, currentBeat),
              poolToPhraseNote({ ...patternNotes[0], isApproach: true }, currentBeat + 1),
              poolToPhraseNote(targetCT, nextStrongBeat),
            ],
            upToBeat: nextStrongBeat,
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

  // Weight by proximity
  const weights = reachable.map(n => {
    const dist = semiInterval(prevNote, n);
    return Math.max(1, 20 - dist * 2);
  });
  return pickWeighted(reachable, weights);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function poolToPhraseNote(note: PoolNote, beatPosition: number): PhraseNote {
  return {
    noteName: note.noteName,
    stringIdx: note.stringIdx,
    fret: note.fret,
    semitone: note.semitone,
    isChordTone: note.isChordTone,
    isApproach: note.isApproach,
    beatPosition,
    isStrong: isStrongBeat(beatPosition),
  };
}

const SEMI_MAP: Record<string, number> = {
  'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
  'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  'C#': 1, 'D#': 3, 'F#': 6, 'G#': 8, 'A#': 10,
};

function findSemitone(noteName: string): number | null {
  return SEMI_MAP[noteName] ?? null;
}
