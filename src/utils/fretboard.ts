import type { FretMap, FretNote, Position, PositionInstance, StringNotes } from '../types';
import { OPEN_STRINGS } from '../constants';

/**
 * Build a map of scale notes on each string across frets 1-21.
 */
export function buildFretMap(scaleSemitones: number[], noteNames: string[]): FretMap {
  const semiToName: Record<number, string> = {};
  scaleSemitones.forEach((s, i) => { semiToName[s] = noteNames[i]; });

  const result: FretMap = [];
  for (let strIdx = 0; strIdx < 6; strIdx++) {
    const open = OPEN_STRINGS[strIdx];
    const notes: FretNote[] = [];
    for (let fret = 1; fret <= 21; fret++) {
      const semi = (open + fret) % 12;
      if (semiToName[semi] !== undefined) {
        notes.push([semiToName[semi], fret, semi]);
      }
    }
    result.push(notes);
  }
  return result;
}

/**
 * Generate the 7 Berklee positions from a fret map.
 *
 * Each position is defined by its B-string degree pair. All octave
 * instances of the same degree pattern on the fretboard are collected
 * as separate PositionInstances, enabling per-fret position lookup.
 */
export function generatePositions(fretMap: FretMap, scaleNotes: string[]): Position[] {
  const bNotes = fretMap[1];

  function deg(note: FretNote): number {
    return scaleNotes.indexOf(note[0]);
  }

  // Build all valid consecutive pairs on B string
  const allPairs: FretNote[][] = [];
  for (let i = 0; i < bNotes.length - 1; i++) {
    const n1 = bNotes[i], n2 = bNotes[i + 1];
    if (deg(n2) === (deg(n1) + 1) % 7) {
      allPairs.push([n1, n2]);
    }
  }

  // Build all valid consecutive trios per string
  function getOrderedTrios(strIdx: number): FretNote[][] {
    const available = fretMap[strIdx];
    const trios: FretNote[][] = [];
    for (let i = 0; i < available.length - 2; i++) {
      const t = [available[i], available[i + 1], available[i + 2]];
      if (deg(t[1]) === (deg(t[0]) + 1) % 7 && deg(t[2]) === (deg(t[1]) + 1) % 7) {
        trios.push(t);
      }
    }
    return trios;
  }

  const e1T = getOrderedTrios(0), gT = getOrderedTrios(2);
  const dT = getOrderedTrios(3), aT = getOrderedTrios(4);

  // Find the primary Pos-1 B pair (starts with 2nd scale degree)
  const refPairIdx = allPairs.findIndex(([n1]) => deg(n1) === 1);
  const refPair = allPairs[refPairIdx];

  // Determine starting degree per string via fret-proximity alignment
  function findAlignedDeg(trios: FretNote[][]): number {
    if (trios.length === 0) return -1;
    const bMin = refPair[0][1], bMax = refPair[1][1];
    let bestDeg = deg(trios[0][0]);
    let bestOverlap = -Infinity;
    for (const t of trios) {
      const overlap = Math.min(bMax, t[2][1]) - Math.max(bMin, t[0][1]);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestDeg = deg(t[0]);
      }
    }
    return bestDeg;
  }

  const eDeg0 = findAlignedDeg(e1T);
  const gDeg0 = findAlignedDeg(gT);
  const dDeg0 = findAlignedDeg(dT);
  const aDeg0 = findAlignedDeg(aT);

  // Find the trio closest to a fret range, matching a required first degree
  function findClosestTrio(
    trios: FretNote[][], firstDeg: number, refMin: number, refMax: number,
  ): FretNote[] | null {
    let best: FretNote[] | null = null;
    let bestOverlap = -Infinity;
    for (const t of trios) {
      if (deg(t[0]) !== firstDeg) continue;
      const overlap = Math.min(refMax, t[2][1]) - Math.max(refMin, t[0][1]);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = t;
      }
    }
    return bestOverlap >= -5 ? best : null;
  }

  return Array.from({ length: 7 }, (_, i): Position => {
    // Degree pair for this position on B string
    const bDeg1 = (1 + i) % 7;
    const bDeg2 = (bDeg1 + 1) % 7;

    // Expected first degree per string for this position
    const eDeg = eDeg0 >= 0 ? (eDeg0 + i) % 7 : -1;
    const gDeg = gDeg0 >= 0 ? (gDeg0 + i) % 7 : -1;
    const dDeg = dDeg0 >= 0 ? (dDeg0 + i) % 7 : -1;
    const aDeg = aDeg0 >= 0 ? (aDeg0 + i) % 7 : -1;

    // All B pairs matching this position's degree pattern
    const matchingBPairs = allPairs.filter(
      ([n1, n2]) => deg(n1) === bDeg1 && deg(n2) === bDeg2,
    );

    // Each B pair defines one instance; align trios by fret proximity
    const instances: PositionInstance[] = matchingBPairs.map(bPair => {
      const bMin = bPair[0][1], bMax = bPair[1][1];

      const eNotes = eDeg >= 0 ? findClosestTrio(e1T, eDeg, bMin, bMax) : null;
      const gNotes = gDeg >= 0 ? findClosestTrio(gT, gDeg, bMin, bMax) : null;
      const dNotes = dDeg >= 0 ? findClosestTrio(dT, dDeg, bMin, bMax) : null;
      const aNotes = aDeg >= 0 ? findClosestTrio(aT, aDeg, bMin, bMax) : null;

      const strings: StringNotes[] = [
        eNotes, bPair, gNotes, dNotes, aNotes, eNotes,
      ];

      const frets = strings
        .filter((s): s is FretNote[] => s !== null)
        .flatMap(s => s.map(([, f]) => f));

      return {
        strings,
        fretMin: frets.length ? Math.min(...frets) : 0,
        fretMax: frets.length ? Math.max(...frets) : 0,
      };
    })
    // Drop sparse instances (need B pair + at least 3 other string groups)
    .filter(inst => inst.strings.filter(s => s !== null).length >= 4);

    // Label from any instance (note names are the same across octaves)
    const labelPair = matchingBPairs[0];
    const bPairLabel = labelPair ? labelPair.map(([n]) => n).join(', ') : '?';

    const rangeStr = instances.length
      ? instances.map(inst => `${inst.fretMin}\u2013${inst.fretMax}`).join(', ')
      : '?';

    return {
      id: i + 1,
      bPair: bPairLabel,
      range: rangeStr,
      instances,
    };
  });
}
