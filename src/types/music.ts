/** A single note on the fretboard: [noteName, fretNumber, semitoneValue] */
export type FretNote = [string, number, number];

/** Notes on a single string within a position */
export type StringNotes = FretNote[] | null;

/** A fretboard position (one of the 7 Berklee positions) */
export interface Position {
  id: number;
  bPair: string;
  range: string;
  strings: StringNotes[];
}

/** Degree map: note name -> scale degree string */
export type DegreeMap = Record<string, string>;

/** A mode definition */
export interface Mode {
  key: string;
  name: string;
  semi: number[];
  notes: string[];
  degrees: DegreeMap;
  chord: string;
  chordTones: string[];
  chordSub: string;
}

/** The complete fretboard map: one array of FretNotes per string */
export type FretMap = FretNote[][];

/** Label display mode */
export type LabelMode = 'note' | 'degree';
