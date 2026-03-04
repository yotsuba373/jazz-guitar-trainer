export { buildFretMap, generatePositions, generateDimPositions } from './fretboard';
export { spellScale, buildDegreeMap, resolveMode } from './noteSpelling';
export {
  QUALITY_TO_MODES,
  parseChordSymbol,
  normalizeChordSymbol,
  suggestMode,
  isDiatonic,
  chordRomanNumeral,
  computeEffectiveSelections,
  rankPositionsByProximity,
  buildChordSlot,
  saveProgressions,
  loadProgressions,
  PRESET_PROGRESSIONS,
} from './progression';
export {
  formatChordSymbol,
  formatQuality,
  loadChordNotationPrefs,
  saveChordNotationPrefs,
  CHORD_NOTATION_OPTIONS,
  DEFAULT_CHORD_PREFS,
  displayChordName,
} from './chordFormat';
export {
  fetchJazzStandards,
  searchSongs,
  songToProgression,
} from './jazzStandards';
export {
  deriveChartLayout,
  getChartLayout,
  buildChordRows,
} from './chartLayout';
export {
  getGuideTones,
  findNoteLocations,
  classifyResolution,
} from './guideTones';
export type { GuideToneInfo, ResolutionType, GuideToneEntry } from './guideTones';
export {
  findVoicingsInPosition,
  formatVoicingLabel,
  VOICING_TEMPLATES,
} from './chordForms';
export {
  OPEN_STRING_MIDI,
  fretToFrequency,
  playKSNote,
  playChordStrum,
} from './audioEngine';
export {
  generatePhrase,
  buildNotePool,
  getApproachNotes,
  absolutePitch,
} from './phraseGenerator';
export { analyzePhrase } from './phraseAnalysis';
