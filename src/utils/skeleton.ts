import type { Mode, PoolNote, PhraseContour } from '../types';
import { absolutePitch } from './bebopScheduler';
import { pickWeighted } from './bebopTemplates';
import { getBebopPassingTone } from '../constants/bebopScales';

// ---------------------------------------------------------------------------
// Skeleton types
// ---------------------------------------------------------------------------

export type SkeletonRole = 'start' | 'downbeat-ct' | 'strong-gt' | 'target';

export interface SkeletonSlot {
  beatPos: number;          // absolute beat position (0, 0.5, 1, 1.5, ...)
  note: PoolNote;           // concrete fretboard note
  role: SkeletonRole;
  required: boolean;        // true = must use this note; false = guide (segment may adjust)
}

export interface PhraseSkeleton {
  slots: SkeletonSlot[];    // sorted by beatPos ascending
  contour: PhraseContour;
  totalBeats: number;
  beatOffset: number;       // 0 or 0.5
}

// ---------------------------------------------------------------------------
// Contour selection — derive from start/goal pitch relationship
// ---------------------------------------------------------------------------

export function chooseContour(
  startPitch: number,
  goalPitch: number,
  prevContour?: PhraseContour,
): PhraseContour {
  const diff = goalPitch - startPitch;

  let candidates: [PhraseContour, number][];
  if (diff > 2) {
    // ascending pitch diff
    candidates = [['ascending', 35], ['reverse-arch', 30], ['wave', 20], ['arch', 15]];
  } else if (diff < -2) {
    // descending pitch diff — maintain bebop's natural descending bias (§2)
    candidates = [['descending', 40], ['arch', 35], ['wave', 15], ['reverse-arch', 10]];
  } else {
    // roughly same pitch — moderate descending preference (§2 bebop convention)
    candidates = [['descending', 30], ['arch', 28], ['wave', 20], ['reverse-arch', 14], ['ascending', 8]];
  }

  // Penalize consecutive same contour (-50% weight)
  if (prevContour) {
    candidates = candidates.map(([c, w]) =>
      c === prevContour ? [c, Math.max(1, Math.floor(w * 0.5))] : [c, w]
    );
  }

  return pickWeighted(
    candidates.map(c => c[0]),
    candidates.map(c => c[1]),
  );
}

// ---------------------------------------------------------------------------
// Contour curve — returns target pitch at a given fractional position [0, 1]
// ---------------------------------------------------------------------------

export function contourCurve(
  contour: PhraseContour,
  t: number,  // 0 = start, 1 = end
  startPitch: number,
  goalPitch: number,
): number {
  // Peak/valley offset from the extremes
  const range = Math.abs(goalPitch - startPitch);
  const peakExtra = Math.max(4, range * 0.5);  // at least 4 semitones of curvature

  switch (contour) {
    case 'ascending':
      return startPitch + (goalPitch - startPitch) * t;

    case 'descending':
      return startPitch + (goalPitch - startPitch) * t;

    case 'arch': {
      // Rise to peak at midpoint, then descend to goal
      const peak = Math.max(startPitch, goalPitch) + peakExtra;
      if (t <= 0.5) {
        // start → peak
        return startPitch + (peak - startPitch) * (t / 0.5);
      }
      // peak → goal
      return peak + (goalPitch - peak) * ((t - 0.5) / 0.5);
    }

    case 'reverse-arch': {
      // Dip to valley at midpoint, then rise to goal
      const valley = Math.min(startPitch, goalPitch) - peakExtra;
      if (t <= 0.5) {
        return startPitch + (valley - startPitch) * (t / 0.5);
      }
      return valley + (goalPitch - valley) * ((t - 0.5) / 0.5);
    }

    case 'wave': {
      // Dip at 1/3, peak at 2/3
      const dip = Math.min(startPitch, goalPitch) - peakExtra * 0.5;
      const peak = Math.max(startPitch, goalPitch) + peakExtra * 0.5;
      if (t <= 1 / 3) {
        return startPitch + (dip - startPitch) * (t / (1 / 3));
      }
      if (t <= 2 / 3) {
        return dip + (peak - dip) * ((t - 1 / 3) / (1 / 3));
      }
      return peak + (goalPitch - peak) * ((t - 2 / 3) / (1 / 3));
    }

    default:
      return startPitch + (goalPitch - startPitch) * t;
  }
}

