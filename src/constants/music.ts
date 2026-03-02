import type { ModeTemplate, RootName } from '../types';

export const OPEN_STRINGS: number[] = [4, 11, 7, 2, 9, 4]; // 1E, 2B, 3G, 4D, 5A, 6E

export const STR_LABELS: string[] = ['e', 'B', 'G', 'D', 'A', 'E'];

export const MODE_TEMPLATES: ModeTemplate[] = [
  { key: 'ionian', name: 'Ionian', semi: [0,2,4,5,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7' },
  { key: 'dorian', name: 'Dorian', semi: [0,2,3,5,7,9,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7' },
  { key: 'phrygian', name: 'Phrygian', semi: [0,1,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7' },
  { key: 'lydian', name: 'Lydian', semi: [0,2,4,6,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7' },
  { key: 'mixolydian', name: 'Mixolydian', semi: [0,2,4,5,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7' },
  { key: 'aeolian', name: 'Aeolian', semi: [0,2,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7' },
  { key: 'locrian', name: 'Locrian', semi: [0,1,3,5,6,8,10],
    chordSub: '1 ♭3 ♭5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7♭5' },

  // ── Melodic Minor modes ──
  { key: 'melodic-minor', name: 'Melodic Minor', semi: [0,2,3,5,7,9,11],
    chordSub: '1 ♭3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'mMaj7' },
  { key: 'dorian-b2', name: 'Dorian ♭2', semi: [0,1,3,5,7,9,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7' },
  { key: 'lydian-aug', name: 'Lydian Augmented', semi: [0,2,4,6,8,9,11],
    chordSub: '1 3 #5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'aug' },
  { key: 'lydian-dom', name: 'Lydian Dominant', semi: [0,2,4,6,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7#11' },
  { key: 'mixolydian-b6', name: 'Mixolydian ♭6', semi: [0,2,4,5,7,8,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7b13' },
  { key: 'locrian-s2', name: 'Locrian ♯2', semi: [0,2,3,5,6,8,10],
    chordSub: '1 ♭3 ♭5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7♭5' },
  { key: 'altered', name: 'Altered', semi: [0,1,3,4,6,8,10],
    chordSub: '1 3 ♭5 ♭7', chordDegreesIdx: [0,3,4,6], chordQuality: '7alt' },

  // ── Harmonic Minor modes ──
  { key: 'harmonic-minor', name: 'Harmonic Minor', semi: [0,2,3,5,7,8,11],
    chordSub: '1 ♭3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'mMaj7' },
  { key: 'phrygian-dom', name: 'Phrygian Dominant', semi: [0,1,4,5,7,8,10],
    chordSub: '1 3 5 ♭7 ♭9', chordDegreesIdx: [0,2,4,6,1], chordQuality: '7b9' },

  // ── Diminished (対称スケール — 8音) ──
  { key: 'dim-wh', name: 'Diminished W-H', semi: [0,2,3,5,6,8,9,11],
    chordSub: '1 ♭3 ♭5 ♭♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'dim',
    customDegrees: ['1','2','♭3','4','♭5','♭6','6','7'] },
  { key: 'dim-hw', name: 'Diminished H-W', semi: [0,1,3,4,6,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,3,5,7], chordQuality: '7',
    customDegrees: ['1','♭2','♭3','3','♭5','5','6','♭7'] },
];

export const ROOTS: { name: RootName; semitone: number }[] = [
  { name: 'C', semitone: 0 },
  { name: 'D♭', semitone: 1 },
  { name: 'D', semitone: 2 },
  { name: 'E♭', semitone: 3 },
  { name: 'E', semitone: 4 },
  { name: 'F', semitone: 5 },
  { name: 'G♭', semitone: 6 },
  { name: 'G', semitone: 7 },
  { name: 'A♭', semitone: 8 },
  { name: 'A', semitone: 9 },
  { name: 'B♭', semitone: 10 },
  { name: 'B', semitone: 11 },
];

/**
 * Pos 1 における各弦の開始度数 (standard tuning, 7-note diatonic scales).
 * 全 12 キー × 7 モードで不変であることを検証済み。
 */
export const STRING_DEG_OFFSETS = { e: 3, g: 5, d: 2, a: 6 } as const;

/** findClosestTrio でのBペア–トリオ間の最大フレットギャップ許容値 */
export const MAX_TRIO_GAP = 5;

export const POS_COLORS: string[] = [
  '#E74C3C', '#E67E22', '#E8336F', '#27AE60',
  '#6EAC00', '#8E44AD', '#16A085',
];

export const MODE_COLORS: Record<string, string> = {
  // Diatonic (major scale modes)
  ionian: '#E74C3C', dorian: '#E67E22', phrygian: '#F1C40F', lydian: '#27AE60',
  mixolydian: '#2980B9', aeolian: '#8E44AD', locrian: '#16A085',
  // Melodic Minor modes
  'melodic-minor': '#E91E63', 'dorian-b2': '#FF5722', 'lydian-aug': '#CDDC39',
  'lydian-dom': '#4CAF50', 'mixolydian-b6': '#00BCD4', 'locrian-s2': '#9C27B0',
  'altered': '#FF9800',
  // Harmonic Minor modes
  'phrygian-dom': '#D2691E', 'harmonic-minor': '#D32F2F',
  // Diminished modes
  'dim-wh': '#78909C', 'dim-hw': '#90A4AE',
};
