/** Rhythm duration type: q=quarter(1 beat), t=triplet(1/3), e=eighth(1/2), s=sixteenth(1/4) */
export type RhythmType = 'q' | 't' | 'e' | 's';

/** Instrument type for phrase playback synthesis */
export type InstrumentType = 'guitar' | 'saxophone';

/** Rhythm mode: metronome click or drum pattern */
export type RhythmMode = 'metronome' | 'drums';

/** Backing style for comping, bass, and drums */
export type BackingStyle = 'swing' | 'bossa' | 'ballad' | 'latin';

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
  mMaj7: string;  // 'mMaj7' | 'mM7' | 'm(maj7)'
  aug: string;    // 'aug' | '+'
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
  customDegrees?: string[];  // 8-note scales: degree labels (buildDegreeMap doesn't apply)
  description: string;       // Mode flavor text (usage, character, trivia)
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
  voicingKey?: string;  // e.g. "drop2-0-5,4,3,2" — saved voicing template selection
  lickId?: string;           // stable lick ID (e.g. "D-3a7f") — saved lick selection
  lickHighOctave?: boolean;  // 8va toggle: +12 semitone shift within same instance
  lickHighInstance?: boolean; // high-position instance toggle
  lickBeatOffset?: number;   // beat offset into the lick (anacrusis = originator, >anacrusis = continuation, undefined = no split)
  lickAnacrusis?: number;    // anacrusis beats of the assigned lick (originator identification with anacrusis)
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
  bpm?: number;               // per-song BPM (restored on song switch)
  loopRange?: { start: number; end: number };  // per-song measure loop range
  backingStyle?: BackingStyle;  // per-song backing style (restored on song switch)
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

/** Voicing type: Drop 2 or Drop 3 */
export type VoicingType = 'drop2' | 'drop3';

/** A voicing template defining which chord tone goes on which string */
export interface VoicingTemplate {
  type: VoicingType;
  inversion: number;         // 0=Root, 1=1st, 2=2nd, 3=3rd (named by bass note)
  inversionName: string;     // "Root" | "1st" | "2nd" | "3rd"
  stringIndices: number[];   // 4 string indices bass→treble (e.g., [5,4,3,2])
  chordToneOrder: number[];  // chord tone index per string bass→treble (0=R,1=3rd,2=5th,3=7th)
}

/** A concrete voicing found within a position instance */
export interface FoundVoicing {
  template: VoicingTemplate;
  notes: { stringIdx: number; fret: number; noteName: string; chordToneIdx: number }[];
  instanceIdx: number;
  fretSpan: number;
}

// --- Pool Note (used by phrase generation) ---

export interface PoolNote {
  noteName: string;
  stringIdx: number;
  fret: number;
  semitone: number;
  isChordTone: boolean;
  isApproach: boolean;  // chromatic note outside the scale
}

// --- Phrase / Lick Shared Types ---

/** Approach group metadata — attached to notes from committed approach patterns */
export interface ApproachGroupInfo {
  groupId: number;
  approachType: ApproachType;
  role: 'approach' | 'target';
  positionInGroup: number;   // 0-based index within group
  groupSize: number;         // total notes including target
}

/** A single note in a generated phrase, with fretboard coordinates */
export interface PhraseNote {
  noteName: string;
  stringIdx: number;       // 0=1E, 1=B, 2=G, 3=D, 4=A, 5=6E
  fret: number;
  semitone: number;        // absolute (0-11)
  isChordTone: boolean;
  isApproach: boolean;
  beatPosition: number;    // 1-8 (eighth note position)
  isStrong: boolean;       // true = 強拍 (metrically strong: beat 1, 3)
  approachGroup?: ApproachGroupInfo;
  isRest?: boolean;                      // true for rest (no sound, gap in phrase path)
  duration?: RhythmType;                // note duration (default 'e' = eighth note)
  durationBeats?: number;              // exact duration in beats (from lick data, overrides duration)
  beatStart?: number;                   // absolute beat position (0-based, fractional)
}

/** Approach note types */
export type ApproachType =
  | 'single-below'       // [CT-1] → CT (chromatic half step below)
  | 'single-above'       // [CT+1] → CT (chromatic half step above)
  | 'diatonic-above'     // diatonic step above → CT
  | 'diatonic-below'     // diatonic step below → CT
  | 'double-chromatic'   // double chromatic approach → CT
  | 'enclosure'          // [diatonic above] → [chromatic below] → CT
  | 'parker-enclosure'   // [CT+1] → [CT-2] → [CT-1] → CT
  | 'b9-arpeggio';       // b9→3→5→b7 (Dom7 only)

/** A phrase (lick or generated) ready for display and playback */
export interface GeneratedPhrase {
  notes: PhraseNote[];
  posId: number;
  modeKey: string;
  rootName: string;
  /** Total number of beats in the phrase */
  totalBeats: number;
  /** Anacrusis (pickup) beats — used to delay chord strum in preview playback */
  anacrusis?: number;
}

// --- Lick DB Types ---

/** A single note in a lick (from MIDI parser output) */
export interface LickNote {
  pitch?: number;       // MIDI pitch (C4=60, normalized near C4)
  rest?: boolean;       // true for rest notes
  beatStart: number;    // beat position (0-based, fractional)
  duration: number;     // duration in beats
}

/** A single lick entry from the lick database */
export interface LickEntry {
  id?: string;          // stable unique ID from parser (e.g. "D-3a7f", "m-b2c1")
  notes: LickNote[];
  noteCount: number;
  beats: number;        // total beats (4 or 8)
  source?: string;      // artist identifier (e.g. "cannonball", "parker")
  anacrusis?: number;   // anacrusis beats (pickup measure)
}

/** Lick database: keyed by lick type (dom7, min7, maj7, m7b5, etc.) */
export type LickDB = Record<string, LickEntry[]>;

// --- Phrase Analysis Types ---

/** Per-note analysis result (computed post-hoc) */
export interface NoteAnalysis {
  beatPosition: number;
  noteName: string;
  scaleDegree: string;          // e.g. "1", "♭3", "#5", "chr."
  intervalFromPrev: number | null;
  intervalDirection: 'up' | 'down' | 'unison' | null;
  intervalLabel: string;        // e.g. "↑m2", "↓M3", "—"
  functionLabel: string;        // e.g. "CT (Root)", "Encl. above", "Scale tone"
  approachGroup?: ApproachGroupInfo;
}

/** Overall phrase analysis summary */
export interface PhraseAnalysisSummary {
  stepwisePct: number;
  thirdsPct: number;
  fourthsPct: number;
  leapsPct: number;
  rangeSemitones: number;
  contourLabel: string;
  approachPatternsUsed: { type: ApproachType; count: number }[];
  directionChanges: number;
  chordToneCount: number;
  approachNoteCount: number;
  scaleNoteCount: number;
  extensionCount?: number;
}

/** Complete analysis result */
export interface PhraseAnalysis {
  notes: NoteAnalysis[];
  summary: PhraseAnalysisSummary;
  narrative?: string;
}
