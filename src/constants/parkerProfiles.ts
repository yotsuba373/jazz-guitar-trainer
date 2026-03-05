// ---------------------------------------------------------------------------
// Parker Omnibook + WJD Deep Analysis — Quality-specific bebop profiles
// Source: 50 Parker solos (22,699 notes) + 186 WJD solos (75,958 notes)
// ---------------------------------------------------------------------------

export type ParkerQuality = 'dom7' | 'maj' | 'min7' | 'min7b5' | 'dim' | 'overall';

export interface QualityProfile {
  intervals: { stepwise: number; thirds: number; fourths: number; leaps: number };
  approach: { singleBelowPct: number; singleAbovePct: number; enclosurePct: number };
  chordTones: { strongBeatCtPct: number; strongBeatGtPct: number };
  direction: { downPct: number; dirChangesPerPhrase: number };
  /** Pitch class usage frequency (0-11, semitones from root) — higher = more used */
  pitchClassUsage: Record<number, number>;
  /** Contour weights (descending-dominant per Parker data) */
  contourWeights: { arch: number; 'reverse-arch': number; descending: number; wave: number };
  /** Bebop scale passing tone bonus multiplier (derived from scale coverage) */
  bebopScaleBoost: number;
}

export const PARKER_PROFILES: Record<ParkerQuality, QualityProfile> = {
  dom7: {
    // N=12,724 notes
    intervals: { stepwise: 50.3, thirds: 25.6, fourths: 6.2, leaps: 11.2 },
    approach: { singleBelowPct: 32.3, singleAbovePct: 59.5, enclosurePct: 8.2 },
    chordTones: { strongBeatCtPct: 56.4, strongBeatGtPct: 32.7 },
    direction: { downPct: 51.9, dirChangesPerPhrase: 3.33 },
    pitchClassUsage: {
      0: 14.7, 1: 5.1, 2: 9.3, 3: 3.8, 4: 11.3, 5: 9.4,
      6: 2.6, 7: 16.2, 8: 3.6, 9: 8.8, 10: 11.0, 11: 4.1,
    },
    contourWeights: { arch: 20, 'reverse-arch': 15, descending: 45, wave: 20 },
    bebopScaleBoost: 1.025,  // BebopDom 82% coverage / 80% baseline
  },
  maj: {
    // N=4,020 notes
    intervals: { stepwise: 47.9, thirds: 26.8, fourths: 7.9, leaps: 11.5 },
    approach: { singleBelowPct: 39.9, singleAbovePct: 45.6, enclosurePct: 14.5 },
    chordTones: { strongBeatCtPct: 56.1, strongBeatGtPct: 32.9 },
    direction: { downPct: 48.2, dirChangesPerPhrase: 3.45 },
    pitchClassUsage: {
      0: 17.4, 1: 1.3, 2: 12.2, 3: 3.2, 4: 14.8, 5: 7.4,
      6: 1.8, 7: 18.0, 8: 2.2, 9: 8.6, 10: 1.8, 11: 11.3,
    },
    contourWeights: { arch: 25, 'reverse-arch': 15, descending: 40, wave: 20 },
    bebopScaleBoost: 0.95,  // BebopMajor 89% but Ionian-based, less chromatic passing
  },
  min7: {
    // N=5,607 notes
    intervals: { stepwise: 42.9, thirds: 29.5, fourths: 6.2, leaps: 15.4 },
    approach: { singleBelowPct: 35.7, singleAbovePct: 51.2, enclosurePct: 13.1 },
    chordTones: { strongBeatCtPct: 48.9, strongBeatGtPct: 34.4 },
    direction: { downPct: 51.9, dirChangesPerPhrase: 3.38 },
    pitchClassUsage: {
      0: 16.0, 1: 3.0, 2: 10.6, 3: 15.9, 4: 1.9, 5: 9.0,
      6: 2.8, 7: 15.9, 8: 2.7, 9: 6.2, 10: 12.6, 11: 3.3,
    },
    contourWeights: { arch: 20, 'reverse-arch': 15, descending: 45, wave: 20 },
    bebopScaleBoost: 1.038,  // BebopDorian 83% coverage
  },
  min7b5: {
    // N=163 notes (small sample)
    intervals: { stepwise: 61.1, thirds: 18.5, fourths: 5.6, leaps: 11.1 },
    approach: { singleBelowPct: 34.3, singleAbovePct: 60.0, enclosurePct: 5.7 },
    chordTones: { strongBeatCtPct: 54.3, strongBeatGtPct: 31.4 },
    direction: { downPct: 56.2, dirChangesPerPhrase: 3.75 },
    pitchClassUsage: {
      0: 17.8, 1: 8.6, 2: 3.7, 3: 16.6, 4: 1.8, 5: 9.8,
      6: 9.8, 7: 2.5, 8: 3.7, 9: 7.4, 10: 16.0, 11: 2.5,
    },
    contourWeights: { arch: 15, 'reverse-arch': 15, descending: 50, wave: 20 },
    bebopScaleBoost: 0.85,  // Locrian-based, less bebop-scale usage
  },
  dim: {
    // N=179 notes (small sample)
    intervals: { stepwise: 39.9, thirds: 29.2, fourths: 6.7, leaps: 13.5 },
    approach: { singleBelowPct: 17.2, singleAbovePct: 69.0, enclosurePct: 13.8 },
    chordTones: { strongBeatCtPct: 21.4, strongBeatGtPct: 16.7 },
    direction: { downPct: 50.6, dirChangesPerPhrase: 3.55 },
    pitchClassUsage: {
      0: 10.1, 1: 3.4, 2: 5.6, 3: 10.6, 4: 1.7, 5: 8.9,
      6: 20.1, 7: 1.1, 8: 10.6, 9: 14.5, 10: 2.2, 11: 11.2,
    },
    contourWeights: { arch: 20, 'reverse-arch': 20, descending: 40, wave: 20 },
    bebopScaleBoost: 0.80,
  },
  overall: {
    // N=22,699 notes — baseline (matches current hardcoded values)
    intervals: { stepwise: 51.2, thirds: 27.1, fourths: 6.0, leaps: 8.6 },
    approach: { singleBelowPct: 33.4, singleAbovePct: 55.7, enclosurePct: 10.9 },
    chordTones: { strongBeatCtPct: 54.2, strongBeatGtPct: 33.0 },
    direction: { downPct: 50.9, dirChangesPerPhrase: 3.19 },
    pitchClassUsage: {
      0: 15.5, 1: 3.9, 2: 10.1, 3: 6.8, 4: 9.5, 5: 8.9,
      6: 2.7, 7: 16.2, 8: 3.2, 9: 8.2, 10: 9.7, 11: 5.2,
    },
    contourWeights: { arch: 20, 'reverse-arch': 15, descending: 45, wave: 20 },
    bebopScaleBoost: 1.0,  // baseline
  },
};

/** Map app chord quality string to Parker profile key */
export function toParkerQuality(q: string | undefined): ParkerQuality {
  if (!q) return 'overall';
  switch (q) {
    case '7': case '7#11': case '7b13': case '7alt': case '7b9':
      return 'dom7';
    case 'maj7':
      return 'maj';
    case 'm7':
      return 'min7';
    case 'm7♭5':
      return 'min7b5';
    case 'dim': case 'dim7':
      return 'dim';
    default:
      return 'overall';  // mMaj7, aug, etc.
  }
}
