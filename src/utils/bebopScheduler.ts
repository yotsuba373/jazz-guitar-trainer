import type { Mode, PhraseNote, RhythmType, PoolNote, ApproachGroupInfo, ApproachType } from '../types';
import { SEGMENT_FNS } from './bebopSegments';
import { getBebopPassingTone } from '../constants/bebopScales';
import type { PhraseTemplate } from './bebopTemplates';
import { allocateBeats } from './bebopTemplates';
import type { PhraseSkeleton, SkeletonSlot } from './skeleton';

// ---------------------------------------------------------------------------
// Shared helpers (moved from phraseGenerator.ts)
// ---------------------------------------------------------------------------

/** Absolute pitch (semitone + octave info) for interval comparison.
 *  Uses fret as a proxy for octave height since we're on a guitar.  */
export function absolutePitch(note: { stringIdx: number; fret: number }): number {
  const OPEN_MIDI = [64, 59, 55, 50, 45, 40]; // 1E=E4, B=B3, G=G3, D=D3, A=A2, 6E=E2
  return OPEN_MIDI[note.stringIdx] + note.fret;
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const EXTENSION_DEGREES: Record<string, number[]> = {
  'maj7':  [1, 5],
  '7':     [1, 5],
  'm7':    [1],
  'mMaj7': [1],
  '7alt':  [],
  'dim7':  [],
};

export function isExtensionTone(noteName: string, mode: Mode): boolean {
  const indices = EXTENSION_DEGREES[mode.chordQuality];
  if (!indices || indices.length === 0) return false;
  return indices.some(idx => mode.notes[idx] === noteName);
}

// ---------------------------------------------------------------------------
// Rhythm constants
// ---------------------------------------------------------------------------

export const RHYTHM_BEATS: Record<RhythmType, number> = {
  'q': 1.0, 't': 1/3, 'e': 0.5, 's': 0.25,
};

// ---------------------------------------------------------------------------
// planSegmentRhythms — pre-determine rhythm for each segment BEFORE generation
// ---------------------------------------------------------------------------

/** Rhythm eligibility per segment type: [rhythm, probability] pairs */
const SEGMENT_RHYTHM_TABLE: Record<string, [RhythmType, number][]> = {
  scaleRun:       [['e', 1.0]],                           // §2: always eighth
  enclosure:      [['e', 1.0]],                           // parity-dependent, post-compress to 16th
  arpeggio:       [['e', 0.55], ['t', 0.45]],             // Baker/Larsen: CT arpeggio triplet
  '1235':         [['e', 0.55], ['t', 0.45]],             // 4-note pattern = triplet natural
  dim7From3rd:    [['e', 0.55], ['t', 0.45]],             // CT arpeggio variant
  upperStructure: [['e', 0.55], ['t', 0.45]],             // CT arpeggio variant
  approachCT:     [['e', 0.65], ['s', 0.35]],             // approach → CT = quick passing
  chromatic:      [['e', 0.45], ['s', 0.55]],             // chromatic run = tension
  octaveDisp:     [['e', 0.60], ['t', 0.40]],             // octave leap + arpeggio
};

export interface SegmentRhythmPlan {
  rhythm: RhythmType;
  beatBudget: number;
  noteCount: number;
}

/**
 * Plan rhythms for each segment before generation.
 * Returns a rhythm plan per segment with the chosen rhythm, beat budget, and note count.
 */
export function planSegmentRhythms(
  template: PhraseTemplate,
  beatsPerSeg: number[],
  _beatOffset: number,
): SegmentRhythmPlan[] {
  return template.segments.map((spec, i) => {
    const budget = beatsPerSeg[i];
    const table = SEGMENT_RHYTHM_TABLE[spec.type] ?? [['e', 1.0]];

    // Pick rhythm by weighted random
    let rhythm: RhythmType = 'e';
    const r = Math.random();
    let acc = 0;
    for (const [rType, prob] of table) {
      acc += prob;
      if (r < acc) { rhythm = rType; break; }
    }

    const beatsPerNote = RHYTHM_BEATS[rhythm];
    // Enclosure needs at least 3 notes (above + below + target)
    const minNotes = spec.type === 'enclosure' ? 3 : 2;
    const noteCount = Math.max(minNotes, Math.floor(budget / beatsPerNote));
    return { rhythm, beatBudget: budget, noteCount };
  });
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

/** Check if a beat position falls on a downbeat (integer beat position: 1,2,3,4) */
function isOnBeat(beat: number): boolean {
  return Math.abs(beat - Math.round(beat)) < 0.05;
}

/** Check if beat falls on a strong beat (beats 1, 3 = even integer positions) */
function isOnStrongBeat(beat: number): boolean {
  if (!isOnBeat(beat)) return false;
  return Math.round(beat) % 2 === 0;
}

// ---------------------------------------------------------------------------
// buildPhrase — execute a template and produce PhraseNote[]
// ---------------------------------------------------------------------------

export function buildPhrase(
  template: PhraseTemplate,
  pool: PoolNote[],
  mode: Mode,
  startNote: PoolNote,
  goalNote: PoolNote,
  totalEighths: number,
  beatOffset = 0,
  goalIsVL = false,
  forceStartNote?: PoolNote,
): PhraseNote[] | null {
  const ctSet = new Set(mode.chordTones);
  const bebopPassing = getBebopPassingTone(mode);
  const quality = mode.chordQuality;

  // E案: Pre-plan rhythms before segment generation
  const totalBeats = totalEighths * 0.5;
  const beatsPerSeg = allocateBeats(template, totalBeats);
  const rhythmPlan = planSegmentRhythms(template, beatsPerSeg, beatOffset);

  const allNotes: { note: PoolNote; segIdx: number; isRest?: boolean; rhythm?: RhythmType }[] = [];
  let current = startNote;

  // Execute each segment with pre-planned rhythm
  for (let si = 0; si < template.segments.length; si++) {
    const spec = template.segments[si];
    const segFn = SEGMENT_FNS[spec.type];
    if (!segFn) continue;

    const isLast = si === template.segments.length - 1;
    const plan = rhythmPlan[si];

    // Compute accurate beat position using actual accumulated notes
    const segBeatPos = beatOffset + allNotes.reduce(
      (sum, n) => sum + RHYTHM_BEATS[n.rhythm ?? 'e'], 0);
    const segParity = isOnBeat(segBeatPos) ? 0 : 1;
    // Beat phase (0-3): 0=strong-on, 1=strong-off, 2=nonstrong-on, 3=nonstrong-off
    const segBeatPhase = Math.round(segBeatPos * 2) % 4;

    // For segments with triplet rhythm, convert noteCount to eighths equivalent
    // (segment functions still expect "eighths" count parameter)
    const segNotes = segFn(
      pool, mode, current, spec.direction, plan.noteCount,
      { goalNote: isLast ? goalNote : undefined, quality,
        beatParity: segParity, beatPhase: segBeatPhase, rhythm: plan.rhythm },
    );

    if (!segNotes || segNotes.length === 0) {
      // Segment failed — try a simple scale run as fallback
      const fallbackCount = Math.max(2, Math.floor(plan.beatBudget / 0.5));
      const fallback = SEGMENT_FNS.scaleRun(pool, mode, current, spec.direction, fallbackCount);
      if (fallback && fallback.length > 0) {
        for (const n of fallback) allNotes.push({ note: n, segIdx: si, rhythm: 'e' });
        current = fallback[fallback.length - 1];
        continue;
      }
      return null; // can't recover
    }

    // forceStartNote prepend (first segment only):
    // If the first segment didn't start with the forced note, prepend it.
    // scaleRun/chromatic already preserve startNote, so prepend only fires
    // for parity-independent segments (arpeggio, 1235, approachCT, etc.)
    if (si === 0 && forceStartNote && segNotes.length > 0) {
      const first = segNotes[0];
      const forcePitch = absolutePitch(forceStartNote);
      const firstPitch = absolutePitch(first);
      if (forcePitch !== firstPitch || first.stringIdx !== forceStartNote.stringIdx) {
        allNotes.push({ note: forceStartNote, segIdx: si, rhythm: plan.rhythm });
      }
    }

    // Segment junction smoothness: check distance from previous segment's last note
    if (allNotes.length > 0) {
      const prevNote = allNotes[allNotes.length - 1].note;
      const firstNote = segNotes[0];
      const junctionLeap = Math.abs(absolutePitch(firstNote) - absolutePitch(prevNote));
      const stringDist = Math.abs(firstNote.stringIdx - prevNote.stringIdx);
      // Reject if junction is too disjunct (> major 6th or > 2 strings apart)
      if (junctionLeap > 9 || stringDist > 3) {
        // Try fallback scale run instead
        const fallbackCount = Math.max(2, Math.floor(plan.beatBudget / 0.5));
        const fallback = SEGMENT_FNS.scaleRun(pool, mode, allNotes[allNotes.length - 1].note, spec.direction, fallbackCount);
        if (fallback && fallback.length > 0) {
          const fb0 = fallback[0];
          const fbLeap = Math.abs(absolutePitch(fb0) - absolutePitch(prevNote));
          if (fbLeap <= 9) {
            for (const n of fallback) allNotes.push({ note: n, segIdx: si, rhythm: 'e' });
            current = fallback[fallback.length - 1];
            continue;
          }
        }
        return null;
      }
    }

    // Deduplicate junction: skip first note if identical to previous segment's last
    let skipFirst = false;
    if (allNotes.length > 0 && segNotes.length > 1) {
      const prev = allNotes[allNotes.length - 1].note;
      const first = segNotes[0];
      if (absolutePitch(first) === absolutePitch(prev) &&
          first.stringIdx === prev.stringIdx) {
        skipFirst = true;
      }
    }
    for (let ni = skipFirst ? 1 : 0; ni < segNotes.length; ni++) {
      allNotes.push({ note: segNotes[ni], segIdx: si, rhythm: plan.rhythm });
    }
    current = segNotes[segNotes.length - 1];
  }

  if (allNotes.length < 3) return null;

  // E案: Extract pre-planned rhythms directly (no post-process assignRhythms)
  const rawRhythms: RhythmType[] = allNotes.map(e => e.rhythm ?? 'e');

  // Post-compress enclosure/chromatic segments to 16th notes
  {
    const segGroups: { start: number; end: number; type: string }[] = [];
    let gi = 0;
    while (gi < allNotes.length) {
      const segIdx = allNotes[gi].segIdx;
      const start = gi;
      while (gi < allNotes.length && allNotes[gi].segIdx === segIdx) gi++;
      segGroups.push({ start, end: gi, type: template.segments[segIdx]?.type ?? '' });
    }
    for (const group of segGroups) {
      const count = group.end - group.start;
      // Note: enclosure segments are NOT compressed to 16th; the padding in
      // segEnclosure carefully aligns the target to a strong beat at 8th spacing,
      // and 16th compression would shift the target off that beat.
      if (group.type === 'chromatic' && count >= 2 && Math.random() < 0.45) {
        const limit = Math.min(count, 6);
        for (let j = group.start; j < group.start + limit; j++) rawRhythms[j] = 's';
      }
    }
  }

  // Last note CT → quarter (45% chance) for landing feel
  if (allNotes.length > 0 && ctSet.has(allNotes[allNotes.length - 1].note.noteName) && Math.random() < 0.45) {
    rawRhythms[rawRhythms.length - 1] = 'q';
  }

  // First note on downbeat CT → quarter (15% chance) for pickup/breathing feel
  if (allNotes.length > 0 && !allNotes[0].isRest && ctSet.has(allNotes[0].note.noteName)
      && isOnBeat(beatOffset) && Math.random() < 0.15) {
    rawRhythms[0] = 'q';
  }

  // Segment boundary last note CT → quarter (20% chance) for phrasing
  if (template.segments.length > 1) {
    for (let i = 1; i < allNotes.length; i++) {
      if (allNotes[i].segIdx !== allNotes[i - 1].segIdx && i > 0) {
        const prevEntry = allNotes[i - 1];
        if (!prevEntry.isRest && ctSet.has(prevEntry.note.noteName) && Math.random() < 0.20) {
          rawRhythms[i - 1] = 'q';
        }
      }
    }
  }

  // Insert rests at segment junctions (15% probability, multi-segment templates only)
  if (template.segments.length > 1) {
    for (let i = allNotes.length - 1; i > 0; i--) {
      if (allNotes[i].segIdx !== allNotes[i - 1].segIdx && Math.random() < 0.15) {
        // Compute cumulative beat position at junction
        let accBeat = beatOffset;
        for (let j = 0; j < i; j++) accBeat += RHYTHM_BEATS[rawRhythms[j]] ?? 0.5;
        const onDownbeat = Math.abs(accBeat - Math.round(accBeat)) < 0.1;
        // Choose rest duration so next segment starts 70% on upbeat / 30% on downbeat
        const restDuration: RhythmType = onDownbeat
          ? (Math.random() < 0.7 ? 'e' : 'q')
          : (Math.random() < 0.7 ? 'q' : 'e');
        allNotes.splice(i, 0, {
          note: { ...allNotes[i - 1].note },
          segIdx: allNotes[i - 1].segIdx,
          isRest: true,
        });
        rawRhythms.splice(i, 0, restDuration);
      }
    }
  }

  // Trim to beat budget (instead of note count)
  const beatBudget = totalEighths * 0.5; // convert eighth count to beats
  const trimmed: typeof allNotes = [];
  const trimmedRhythms: RhythmType[] = [];
  let usedBeats = 0;
  for (let i = 0; i < allNotes.length; i++) {
    const noteBeats = RHYTHM_BEATS[rawRhythms[i]];
    if (usedBeats + noteBeats > beatBudget + 0.01) break;
    trimmed.push(allNotes[i]);
    trimmedRhythms.push(rawRhythms[i]);
    usedBeats += noteBeats;
  }

  // Try to append goal connector if not reached
  if (trimmed.length > 0 && trimmed[trimmed.length - 1].note.noteName !== goalNote.noteName
      && usedBeats + 0.5 <= beatBudget + 0.01) {
    trimmed.push({ note: goalNote, segIdx: trimmed[trimmed.length - 1].segIdx });
    trimmedRhythms.push('e');
  }

  if (trimmed.length < 3) return null;

  // --- Quality checks (beat-position based) ---

  // §2: Bebop passing tone must not land on downbeats — fix by swapping
  if (bebopPassing !== null) {
    let bp = beatOffset;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i].isRest) { bp += RHYTHM_BEATS[trimmedRhythms[i]]; continue; }
      if (isOnBeat(bp) && trimmed[i].note.semitone === bebopPassing && !ctSet.has(trimmed[i].note.noteName)) {
        // Swap to nearest non-passing scale tone
        const cur = trimmed[i].note;
        const curPitch = absolutePitch(cur);
        const scaleSemis = new Set(mode.semi);
        let bestSwap: PoolNote | null = null;
        let bestDist = Infinity;
        for (const n of pool) {
          if (n.isApproach) continue;
          if (n.semitone === bebopPassing) continue;
          if (!scaleSemis.has(n.semitone) && !ctSet.has(n.noteName)) continue;
          const pd = Math.abs(absolutePitch(n) - curPitch);
          const sd = Math.abs(n.stringIdx - cur.stringIdx);
          if (pd <= 2 && sd <= 1 && pd < bestDist) {
            bestDist = pd;
            bestSwap = n;
          }
        }
        if (bestSwap) {
          trimmed[i] = { note: bestSwap, segIdx: trimmed[i].segIdx };
        }
      }
      bp += RHYTHM_BEATS[trimmedRhythms[i]];
    }
  }

  // CT promotion on downbeats: swap non-CT scale tones to nearby CTs
  {
    let bp = beatOffset;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i].isRest) { bp += RHYTHM_BEATS[trimmedRhythms[i]]; continue; }
      if (isOnBeat(bp) && !ctSet.has(trimmed[i].note.noteName)
          && !trimmed[i].note.isApproach && !isExtensionTone(trimmed[i].note.noteName, mode)) {
        const cur = trimmed[i].note;
        const curPitch = absolutePitch(cur);
        let bestSwap: PoolNote | null = null;
        let bestDist = Infinity;
        for (const n of pool) {
          if (!ctSet.has(n.noteName)) continue;
          if (n.isApproach) continue;
          if (bebopPassing !== null && n.semitone === bebopPassing) continue;
          const pd = Math.abs(absolutePitch(n) - curPitch);
          const sd = Math.abs(n.stringIdx - cur.stringIdx);
          if (pd <= 2 && sd <= 1 && pd < bestDist) {
            bestDist = pd;
            bestSwap = n;
          }
        }
        if (bestSwap) {
          trimmed[i] = { note: bestSwap, segIdx: trimmed[i].segIdx };
        }
      }
      bp += RHYTHM_BEATS[trimmedRhythms[i]];
    }
  }

  // CT on downbeats check
  let strongCount = 0;
  let strongCTCount = 0;
  {
    let beatPos = beatOffset;
    for (let i = 0; i < trimmed.length; i++) {
      if (!trimmed[i].isRest && isOnBeat(beatPos)) {
        strongCount++;
        if (ctSet.has(trimmed[i].note.noteName) || isExtensionTone(trimmed[i].note.noteName, mode)) {
          strongCTCount++;
        }
      }
      beatPos += RHYTHM_BEATS[trimmedRhythms[i]];
    }
  }
  if (strongCount > 0 && strongCTCount / strongCount < 0.4) return null;

  // GT (3rd/7th) on strong beats — promote then gate (§1 supplement)
  // WJD data shows GT on ~31% of downbeats; strong beats (1,3) are the primary GT positions.
  const gtNames = new Set<string>();
  if (mode.chordTones.length >= 2) gtNames.add(mode.chordTones[1]); // 3rd
  if (mode.chordTones.length >= 4) gtNames.add(mode.chordTones[3]); // 7th

  // Promotion pass: try to swap non-GT CTs on strong beats to nearby GTs
  if (gtNames.size > 0) {
    let bp = beatOffset;
    let strongGTFound = false;
    for (let i = 0; i < trimmed.length; i++) {
      if (!trimmed[i].isRest && isOnStrongBeat(bp) && gtNames.has(trimmed[i].note.noteName)) {
        strongGTFound = true;
      }
      bp += RHYTHM_BEATS[trimmedRhythms[i]];
    }
    if (!strongGTFound) {
      // Try swapping one non-GT CT on a strong beat to a nearby GT
      bp = beatOffset;
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i].isRest) { bp += RHYTHM_BEATS[trimmedRhythms[i]]; continue; }
        if (isOnStrongBeat(bp) && ctSet.has(trimmed[i].note.noteName) && !gtNames.has(trimmed[i].note.noteName)) {
          const cur = trimmed[i].note;
          const curPitch = absolutePitch(cur);
          let bestGT: PoolNote | null = null;
          let bestDist = Infinity;
          for (const n of pool) {
            if (!gtNames.has(n.noteName)) continue;
            // §2: never place bebop passing tone on downbeat
            if (bebopPassing !== null && n.semitone === bebopPassing) continue;
            const pd = Math.abs(absolutePitch(n) - curPitch);
            const sd = Math.abs(n.stringIdx - cur.stringIdx);
            if (pd <= 3 && sd <= 1 && pd < bestDist) {
              bestDist = pd;
              bestGT = n;
            }
          }
          if (bestGT) {
            trimmed[i] = { note: bestGT, segIdx: trimmed[i].segIdx };
            break; // one swap is enough
          }
        }
        bp += RHYTHM_BEATS[trimmedRhythms[i]];
      }
    }
  }

  // Gate: reject if ≥2 strong beats but no GT on any of them
  {
    let strongBeatCount = 0;
    let strongGTCount = 0;
    let bp2 = beatOffset;
    for (let i = 0; i < trimmed.length; i++) {
      if (!trimmed[i].isRest && isOnStrongBeat(bp2)) {
        strongBeatCount++;
        if (gtNames.has(trimmed[i].note.noteName)) strongGTCount++;
      }
      bp2 += RHYTHM_BEATS[trimmedRhythms[i]];
    }
    if (strongBeatCount >= 2 && strongGTCount === 0) return null;
  }

  // CT ending trial: swap last note to nearest CT if possible (~65% CT ending rate)
  // Skip if goalIsVL and last note is already the goal (preserve VL resolution)
  const lastEntry = trimmed[trimmed.length - 1];
  const lastIsGoal = lastEntry.note.noteName === goalNote.noteName
    && lastEntry.note.stringIdx === goalNote.stringIdx && lastEntry.note.fret === goalNote.fret;
  if (!ctSet.has(lastEntry.note.noteName) && !(goalIsVL && lastIsGoal)) {
    const lastPitch = absolutePitch(lastEntry.note);
    // Compute other notes' pitch bounds (excluding last) to constrain swap
    const otherPitches = trimmed.slice(0, -1).map(e => absolutePitch(e.note));
    const otherMin = Math.min(...otherPitches);
    const otherMax = Math.max(...otherPitches);
    let bestCt: PoolNote | null = null;
    let bestDist = Infinity;
    for (const n of pool) {
      if (!ctSet.has(n.noteName)) continue;
      const pd = Math.abs(absolutePitch(n) - lastPitch);
      const sd = Math.abs(n.stringIdx - lastEntry.note.stringIdx);
      // Ensure swap keeps range within 4-15
      const np = absolutePitch(n);
      const newMin = Math.min(otherMin, np);
      const newMax = Math.max(otherMax, np);
      if (pd <= 3 && sd <= 1 && pd < bestDist && (newMax - newMin) <= 15 && (newMax - newMin) >= 4) {
        bestDist = pd;
        bestCt = n;
      }
    }
    if (bestCt) {
      trimmed[trimmed.length - 1] = { note: bestCt, segIdx: lastEntry.segIdx };
    }
    // If no CT found nearby, pass through (don't reject)
  }

  // Tension ending: swap 26% of CT endings to neighboring non-CT scale tone (~95% × 0.74 ≈ 70%)
  // Skip if goalIsVL and last note is the goal (preserve VL resolution)
  {
    const lastE = trimmed[trimmed.length - 1];
    const lastEIsGoal = lastE.note.noteName === goalNote.noteName
      && lastE.note.stringIdx === goalNote.stringIdx && lastE.note.fret === goalNote.fret;
    if (ctSet.has(lastE.note.noteName) && Math.random() < 0.26 && !(goalIsVL && lastEIsGoal)) {
      const lastPitch = absolutePitch(lastE.note);
      const scaleSemis = new Set(mode.semi);
      let bestTension: PoolNote | null = null;
      let bestDist = Infinity;
      for (const n of pool) {
        if (ctSet.has(n.noteName)) continue;
        if (n.isApproach) continue;
        if (!scaleSemis.has(n.semitone)) continue;
        const pd = Math.abs(absolutePitch(n) - lastPitch);
        const sd = Math.abs(n.stringIdx - lastE.note.stringIdx);
        if (pd <= 2 && sd <= 1 && pd < bestDist) {
          bestDist = pd;
          bestTension = n;
        }
      }
      if (bestTension) {
        trimmed[trimmed.length - 1] = { note: bestTension, segIdx: lastE.segIdx };
      }
    }
  }

  // Range check (skip rests)
  const soundNotes = trimmed.filter(e => !e.isRest);
  const pitches = soundNotes.map(e => absolutePitch(e.note));
  const range = Math.max(...pitches) - Math.min(...pitches);
  if (range > 15 || range < 4) return null;

  // Leap check (skip rests)
  for (let i = 1; i < soundNotes.length; i++) {
    const leap = Math.abs(absolutePitch(soundNotes[i].note) - absolutePitch(soundNotes[i - 1].note));
    if (leap > 9) return null;
  }

  // §9: Direction changes should avoid strong beats (beats 1, 3) (Barry Harris / Jens Larsen)
  // Use soundNotes (rests excluded) with their beat positions
  if (soundNotes.length >= 4) {
    let dirChanges = 0;
    let dirChangesOnStrong = 0;
    // Build beat positions for sound notes only
    const soundBeatPos: number[] = [];
    {
      let bp = beatOffset;
      for (let ni = 0; ni < trimmed.length; ni++) {
        if (!trimmed[ni].isRest) {
          soundBeatPos.push(bp);
        }
        bp += RHYTHM_BEATS[trimmedRhythms[ni]];
      }
    }
    for (let i = 2; i < soundNotes.length; i++) {
      const prev = absolutePitch(soundNotes[i - 1].note) - absolutePitch(soundNotes[i - 2].note);
      const cur = absolutePitch(soundNotes[i].note) - absolutePitch(soundNotes[i - 1].note);
      if (prev !== 0 && cur !== 0 && ((prev > 0 && cur < 0) || (prev < 0 && cur > 0))) {
        dirChanges++;
        if (isOnStrongBeat(soundBeatPos[i])) dirChangesOnStrong++;
      }
    }
    // Reject if >60% of direction changes land on strong beats (beats 1, 3)
    if (dirChanges >= 2 && dirChangesOnStrong / dirChanges > 0.6) return null;
  }

  // --- Annotate approach groups for approachCT / enclosure segments ---
  const approachGroupMap = new Map<number, ApproachGroupInfo>();
  {
    let groupId = 0;
    let groupStart = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i].isRest) { groupStart = i + 1; continue; }
      const segType = template.segments[trimmed[i].segIdx]?.type;
      const isApproachSeg = segType === 'approachCT' || segType === 'enclosure';
      const nextSegDiff = i + 1 < trimmed.length && trimmed[i + 1].segIdx !== trimmed[i].segIdx;
      const isLast = i === trimmed.length - 1;
      const isCT = ctSet.has(trimmed[i].note.noteName);

      if (!isApproachSeg) {
        groupStart = i + 1;
        continue;
      }

      // CT found with preceding non-CT notes in same segment = approach group
      if (isCT && i > groupStart) {
        const gId = groupId++;
        const approachCount = i - groupStart;
        const groupSize = approachCount + 1;

        // Infer approach type from intervals
        let approachType: ApproachType;
        if (segType === 'enclosure' && approachCount >= 2) {
          approachType = 'enclosure';
        } else if (approachCount >= 2) {
          approachType = 'double-chromatic';
        } else {
          const apPitch = absolutePitch(trimmed[groupStart].note);
          const tgPitch = absolutePitch(trimmed[i].note);
          const diff = tgPitch - apPitch;
          if (diff === 1) approachType = 'single-below';
          else if (diff === -1) approachType = 'single-above';
          else if (diff > 0) approachType = 'diatonic-below';
          else approachType = 'diatonic-above';
        }

        for (let j = groupStart; j < i; j++) {
          approachGroupMap.set(j, {
            groupId: gId, approachType, role: 'approach',
            positionInGroup: j - groupStart, groupSize,
          });
        }
        approachGroupMap.set(i, {
          groupId: gId, approachType, role: 'target',
          positionInGroup: approachCount, groupSize,
        });
        groupStart = i + 1;
      } else if (!isCT) {
        // non-CT: continue accumulating
      } else {
        // CT with no preceding approach notes
        groupStart = i + 1;
      }

      // Reset group start on segment boundary
      if (nextSegDiff || isLast) groupStart = i + 1;
    }
  }

  // --- Convert to PhraseNote[] ---
  let accBeat = beatOffset;
  const phraseNotes: PhraseNote[] = trimmed.map((entry, idx) => {
    const { note, segIdx } = entry;
    const duration = trimmedRhythms[idx];
    const beatPos = Math.min(Math.floor(accBeat * 2) + 1, 8);
    const strong = isOnStrongBeat(accBeat);
    const isCT = ctSet.has(note.noteName);
    const isBebopPass = bebopPassing !== null && note.semitone === bebopPassing && !isCT;
    const ag = approachGroupMap.get(idx);
    const segType = template.segments[segIdx]?.type;
    const isDim7 = !isCT && segType === 'dim7From3rd';

    const pn: PhraseNote = {
      noteName: note.noteName,
      stringIdx: note.stringIdx,
      fret: note.fret,
      semitone: note.semitone,
      isChordTone: isCT,
      isApproach: note.isApproach || (ag?.role === 'approach'),
      beatPosition: beatPos,
      isStrong: strong,
      duration,
      beatStart: accBeat,
      segmentIdx: segIdx,
      isDim7Tone: isDim7 || undefined,
      isBebopPassing: isBebopPass || undefined,
      isRest: entry.isRest || undefined,
      approachGroup: ag,
    };
    accBeat += RHYTHM_BEATS[duration];
    return pn;
  });

  return phraseNotes;
}