// ---------------------------------------------------------------------------
// buildSkeleton — core function
// ---------------------------------------------------------------------------

export function buildSkeleton(
  _pool: PoolNote[],
  ctPool: PoolNote[],
  mode: Mode,
  startNote: PoolNote,
  goalNote: PoolNote,
  totalBeats: number,
  beatOffset: number,
  prevContour?: PhraseContour,
): PhraseSkeleton | null {
  if (ctPool.length === 0) return null;

  const startPitch = absolutePitch(startNote);
  const goalPitch = absolutePitch(goalNote);

  // 1. Contour
  const contour = chooseContour(startPitch, goalPitch, prevContour);

  // 2. Beat grid
  const lastBeat = beatOffset + totalBeats;
  const downbeats: number[] = [];  // integer beats within range
  const strongBeats: number[] = []; // beats 1, 3, 5, 7... (odd integers in 0-based → even in 1-based)
  for (let b = Math.ceil(beatOffset); b < lastBeat; b++) {
    if (b > beatOffset) { // exclude the start beat itself if it's a downbeat
      downbeats.push(b);
    }
  }
  // Strong beats are at integer positions where (beat % 2 === 0) counting from 0
  // i.e. beats 0, 2, 4... are strong (= beats 1, 3, 5... in 1-based)
  for (const b of downbeats) {
    if (b % 2 === 0) strongBeats.push(b);
  }

  // 3. Hard anchors: start and goal (target)
  const slots: SkeletonSlot[] = [];

  // Start
  slots.push({
    beatPos: beatOffset,
    note: startNote,
    role: 'start',
    required: true,
  });

  // Goal / target — placed at or near lastBeat
  // The goal is placed at the last available beat position
  const goalBeat = lastBeat;
  slots.push({
    beatPos: goalBeat,
    note: goalNote,
    role: 'target',
    required: true,
  });

  // 4. GT set (3rd and 7th)
  const gtNames = new Set<string>();
  if (mode.chordTones.length >= 2) gtNames.add(mode.chordTones[1]); // 3rd
  if (mode.chordTones.length >= 4) gtNames.add(mode.chordTones[3]); // 7th

  // Bebop passing tone to avoid
  const bebopPassing = getBebopPassingTone(mode);

  // 5. Place CT anchors on downbeats
  const beatRange = lastBeat - beatOffset;
  let prevAnchor = startNote;

  for (const b of downbeats) {
    // Skip if this is the goal beat (already placed)
    if (Math.abs(b - goalBeat) < 0.01) continue;

    // Fractional position for contour curve
    const t = (b - beatOffset) / beatRange;
    const targetPitch = contourCurve(contour, t, startPitch, goalPitch);

    // Find best CT near target pitch, reachable from previous anchor
    const anchor = findAnchorCT(ctPool, targetPitch, prevAnchor, bebopPassing);
    if (!anchor) continue;

    const isStrong = strongBeats.includes(b);

    // 5b. Strong beat GT bias: prefer GT (3rd/7th) on strong beats
    if (isStrong && !gtNames.has(anchor.noteName)) {
      const gtCandidate = findGTNear(ctPool, gtNames, targetPitch, prevAnchor, bebopPassing);
      if (gtCandidate) {
        slots.push({
          beatPos: b,
          note: gtCandidate,
          role: 'strong-gt',
          required: false,
        });
        prevAnchor = gtCandidate;
        continue;
      }
    }

    slots.push({
      beatPos: b,
      note: anchor,
      role: isStrong ? 'strong-gt' : 'downbeat-ct',
      required: false,
    });
    prevAnchor = anchor;
  }

  // 6. Sort slots by beatPos
  slots.sort((a, b) => a.beatPos - b.beatPos);

  // 7. Validate playability between consecutive slots
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1];
    const curr = slots[i];
    const pitchDist = Math.abs(absolutePitch(curr.note) - absolutePitch(prev.note));
    const stringDist = Math.abs(curr.note.stringIdx - prev.note.stringIdx);

    if (pitchDist > 12 || stringDist > 3) {
      if (!curr.required) {
        // Try to find a better CT closer to previous
        const better = findReachableCT(ctPool, prev.note, curr.beatPos, beatOffset, beatRange,
          contour, startPitch, goalPitch, bebopPassing);
        if (better) {
          slots[i] = { ...curr, note: better };
        } else {
          // Remove this optional slot
          slots.splice(i, 1);
          i--;
        }
      } else if (i > 0 && !prev.required) {
        // Current is required but unreachable — remove the optional predecessor
        slots.splice(i - 1, 1);
        i = Math.max(0, i - 2); // re-check from earlier
      }
      // If both are required (start/target), segments will handle the gap
    }
  }

  // 8. Verify we have at least start + target
  if (slots.length < 2) return null;

  return {
    slots,
    contour,
    totalBeats,
    beatOffset,
  };
}

