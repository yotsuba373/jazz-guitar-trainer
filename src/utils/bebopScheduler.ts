import type { Mode, PhraseNote, RhythmType, PoolNote, ApproachGroupInfo, ApproachType } from '../types';
import { SEGMENT_FNS } from './bebopSegments';
import { getBebopPassingTone } from '../constants/bebopScales';
import type { PhraseTemplate, SegmentSpec } from './bebopTemplates';
import { allocateEighths } from './bebopTemplates';

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
// assignRhythms — post-process: assign rhythm per segment type
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

/**
 * Assign rhythms to notes based on segment type.
 * Pattern-based per segment for musical coherence (not random per note).
 */
export function assignRhythms(
  notes: { note: PoolNote; segIdx: number }[],
  segments: SegmentSpec[],
  beatOffset: number,
  ctSet: Set<string>,
): RhythmType[] {
  const rhythms: RhythmType[] = new Array(notes.length).fill('e');

  // Group notes by segIdx
  const segGroups: { start: number; end: number; type: string }[] = [];
  let i = 0;
  while (i < notes.length) {
    const segIdx = notes[i].segIdx;
    const start = i;
    while (i < notes.length && notes[i].segIdx === segIdx) i++;
    segGroups.push({ start, end: i, type: segments[segIdx]?.type ?? '' });
  }

  // Compute beat position for each note (assuming all 'e' initially, will refine)
  // We need segment start beats for condition checks
  const segStartBeats: number[] = [];
  {
    let beat = beatOffset;
    let gi = 0;
    for (let ni = 0; ni < notes.length; ni++) {
      if (gi < segGroups.length && ni === segGroups[gi].start) {
        segStartBeats.push(beat);
        gi++;
      }
      beat += 0.5; // eighth note default
    }
  }

  for (let g = 0; g < segGroups.length; g++) {
    const { start, end, type } = segGroups[g];
    const count = end - start;
    const segBeat = segStartBeats[g];

    if (type === 'arpeggio') {
      // §10: triplet for CT arpeggio — 25% chance
      // Allow first segment even on off-beat (pickup triplets are idiomatic in bebop)
      const isFirstSeg = (start === 0);
      if (count >= 3 && (isOnBeat(segBeat) || isFirstSeg) && Math.random() < 0.25) {
        // Apply triplet to first 3 notes only
        for (let j = 0; j < 3 && start + j < end; j++) {
          rhythms[start + j] = 't';
        }
      }
    } else if (type === 'enclosure') {
      // §10: 16th notes for approach notes — 35% chance, ≥3 notes
      // segEnclosure already controls parity for CT target placement
      if (count >= 3 && Math.random() < 0.35) {
        const numApproach = count - 1; // last note is target
        for (let j = 0; j < numApproach; j++) {
          rhythms[start + j] = 's';
        }
        // Target note stays 'e'
      }
    } else if (type === 'chromatic') {
      // §10: 16th notes for chromatic runs — 40% chance, ≥2 notes, max 6
      if (count >= 2 && Math.random() < 0.40) {
        const limit = Math.min(count, 6);
        for (let j = 0; j < limit; j++) {
          rhythms[start + j] = 's';
        }
      }
    }
    // scaleRun, 1235, approachCT, etc. → stay 'e' (§2 core principle)
  }

  // Last note → quarter (12% chance, CT only) for landing feel
  if (notes.length > 0 && ctSet.has(notes[notes.length - 1].note.noteName) && Math.random() < 0.18) {
    rhythms[notes.length - 1] = 'q';
  }

  return rhythms;
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
): PhraseNote[] | null {
  const eighthsPerSeg = allocateEighths(template, totalEighths);
  const ctSet = new Set(mode.chordTones);
  const bebopPassing = getBebopPassingTone(mode);
  const quality = mode.chordQuality;

  const allNotes: { note: PoolNote; segIdx: number; isRest?: boolean }[] = [];
  let current = startNote;

  // Execute each segment
  for (let si = 0; si < template.segments.length; si++) {
    const spec = template.segments[si];
    const segFn = SEGMENT_FNS[spec.type];
    if (!segFn) continue;

    const isLast = si === template.segments.length - 1;
    const segEighths = eighthsPerSeg[si];

    // Compute actual beat position for this segment start
    const segBeatPos = beatOffset + allNotes.length * 0.5; // approximate: segments before rhythm assignment
    const segParity = isOnBeat(segBeatPos) ? 0 : 1;
    const segNotes = segFn(
      pool, mode, current, spec.direction, segEighths,
      { goalNote: isLast ? goalNote : undefined, quality,
        beatParity: segParity },
    );

    if (!segNotes || segNotes.length === 0) {
      // Segment failed — try a simple scale run as fallback
      const fallback = SEGMENT_FNS.scaleRun(pool, mode, current, spec.direction, segEighths);
      if (fallback && fallback.length > 0) {
        for (const n of fallback) allNotes.push({ note: n, segIdx: si });
        current = fallback[fallback.length - 1];
        continue;
      }
      return null; // can't recover
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
        const fallback = SEGMENT_FNS.scaleRun(pool, mode, allNotes[allNotes.length - 1].note, spec.direction, segEighths);
        if (fallback && fallback.length > 0) {
          const fb0 = fallback[0];
          const fbLeap = Math.abs(absolutePitch(fb0) - absolutePitch(prevNote));
          if (fbLeap <= 9) {
            for (const n of fallback) allNotes.push({ note: n, segIdx: si });
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
      allNotes.push({ note: segNotes[ni], segIdx: si });
    }
    current = segNotes[segNotes.length - 1];
  }

  if (allNotes.length < 3) return null;

  // Assign rhythms based on segment types
  const rawRhythms = assignRhythms(allNotes, template.segments, beatOffset, ctSet);

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
  const lastEntry = trimmed[trimmed.length - 1];
  if (!ctSet.has(lastEntry.note.noteName)) {
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
  {
    const lastE = trimmed[trimmed.length - 1];
    if (ctSet.has(lastE.note.noteName) && Math.random() < 0.26) {
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

  // §9: Direction changes should occur on off-beats (Barry Harris)
  // Use soundNotes (rests excluded) with their beat positions
  if (soundNotes.length >= 4) {
    let dirChanges = 0;
    let dirChangesOnDownbeat = 0;
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
        if (isOnBeat(soundBeatPos[i])) dirChangesOnDownbeat++;
      }
    }
    // Reject if >60% of direction changes land on downbeats (any beat head)
    if (dirChanges >= 2 && dirChangesOnDownbeat / dirChanges > 0.6) return null;
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
