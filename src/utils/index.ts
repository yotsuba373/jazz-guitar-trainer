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
  removeChordFromLayout,
  appendChordToLayout,
  computeInsertFlatIndex,
  insertChordAtBeat,
  splitSection,
  mergeSections,
  splitEndings,
  removeEndings,
  renameSection,
  findChordMeasure,
  adjustEndingSplit,
  splitSectionAtEnding,
  insertEmptyMeasure,
  getChordBeatCount,
} from './chartLayout';
export type { ChordMeasureInfo } from './chartLayout';
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
  playEPNote,
  playNote,
  playClick,
  schedulePhrase,
} from './audioEngine';
export { absolutePitch, buildNotePool, hasAlternateOctave, detectIiVPattern, isIiVLickId, buildIiVLickContext, getIiVTransposeSemitones, sliceLick } from './lickEngine';
export type { IiVType, IiVDetection } from './lickEngine';
export { analyzePhrase } from './phraseAnalysis';
export { swingBeatStart, swingVolumeMult, swingDurMult } from './swing';
export {
  loadLickDB, clearLickDBCache, transposeLick,
  QUALITY_TO_LICK_TYPE, SOURCE_DISPLAY_NAMES,
  inferModeFromLick, inferModeCandidates, findBestPositionForLick,
  lickToGeneratedPhrase, mapLickToFretboard,
  getTransposeSemitones, buildLickContext, selectBestInstance,
  inferRhythmType,
} from './lickEngine';
export { buildPlaybackSeq, computeCumBeats } from './playbackSeq';
export type { PlaybackStep } from './playbackSeq';
export {
  findLickById, findOriginatorIdx, chordHasSavedLick,
  resolveChordPositions, computeTransposeSemitones,
  buildPhraseForLick, playLickForChord, buildAnacrusisPhrase,
  isLickOriginator, getStrumNotes,
} from './lickPlayback';
