import type { FretMap, FretNote, Position } from '../types';
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
 * WARNING: Do NOT modify this algorithm. See HANDOFF.md for failed approaches.
 * B-string consecutive pairs (skip root pair, take next 7),
 * then 1:1 sequential trio assignment for other strings.
 */
export function generatePositions(fretMap: FretMap, scaleNotes: string[]): Position[] {
  const bNotes = fretMap[1];
  const allPairs: FretNote[][] = [];
  for (let i = 0; i < bNotes.length - 1; i++) {
    const n1 = bNotes[i], n2 = bNotes[i + 1];
    const idx1 = scaleNotes.indexOf(n1[0]);
    const idx2 = scaleNotes.indexOf(n2[0]);
    if (idx2 === (idx1 + 1) % 7) {
      if (allPairs.length === 0 || allPairs[allPairs.length - 1][0][0] !== n1[0]) {
        allPairs.push([n1, n2]);
      }
    }
  }
  const wantedPairs = allPairs.slice(1, 8);

  function getOrderedTrios(strIdx: number): FretNote[][] {
    const available = fretMap[strIdx];
    const validTrios: FretNote[][] = [];
    for (let i = 0; i < available.length - 2; i++) {
      const trio = [available[i], available[i + 1], available[i + 2]];
      const i0 = scaleNotes.indexOf(trio[0][0]);
      const i1 = scaleNotes.indexOf(trio[1][0]);
      const i2 = scaleNotes.indexOf(trio[2][0]);
      if (i1 === (i0 + 1) % 7 && i2 === (i1 + 1) % 7) {
        validTrios.push(trio);
      }
    }
    return validTrios;
  }

  const e1T = getOrderedTrios(0), gT = getOrderedTrios(2);
  const dT = getOrderedTrios(3), aT = getOrderedTrios(4);

  return wantedPairs.map((bPair, i): Position => {
    const strings = [e1T[i] || null, bPair, gT[i] || null, dT[i] || null, aT[i] || null, e1T[i] || null];
    const frets = strings
      .filter((s): s is FretNote[] => s !== null)
      .flatMap(s => s.map(([, f]) => f));
    return {
      id: i + 1,
      bPair: bPair.map(([n]) => n).join(', '),
      range: frets.length ? `${Math.min(...frets)}\u2013${Math.max(...frets)}` : '?',
      strings,
    };
  });
}
