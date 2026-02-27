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

export const POS_COLORS: string[] = [
  '#E74C3C', '#E67E22', '#F1C40F', '#27AE60',
  '#2980B9', '#8E44AD', '#16A085',
];

export const MODE_COLORS: Record<string, string> = {
  ionian: '#E74C3C', dorian: '#E67E22', phrygian: '#F1C40F', lydian: '#27AE60',
  mixolydian: '#2980B9', aeolian: '#8E44AD', locrian: '#16A085',
};
