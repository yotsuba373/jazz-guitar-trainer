import type { Mode } from '../types';

// ---------------------------------------------------------------------------
// Bebop scale definitions — 4 types with added passing tone
// ---------------------------------------------------------------------------

export interface BebopScaleDef {
  baseSemi: number[];   // 7-note parent scale intervals from root
  addedSemi: number;    // the added passing tone (semitone from root)
}

export const BEBOP_SCALES: Record<string, BebopScaleDef> = {
  dominant:  { baseSemi: [0, 2, 4, 5, 7, 9, 10], addedSemi: 11 },  // Mixo + nat7
  major:     { baseSemi: [0, 2, 4, 5, 7, 9, 11], addedSemi: 8 },   // Ionian + b6
  dorian:    { baseSemi: [0, 2, 3, 5, 7, 9, 10], addedSemi: 4 },   // Dorian + nat3
  harmMinor: { baseSemi: [0, 2, 3, 5, 7, 8, 11], addedSemi: 10 },  // HarMin + b7
};

/** Map mode key → bebop scale type */
export const MODE_TO_BEBOP: Record<string, string> = {
  'mixolydian':     'dominant',
  'ionian':         'major',
  'dorian':         'dorian',
  'aeolian':        'dorian',
  'lydian':         'major',
  'phrygian':       'dorian',
  'locrian':        'dorian',
  'lydian-dom':     'dominant',
  'altered':        'dominant',
  'harmonic-minor': 'harmMinor',
  'phrygian-dom':   'harmMinor',
};

/** Get the 8-note bebop scale as semitone values (absolute, 0-11) for a mode.
 *  Returns null if no bebop mapping exists. */
export function getBebopScale(mode: Mode): number[] | null {
  const bType = MODE_TO_BEBOP[mode.key];
  if (!bType) return null;
  const def = BEBOP_SCALES[bType];
  if (!def) return null;
  const root = mode.semi[0];
  const eightNotes = [...def.baseSemi, def.addedSemi]
    .map(s => (s + root) % 12)
    .sort((a, b) => a - b);
  return eightNotes;
}

/** Get the added passing tone's absolute semitone value for a mode.
 *  Returns null if no bebop mapping exists. */
export function getBebopPassingTone(mode: Mode): number | null {
  const bType = MODE_TO_BEBOP[mode.key];
  if (!bType) return null;
  const def = BEBOP_SCALES[bType];
  if (!def) return null;
  return (def.addedSemi + mode.semi[0]) % 12;
}
