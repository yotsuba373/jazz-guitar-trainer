import type { Mode } from '../types';
import { getBebopScale, getBebopPassingTone } from '../constants/bebopScales';
import { absolutePitch, type PoolNote } from './phraseGenerator';

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
// Candidate selection — shared scoring logic
// ---------------------------------------------------------------------------

function bestCandidate(
  candidates: PoolNote[],
  ref: PoolNote,
  preferDir: 'asc' | 'desc' | null,
): PoolNote | null {
  if (candidates.length === 0) return null;
  let best: PoolNote | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    let score = 0;
    const pitchDist = Math.abs(absolutePitch(c) - absolutePitch(ref));
    score += 50 - pitchDist * 3;
    const strDist = Math.abs(c.stringIdx - ref.stringIdx);
    if (strDist <= 1) score += 40;
    else if (strDist === 2) score += 20;
    else score -= 20;
    if (preferDir) {
      const dir = absolutePitch(c) - absolutePitch(ref);
      if ((preferDir === 'asc' && dir > 0) || (preferDir === 'desc' && dir < 0)) score += 15;
      if ((preferDir === 'asc' && dir < 0) || (preferDir === 'desc' && dir > 0)) score -= 10;
    }
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

export const segArpeggio: SegmentFn = (pool, mode, startNote, direction, eighths) => {
  const ctNames = new Set(mode.chordTones);
  const ctPool = pool.filter(n => ctNames.has(n.noteName));
  if (ctPool.length < 2) return null;

  // Build semitone set for CT filtering in nextScaleTone
  const ctSemiSet = new Set(ctPool.map(n => n.semitone));

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

  for (let i = 1; i < eighths; i++) {
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

export const segScaleRun: SegmentFn = (pool, mode, startNote, direction, eighths) => {
  const bebopSemis = getBebopScale(mode);
  const scaleSemis = new Set(bebopSemis ?? mode.semi);
  const allSemis = new Set([...scaleSemis]);
  const bebopPassing = getBebopPassingTone(mode);

  const result: PoolNote[] = [startNote];
  let current = startNote;

  for (let i = 1; i < eighths; i++) {
    const next = nextScaleTone(pool, current, direction, allSemis, false);
    if (!next) break;
    if (Math.abs(absolutePitch(next) - absolutePitch(current)) > 4) break; // max a major 3rd step
    // §2: Bebop passing tone must fall on off-beats (odd index = off-beat in 0-based)
    if (bebopPassing !== null && next.semitone === bebopPassing && i % 2 === 0) {
      // Passing tone would land on a strong beat — skip it and try the next scale tone
      const skip = nextScaleTone(pool, next, direction, allSemis, false);
      if (skip && Math.abs(absolutePitch(skip) - absolutePitch(current)) <= 4) {
        result.push(skip);
        current = skip;
        continue;
      }
      // Can't skip — just break to avoid violating the rule
      break;
    }
    result.push(next);
    current = next;
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segEnclosure — diatonic above + chromatic below → CT target
// ---------------------------------------------------------------------------

export const segEnclosure: SegmentFn = (pool, mode, startNote, _direction, eighths, opts) => {
  if (eighths < 3) return null;
  const ctSet = new Set(mode.chordTones);
  const scaleSemis = new Set(mode.semi);

  // Find target CT (goal or nearest CT from start)
  let target: PoolNote | null = opts?.goalNote ?? null;
  if (!target) {
    const ctPool = pool.filter(n => ctSet.has(n.noteName));
    target = bestCandidate(ctPool, startNote, null);
  }
  if (!target || !ctSet.has(target.noteName)) return null;

  // Diatonic above: nearest scale tone above target
  const above = nextScaleTone(pool, target, 'asc', scaleSemis);
  if (!above) return null;

  // Chromatic below: one semitone below target
  const belowSemi = (target.semitone + 11) % 12;
  const below = findNearest(pool, belowSemi, target, 'desc') ??
    // Create synthetic chromatic note if not in pool
    pool.find(n => n.fret === target!.fret - 1 && n.stringIdx === target!.stringIdx);
  if (!below) return null;

  let result = [above, below, target];

  // §4: CT target must land on a downbeat (even index in 0-based = beat 1,3,5,7)
  // Core pattern is 3 notes [above, below, target]. Target is at index 2 (downbeat). Good.
  // If we need more eighths, prepend scale tones so target stays on an even index.
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

  // Ensure target (last element) lands on an even index (downbeat)
  // If odd length → target is at even index (0-based). If even length → target at odd index, pad.
  if (result.length > 1 && result.length % 2 === 0) {
    // Target is at odd index — prepend one more note to shift to even
    const padRef = result[0];
    const pad = nextScaleTone(pool, padRef, 'asc', scaleSemis);
    if (pad) result.unshift(pad);
  }

  return result.length >= 3 ? result : null;
};

// ---------------------------------------------------------------------------
// seg1235 — 1-2-3-5 four-note ascending pattern
// ---------------------------------------------------------------------------

export const seg1235: SegmentFn = (pool, mode, startNote, _direction, eighths) => {
  // Find R, 2, 3, 5 near startNote
  const targetDegrees = [0, 1, 2, 4]; // indices into mode.semi / mode.notes
  const targets = targetDegrees.map(idx => {
    if (idx >= mode.semi.length) return null;
    const semi = mode.semi[idx];
    return findNearest(pool, semi, startNote, 'asc');
  });

  if (targets.some(t => t === null)) return null;
  const result = targets as PoolNote[];

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

  // Find the 4 notes near startNote
  const thirdNote = findNearest(pool, mode.semi[mode.notes.indexOf(third)] ?? -1, startNote, direction);
  const fifthNote = thirdNote ? findNearest(pool, mode.semi[mode.notes.indexOf(fifth)] ?? -1, thirdNote, direction) : null;
  const seventhNote = fifthNote ? findNearest(pool, mode.semi[mode.notes.indexOf(seventh)] ?? -1, fifthNote, direction) : null;
  const b9Note = seventhNote ? findNearest(pool, b9Semi, seventhNote, direction) : null;

  const notes = [thirdNote, fifthNote, seventhNote, b9Note].filter(Boolean) as PoolNote[];
  if (notes.length < 3) return null;

  // Ensure proper direction
  if (direction === 'asc') {
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

  return notes.slice(0, Math.min(eighths, 4));
};

// ---------------------------------------------------------------------------
// segUpperStructure — 3rd-based m7/maj7 arpeggio
// ---------------------------------------------------------------------------

export const segUpperStructure: SegmentFn = (pool, mode, startNote, direction, eighths) => {
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
  for (const semi of targets) {
    if (semi === null || semi === undefined) continue;
    const note = findNearest(pool, semi, ref, direction);
    if (!note) continue;
    if (result.length > 0 && Math.abs(absolutePitch(note) - absolutePitch(result[result.length - 1])) > 9) continue;
    result.push(note);
    ref = note;
    if (result.length >= eighths) break;
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segApproachCT — single chromatic approach → CT
// ---------------------------------------------------------------------------

export const segApproachCT: SegmentFn = (pool, mode, startNote, _direction, eighths) => {
  const ctSet = new Set(mode.chordTones);
  const ctPool = pool.filter(n => ctSet.has(n.noteName));
  if (ctPool.length === 0) return null;

  const result: PoolNote[] = [];
  let ref = startNote;
  const usedSemitones = new Set<number>(); // Track used CT semitones to avoid repetition

  for (let pair = 0; pair < Math.floor(eighths / 2); pair++) {
    // Find nearest CT that hasn't been targeted yet
    const availableCTs = ctPool.filter(n => !usedSemitones.has(n.semitone));
    // If all CTs used, reset (allow cycling through again)
    const candidates = availableCTs.length > 0 ? availableCTs : ctPool;
    const target = bestCandidate(candidates, ref, null);
    if (!target) break;

    usedSemitones.add(target.semitone);

    // Chromatic approach from below (half step)
    const approachSemi = (target.semitone + 11) % 12;
    const approach = findNearest(pool, approachSemi, target, 'desc') ??
      pool.find(n => n.fret === target.fret - 1 && n.stringIdx === target.stringIdx);
    if (approach) {
      result.push(approach, target);
    } else {
      result.push(target);
    }
    ref = target;
  }

  return result.length >= 2 ? result : null;
};

// ---------------------------------------------------------------------------
// segChromatic — chromatic run between two CTs
// ---------------------------------------------------------------------------

export const segChromatic: SegmentFn = (pool, _mode, startNote, direction, eighths) => {
  const result: PoolNote[] = [startNote];
  let current = startNote;
  const step = direction === 'asc' ? 1 : -1;

  for (let i = 1; i < eighths; i++) {
    const targetSemi = (current.semitone + step + 12) % 12;
    // Prefer same string
    const sameStr = pool.find(n =>
      n.semitone === targetSemi && n.stringIdx === current.stringIdx &&
      n.fret === current.fret + step
    );
    const next = sameStr ?? findNearest(pool, targetSemi, current, direction);
    if (!next) break;
    result.push(next);
    current = next;
  }

  return result.length >= 2 ? result : null;
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
};
