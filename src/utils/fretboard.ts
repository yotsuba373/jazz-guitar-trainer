import type { FretMap, FretNote, Position, PositionInstance, StringNotes } from '../types';
import { OPEN_STRINGS, STRING_DEG_OFFSETS, MAX_TRIO_GAP } from '../constants';

/**
 * Build a map of scale notes on each string across frets 0-22.
 * Fret 0 represents the open string.
 */
export function buildFretMap(scaleSemitones: number[], noteNames: string[]): FretMap {
  const semiToName: Record<number, string> = {};
  scaleSemitones.forEach((s, i) => { semiToName[s] = noteNames[i]; });

  const result: FretMap = [];
  for (let strIdx = 0; strIdx < 6; strIdx++) {
    const open = OPEN_STRINGS[strIdx];
    const notes: FretNote[] = [];
    for (let fret = 0; fret <= 22; fret++) {
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
 * Algorithm:
 * 1. B-string pairs and per-string trios are extracted from the fret map.
 * 2. Each position's expected degrees are determined by constant offsets
 *    (STRING_DEG_OFFSETS), which are invariant across all keys and modes.
 * 3. For each B-pair instance, the closest matching trio on each string
 *    is selected by fret proximity, then incomplete instances are filtered.
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

  // Find the trio closest to a fret range, matching a required first degree.
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
    return bestOverlap >= -MAX_TRIO_GAP ? best : null;
  }

  return Array.from({ length: 7 }, (_, i): Position => {
    // Degree pair for this position on B string
    const bDeg1 = (1 + i) % 7;
    const bDeg2 = (bDeg1 + 1) % 7;

    // Expected first degree per string (constant offsets, no heuristic)
    const eDeg = (STRING_DEG_OFFSETS.e + i) % 7;
    const gDeg = (STRING_DEG_OFFSETS.g + i) % 7;
    const dDeg = (STRING_DEG_OFFSETS.d + i) % 7;
    const aDeg = (STRING_DEG_OFFSETS.a + i) % 7;

    // All B pairs matching this position's degree pattern
    const matchingBPairs = allPairs.filter(
      ([n1, n2]) => deg(n1) === bDeg1 && deg(n2) === bDeg2,
    );

    // Each B pair defines one instance; align trios by fret proximity
    const instances: PositionInstance[] = matchingBPairs.map(bPair => {
      const bMin = bPair[0][1], bMax = bPair[1][1];

      const eNotes = findClosestTrio(e1T, eDeg, bMin, bMax);
      const gNotes = findClosestTrio(gT, gDeg, bMin, bMax);
      const dNotes = findClosestTrio(dT, dDeg, bMin, bMax);
      const aNotes = findClosestTrio(aT, aDeg, bMin, bMax);

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
    // Only keep instances where all strings are present (complete position).
    .filter(inst => inst.strings.every(s => s !== null));

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
