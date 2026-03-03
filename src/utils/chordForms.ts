import type { Position, Mode, VoicingTemplate, FoundVoicing } from '../types';

// --- Voicing template definitions ---

const INV_NAMES = ['Root', '1st', '2nd', '3rd'] as const;

/**
 * Drop 2: 4-way close voicing の上から2番目の音を1オクターブ下げる。
 * 転回形はベース音で命名 (ジャズ標準):
 *   Root: R-5-7-3  1st: 3-7-R-5  2nd: 5-R-3-7  3rd: 7-3-5-R
 */
const DROP2_INVERSIONS: number[][] = [
  [0, 2, 3, 1], // Root pos (R in bass)
  [1, 3, 0, 2], // 1st inv  (3rd in bass)
  [2, 0, 1, 3], // 2nd inv  (5th in bass)
  [3, 1, 2, 0], // 3rd inv  (7th in bass)
];

/** Drop 2: 4 consecutive strings */
const DROP2_STRING_SETS: number[][] = [
  [5, 4, 3, 2], // 6E-A-D-G
  [4, 3, 2, 1], // A-D-G-B
  [3, 2, 1, 0], // D-G-B-1E
];

/**
 * Drop 3: 4-way close voicing の上から3番目の音を1オクターブ下げる。
 * 転回形はベース音で命名:
 *   Root: R-7-3-5  1st: 3-R-5-7  2nd: 5-3-7-R  3rd: 7-5-R-3
 */
const DROP3_INVERSIONS: number[][] = [
  [0, 3, 1, 2], // Root pos (R in bass)
  [1, 0, 2, 3], // 1st inv  (3rd in bass)
  [2, 1, 3, 0], // 2nd inv  (5th in bass)
  [3, 2, 0, 1], // 3rd inv  (7th in bass)
];

/** Drop 3: 4 strings with 1 gap (skip 2nd string from bass) */
const DROP3_STRING_SETS: number[][] = [
  [5, 3, 2, 1], // 6E-(skip A)-D-G-B
  [4, 2, 1, 0], // A-(skip D)-G-B-1E
];

/** All 20 voicing templates */
export const VOICING_TEMPLATES: VoicingTemplate[] = [
  ...DROP2_INVERSIONS.flatMap((order, inv) =>
    DROP2_STRING_SETS.map(strings => ({
      type: 'drop2' as const,
      inversion: inv,
      inversionName: INV_NAMES[inv],
      stringIndices: strings,
      chordToneOrder: order,
    }))
  ),
  ...DROP3_INVERSIONS.flatMap((order, inv) =>
    DROP3_STRING_SETS.map(strings => ({
      type: 'drop3' as const,
      inversion: inv,
      inversionName: INV_NAMES[inv],
      stringIndices: strings,
      chordToneOrder: order,
    }))
  ),
];

// --- String label helpers ---

const STR_NAMES = ['1E', 'B', 'G', 'D', 'A', '6E'];

function stringSetLabel(indices: number[]): string {
  return indices.map(i => STR_NAMES[i]).join('-');
}

// --- Core algorithm ---

/**
 * Find all Drop 2 / Drop 3 voicings that fit within a position's fret range.
 * Only meaningful for 7-note diatonic modes (modeIdx 0-6).
 */
export function findVoicingsInPosition(
  position: Position,
  mode: Mode,
  maxSpan = 5,
): FoundVoicing[] {
  const ct = mode.chordTones; // [root, 3rd, 5th, 7th]
  if (ct.length < 4) return [];

  const results: FoundVoicing[] = [];

  for (let instIdx = 0; instIdx < position.instances.length; instIdx++) {
    const inst = position.instances[instIdx];

    // Build chord-tone lookup per string:
    // stringIdx → array of { chordToneIdx, fret, noteName }
    const ctMap: Map<number, { chordToneIdx: number; fret: number; noteName: string }[]> = new Map();
    for (let sIdx = 0; sIdx < 6; sIdx++) {
      const notes = inst.strings[sIdx];
      const entries: { chordToneIdx: number; fret: number; noteName: string }[] = [];
      if (notes) {
        for (const [name, fret] of notes) {
          const ctIdx = ct.indexOf(name);
          if (ctIdx >= 0) {
            entries.push({ chordToneIdx: ctIdx, fret, noteName: name });
          }
        }
      }
      ctMap.set(sIdx, entries);
    }

    // Try each voicing template
    for (const tmpl of VOICING_TEMPLATES) {
      // Collect candidates per string position in the template
      const candidates: { chordToneIdx: number; fret: number; noteName: string }[][] = [];
      let valid = true;

      for (let i = 0; i < 4; i++) {
        const sIdx = tmpl.stringIndices[i];
        const requiredCT = tmpl.chordToneOrder[i];
        const available = (ctMap.get(sIdx) ?? []).filter(e => e.chordToneIdx === requiredCT);
        if (available.length === 0) { valid = false; break; }
        candidates.push(available);
      }
      if (!valid) continue;

      // Find the combination with smallest fret span
      let bestCombo: typeof candidates[0] | null = null;
      let bestSpan = Infinity;

      // Enumerate all combinations (typically very small: 1-2 options per string)
      const enumerate = (depth: number, current: typeof candidates[0]) => {
        if (depth === 4) {
          const frets = current.map(c => c.fret);
          const span = Math.max(...frets) - Math.min(...frets);
          if (span <= maxSpan && span < bestSpan) {
            bestSpan = span;
            bestCombo = [...current];
          }
          return;
        }
        for (const opt of candidates[depth]) {
          current.push(opt);
          enumerate(depth + 1, current);
          current.pop();
        }
      };
      enumerate(0, []);

      if (bestCombo) {
        results.push({
          template: tmpl,
          notes: (bestCombo as typeof candidates[0]).map((c, i) => ({
            stringIdx: tmpl.stringIndices[i],
            fret: c.fret,
            noteName: c.noteName,
            chordToneIdx: c.chordToneIdx,
          })),
          instanceIdx: instIdx,
          fretSpan: bestSpan,
        });
      }
    }
  }

  // Sort: Drop 2 before Drop 3, then by inversion, then by string set (bass string desc), then instance
  results.sort((a, b) => {
    const typeOrder = (a.template.type === 'drop2' ? 0 : 1) - (b.template.type === 'drop2' ? 0 : 1);
    if (typeOrder !== 0) return typeOrder;
    const invOrder = a.template.inversion - b.template.inversion;
    if (invOrder !== 0) return invOrder;
    const strOrder = b.template.stringIndices[0] - a.template.stringIndices[0];
    if (strOrder !== 0) return strOrder;
    return a.instanceIdx - b.instanceIdx;
  });

  return results;
}

/** Format a human-readable label for a voicing */
export function formatVoicingLabel(v: FoundVoicing): string {
  const typeName = v.template.type === 'drop2' ? 'Drop 2' : 'Drop 3';
  const strLabel = stringSetLabel(v.template.stringIndices);
  return `${typeName} ${v.template.inversionName} (${strLabel})`;
}
