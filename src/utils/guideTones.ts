import type { FretMap, Mode } from '../types';
import { OPEN_STRINGS } from '../constants';

/** Guide tone data for a single chord in context */
export interface GuideToneInfo {
  third: string;
  seventh: string;
  nextThird: string | null;
  nextThirdLocations: { stringIdx: number; fret: number }[];
  resolution: ResolutionType | null;
}

export type ResolutionType = 'half-step-down' | 'half-step-up' | 'common-tone' | 'other';

/** Extract guide tones (3rd and 7th) from a resolved mode */
export function getGuideTones(mode: Mode): { third: string; seventh: string } {
  return {
    third: mode.chordTones[1],
    seventh: mode.chordTones[3],
  };
}

/**
 * Find all fret positions for a note on the fretboard.
 * First checks the current scale's fretMap; if the note isn't there,
 * falls back to chromatic calculation using the semitone value.
 */
export function findNoteLocations(
  noteName: string,
  fretMap: FretMap,
  semitoneValue?: number,
): { stringIdx: number; fret: number }[] {
  const locations: { stringIdx: number; fret: number }[] = [];

  for (let s = 0; s < 6; s++) {
    for (const [name, fret] of fretMap[s]) {
      if (name === noteName) {
        locations.push({ stringIdx: s, fret });
      }
    }
  }

  if (locations.length === 0 && semitoneValue !== undefined) {
    for (let s = 0; s < 6; s++) {
      for (let fret = 0; fret <= 22; fret++) {
        if ((OPEN_STRINGS[s] + fret) % 12 === semitoneValue) {
          locations.push({ stringIdx: s, fret });
        }
      }
    }
  }

  return locations;
}

/**
 * Classify the voice leading resolution between previous 7th and current 3rd.
 */
export function classifyResolution(
  prevSeventhSemi: number,
  currentThirdSemi: number,
): ResolutionType {
  const diff = ((currentThirdSemi - prevSeventhSemi) + 12) % 12;
  if (diff === 0) return 'common-tone';
  if (diff === 11) return 'half-step-down';
  if (diff === 1) return 'half-step-up';
  return 'other';
}

/** Guide tone entry for the progression-wide summary */
export interface GuideToneEntry {
  chordSymbol: string;
  third: string;
  seventh: string;
  thirdSemi: number;
  seventhSemi: number;
}
