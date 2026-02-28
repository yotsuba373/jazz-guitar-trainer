/** A single note on the fretboard: [noteName, fretNumber, semitoneValue] */
export type FretNote = [string, number, number];

/** Notes on a single string within a position */
export type StringNotes = FretNote[] | null;

/** One octave instance of a position on the fretboard */
export interface PositionInstance {
  strings: StringNotes[];
  fretMin: number;
  fretMax: number;
}

/** A fretboard position (one of the 7 Berklee positions) */
export interface Position {
  id: number;
  bPair: string;
  range: string;
  instances: PositionInstance[];
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

/** Selectable root key names */
export type RootName =
  | 'C' | 'D♭' | 'D' | 'E♭' | 'E' | 'F'
  | 'G♭' | 'G' | 'A♭' | 'A' | 'B♭' | 'B';

/** Root-agnostic mode template (static data) */
export interface ModeTemplate {
  key: string;
  name: string;
  semi: number[];
  chordSub: string;
  chordDegreesIdx: number[];
  chordQuality: string;
}

/** A single chord slot in a progression */
export interface ChordSlot {
  symbol: string;       // display name (e.g. "Dm7", "G7", "CM7")
  rootName: RootName;
  quality: string;      // matches MODE_TEMPLATES.chordQuality
  modeIdx: number;      // user-selected mode index
  posId: number;        // position id (auto-suggested or user-selected)
  posConfirmed: boolean; // true = user explicitly chose this position
  modeConfirmed?: boolean; // true = user explicitly chose this mode
}

/** A saveable chord progression */
export interface Progression {
  name: string;
  songKey?: RootName;   // song key for smart mode suggestion
  chords: ChordSlot[];
}
