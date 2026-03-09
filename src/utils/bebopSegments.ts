import type { Mode, PoolNote } from '../types';
import { getBebopScale, getBebopPassingTone } from '../constants/bebopScales';
import { absolutePitch } from './bebopScheduler';
import { pickWeighted } from './bebopTemplates';

// ---------------------------------------------------------------------------
// Segment generation functions for rule-based bebop phrase construction.
// Each function takes a pool of available notes and returns a sequence of
// PoolNotes, or null on failure.
// ---------------------------------------------------------------------------

export interface SegmentOpts {
  /** Target CT at segment end (for goal-directed segments) */
  goalNote?: PoolNote;
  /** Chord quality for quality-specific logic */
  quality?: string;
  /** Beat parity: 0 = first note on downbeat, 1 = first note on upbeat */
  beatParity?: number;
  /** Beat phase (0-3): 0=strong-on, 1=strong-off, 2=nonstrong-on, 3=nonstrong-off */
  beatPhase?: number;
  /** Pre-planned rhythm for this segment (from planSegmentRhythms) */
  rhythm?: 'q' | 't' | 'e' | 's';
  /** Skeleton-driven: the anchor this segment aims toward */
  exitAnchor?: PoolNote;
  /** Skeleton-driven: intermediate anchors to pass through */
  interiorAnchors?: PoolNote[];
}

export type SegmentFn = (
  pool: PoolNote[],
  mode: Mode,
  startNote: PoolNote,
  direction: 'asc' | 'desc',
  eighths: number,
  opts?: SegmentOpts,
) => PoolNote[] | null;

// ---------------------------------------------------------------------------
// Candidate selection — shared scoring logic with Musical Forces (§9)
// ---------------------------------------------------------------------------

/** Optional context for Musical Forces scoring */
interface ForceContext {
  prevNote?: PoolNote;       // note before ref (for inertia)
  poolMedianPitch?: number;  // median pitch of pool (for gravity)
  ctSemis?: Set<number>;     // chord tone semitones (for magnetism)
}