// ---------------------------------------------------------------------------
// Helper: find CT near target pitch, reachable from previous anchor
// ---------------------------------------------------------------------------

function findAnchorCT(
  ctPool: PoolNote[],
  targetPitch: number,
  prevAnchor: PoolNote,
  bebopPassing: number | null,
): PoolNote | null {
  const prevPitch = absolutePitch(prevAnchor);
  let best: PoolNote | null = null;
  let bestScore = -Infinity;

  for (const n of ctPool) {
    // Skip bebop passing tone
    if (bebopPassing !== null && n.semitone === bebopPassing && !n.isChordTone) continue;

    const pitch = absolutePitch(n);
    const pitchDist = Math.abs(pitch - targetPitch);
    const reachDist = Math.abs(pitch - prevPitch);
    const stringDist = Math.abs(n.stringIdx - prevAnchor.stringIdx);

    // Scoring: closeness to target pitch + reachability from previous
    let score = 0;
    score -= pitchDist * 2;       // prefer close to contour target
    score -= reachDist * 1;       // prefer reachable from previous
    score -= stringDist * 3;      // prefer close strings

    // Penalty for unreachable notes
    if (reachDist > 12) score -= 50;
    if (stringDist > 3) score -= 50;

    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Helper: find GT (3rd/7th) near target pitch
// ---------------------------------------------------------------------------

function findGTNear(
  ctPool: PoolNote[],
  gtNames: Set<string>,
  targetPitch: number,
  prevAnchor: PoolNote,
  bebopPassing: number | null,
): PoolNote | null {
  const gtCandidates = ctPool.filter(n => {
    if (!gtNames.has(n.noteName)) return false;
    if (bebopPassing !== null && n.semitone === bebopPassing) return false;
    return true;
  });

  if (gtCandidates.length === 0) return null;

  const prevPitch = absolutePitch(prevAnchor);
  let best: PoolNote | null = null;
  let bestScore = -Infinity;

  for (const n of gtCandidates) {
    const pitch = absolutePitch(n);
    const pitchDist = Math.abs(pitch - targetPitch);
    const reachDist = Math.abs(pitch - prevPitch);
    const stringDist = Math.abs(n.stringIdx - prevAnchor.stringIdx);

    let score = 0;
    score -= pitchDist * 2;
    score -= reachDist * 1;
    score -= stringDist * 3;
    if (reachDist > 12) score -= 50;
    if (stringDist > 3) score -= 50;

    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Helper: find reachable CT when playability check fails
// ---------------------------------------------------------------------------

function findReachableCT(
  ctPool: PoolNote[],
  prevNote: PoolNote,
  beatPos: number,
  beatOffset: number,
  beatRange: number,
  contour: PhraseContour,
  startPitch: number,
  goalPitch: number,
  bebopPassing: number | null,
): PoolNote | null {
  const t = (beatPos - beatOffset) / beatRange;
  const targetPitch = contourCurve(contour, t, startPitch, goalPitch);
  const prevPitch = absolutePitch(prevNote);

  // Filter to reachable notes
  const reachable = ctPool.filter(n => {
    if (bebopPassing !== null && n.semitone === bebopPassing && !n.isChordTone) return false;
    const pitch = absolutePitch(n);
    const pd = Math.abs(pitch - prevPitch);
    const sd = Math.abs(n.stringIdx - prevNote.stringIdx);
    return pd <= 12 && sd <= 3;
  });

  if (reachable.length === 0) return null;

  // Pick closest to target pitch
  return reachable.reduce((best, n) => {
    const nd = Math.abs(absolutePitch(n) - targetPitch);
    const bd = Math.abs(absolutePitch(best) - targetPitch);
    return nd < bd ? n : best;
  });
}
