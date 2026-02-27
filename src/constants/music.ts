import type { Mode } from '../types';

export const OPEN_STRINGS: number[] = [4, 11, 7, 2, 9, 4]; // 1E, 2B, 3G, 4D, 5A, 6E

export const STR_LABELS: string[] = ['e', 'B', 'G', 'D', 'A', 'E'];

export const MODES: Mode[] = [
  { key: 'ionian', name: 'Ionian', semi: [0,2,4,5,7,9,11], notes: ['C','D','E','F','G','A','B'],
    degrees: { C:'1', D:'2', E:'3', F:'4', G:'5', A:'6', B:'7' },
    chord: 'Cmaj7', chordTones: ['C','E','G','B'], chordSub: '1 3 5 7' },
  { key: 'dorian', name: 'Dorian', semi: [0,2,3,5,7,9,10], notes: ['C','D','E♭','F','G','A','B♭'],
    degrees: { C:'1', D:'2', 'E♭':'♭3', F:'4', G:'5', A:'6', 'B♭':'♭7' },
    chord: 'Cm7', chordTones: ['C','E♭','G','B♭'], chordSub: '1 ♭3 5 ♭7' },
  { key: 'phrygian', name: 'Phrygian', semi: [0,1,3,5,7,8,10], notes: ['C','D♭','E♭','F','G','A♭','B♭'],
    degrees: { C:'1', 'D♭':'♭2', 'E♭':'♭3', F:'4', G:'5', 'A♭':'♭6', 'B♭':'♭7' },
    chord: 'Cm7', chordTones: ['C','E♭','G','B♭'], chordSub: '1 ♭3 5 ♭7' },
  { key: 'lydian', name: 'Lydian', semi: [0,2,4,6,7,9,11], notes: ['C','D','E','F#','G','A','B'],
    degrees: { C:'1', D:'2', E:'3', 'F#':'#4', G:'5', A:'6', B:'7' },
    chord: 'Cmaj7', chordTones: ['C','E','G','B'], chordSub: '1 3 5 7' },
  { key: 'mixolydian', name: 'Mixolydian', semi: [0,2,4,5,7,9,10], notes: ['C','D','E','F','G','A','B♭'],
    degrees: { C:'1', D:'2', E:'3', F:'4', G:'5', A:'6', 'B♭':'♭7' },
    chord: 'C7', chordTones: ['C','E','G','B♭'], chordSub: '1 3 5 ♭7' },
  { key: 'aeolian', name: 'Aeolian', semi: [0,2,3,5,7,8,10], notes: ['C','D','E♭','F','G','A♭','B♭'],
    degrees: { C:'1', D:'2', 'E♭':'♭3', F:'4', G:'5', 'A♭':'♭6', 'B♭':'♭7' },
    chord: 'Cm7', chordTones: ['C','E♭','G','B♭'], chordSub: '1 ♭3 5 ♭7' },
  { key: 'locrian', name: 'Locrian', semi: [0,1,3,5,6,8,10], notes: ['C','D♭','E♭','F','G♭','A♭','B♭'],
    degrees: { C:'1', 'D♭':'♭2', 'E♭':'♭3', F:'4', 'G♭':'♭5', 'A♭':'♭6', 'B♭':'♭7' },
    chord: 'Cm7♭5', chordTones: ['C','E♭','G♭','B♭'], chordSub: '1 ♭3 ♭5 ♭7' },
];

export const POS_COLORS: string[] = [
  '#E74C3C', '#E67E22', '#F1C40F', '#27AE60',
  '#2980B9', '#8E44AD', '#16A085',
];

export const MODE_COLORS: Record<string, string> = {
  ionian: '#E74C3C', dorian: '#E67E22', phrygian: '#F1C40F', lydian: '#27AE60',
  mixolydian: '#2980B9', aeolian: '#8E44AD', locrian: '#16A085',
};