function bestCandidate(
  candidates: PoolNote[],
  ref: PoolNote,
  preferDir: 'asc' | 'desc' | null,
  forces?: ForceContext,
): PoolNote | null {
  if (candidates.length === 0) return null;
  let best: PoolNote | null = null;
  let bestScore = -Infinity;
  const refPitch = absolutePitch(ref);
  for (const c of candidates) {
    let score = 0;
    const cPitch = absolutePitch(c);
    const pitchDist = Math.abs(cPitch - refPitch);
    score += 50 - pitchDist * 3;
    const strDist = Math.abs(c.stringIdx - ref.stringIdx);
    if (strDist === 0) score += 50;
    else if (strDist === 1) score += 35;
    else if (strDist === 2) score += 20;
    else score -= 20;
    if (preferDir) {
      const dir = cPitch - refPitch;
      if ((preferDir === 'asc' && dir > 0) || (preferDir === 'desc' && dir < 0)) score += 15;
      if ((preferDir === 'asc' && dir < 0) || (preferDir === 'desc' && dir > 0)) score -= 10;
    }
    // §9 Musical Forces (subtle biases ±3~5)
    if (forces) {
      // Gravity: higher notes tend to descend
      if (forces.poolMedianPitch !== undefined) {
        if (refPitch > forces.poolMedianPitch && cPitch < refPitch) score += 5;
        else if (refPitch > forces.poolMedianPitch && cPitch > refPitch) score -= 3;
      }
      // Magnetism: non-CT notes pull toward nearest CT
      if (forces.ctSemis && !forces.ctSemis.has(ref.semitone)) {
        const isCT = forces.ctSemis.has(c.semitone);
        if (isCT) score += 5;
      }
      // Inertia: continue in same direction as previous movement
      if (forces.prevNote) {
        const prevDir = refPitch - absolutePitch(forces.prevNote);
        const curDir = cPitch - refPitch;
        if ((prevDir > 0 && curDir > 0) || (prevDir < 0 && curDir < 0)) score += 3;
      }
    }
    // ±4 jitter for stepwise/approach selection only (not target CT selection)
    if (preferDir || forces) score += (Math.random() - 0.5) * 8;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** Find the next scale tone in the given direction from ref */
function nextScaleTone(
  pool: PoolNote[],
  ref: PoolNote,
  direction: 'asc' | 'desc',
  scaleSemis: Set<number>,
  excludeApproach = true,
): PoolNote | null {
  const refPitch = absolutePitch(ref);
  const candidates = pool.filter(n => {
    if (excludeApproach && n.isApproach) return false;
    if (!scaleSemis.has(n.semitone)) return false;
    const p = absolutePitch(n);
    if (direction === 'asc') return p > refPitch;
    return p < refPitch;
  });
  if (candidates.length === 0) return null;
  // Closest in the given direction
  candidates.sort((a, b) => {
    const da = Math.abs(absolutePitch(a) - refPitch);
    const db = Math.abs(absolutePitch(b) - refPitch);
    if (da !== db) return da - db;
    // Prefer same/adjacent string
    return Math.abs(a.stringIdx - ref.stringIdx) - Math.abs(b.stringIdx - ref.stringIdx);
  });
  return candidates[0];
}

/** Find the nearest pool note matching a target semitone near ref */
function findNearest(
  pool: PoolNote[],
  targetSemi: number,
  ref: PoolNote,
  direction: 'asc' | 'desc' | null = null,
): PoolNote | null {
  const candidates = pool.filter(n => n.semitone === targetSemi);
  return bestCandidate(candidates, ref, direction);
}

// ---------------------------------------------------------------------------
// segArpeggio — CT arpeggio (R-3-5-7 or subset)
// ---------------------------------------------------------------------------

export const segArpeggio: SegmentFn = (pool, mode, startNote, direction, eighths, opts) => {
  const ctNames = new Set(mode.chordTones);
  const ctPool = pool.filter(n => ctNames.has(n.noteName));
  if (ctPool.length < 2) return null;

  // Build semitone set for CT filtering in nextScaleTone
  const ctSemiSet = new Set(ctPool.map(n => n.semitone));
  const exitTarget = opts?.exitAnchor;
  const interiorAnchors = opts?.interiorAnchors ?? [];

  const result: PoolNote[] = [];
  let current = startNote;

  // If startNote is not a CT, find the nearest CT in direction
  if (!ctNames.has(current.noteName)) {
    const nearest = ctPool.reduce((best, n) => {
      const d = Math.abs(absolutePitch(n) - absolutePitch(current));
      return d < Math.abs(absolutePitch(best) - absolutePitch(current)) ? n : best;
    });
    current = nearest;
  }

  result.push(current);

  // If interior anchors are provided, pass through them
  if (interiorAnchors.length > 0) {
    for (const anchor of interiorAnchors) {
      if (result.length >= eighths) break;
      if (ctNames.has(anchor.noteName)) {
        const leap = Math.abs(absolutePitch(anchor) - absolutePitch(current));
        if (leap <= 9) {
          result.push(anchor);
          current = anchor;
        }
      }
    }
  }

  for (let i = result.length; i < eighths; i++) {
    // Aim toward exitAnchor if close to end
    if (exitTarget && i >= eighths - 1) {
      const dist = Math.abs(absolutePitch(current) - absolutePitch(exitTarget));
      if (dist <= 9 && ctNames.has(exitTarget.noteName)) {
        if (absolutePitch(exitTarget) !== absolutePitch(current) || exitTarget.stringIdx !== current.stringIdx) {
          result.push(exitTarget);
        }
        break;
      }
    }

    const next = nextScaleTone(ctPool, current, direction, ctSemiSet);
    if (!next) break;
    // Guard against large leaps
    if (Math.abs(absolutePitch(next) - absolutePitch(current)) > 9) break;
    result.push(next);
    current = next;
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segScaleRun — bebop scale run (8-note scale, passing tone on off-beats)
// ---------------------------------------------------------------------------

export const segScaleRun: SegmentFn = (pool, mode, startNote, direction, eighths, opts) => {
  const bebopSemis = getBebopScale(mode);
  const scaleSemis = new Set(bebopSemis ?? mode.semi);
  const allSemis = new Set([...scaleSemis]);
  const bebopPassing = getBebopPassingTone(mode);
  const parity = opts?.beatParity ?? 0;
  const exitTarget = opts?.exitAnchor;

  // §1: GT (3rd/7th) preferred on strong beats
  const gtSemis = new Set<number>();
  if (mode.chordTones.length >= 2) {
    const idx3 = mode.notes.indexOf(mode.chordTones[1]);
    if (idx3 >= 0) gtSemis.add(mode.semi[idx3]);
  }
  if (mode.chordTones.length >= 4) {
    const idx7 = mode.notes.indexOf(mode.chordTones[3]);
    if (idx7 >= 0) gtSemis.add(mode.semi[idx7]);
  }

  // Build waypoint queue: interiorAnchors followed by exitAnchor
  const waypoints: PoolNote[] = [
    ...(opts?.interiorAnchors ?? []),
    ...(exitTarget ? [exitTarget] : []),
  ];
  let wpIdx = 0;

  // Determine effective direction toward current waypoint (or use original direction)
  const directionToward = (from: PoolNote, target: PoolNote): 'asc' | 'desc' => {
    const fp = absolutePitch(from);
    const tp = absolutePitch(target);
    return tp >= fp ? 'asc' : 'desc';
  };

  let effDirection = direction;
  if (waypoints.length > 0) {
    effDirection = directionToward(startNote, waypoints[0]);
  } else if (exitTarget) {
    const startPitch = absolutePitch(startNote);
    const exitPitch = absolutePitch(exitTarget);
    if (exitPitch > startPitch) effDirection = 'asc';
    else if (exitPitch < startPitch) effDirection = 'desc';
  }

  const result: PoolNote[] = [startNote];
  let current = startNote;

  for (let i = 1; i < eighths; i++) {
    const currentWp = wpIdx < waypoints.length ? waypoints[wpIdx] : null;
    const isLastWp = wpIdx === waypoints.length - 1;

    // Waypoint proximity check: snap when close enough
    if (currentWp) {
      const wpDist = Math.abs(absolutePitch(current) - absolutePitch(currentWp));
      const wpStrDist = Math.abs(current.stringIdx - currentWp.stringIdx);
      // For last waypoint (exitAnchor): only snap near the end
      // For interior waypoints: snap when within reach
      const shouldSnap = isLastWp ? (i >= eighths - 1 && wpDist <= 4 && wpStrDist <= 1)
                                   : (wpDist <= 3 && wpStrDist <= 1);
      if (shouldSnap) {
        if (absolutePitch(currentWp) !== absolutePitch(current) || currentWp.stringIdx !== current.stringIdx) {
          result.push(currentWp);
          current = currentWp;
        }
        wpIdx++;
        // Update direction toward next waypoint
        if (wpIdx < waypoints.length) {
          effDirection = directionToward(current, waypoints[wpIdx]);
        }
        if (isLastWp) break;
        continue;
      }
    }

    let next = nextScaleTone(pool, current, effDirection, allSemis, false);
    if (!next) break;
    if (Math.abs(absolutePitch(next) - absolutePitch(current)) > 4) break; // max a major 3rd step
    // §2: Bebop passing tone must fall on off-beats
    // On-beat (downbeat) when (i + parity) is even (0-based index)
    const isOnBeat = (i + parity) % 2 === 0;
    if (bebopPassing !== null && next.semitone === bebopPassing && isOnBeat) {
      // Passing tone would land on a downbeat — skip it and try the next scale tone
      const skip = nextScaleTone(pool, next, effDirection, allSemis, false);
      if (skip && Math.abs(absolutePitch(skip) - absolutePitch(current)) <= 4) {
        result.push(skip);
        current = skip;
        continue;
      }
      // Can't skip — just break to avoid violating the rule
      break;
    }
    // §1 supplement: on downbeats, prefer GT over other scale tones
    if (isOnBeat && !gtSemis.has(next.semitone) && gtSemis.size > 0) {
      // Check if there's a GT at the same stepwise distance
      const nextPitch = absolutePitch(next);
      const gtCandidates = pool.filter(n =>
        gtSemis.has(n.semitone) && !n.isApproach &&
        Math.abs(absolutePitch(n) - absolutePitch(current)) <= 4 &&
        Math.abs(absolutePitch(n) - nextPitch) <= 2 &&
        Math.abs(n.stringIdx - current.stringIdx) <= 1 &&
        (effDirection === 'asc' ? absolutePitch(n) > absolutePitch(current) : absolutePitch(n) < absolutePitch(current))
      );
      if (gtCandidates.length > 0) {
        // Pick closest GT to current note
        gtCandidates.sort((a, b) =>
          Math.abs(absolutePitch(a) - absolutePitch(current)) - Math.abs(absolutePitch(b) - absolutePitch(current))
        );
        next = gtCandidates[0];
      }
    }
    result.push(next);
    current = next;
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segEnclosure — 4 types: Mixed(40), Diatonic(25), Chromatic(20), 3-note(15)
// ---------------------------------------------------------------------------

/** Enclosure type definitions (§4) */
type EnclosureType = 'mixed' | 'diatonic' | 'chromatic' | '3-note';
const ENCLOSURE_TYPES: { type: EnclosureType; weight: number }[] = [
  { type: 'mixed',     weight: 55 },  // scale above + chrom below → CT (most common)
  { type: 'diatonic',  weight: 20 },  // scale above + scale below → CT
  { type: 'chromatic', weight: 15 },  // chrom above + chrom below → CT
  { type: '3-note',    weight: 15 },  // scale above + approach + chrom below → CT
];

export const segEnclosure: SegmentFn = (pool, mode, startNote, _direction, eighths, opts) => {
  if (eighths < 3) return null;
  const ctSet = new Set(mode.chordTones);
  const scaleSemis = new Set(mode.semi);
  const parity = opts?.beatParity ?? 0;

  // Find target CT: exitAnchor > goalNote > nearest CT from start
  let target: PoolNote | null = null;
  if (opts?.exitAnchor && ctSet.has(opts.exitAnchor.noteName)) {
    target = opts.exitAnchor;
  } else {
    target = opts?.goalNote ?? null;
  }
  if (!target) {
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    target = bestCandidate(ctPool, startNote, null);
  }
  if (!target || !ctSet.has(target.noteName)) return null;

  // Pick enclosure type by weight
  const enclType = pickWeighted(
    ENCLOSURE_TYPES.map(e => e.type),
    ENCLOSURE_TYPES.map(e => e.weight),
  );

  // Build the core enclosure pattern based on type
  let above: PoolNote | null = null;
  let result: PoolNote[];

  const chromAboveSemi = (target.semitone + 1) % 12;
  const chromBelowSemi = (target.semitone + 11) % 12;

  // Helper to synthesize a chromatic approach note from target (not necessarily in pool)
  // Frets are clamped to pool range to avoid position-range violations (U.1)
  const SEMITONE_TO_NAME: Record<number, string> = {
    0: 'C', 1: 'D♭', 2: 'D', 3: 'E♭', 4: 'E', 5: 'F',
    6: 'G♭', 7: 'G', 8: 'A♭', 9: 'A', 10: 'B♭', 11: 'B',
  };
  const poolFretMin = Math.min(...pool.map(n => n.fret));
  const poolFretMax = Math.max(...pool.map(n => n.fret));
  const synthChromNote = (ref: PoolNote, semiOffset: number): PoolNote => {
    const semi = ((ref.semitone + semiOffset) % 12 + 12) % 12;
    return {
      noteName: SEMITONE_TO_NAME[semi] ?? ref.noteName,
      stringIdx: ref.stringIdx,
      fret: Math.max(poolFretMin, Math.min(poolFretMax, ref.fret + semiOffset)),
      semitone: semi,
      isChordTone: false,
      isApproach: true,
    };
  };

  // Helper to find chromatic note: try pool first, then synthesize
  const findChromBelow = (ref: PoolNote): PoolNote =>
    findNearest(pool, chromBelowSemi, ref, 'desc') ??
    pool.find(n => n.fret === ref.fret - 1 && n.stringIdx === ref.stringIdx) ??
    synthChromNote(ref, -1);
  const findChromAbove = (ref: PoolNote): PoolNote =>
    findNearest(pool, chromAboveSemi, ref, 'asc') ??
    pool.find(n => n.fret === ref.fret + 1 && n.stringIdx === ref.stringIdx) ??
    synthChromNote(ref, 1);

  // Helper to build enclosure pattern; returns null if required notes not found
  const buildEncl = (type: EnclosureType): PoolNote[] | null => {
    switch (type) {
      case 'mixed': {
        let a = nextScaleTone(pool, target!, 'asc', scaleSemis);
        if (!a) {
          // Synthesize diatonic above: find next scale semitone above target
          const sortedSemis = Array.from(scaleSemis).sort((x, y) => x - y);
          const nextSemi = sortedSemis.find(s => s > target!.semitone)
            ?? sortedSemis[0]; // wrap around
          if (nextSemi !== undefined) {
            const offset = ((nextSemi - target!.semitone) + 12) % 12;
            a = { ...synthChromNote(target!, offset), isApproach: true };
          }
        }
        if (!a) return null;
        // Below must be truly chromatic (not in scale) for mixed enclosure
        const cb1 = (target!.semitone + 11) % 12;
        if (scaleSemis.has(cb1)) return null;
        const b = findChromBelow(target!);
        return [a, b, target!];
      }
      case 'diatonic': {
        const a = nextScaleTone(pool, target!, 'asc', scaleSemis);
        const b = nextScaleTone(pool, target!, 'desc', scaleSemis);
        return a && b ? [a, b, target!] : null;
      }
      case 'chromatic': {
        const a = findChromAbove(target!);
        const b = findChromBelow(target!);
        return [a, b, target!];
      }
      case '3-note': {
        const a = nextScaleTone(pool, target!, 'asc', scaleSemis);
        if (!a) return null;
        const b = findChromBelow(target!);
        const extraAbove = nextScaleTone(pool, a, 'asc', scaleSemis);
        return extraAbove ? [extraAbove, a, b, target!] : [a, b, target!];
      }
      default:
        return null;
    }
  };

  // Try selected type first, then fallback through other types
  let enclResult = buildEncl(enclType);
  if (!enclResult) {
    const fallbackOrder: EnclosureType[] = ['diatonic', 'mixed', 'chromatic'];
    for (const fb of fallbackOrder) {
      if (fb === enclType) continue;
      enclResult = buildEncl(fb);
      if (enclResult) break;
    }
  }
  if (!enclResult) return null;
  result = enclResult;
  // Extract 'above' note from the result pattern (needed for extras padding loop)
  above = result.length >= 3 ? result[result.length - 3] : result[0];

  // §4: CT target must land on a downbeat
  // Core pattern is 3 notes [above, below, target]. Target is at index 2.
  // With parity, target lands on strong beat when (2 + parity) is even.
  // If we need more eighths, prepend scale tones so target stays on a strong beat.
  if (eighths > 3 && result.length < eighths) {
    const extras: PoolNote[] = [];
    let ref = above;
    while (extras.length + result.length < eighths) {
      const extra = nextScaleTone(pool, ref, 'asc', scaleSemis);
      if (!extra) break;
      extras.unshift(extra);
      ref = extra;
    }
    result = [...extras, ...result];
  }

  // §4 Delayed Resolution (Anton Schwartz): 30% chance to shift target to off-beat
  // Adds an extra approach note so the target lands one eighth later
  const useDelayedResolution = Math.random() < 0.3 && result.length < eighths;

  // Helper: find a pad note before the first note of the enclosure
  const findPadNote = (): PoolNote | null => {
    const padRef = result[0];
    return nextScaleTone(pool, padRef, 'asc', scaleSemis)
      ?? nextScaleTone(pool, padRef, 'desc', scaleSemis)
      ?? synthChromNote(padRef, 1);
  };

  // Beat phase: 0=strong-on, 1=strong-off, 2=nonstrong-on, 3=nonstrong-off
  // Determines exactly where the target lands in the strong-beat cycle
  const beatPhase = opts?.beatPhase ?? (parity === 0 ? 0 : 1);
  const targetPhase = (beatPhase + result.length - 1) % 4;
  const targetIsStrong = targetPhase === 0;
  const targetIsOnBeat = targetPhase === 0 || targetPhase === 2;

  if (!useDelayedResolution) {
    // Normal: prefer target on strong beat (beats 1, 3)
    if (!targetIsStrong) {
      // Calculate how many pads needed to reach strong beat (phase 0)
      const padsFor1 = (beatPhase + result.length) % 4;      // target phase after +1
      const padsFor2 = (beatPhase + result.length + 1) % 4;  // target phase after +2
      if (padsFor1 === 0) {
        // 1 pad reaches strong beat
        const pad = findPadNote();
        if (pad) result.unshift(pad);
      } else if (padsFor2 === 0) {
        // 2 pads reach strong beat (only if within budget)
        const pad1 = findPadNote();
        if (pad1) {
          result.unshift(pad1);
          const pad2Ref = result[0];
          const pad2 = nextScaleTone(pool, pad2Ref, 'asc', scaleSemis)
            ?? nextScaleTone(pool, pad2Ref, 'desc', scaleSemis)
            ?? synthChromNote(pad2Ref, 1);
          if (pad2) result.unshift(pad2);
        }
      } else if (!targetIsOnBeat) {
        // At least shift to on-beat if strong isn't reachable
        const pad = findPadNote();
        if (pad) result.unshift(pad);
      }
    }
  } else {
    // Delayed: target should NOT be on strong beat
    if (targetIsStrong) {
      const pad = findPadNote();
      if (pad) result.unshift(pad);
    }
  }

  return result.length >= 3 ? result : null;
};

// ---------------------------------------------------------------------------
// seg1235 — 1-2-3-5 four-note ascending pattern
// ---------------------------------------------------------------------------

export const seg1235: SegmentFn = (pool, mode, startNote, _direction, eighths, opts) => {
  const exitTarget = opts?.exitAnchor;

  // Find R, 2, 3, 5 near startNote
  const targetDegrees = [0, 1, 2, 4]; // indices into mode.semi / mode.notes
  const targets = targetDegrees.map(idx => {
    if (idx >= mode.semi.length) return null;
    const semi = mode.semi[idx];
    return findNearest(pool, semi, startNote, 'asc');
  });

  if (targets.some(t => t === null)) return null;
  const result = targets as PoolNote[];

  // If exitAnchor is provided, try to pick octave of root that brings pattern closer
  if (exitTarget) {
    const exitPitch = absolutePitch(exitTarget);
    const rootSemi = mode.semi[0];
    const rootCandidates = pool.filter(n => n.semitone === rootSemi);
    if (rootCandidates.length > 1) {
      // Pick root octave whose resulting pattern end is closest to exitAnchor
      let bestRoot = result[0];
      let bestDist = Infinity;
      for (const rc of rootCandidates) {
        // Estimate where 5th degree would land from this root
        const rcPitch = absolutePitch(rc);
        const fifthSemi = mode.semi[4];
        const fifthCandidates = pool.filter(n =>
          n.semitone === fifthSemi && absolutePitch(n) > rcPitch
        );
        if (fifthCandidates.length > 0) {
          const fifthPitch = Math.min(...fifthCandidates.map(n => absolutePitch(n)));
          const dist = Math.abs(fifthPitch - exitPitch);
          if (dist < bestDist) {
            bestDist = dist;
            bestRoot = rc;
          }
        }
      }
      // Rebuild from chosen root if different
      if (bestRoot !== result[0]) {
        result[0] = bestRoot;
        for (let idx = 1; idx < targetDegrees.length; idx++) {
          const semi = mode.semi[targetDegrees[idx]];
          result[idx] = findNearest(pool, semi, result[idx - 1], 'asc') ?? result[idx];
        }
      }
    }
  }

  // Ensure ascending order
  for (let i = 1; i < result.length; i++) {
    if (absolutePitch(result[i]) <= absolutePitch(result[i - 1])) {
      // Try to find a higher octave instance
      const higher = pool.filter(n =>
        n.semitone === result[i].semitone && absolutePitch(n) > absolutePitch(result[i - 1])
      );
      if (higher.length > 0) {
        result[i] = bestCandidate(higher, result[i - 1], 'asc') ?? result[i];
      } else {
        return null;
      }
    }
  }

  return result.slice(0, Math.min(eighths, 4));
};

// ---------------------------------------------------------------------------
// segDim7From3rd — dim7 arpeggio from 3rd (dom7 only: 3-5-b7-b9)
// ---------------------------------------------------------------------------

export const segDim7From3rd: SegmentFn = (pool, mode, startNote, direction, eighths, opts) => {
  if (opts?.quality !== '7' && opts?.quality !== '7b9' && opts?.quality !== '7#11' && opts?.quality !== '7b13') return null;

  const third = mode.chordTones[1];
  const fifth = mode.chordTones[2];
  const seventh = mode.chordTones[3];
  const rootSemi = mode.semi[0];
  const b9Semi = (rootSemi + 1) % 12;

  // If exitAnchor is provided, prefer direction toward it
  const exitTarget = opts?.exitAnchor;
  let effDirection = direction;
  if (exitTarget) {
    const startPitch = absolutePitch(startNote);
    const exitPitch = absolutePitch(exitTarget);
    if (exitPitch > startPitch) effDirection = 'asc';
    else if (exitPitch < startPitch) effDirection = 'desc';
  }

  // Find the 4 notes near startNote
  const thirdNote = findNearest(pool, mode.semi[mode.notes.indexOf(third)] ?? -1, startNote, effDirection);
  const fifthNote = thirdNote ? findNearest(pool, mode.semi[mode.notes.indexOf(fifth)] ?? -1, thirdNote, effDirection) : null;
  const seventhNote = fifthNote ? findNearest(pool, mode.semi[mode.notes.indexOf(seventh)] ?? -1, fifthNote, effDirection) : null;
  const b9Note = seventhNote ? findNearest(pool, b9Semi, seventhNote, effDirection) : null;

  const notes = [thirdNote, fifthNote, seventhNote, b9Note].filter(Boolean) as PoolNote[];
  if (notes.length < 3) return null;

  // Ensure proper direction
  if (effDirection === 'asc') {
    for (let i = 1; i < notes.length; i++) {
      if (absolutePitch(notes[i]) <= absolutePitch(notes[i - 1])) {
        const higher = pool.filter(n =>
          n.semitone === notes[i].semitone && absolutePitch(n) > absolutePitch(notes[i - 1])
        );
        if (higher.length > 0) {
          notes[i] = bestCandidate(higher, notes[i - 1], 'asc') ?? notes[i];
        }
      }
    }
  }

  // If exitAnchor provided, try to pick last note closer to it
  if (exitTarget && notes.length >= 2) {
    const lastIdx = Math.min(eighths, 4) - 1;
    if (lastIdx < notes.length) {
      const lastSemi = notes[lastIdx].semitone;
      const closer = pool.filter(n => n.semitone === lastSemi);
      const best = bestCandidate(closer, exitTarget, null);
      if (best) notes[lastIdx] = best;
    }
  }

  return notes.slice(0, Math.min(eighths, 4));
};

// ---------------------------------------------------------------------------
// segUpperStructure — 3rd-based m7/maj7 arpeggio
// ---------------------------------------------------------------------------

export const segUpperStructure: SegmentFn = (pool, mode, startNote, direction, eighths, opts) => {
  const exitTarget = opts?.exitAnchor;

  // If exitAnchor provided, prefer direction toward it
  let effDirection = direction;
  if (exitTarget) {
    const startPitch = absolutePitch(startNote);
    const exitPitch = absolutePitch(exitTarget);
    if (exitPitch > startPitch) effDirection = 'asc';
    else if (exitPitch < startPitch) effDirection = 'desc';
  }

  // From the 3rd, arpeggiate: 3-5-7-9 (upper structure triad/7th)
  const targets = [1, 2, 3].map(idx => {
    if (idx >= mode.chordTones.length) return null;
    const ct = mode.chordTones[idx];
    const semi = mode.semi[mode.notes.indexOf(ct)];
    return semi !== undefined ? semi : null;
  });
  // Add 9th (2nd degree)
  if (mode.semi.length > 1) targets.push(mode.semi[1]);

  const result: PoolNote[] = [];
  let ref = startNote;
  for (let ti = 0; ti < targets.length; ti++) {
    const semi = targets[ti];
    if (semi === null || semi === undefined) continue;

    // On last note, if exitAnchor matches this semitone, prefer note closer to it
    const isLast = result.length === Math.min(eighths, targets.filter(s => s !== null && s !== undefined).length) - 1;
    let note: PoolNote | null;
    if (exitTarget && isLast && exitTarget.semitone === semi) {
      note = exitTarget;
    } else {
      note = findNearest(pool, semi, ref, effDirection);
    }
    if (!note) continue;
    if (result.length > 0 && Math.abs(absolutePitch(note) - absolutePitch(result[result.length - 1])) > 9) continue;
    result.push(note);
    ref = note;
    if (result.length >= eighths) break;
  }

  // If exitAnchor provided and close to last note, try to snap last note closer
  if (exitTarget && result.length >= 2) {
    const last = result[result.length - 1];
    const dist = Math.abs(absolutePitch(last) - absolutePitch(exitTarget));
    if (dist <= 5) {
      const closer = pool.filter(n =>
        n.semitone === last.semitone &&
        Math.abs(absolutePitch(n) - absolutePitch(exitTarget)) < dist
      );
      if (closer.length > 0) {
        const best = bestCandidate(closer, exitTarget, null);
        if (best) result[result.length - 1] = best;
      }
    }
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segApproachCT — diverse approach types → CT (WJD statistics-based weights)
// ---------------------------------------------------------------------------

/** Approach type definitions with WJD-derived weights */
interface ApproachDef {
  type: string;
  weight: number;
  /** Semitone offsets from target (applied in order, last note resolves to target) */
  offsets: number[];
}

const APPROACH_DEFS: ApproachDef[] = [
  { type: 'chrom-below',     weight: 22, offsets: [11] },       // half step below → target
  { type: 'dbl-chrom-below', weight: 8,  offsets: [10, 11] },   // whole+half below → target
  { type: 'chrom-above',     weight: 16, offsets: [1] },        // half step above → target (§3: diatonic preferred above)
  { type: 'dbl-chrom-above', weight: 7,  offsets: [2, 1] },     // whole+half above → target
  { type: 'diatonic-above',  weight: 25, offsets: [0] },        // diatonic above → target (§3: preferred for above)
  { type: 'diatonic-below',  weight: 12, offsets: [0] },        // diatonic below → target (special)
];

/** Build approach notes for a given target CT */
function buildApproachNotes(
  pool: PoolNote[],
  mode: Mode,
  target: PoolNote,
  def: ApproachDef,
): PoolNote[] | null {
  const scaleSemis = new Set(mode.semi);

  if (def.type === 'diatonic-above') {
    const above = nextScaleTone(pool, target, 'asc', scaleSemis);
    return above ? [above] : null;
  }
  if (def.type === 'diatonic-below') {
    const below = nextScaleTone(pool, target, 'desc', scaleSemis);
    return below ? [below] : null;
  }

  // Chromatic approach(es)
  const notes: PoolNote[] = [];
  for (const offset of def.offsets) {
    const semi = (target.semitone + offset) % 12;
    const found = findNearest(pool, semi, target, offset > 6 ? 'desc' : 'asc') ??
      pool.find(n => n.semitone === semi && Math.abs(n.stringIdx - target.stringIdx) <= 1);
    if (!found) return null;
    notes.push(found);
  }
  return notes;
}

export const segApproachCT: SegmentFn = (pool, mode, startNote, _direction, eighths, opts) => {
  const ctSet = new Set(mode.chordTones);
  const ctSemis = new Set(pool.filter(n => ctSet.has(n.noteName)).map(n => n.semitone));
  const ctPool = pool.filter(n => ctSet.has(n.noteName));
  if (ctPool.length === 0) return null;

  // Compute pool median pitch for gravity
  const pitches = pool.map(n => absolutePitch(n)).sort((a, b) => a - b);
  const poolMedianPitch = pitches[Math.floor(pitches.length / 2)];

  // If skeleton anchors are provided, use them as ordered targets
  const anchorTargets: PoolNote[] = [];
  if (opts?.interiorAnchors) {
    for (const a of opts.interiorAnchors) {
      if (ctSet.has(a.noteName)) anchorTargets.push(a);
    }
  }
  if (opts?.exitAnchor && ctSet.has(opts.exitAnchor.noteName)) {
    anchorTargets.push(opts.exitAnchor);
  }

  const result: PoolNote[] = [];
  let ref = startNote;
  let prevNote: PoolNote | undefined;
  const usedSemitones = new Set<number>();
  let budget = eighths;
  let anchorIdx = 0;

  while (budget >= 2) {
    // Use anchor targets in order if available, otherwise find CT via Musical Forces
    let target: PoolNote | null = null;
    if (anchorIdx < anchorTargets.length) {
      target = anchorTargets[anchorIdx++];
    } else {
      const availableCTs = ctPool.filter(n => !usedSemitones.has(n.semitone));
      const candidates = availableCTs.length > 0 ? availableCTs : ctPool;
      target = bestCandidate(candidates, ref, null, { prevNote, poolMedianPitch, ctSemis });
    }
    if (!target) break;

    usedSemitones.add(target.semitone);

    // Filter approach defs that fit in remaining budget
    const viable = APPROACH_DEFS.filter(d => d.offsets.length + 1 <= budget);
    if (viable.length === 0) break;

    // Pick approach type by weight
    const chosen = pickWeighted(viable, viable.map(d => d.weight));
    const approachNotes = buildApproachNotes(pool, mode, target, chosen);

    if (approachNotes) {
      for (const n of approachNotes) result.push(n);
      result.push(target);
      budget -= approachNotes.length + 1;
    } else {
      // Fallback: just push target
      result.push(target);
      budget -= 1;
    }
    prevNote = ref;
    ref = target;
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segChromatic — chromatic run between two CTs
// ---------------------------------------------------------------------------

export const segChromatic: SegmentFn = (pool, _mode, startNote, direction, eighths, opts) => {
  const exitTarget = opts?.exitAnchor;
  const result: PoolNote[] = [startNote];
  let current = startNote;

  // Determine step direction: if exitAnchor is given, walk toward it
  let step = direction === 'asc' ? 1 : -1;
  if (exitTarget) {
    const diff = absolutePitch(exitTarget) - absolutePitch(startNote);
    if (diff > 0) step = 1;
    else if (diff < 0) step = -1;
  }

  for (let i = 1; i < eighths; i++) {
    // Snap to exitAnchor when close enough at end
    if (exitTarget && i >= eighths - 1) {
      const dist = Math.abs(absolutePitch(current) - absolutePitch(exitTarget));
      if (dist <= 2) {
        if (absolutePitch(exitTarget) !== absolutePitch(current) || exitTarget.stringIdx !== current.stringIdx) {
          result.push(exitTarget);
        }
        break;
      }
    }

    const targetSemi = (current.semitone + step + 12) % 12;
    // Prefer same string
    const sameStr = pool.find(n =>
      n.semitone === targetSemi && n.stringIdx === current.stringIdx &&
      n.fret === current.fret + step
    );
    const next = sameStr ?? findNearest(pool, targetSemi, current, step > 0 ? 'asc' : 'desc');
    if (!next) break;
    result.push(next);
    current = next;
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segOctaveDisp — Honeysuckle Rose: Root → 1oct-lower 3rd → ascending
// ---------------------------------------------------------------------------

export const segOctaveDisp: SegmentFn = (pool, mode, startNote, _direction, eighths, opts) => {
  if (eighths < 3) return null;
  const ctSet = new Set(mode.chordTones);
  const exitTarget = opts?.exitAnchor;

  // Find root near startNote
  const rootSemi = mode.semi[0];
  const rootNote = findNearest(pool, rootSemi, startNote, null) ??
    pool.find(n => n.semitone === rootSemi && ctSet.has(n.noteName));
  if (!rootNote) return null;

  // Find 3rd one octave below root
  const thirdName = mode.chordTones.length >= 2 ? mode.chordTones[1] : null;
  if (!thirdName) return null;
  const thirdSemi = mode.semi[mode.notes.indexOf(thirdName)];
  if (thirdSemi === undefined) return null;

  const rootPitch = absolutePitch(rootNote);
  const lowThirds = pool.filter(n =>
    n.semitone === thirdSemi && absolutePitch(n) < rootPitch
  );
  if (lowThirds.length === 0) return null;

  // Pick the closest 3rd below root
  lowThirds.sort((a, b) =>
    Math.abs(absolutePitch(b) - rootPitch) - Math.abs(absolutePitch(a) - rootPitch)
  );
  const lowThird = lowThirds[lowThirds.length - 1]; // closest below

  const result: PoolNote[] = [rootNote, lowThird];

  // Continue ascending from lowThird
  const scaleSemis = new Set(mode.semi);
  let current = lowThird;
  for (let i = 2; i < eighths; i++) {
    // If exitAnchor provided and near end, try to snap toward it
    if (exitTarget && i >= eighths - 1) {
      const dist = Math.abs(absolutePitch(current) - absolutePitch(exitTarget));
      if (dist <= 5 && Math.abs(current.stringIdx - exitTarget.stringIdx) <= 1) {
        if (absolutePitch(exitTarget) !== absolutePitch(current) || exitTarget.stringIdx !== current.stringIdx) {
          result.push(exitTarget);
        }
        break;
      }
    }

    const next = nextScaleTone(pool, current, 'asc', scaleSemis);
    if (!next) break;
    if (Math.abs(absolutePitch(next) - absolutePitch(current)) > 5) break;
    result.push(next);
    current = next;
  }

  return result.length >= 3 ? result : null;
};

// ---------------------------------------------------------------------------
// Segment registry
// ---------------------------------------------------------------------------

export const SEGMENT_FNS: Record<string, SegmentFn> = {
  arpeggio: segArpeggio,
  scaleRun: segScaleRun,
  enclosure: segEnclosure,
  '1235': seg1235,
  dim7From3rd: segDim7From3rd,
  upperStructure: segUpperStructure,
  approachCT: segApproachCT,
  chromatic: segChromatic,
  octaveDisp: segOctaveDisp,
};
