import type { Position, Mode, FretMap, PhraseNote, PhraseConfig, PhraseContour, GeneratedPhrase, ApproachType, Lick, RhythmType } from '../types';
import { OPEN_STRINGS, getLicksForQuality } from '../constants';

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

export interface PoolNote {
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
// Characteristic tones — notes that distinguish each mode from others of the
// same chord quality (used for lick selection scoring)
// ---------------------------------------------------------------------------

const CHARACTERISTIC_TONES: Record<string, number[]> = {
  // Diatonic
  'ionian':       [5],       // ♮4 (vs Lydian ♯4)
  'dorian':       [9],       // ♮6 (vs Aeolian ♭6)
  'phrygian':     [1],       // ♭2 (vs Dorian ♮2)
  'lydian':       [6],       // ♯4 (vs Ionian ♮4)
  'mixolydian':   [5],       // ♮4 (vs Lydian Dom ♯4)
  'aeolian':      [8],       // ♭6 (vs Dorian ♮6)
  'locrian':      [1, 6],    // ♭2, ♭5
  // Melodic Minor
  'melodic-minor':  [9, 11], // ♮6, ♮7
  'dorian-b2':      [1, 9],  // ♭2, ♮6
  'lydian-aug':     [6, 8],  // ♯4, ♯5
  'lydian-dom':     [6],     // ♯4
  'mixo-b6':        [8],     // ♭6
  'locrian-nat2':   [2],     // ♮2
  'altered':        [1, 3],  // ♭9, ♯9
  // Harmonic Minor
  'harmonic-minor':  [8, 11], // ♭6, ♮7
  'phrygian-dom':    [1, 4],  // ♭2, ♮3
  // Diminished
  'dim-wh':  [9, 11],        // ♮6, ♮7
  'dim-hw':  [1, 4],         // ♭2, ♮3
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isStrongBeat(beat: number, goalBeat = 8): boolean {
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

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickWeighted<T>(items: T[], weights: number[]): T {
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

export function isExtensionTone(noteName: string, mode: Mode): boolean {
  const indices = EXTENSION_DEGREES[mode.chordQuality];
  if (!indices || indices.length === 0) return false;
  return indices.some(idx => mode.notes[idx] === noteName);
}

// ---------------------------------------------------------------------------
// Lick-driven generation
// ---------------------------------------------------------------------------

const RHYTHM_BEATS: Record<RhythmType, number> = {
  'q': 1.0, 't': 1/3, 'e': 0.5, 's': 0.25,
};

/** Select a lick from the library based on quality, beat budget, and context.
 *  When `chainFromStep` is provided (2nd lick in a chain), only licks whose
 *  startStep is 1-5 semitones from chainFromStep are eligible. */
export function selectLick(
  quality: string,
  maxBeats: number,
  goalSemitone: number | null,
  startHint: PhraseConfig['startHint'],
  contour: PhraseContour,
  rootSemitone = 0,
  modeSemi: number[] = [],
  charTones: number[] = [],
  chainFromStep?: number,
): Lick | null {
  const licks = getLicksForQuality(quality);
  if (licks.length === 0) return null;

  // Filter by duration + scale compatibility
  const semiSet = modeSemi.length > 0 ? new Set(modeSemi) : null;
  const eligible = licks.filter(l => {
    if (l.durationBeats > maxBeats || l.length < 3) return false;
    // Reject licks with 2+ unique out-of-scale pitch classes
    if (semiSet) {
      const uniqueOut = new Set(l.steps.filter(s => !semiSet.has(s))).size;
      if (uniqueOut >= 2) return false;
    }
    // Chain filter: startStep must be 1-5 semitones from previous lick's endStep
    if (chainFromStep !== undefined) {
      let pcDist = Math.abs(l.startStep - chainFromStep);
      if (pcDist > 6) pcDist = 12 - pcDist;
      if (pcDist === 0 || pcDist > 5) return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;

  // Score each lick
  const scored = eligible.map(l => {
    let score = 0;

    // Goal compatibility
    if (goalSemitone !== null) {
      if (l.endStep === goalSemitone) score += 30;
      else if (Math.abs(l.endStep - goalSemitone) <= 1 || Math.abs(l.endStep - goalSemitone) >= 11) score += 15;
    }

    // Start hint proximity (convert absolute semitone to root-relative)
    if (startHint) {
      const hintRelSemi = ((startHint.semitone - rootSemitone) + 12) % 12;
      const diff = Math.abs(l.startStep - hintRelSemi);
      if (l.startStep === hintRelSemi) score += 40;
      else if (diff <= 1 || diff >= 11) score += 20;
      else if (diff <= 2) score += 10;
    }

    // Out-of-scale penalty (for licks with 1 unique out-of-scale note)
    if (semiSet) {
      const outCount = l.steps.filter(s => !semiSet.has(s)).length;
      score -= outCount * 15;
    }

    // Characteristic tone bonus
    if (charTones.length > 0) {
      const stepsSet = new Set(l.steps);
      const charHits = charTones.filter(t => stepsSet.has(t)).length;
      score += charHits * 20;
    }

    // Contour affinity
    const contourDir = contour === 'arch' || contour === 'wave' ? 'asc'
      : contour === 'descending' || contour === 'reverse-arch' ? 'desc' : 'mixed';
    if (l.direction === contourDir) score += 10;

    // Fill rate: prefer licks that use more of the available beats
    const fillRate = l.durationBeats / maxBeats;
    if (fillRate >= 0.8) score += 15;
    else if (fillRate >= 0.5) score += 5;

    // Prefer shorter (more reusable) licks slightly
    if (l.length <= 6) score += 5;

    return { lick: l, score: Math.max(1, score) };
  });

  // Pick from top 10 by weighted random
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 10);
  return pickWeighted(
    top.map(s => s.lick),
    top.map(s => s.score),
  );
}

/** Resolve a lick's abstract steps to concrete fretboard positions.
 *  Returns PhraseNote[] with duration and beatStart, or null on failure. */
export function resolveLick(
  lick: Lick,
  pool: PoolNote[],
  mode: Mode,
  startRef: { stringIdx: number; fret: number },
  beatOffset = 0,
): PhraseNote[] | null {
  const rootSemi = mode.semi[0];
  const ctSet = new Set(mode.chordTones);
  const result: PhraseNote[] = [];
  let prevNote: { stringIdx: number; fret: number } | null = null;
  let accBeat = beatOffset;

  for (let i = 0; i < lick.steps.length; i++) {
    const targetSemi = (rootSemi + lick.steps[i]) % 12;
    const ref = prevNote ?? startRef;

    // Find all candidates matching the target semitone
    const candidates = pool.filter(n => n.semitone === targetSemi);
    if (candidates.length === 0) return null;

    // Score each candidate
    let best: PoolNote | null = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      let score = 0;

      // Absolute pitch proximity to reference
      const pitchDist = Math.abs(absolutePitch(c) - absolutePitch(ref));
      score += 50 - pitchDist * 3;

      // String distance
      const strDist = Math.abs(c.stringIdx - ref.stringIdx);
      if (strDist <= 1) score += 40;
      else if (strDist === 2) score += 20;
      else if (strDist === 3) score += 5;
      else score -= 30;

      // Direction match with lick interval
      if (i > 0 && lick.intervals[i - 1] !== 0) {
        const actualDir = absolutePitch(c) - absolutePitch(ref);
        const expectedDir = lick.intervals[i - 1];
        if ((actualDir > 0 && expectedDir > 0) || (actualDir < 0 && expectedDir < 0)) {
          score += 15;
        }
      }

      // Same string bonus for stepwise motion
      if (strDist === 0) score += 10;

      // First note: extra bonus for proximity to startRef pitch
      if (i === 0) {
        const refPitch = absolutePitch(startRef);
        if (Math.abs(absolutePitch(c) - refPitch) <= 1) score += 20;
      }

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    // Resolution failure threshold
    if (!best || bestScore < -20) return null;

    // Leap guard: reject if consecutive notes span > 9 semitones (major 6th)
    if (prevNote) {
      const leap = Math.abs(absolutePitch(best) - absolutePitch(prevNote));
      if (leap > 9) return null;
    }

    const duration = lick.rhythm[i] ?? 'e';
    const beatPos = Math.floor(accBeat * 2) + 1; // convert to 1-based eighth-note position
    const totalBeatCount = Math.ceil((beatOffset + lick.durationBeats) * 2);
    const strongBeat = isStrongBeat(beatPos, beatOffset === 0 ? 8 : totalBeatCount);

    // Strong-beat CT enforcement: reject chromatic/approach on strong beats
    if (strongBeat && !ctSet.has(best.noteName) && !isExtensionTone(best.noteName, mode)) {
      // Allow scale tones on strong beats, but reject approach/chromatic
      if (best.isApproach) return null;
    }

    const isStrong = Math.abs(accBeat - Math.round(accBeat)) < 0.05 && accBeat === Math.round(accBeat);

    const pn: PhraseNote = {
      noteName: best.noteName,
      stringIdx: best.stringIdx,
      fret: best.fret,
      semitone: best.semitone,
      isChordTone: ctSet.has(best.noteName),
      isApproach: best.isApproach,
      beatPosition: Math.min(beatPos, 8),
      isStrong,
      duration,
      beatStart: accBeat,
    };
    result.push(pn);
    prevNote = best;
    accBeat += RHYTHM_BEATS[duration];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core generation — lick-search only
// ---------------------------------------------------------------------------

export const ALL_CONTOURS: PhraseContour[] = ['arch', 'reverse-arch', 'descending', 'wave'];

/** Complement contour for the 2nd lick in a chain */
const COMPLEMENT_CONTOUR: Record<PhraseContour, PhraseContour> = {
  'arch': 'descending',
  'reverse-arch': 'wave',
  'descending': 'arch',
  'wave': 'reverse-arch',
  'ascending': 'descending',
};

export function generatePhraseLick(
  position: Position,
  mode: Mode,
  fretMap: FretMap,
  config: PhraseConfig,
  targetThirdNote?: string,
): GeneratedPhrase | null {
  const includeChromatic = config.approachTypes.length > 0;
  const pool = buildNotePool(position, mode, fretMap, includeChromatic);
  const ctPool = pool.filter(n => n.isChordTone);
  const rootSemitone = mode.semi[0];

  if (ctPool.length === 0) {
    return null;
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

  // --- Phrase length & goal beat ---
  const totalBeats = config.beatCount ? config.beatCount * 2 : (config.phraseLength ?? 8);
  const maxLickBeats = totalBeats / 2; // convert eighth-note count to beat count

  // --- Goal note ---
  let goalResult: GoalResult;
  if (config.goalNoteOverride) {
    const override = config.goalNoteOverride;
    const exact = activeCtPool.find(n => n.stringIdx === override.stringIdx && n.fret === override.fret);
    const byName = activeCtPool.filter(n => n.noteName === override.noteName);
    const closest = exact ?? (byName.length > 0 ? byName.reduce((best, n) =>
      Math.abs(absolutePitch(n) - absolutePitch(override as any)) < Math.abs(absolutePitch(best) - absolutePitch(override as any)) ? n : best
    ) : null);
    if (closest) {
      goalResult = { note: closest, reason: 'ユーザー指定ゴール' };
    } else {
      const anyPool = activePool.find(n => n.stringIdx === override.stringIdx && n.fret === override.fret);
      goalResult = anyPool
        ? { note: anyPool, reason: 'ユーザー指定ゴール (非CT)' }
        : chooseGoalNote(activeCtPool, mode, targetThirdNote, config.nextChordContext);
    }
  } else {
    goalResult = chooseGoalNote(activeCtPool, mode, targetThirdNote, config.nextChordContext);
  }
  const goalNote = goalResult.note;
  const goalSemiRel = ((goalNote.semitone - rootSemitone) + 12) % 12;
  const charTones = CHARACTERISTIC_TONES[mode.key] ?? [];

  // --- Lick selection + resolution loop (5 retries, with chaining) ---
  for (let attempt = 0; attempt < 5; attempt++) {
    const lick = selectLick(
      mode.chordQuality, maxLickBeats, goalSemiRel,
      config.startHint, contour, rootSemitone, mode.semi, charTones,
    );
    if (!lick) continue;

    const startRef = config.startHint ?? activeCtPool[0];
    const resolved1 = resolveLick(lick, activePool, mode, startRef, 0);
    if (!resolved1 || resolved1.length < 3) continue;

    // Assign default duration + lick index tag
    for (let i = 0; i < resolved1.length; i++) {
      if (!resolved1[i].duration) resolved1[i].duration = 'e';
      resolved1[i].lickIdx = 0;
    }

    // --- Lick chaining: try to append a 2nd lick if enough beats remain ---
    const lastNote1 = resolved1[resolved1.length - 1];
    const usedBeats1 = (lastNote1.beatStart ?? 0) + RHYTHM_BEATS[lastNote1.duration ?? 'e'];
    const remainAfter1 = maxLickBeats - usedBeats1;
    let resolved: PhraseNote[] = resolved1;
    let lickId: string | string[] = lick.id;

    if (remainAfter1 >= 1.0) {
      const endStepRel = ((lastNote1.semitone - rootSemitone) + 12) % 12;
      const hint2 = {
        noteName: lastNote1.noteName,
        stringIdx: lastNote1.stringIdx,
        fret: lastNote1.fret,
        semitone: lastNote1.semitone,
      };
      const contour2 = COMPLEMENT_CONTOUR[contour];

      const lick2 = selectLick(
        mode.chordQuality, remainAfter1, goalSemiRel,
        hint2, contour2, rootSemitone, mode.semi, charTones,
        endStepRel, // chainFromStep
      );
      if (lick2) {
        const resolved2 = resolveLick(lick2, activePool, mode, lastNote1, usedBeats1);
        if (resolved2 && resolved2.length >= 3) {
          for (let i = 0; i < resolved2.length; i++) {
            if (!resolved2[i].duration) resolved2[i].duration = 'e';
            resolved2[i].lickIdx = 1;
          }
          resolved = [...resolved1, ...resolved2];
          lickId = [lick.id, lick2.id];
        }
      }
      // If chaining failed, fall through with resolved1 + connector below
    }

    // If lick(s) don't end on goal, append connector note
    const lastResNote = resolved[resolved.length - 1];
    const lastBeatStart = lastResNote.beatStart ?? 0;
    const remainingBeats = maxLickBeats - lastBeatStart - RHYTHM_BEATS[lastResNote.duration ?? 'e'];
    if (remainingBeats >= 0.4 && lastResNote.noteName !== goalNote.noteName) {
      const goalResolved = nearestInstance(goalNote.noteName, lastResNote, activeCtPool);
      if (goalResolved) {
        const connBeatStart = lastBeatStart + RHYTHM_BEATS[lastResNote.duration ?? 'e'];
        const connPN: PhraseNote = {
          noteName: goalResolved.noteName,
          stringIdx: goalResolved.stringIdx,
          fret: goalResolved.fret,
          semitone: goalResolved.semitone,
          isChordTone: goalResolved.isChordTone,
          isApproach: false,
          beatPosition: Math.min(Math.floor(connBeatStart * 2) + 1, 8),
          isStrong: Math.abs(connBeatStart - Math.round(connBeatStart)) < 0.05,
          duration: 'e',
          beatStart: connBeatStart,
        };
        resolved.push(connPN);
      }
    }

    // Verify goal achievement — update reason if actual last note differs
    const finalNote = resolved[resolved.length - 1];
    let actualGoalReason = goalResult.reason;
    if (finalNote.noteName !== goalNote.noteName) {
      const chordToneSet = new Set(mode.chordTones);
      if (chordToneSet.has(finalNote.noteName)) {
        actualGoalReason = `CT到達 (${finalNote.noteName})`;
      } else {
        actualGoalReason = 'リック終端';
      }
    }

    // Extract motif from resolved notes
    const lickMotif: number[] = [];
    for (let i = 1; i < Math.min(3, resolved.length); i++) {
      lickMotif.push(absolutePitch(resolved[i]) - absolutePitch(resolved[i - 1]));
    }

    return {
      notes: resolved,
      posId: position.id,
      modeKey: mode.key,
      rootName: mode.notes[0],
      config: { ...config, contour },
      motif: lickMotif,
      goalReason: actualGoalReason,
      lickId,
      totalBeats: maxLickBeats,
    };
  }

  // All attempts failed
  return null;
}

// ---------------------------------------------------------------------------
// Goal & start note selection
// ---------------------------------------------------------------------------

export interface GoalResult { note: PoolNote; reason: string }

export function chooseGoalNote(
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

/** Find the closest physical instance of a note name relative to a reference position */
export function nearestInstance(
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

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const SEMI_MAP: Record<string, number> = {
  'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
  'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  'C#': 1, 'D#': 3, 'F#': 6, 'G#': 8, 'A#': 10,
};

function findSemitone(noteName: string): number | null {
  return SEMI_MAP[noteName] ?? null;
}

/** Backward-compatible alias */
export const generatePhrase = generatePhraseLick;
