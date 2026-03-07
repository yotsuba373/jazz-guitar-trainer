/** Rhythm duration type: q=quarter(1 beat), t=triplet(2/3), e=eighth(1/2), s=sixteenth(1/4) */
export type RhythmType = 'q' | 't' | 'e' | 's';

/** Instrument type for phrase playback synthesis */
export type InstrumentType = 'guitar' | 'saxophone';

/** Phrase engine type: lick-based or rule-based */
export type PhraseEngine = 'lick' | 'rule';

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

// --- Phrase Generator Metadata Types ---

/** Metadata about the harmonic skeleton chosen during phrase generation */
export interface SkeletonMeta {
  patternLabel: string;     // "R→3→5→7"
  direction: 'asc' | 'desc' | 'mixed';
  continuityCtIdx?: number;  // startHintから決定されたbeat1 CT index
}

/** Tag identifying a digital pattern applied to a note */
export interface DigitalPatternTag {
  name: string;             // "1-2-3-5"
  position: number;         // 0-based index within the pattern (0 = first generated note after start)
  size: number;             // total notes in the pattern (steps.length)
}

// --- Phrase Generator Types ---

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
  isExtension?: boolean;   // true for 9th/13th extension tones on strong beats
  beatPosition: number;    // 1-8 (eighth note position)
  isStrong: boolean;       // true for positions 1,3,5,8
  approachGroup?: ApproachGroupInfo;
  digitalPattern?: DigitalPatternTag;   // present if this note belongs to a digital pattern
  isBebopPassing?: boolean;             // true if bebop-scale passing tone (e.g. nat7 in Mixolydian)
  isSkeletonBeat?: boolean;             // true if this note was a skeleton target (beats 1,3,5,goal)
  duration?: RhythmType;                // note duration (default 'e' = eighth note)
  beatStart?: number;                   // absolute beat position (0-based, fractional)
  lickIdx?: number;                     // 0 = 1st lick, 1 = 2nd lick (chained), undefined = connector
  segmentIdx?: number;                  // segment index within rule-based template
}

/** Approach note types */
export type ApproachType =
  | 'single-below'       // [CT-1] → CT
  | 'single-above'       // [CT+1] → CT
  | 'enclosure'          // [diatonic above] → [chromatic below] → CT
  | 'parker-enclosure'   // [CT+1] → [CT-2] → [CT-1] → CT
  | 'b9-arpeggio';       // b9→3→5→b7 (Dom7 only)

/** Phrase contour shape */
export type PhraseContour = 'arch' | 'reverse-arch' | 'descending' | 'wave' | 'ascending';

/** Generation configuration */
export interface PhraseConfig {
  approachTypes: ApproachType[];
  contour?: PhraseContour;       // undefined = random
  /** Last note of the previous phrase — beat 1 will start near this position */
  startHint?: { noteName: string; stringIdx: number; fret: number; semitone: number };
  /** Number of eighth notes to generate (4 | 6 | 8, default: 8) */
  phraseLength?: number;
  /** Previous phrase's contour — used for macro-contour coherence */
  prevContour?: PhraseContour;
  /** Next chord context — for inter-chord voice leading (WP3) */
  nextChordContext?: {
    thirdNote: string;    // next chord's 3rd
    seventhNote: string;  // next chord's 7th
    rootNote: string;     // next chord's root
    quality: string;      // next chord's quality
  };
  /** Previous phrase's motivic pattern — signed interval sequence (WP6) */
  prevMotif?: number[];
  /** Beat count for normal mode (2/3/4 beats, default 4) */
  beatCount?: 2 | 3 | 4;
  /** User-specified goal note override (from fretboard click) */
  goalNoteOverride?: {
    noteName: string; stringIdx: number; fret: number; semitone: number;
  };
}

/** A fully generated phrase */
export interface GeneratedPhrase {
  notes: PhraseNote[];
  posId: number;
  modeKey: string;
  rootName: string;
  config: PhraseConfig;
  /** Intervallic motif extracted from opening notes (WP6) */
  motif?: number[];
  /** Harmonic skeleton pattern used during generation */
  skeleton?: SkeletonMeta;
  /** Reason for goal note selection */
  goalReason?: string;
  /** ID of the lick(s) used for generation — single or chained */
  lickId?: string | string[];
  /** Template ID for rule-based generation */
  templateId?: string;
  /** Total number of beats in the phrase */
  totalBeats: number;
}

// --- Lick Library Types ---

/** A melodic pattern extracted from transcription data */
export interface Lick {
  id: string;
  steps: number[];          // interval-from-root (0-11) per note
  intervals: number[];      // signed semitone interval between consecutive notes
  rhythm: RhythmType[];     // duration per note
  direction: 'asc' | 'desc' | 'mixed';
  length: number;
  startStep: number;
  endStep: number;
  durationBeats: number;    // sum of rhythm durations in beats
  source: 'omnibook' | 'wjd';
}

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
  digitalPattern?: DigitalPatternTag;
  isBebopPassing?: boolean;
  isExtension?: boolean;
  isSkeletonBeat?: boolean;
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
  skeletonLabel?: string;        // e.g. "R→3→5→7 ↑"
  digitalPatternUsed?: string;   // e.g. "1-2-3-5"
  digitalPatternBeats?: string;  // e.g. "3-6"
  goalReason?: string;
  motifLabel?: string;           // e.g. "+3, -2"
  bebopPassingCount?: number;
  extensionCount?: number;
  templateLabel?: string;           // rule-based engine: template name (e.g. "Arp↑+Scale↓")
}

/** Complete analysis result */
export interface PhraseAnalysis {
  notes: NoteAnalysis[];
  summary: PhraseAnalysisSummary;
  narrative?: string;
}