// ---------------------------------------------------------------------------
// fillSkeleton — skeleton-driven phrase construction (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Fill a skeleton with notes using template segments.
 * Each segment is guided by skeleton anchors (exitAnchor / interiorAnchors).
 * Post-processing is minimal: only safety checks (range, leap, direction).
 */
export function fillSkeleton(
  skeleton: PhraseSkeleton,
  template: PhraseTemplate,
  pool: PoolNote[],
  mode: Mode,
  goalIsVL = false,
  forceStartNote?: PoolNote,
): PhraseNote[] | null {
  const ctSet = new Set(mode.chordTones);
  const bebopPassing = getBebopPassingTone(mode);
  const quality = mode.chordQuality;

  const { slots, beatOffset, totalBeats } = skeleton;
  if (slots.length < 2) return null;

  const startNote = slots[0].note;
  const goalNote = slots[slots.length - 1].note;

  // Allocate beats per segment
  const beatsPerSeg = allocateBeats(template, totalBeats);
  const rhythmPlan = planSegmentRhythms(template, beatsPerSeg, beatOffset);

  // Distribute skeleton interior slots across segments
  const interiorSlots = slots.filter(s => s.role !== 'start' && s.role !== 'target');
  const segAnchors = distributeAnchors(interiorSlots, template, beatsPerSeg, beatOffset);

  const allNotes: { note: PoolNote; segIdx: number; isRest?: boolean; rhythm?: RhythmType }[] = [];
  let current = startNote;

  for (let si = 0; si < template.segments.length; si++) {
    const spec = template.segments[si];
    const segFn = SEGMENT_FNS[spec.type];
    if (!segFn) continue;

    const isLast = si === template.segments.length - 1;
    const plan = rhythmPlan[si];

    // Beat position for parity
    const segBeatPos = beatOffset + allNotes.reduce(
      (sum, n) => sum + RHYTHM_BEATS[n.rhythm ?? 'e'], 0);
    const segParity = isOnBeat(segBeatPos) ? 0 : 1;
    const segBeatPhase = Math.round(segBeatPos * 2) % 4;

    // Determine exit anchor for this segment
    const exitAnchor = isLast ? goalNote : segAnchors[si]?.exit ?? undefined;
    const interior = segAnchors[si]?.interior ?? [];

    const segNotes = segFn(
      pool, mode, current, spec.direction, plan.noteCount,
      { goalNote: isLast ? goalNote : undefined, quality,
        beatParity: segParity, beatPhase: segBeatPhase, rhythm: plan.rhythm,
        exitAnchor, interiorAnchors: interior },
    );

    if (!segNotes || segNotes.length === 0) {
      // Fallback: scale run toward exit
      const fbCount = Math.max(2, Math.floor(plan.beatBudget / 0.5));
      const fb = SEGMENT_FNS.scaleRun(pool, mode, current, spec.direction, fbCount,
        { exitAnchor, beatParity: segParity, beatPhase: segBeatPhase });
      if (fb && fb.length > 0) {
        for (const n of fb) allNotes.push({ note: n, segIdx: si, rhythm: 'e' });
        current = fb[fb.length - 1];
        continue;
      }
      return null;
    }

    // forceStartNote prepend (first segment only)
    if (si === 0 && forceStartNote && segNotes.length > 0) {
      const first = segNotes[0];
      const forcePitch = absolutePitch(forceStartNote);
      const firstPitch = absolutePitch(first);
      if (forcePitch !== firstPitch || first.stringIdx !== forceStartNote.stringIdx) {
        allNotes.push({ note: forceStartNote, segIdx: si, rhythm: plan.rhythm });
      }
    }

    // Junction smoothness
    if (allNotes.length > 0) {
      const prevNote = allNotes[allNotes.length - 1].note;
      const firstNote = segNotes[0];
      const junctionLeap = Math.abs(absolutePitch(firstNote) - absolutePitch(prevNote));
      const stringDist = Math.abs(firstNote.stringIdx - prevNote.stringIdx);
      if (junctionLeap > 9 || stringDist > 3) {
        const fbCount = Math.max(2, Math.floor(plan.beatBudget / 0.5));
        const fb = SEGMENT_FNS.scaleRun(pool, mode, allNotes[allNotes.length - 1].note,
          spec.direction, fbCount, { exitAnchor, beatParity: segParity });
        if (fb && fb.length > 0) {
          const fbLeap = Math.abs(absolutePitch(fb[0]) - absolutePitch(prevNote));
          if (fbLeap <= 9) {
            for (const n of fb) allNotes.push({ note: n, segIdx: si, rhythm: 'e' });
            current = fb[fb.length - 1];
            continue;
          }
        }
        return null;
      }
    }

    // Junction dedup
    let skipFirst = false;
    if (allNotes.length > 0 && segNotes.length > 1) {
      const prev = allNotes[allNotes.length - 1].note;
      const first = segNotes[0];
      if (absolutePitch(first) === absolutePitch(prev) && first.stringIdx === prev.stringIdx) {
        skipFirst = true;
      }
    }
    for (let ni = skipFirst ? 1 : 0; ni < segNotes.length; ni++) {
      allNotes.push({ note: segNotes[ni], segIdx: si, rhythm: plan.rhythm });
    }
    current = segNotes[segNotes.length - 1];
  }

  if (allNotes.length < 3) return null;

  // Build rhythms from pre-planned values
  const rawRhythms: RhythmType[] = allNotes.map(e => e.rhythm ?? 'e');

  // Post-compress enclosure/chromatic
  {
    const segGroups: { start: number; end: number; type: string }[] = [];
    let gi = 0;
    while (gi < allNotes.length) {
      const segIdx = allNotes[gi].segIdx;
      const start = gi;
      while (gi < allNotes.length && allNotes[gi].segIdx === segIdx) gi++;
      segGroups.push({ start, end: gi, type: template.segments[segIdx]?.type ?? '' });
    }
    for (const group of segGroups) {
      const count = group.end - group.start;
      // Note: enclosure segments are NOT compressed to 16th (see buildPhrase comment)
      if (group.type === 'chromatic' && count >= 2 && Math.random() < 0.45) {
        const limit = Math.min(count, 6);
        for (let j = group.start; j < group.start + limit; j++) rawRhythms[j] = 's';
      }
    }
  }

  // Last note CT → quarter
  if (allNotes.length > 0 && ctSet.has(allNotes[allNotes.length - 1].note.noteName) && Math.random() < 0.45) {
    rawRhythms[rawRhythms.length - 1] = 'q';
  }

  // First note on downbeat CT → quarter
  if (allNotes.length > 0 && !allNotes[0].isRest && ctSet.has(allNotes[0].note.noteName)
      && isOnBeat(beatOffset) && Math.random() < 0.15) {
    rawRhythms[0] = 'q';
  }

  // Segment boundary quarter
  if (template.segments.length > 1) {
    for (let i = 1; i < allNotes.length; i++) {
      if (allNotes[i].segIdx !== allNotes[i - 1].segIdx && i > 0) {
        const prevEntry = allNotes[i - 1];
        if (!prevEntry.isRest && ctSet.has(prevEntry.note.noteName) && Math.random() < 0.20) {
          rawRhythms[i - 1] = 'q';
        }
      }
    }
  }

  // Insert rests at segment junctions
  if (template.segments.length > 1) {
    for (let i = allNotes.length - 1; i > 0; i--) {
      if (allNotes[i].segIdx !== allNotes[i - 1].segIdx && Math.random() < 0.15) {
        let accBeat = beatOffset;
        for (let j = 0; j < i; j++) accBeat += RHYTHM_BEATS[rawRhythms[j]] ?? 0.5;
        const onDownbeat = Math.abs(accBeat - Math.round(accBeat)) < 0.1;
        const restDuration: RhythmType = onDownbeat
          ? (Math.random() < 0.7 ? 'e' : 'q')
          : (Math.random() < 0.7 ? 'q' : 'e');
        allNotes.splice(i, 0, {
          note: { ...allNotes[i - 1].note },
          segIdx: allNotes[i - 1].segIdx,
          isRest: true,
        });
        rawRhythms.splice(i, 0, restDuration);
      }
    }
  }

  // --- Rhythm anchor awareness: nudge skeleton anchor notes toward downbeats ---
  // If an interior/exit anchor from the skeleton lands on an offbeat, try to shift
  // it to the nearest downbeat by lengthening the preceding note's duration.
  {
    const anchorSemis = new Set<number>();
    for (const sa of segAnchors) {
      if (sa.exit) anchorSemis.add(absolutePitch(sa.exit));
      for (const ia of sa.interior) anchorSemis.add(absolutePitch(ia));
    }
    if (anchorSemis.size > 0) {
      let bp = beatOffset;
      for (let i = 0; i < allNotes.length; i++) {
        const entry = allNotes[i];
        const notePitch = entry.isRest ? -1 : absolutePitch(entry.note);
        if (!entry.isRest && anchorSemis.has(notePitch) && !isOnBeat(bp) && i > 0) {
          // This anchor is on an offbeat — try to lengthen the preceding note
          const prevRhythm = rawRhythms[i - 1];
          const prevBeats = RHYTHM_BEATS[prevRhythm];
          // Only do simple promotions: e→q (0.5→1.0) or s→e (0.25→0.5)
          let newPrevRhythm: RhythmType | null = null;
          if (prevRhythm === 'e') newPrevRhythm = 'q';
          else if (prevRhythm === 's') newPrevRhythm = 'e';
          if (newPrevRhythm) {
            const newPrevBeats = RHYTHM_BEATS[newPrevRhythm];
            const newBp = bp - prevBeats + newPrevBeats;
            // Only accept if the anchor now lands on a downbeat
            if (isOnBeat(newBp)) {
              rawRhythms[i - 1] = newPrevRhythm;
              // Recalculate bp with the new rhythm
              bp = newBp;
            }
          }
        }
        bp += RHYTHM_BEATS[rawRhythms[i]];
      }
    }
  }

  // Trim to beat budget
  const beatBudget = totalBeats;
  const trimmed: typeof allNotes = [];
  const trimmedRhythms: RhythmType[] = [];
  let usedBeats = 0;
  for (let i = 0; i < allNotes.length; i++) {
    const noteBeats = RHYTHM_BEATS[rawRhythms[i]];
    if (usedBeats + noteBeats > beatBudget + 0.01) break;
    trimmed.push(allNotes[i]);
    trimmedRhythms.push(rawRhythms[i]);
    usedBeats += noteBeats;
  }

  // Goal connector
  if (trimmed.length > 0 && trimmed[trimmed.length - 1].note.noteName !== goalNote.noteName
      && usedBeats + 0.5 <= beatBudget + 0.01) {
    trimmed.push({ note: goalNote, segIdx: trimmed[trimmed.length - 1].segIdx });
    trimmedRhythms.push('e');
  }

  if (trimmed.length < 3) return null;

  // --- Skeleton integrity check: verify required slots are present ---
  {
    const requiredSlots = slots.filter(s => s.required);
    let bp = beatOffset;
    const noteBeats: number[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      noteBeats.push(bp);
      bp += RHYTHM_BEATS[trimmedRhythms[i]];
    }
    for (const slot of requiredSlots) {
      const slotSemi = slot.note.semitone;
      const slotStr = slot.note.stringIdx;
      // Check that a note matching this slot exists near the expected beat position
      const found = trimmed.some((entry, idx) => {
        if (entry.isRest) return false;
        if (entry.note.semitone !== slotSemi) return false;
        if (entry.note.stringIdx !== slotStr) return false;
        // Allow ±1 beat tolerance for beat position matching
        return Math.abs(noteBeats[idx] - slot.beatPos) <= 1.0;
      });
      if (!found) return null;
    }
  }

  // --- Safety checks ---

  // §2: Bebop passing tone downbeat fix
  if (bebopPassing !== null) {
    let bp = beatOffset;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i].isRest) { bp += RHYTHM_BEATS[trimmedRhythms[i]]; continue; }
      if (isOnBeat(bp) && trimmed[i].note.semitone === bebopPassing && !ctSet.has(trimmed[i].note.noteName)) {
        const cur = trimmed[i].note;
        const curPitch = absolutePitch(cur);
        const scaleSemis = new Set(mode.semi);
        let bestSwap: PoolNote | null = null;
        let bestDist = Infinity;
        for (const n of pool) {
          if (n.isApproach) continue;
          if (n.semitone === bebopPassing) continue;
          if (!scaleSemis.has(n.semitone) && !ctSet.has(n.noteName)) continue;
          const pd = Math.abs(absolutePitch(n) - curPitch);
          const sd = Math.abs(n.stringIdx - cur.stringIdx);
          if (pd <= 2 && sd <= 1 && pd < bestDist) {
            bestDist = pd;
            bestSwap = n;
          }
        }
        if (bestSwap) trimmed[i] = { note: bestSwap, segIdx: trimmed[i].segIdx };
      }
      bp += RHYTHM_BEATS[trimmedRhythms[i]];
    }
  }

  // CT ending trial (only if not VL goal)
  const lastEntry = trimmed[trimmed.length - 1];
  const lastIsGoal = lastEntry.note.noteName === goalNote.noteName
    && lastEntry.note.stringIdx === goalNote.stringIdx && lastEntry.note.fret === goalNote.fret;
  if (!ctSet.has(lastEntry.note.noteName) && !(goalIsVL && lastIsGoal)) {
    const lastPitch = absolutePitch(lastEntry.note);
    const otherPitches = trimmed.slice(0, -1).map(e => absolutePitch(e.note));
    const otherMin = Math.min(...otherPitches);
    const otherMax = Math.max(...otherPitches);
    let bestCt: PoolNote | null = null;
    let bestDist = Infinity;
    for (const n of pool) {
      if (!ctSet.has(n.noteName)) continue;
      const pd = Math.abs(absolutePitch(n) - lastPitch);
      const sd = Math.abs(n.stringIdx - lastEntry.note.stringIdx);
      const np = absolutePitch(n);
      const newMin = Math.min(otherMin, np);
      const newMax = Math.max(otherMax, np);
      if (pd <= 3 && sd <= 1 && pd < bestDist && (newMax - newMin) <= 15 && (newMax - newMin) >= 4) {
        bestDist = pd;
        bestCt = n;
      }
    }
    if (bestCt) trimmed[trimmed.length - 1] = { note: bestCt, segIdx: lastEntry.segIdx };
  }

  // Tension ending: moved to skeleton/generator stage (generatePhraseRule)
  // fillSkeleton no longer swaps CT endings to tension — the goal note itself
  // is already set to a tension tone when applicable.

  // Range check
  const soundNotes = trimmed.filter(e => !e.isRest);
  const pitches = soundNotes.map(e => absolutePitch(e.note));
  const range = Math.max(...pitches) - Math.min(...pitches);
  if (range > 15 || range < 4) return null;

  // Leap check
  for (let i = 1; i < soundNotes.length; i++) {
    const leap = Math.abs(absolutePitch(soundNotes[i].note) - absolutePitch(soundNotes[i - 1].note));
    if (leap > 9) return null;
  }

  // Direction change on strong beats
  if (soundNotes.length >= 4) {
    let dirChanges = 0;
    let dirChangesOnStrong = 0;
    const soundBeatPos: number[] = [];
    {
      let bp = beatOffset;
      for (let ni = 0; ni < trimmed.length; ni++) {
        if (!trimmed[ni].isRest) soundBeatPos.push(bp);
        bp += RHYTHM_BEATS[trimmedRhythms[ni]];
      }
    }
    for (let i = 2; i < soundNotes.length; i++) {
      const prev = absolutePitch(soundNotes[i - 1].note) - absolutePitch(soundNotes[i - 2].note);
      const cur = absolutePitch(soundNotes[i].note) - absolutePitch(soundNotes[i - 1].note);
      if (prev !== 0 && cur !== 0 && ((prev > 0 && cur < 0) || (prev < 0 && cur > 0))) {
        dirChanges++;
        if (isOnStrongBeat(soundBeatPos[i])) dirChangesOnStrong++;
      }
    }
    if (dirChanges >= 2 && dirChangesOnStrong / dirChanges > 0.6) return null;
  }

  // --- Annotate approach groups ---
  const approachGroupMap = new Map<number, ApproachGroupInfo>();
  {
    let groupId = 0;
    let groupStart = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i].isRest) { groupStart = i + 1; continue; }
      const segType = template.segments[trimmed[i].segIdx]?.type;
      const isApproachSeg = segType === 'approachCT' || segType === 'enclosure';
      const nextSegDiff = i + 1 < trimmed.length && trimmed[i + 1].segIdx !== trimmed[i].segIdx;
      const isLast = i === trimmed.length - 1;
      const isCT = ctSet.has(trimmed[i].note.noteName);

      if (!isApproachSeg) { groupStart = i + 1; continue; }

      if (isCT && i > groupStart) {
        const gId = groupId++;
        const approachCount = i - groupStart;
        const groupSize = approachCount + 1;
        let approachType: ApproachType;
        if (segType === 'enclosure' && approachCount >= 2) {
          approachType = 'enclosure';
        } else if (approachCount >= 2) {
          approachType = 'double-chromatic';
        } else {
          const apPitch = absolutePitch(trimmed[groupStart].note);
          const tgPitch = absolutePitch(trimmed[i].note);
          const diff = tgPitch - apPitch;
          if (diff === 1) approachType = 'single-below';
          else if (diff === -1) approachType = 'single-above';
          else if (diff > 0) approachType = 'diatonic-below';
          else approachType = 'diatonic-above';
        }
        for (let j = groupStart; j < i; j++) {
          approachGroupMap.set(j, {
            groupId: gId, approachType, role: 'approach',
            positionInGroup: j - groupStart, groupSize,
          });
        }
        approachGroupMap.set(i, {
          groupId: gId, approachType, role: 'target',
          positionInGroup: approachCount, groupSize,
        });
        groupStart = i + 1;
      } else if (!isCT) {
        // accumulating
      } else {
        groupStart = i + 1;
      }
      if (nextSegDiff || isLast) groupStart = i + 1;
    }
  }

  // --- Convert to PhraseNote[] ---
  let accBeat = beatOffset;
  const phraseNotes: PhraseNote[] = trimmed.map((entry, idx) => {
    const { note, segIdx } = entry;
    const duration = trimmedRhythms[idx];
    const beatPos = Math.min(Math.floor(accBeat * 2) + 1, 8);
    const strong = isOnStrongBeat(accBeat);
    const isCT = ctSet.has(note.noteName);
    const isBebopPass = bebopPassing !== null && note.semitone === bebopPassing && !isCT;
    const ag = approachGroupMap.get(idx);
    const segType = template.segments[segIdx]?.type;
    const isDim7 = !isCT && segType === 'dim7From3rd';

    // Mark skeleton beat notes
    const isSkeletonNote = slots.some(s =>
      s.role !== 'target' &&
      Math.abs(s.beatPos - accBeat) < 0.05 &&
      s.note.noteName === note.noteName
    );

    const pn: PhraseNote = {
      noteName: note.noteName,
      stringIdx: note.stringIdx,
      fret: note.fret,
      semitone: note.semitone,
      isChordTone: isCT,
      isApproach: note.isApproach || (ag?.role === 'approach'),
      beatPosition: beatPos,
      isStrong: strong,
      duration,
      beatStart: accBeat,
      segmentIdx: segIdx,
      isDim7Tone: isDim7 || undefined,
      isBebopPassing: isBebopPass || undefined,
      isRest: entry.isRest || undefined,
      approachGroup: ag,
      isSkeletonBeat: isSkeletonNote || undefined,
    };
    accBeat += RHYTHM_BEATS[duration];
    return pn;
  });

  return phraseNotes;
}

