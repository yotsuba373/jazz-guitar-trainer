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
  chordQuality: string;   // internal quality key (e.g. 'maj7', 'm7')
  chordTones: string[];
  chordSub: string;
}

/** User's chord notation preferences */
export interface ChordNotationPrefs {
  maj7: string;   // 'M7' | 'maj7' | '△7'
  m7: string;     // 'm7' | 'mi7' | '-7'
  '7': string;    // '7'
  'm7♭5': string; // 'm7♭5' | 'ø7'
  dim: string;    // 'dim' | '°'
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

/** Song key with major/minor quality */
export interface SongKey {
  root: RootName;
  minor: boolean;
}

/** A single measure in the chart layout (contains chord indices into Progression.chords[]) */
export interface ChartMeasure {
  chordIndices: number[];
  beatWidths?: number[];  // parallel array of beat counts per chord (e.g. [2,1,1])
}

/** A section of measures (e.g., "A", "B", "Intro") */
export interface ChartSection {
  label: string;
  measures: ChartMeasure[];
  endings?: ChartMeasure[][];  // endings[0]=1st ending measures, endings[1]=2nd, etc.
  repeats?: number;            // 1=play twice (standard repeat)
}

/** Chart layout metadata — how chords[] maps to a visual grid */
export interface ChartLayout {
  sections: ChartSection[];
  barsPerRow: number;
}

/** A saveable chord progression */
export interface Progression {
  name: string;
  songKey?: SongKey;    // song key for smart mode suggestion
  chords: ChordSlot[];
  chartLayout?: ChartLayout;  // optional chart display layout
}

/** Raw song entry from JazzStandards.json */
export interface RawJazzStandard {
  Title: string;
  Composer?: string;
  Key?: string;
  Sections: RawSection[];
}

export interface RawSection {
  Label?: string;
  MainSegment: { Chords: string };
  Repeats?: number;
  Endings?: { Chords: string }[];
}