// ---------------------------------------------------------------------------
// distributeAnchors — assign skeleton slots to template segments
// ---------------------------------------------------------------------------

interface SegAnchorInfo {
  exit?: PoolNote;
  interior: PoolNote[];
}

function distributeAnchors(
  interiorSlots: SkeletonSlot[],
  template: PhraseTemplate,
  beatsPerSeg: number[],
  beatOffset: number,
): SegAnchorInfo[] {
  const result: SegAnchorInfo[] = template.segments.map(() => ({ interior: [] }));
  if (interiorSlots.length === 0) return result;

  // Calculate beat range for each segment
  let segStart = beatOffset;
  const segRanges: { start: number; end: number }[] = [];
  for (let si = 0; si < template.segments.length; si++) {
    const end = segStart + beatsPerSeg[si];
    segRanges.push({ start: segStart, end });
    segStart = end;
  }

  // Assign each interior slot to the segment whose range contains it
  for (const slot of interiorSlots) {
    for (let si = 0; si < segRanges.length; si++) {
      const { start, end } = segRanges[si];
      if (slot.beatPos >= start - 0.01 && slot.beatPos < end + 0.01) {
        // If this slot is near the end of the segment, make it exit anchor
        if (slot.beatPos >= end - 0.5) {
          result[si].exit = slot.note;
        } else {
          result[si].interior.push(slot.note);
        }
        break;
      }
    }
  }

  // If a non-last segment has no exit anchor, use the last interior anchor
  for (let si = 0; si < result.length - 1; si++) {
    if (!result[si].exit && result[si].interior.length > 0) {
      result[si].exit = result[si].interior.pop();
    }
  }

  return result;
}
