import type { ChordSlot, Progression, LickDB, LickEntry, Position, GeneratedPhrase, RootName, SongKey } from '../types';
import { ROOTS, MODE_TEMPLATES } from '../constants';
import { resolveMode } from './noteSpelling';
import { buildFretMap, generatePositions, generateDimPositions } from './fretboard';
import {
  computeEffectiveSelections, QUALITY_TO_MODES,
} from './progression';
import {
  buildNotePool, lickToGeneratedPhrase, selectBestInstance,
  getTransposeSemitones, getIiVTransposeSemitones, detectIiVPattern, isIiVLickId,
  sliceLick,
} from './lickEngine';
import { getChartLayout, getChordBeatCount } from './chartLayout';
import { findVoicingsInPosition } from './chordForms';

/** Find a lick from any DB section by ID. */
export function findLickById(lickDB: LickDB, lickId: string): LickEntry | null {
  for (const type of Object.keys(lickDB)) {
    const found = lickDB[type].find(l => l.id === lickId);
    if (found) return found;
  }
  return null;
}

/** Find the originator chord index for a continuation chord (scan backward for same lickId with offset matching anacrusis). */
export function findOriginatorIdx(chords: ChordSlot[], continuationIdx: number): number {
  const lickId = chords[continuationIdx].lickId;
  for (let i = continuationIdx - 1; i >= 0; i--) {
    if (chords[i].lickId !== lickId) break;
    const ana = chords[i].lickAnacrusis ?? 0;
    if (chords[i].lickBeatOffset === ana) return i;
  }
  return continuationIdx;
}

/** Check if a chord has a saved lick that should be played during auto-advance. */
export function chordHasSavedLick(chordIdx: number, prog: Progression, lickDB: LickDB): boolean {
  const chord = prog.chords[chordIdx];
  if (!chord?.lickId) return false;
  return findLickById(lickDB, chord.lickId) != null;
}

/** Resolve mode → fretMap → positions for a chord's root and mode index. */
export function resolveChordPositions(chordRootName: RootName, chordModeIdx: number) {
  const t = MODE_TEMPLATES[chordModeIdx];
  const m = resolveMode(chordRootName, t);
  const fm = buildFretMap(m.semi, m.notes);
  const positions = m.notes.length > 7
    ? generateDimPositions(fm, m.semi[0])
    : generatePositions(fm, m.notes);
  return { template: t, mode: m, fretMap: fm, positions };
}

/** Build a GeneratedPhrase for a lick mapped onto a specific position. */
export function buildPhraseForLick(
  lick: LickEntry, chordRootName: RootName, pos: Position,
  chordModeIdx: number, transposeSemitones: number,
  highOctave: boolean, highInstance: boolean,
): GeneratedPhrase {
  const { template, mode: m, fretMap: fm } = resolveChordPositions(chordRootName, chordModeIdx);
  const lickPitches = lick.notes
    .filter(n => !n.rest && n.pitch != null)
    .map(n => n.pitch! + transposeSemitones);
  const bestInstIdx = selectBestInstance(pos, lickPitches, highInstance);
  const singleInstPos = { ...pos, instances: [pos.instances[bestInstIdx]] };
  const pool = buildNotePool(singleInstPos, m, fm, true);
  return lickToGeneratedPhrase(
    lick, pos.id, template.key, chordRootName, pool, transposeSemitones, highOctave,
  );
}

/** Compute transposition semitones for a chord's lick. */
export function computeTransposeSemitones(
  chord: ChordSlot, chords: ChordSlot[], chordIdx: number,
): number {
  const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
  const iiVType = isIiVLickId(chord.lickId!);
  const isContinuation = chord.lickBeatOffset != null && chord.lickBeatOffset > (chord.lickAnacrusis ?? 0);

  if (iiVType) {
    const keyCenterSemi = isContinuation
      ? (rootSemi + 5) % 12
      : (() => { const iiV = detectIiVPattern(chords, chordIdx); return iiV?.keyCenterSemitone ?? 0; })();
    return getIiVTransposeSemitones(keyCenterSemi);
  } else if (isContinuation) {
    const origIdx = findOriginatorIdx(chords, chordIdx);
    const origChord = chords[origIdx];
    const origRootSemi = ROOTS.find(r => r.name === origChord.rootName)?.semitone ?? 0;
    return getTransposeSemitones(origChord.quality, origRootSemi);
  } else {
    return getTransposeSemitones(chord.quality, rootSemi);
  }
}

/** Build the GeneratedPhrase for a chord's saved lick (auto-play用). */
export function playLickForChord(
  chordIdx: number,
  prog: Progression,
  lickDB: LickDB,
): GeneratedPhrase | null {
  const chords = prog.chords;
  const effAll = computeEffectiveSelections(chords, prog.songKey);
  const chord = chords[chordIdx];
  const eff = effAll[chordIdx];
  if (!chord || !eff || !QUALITY_TO_MODES[chord.quality]) return null;

  if (chord.lickId) {
    const highOctave = chord.lickHighOctave ?? false;
    const highInstance = chord.lickHighInstance ?? false;

    const lick = findLickById(lickDB, chord.lickId);
    if (!lick) return null;

    const transposeSemitones = computeTransposeSemitones(chord, chords, chordIdx);

    // Slice lick for this chord's portion
    const layout = getChartLayout(prog);
    const chordBeats = getChordBeatCount(layout, chordIdx);
    const beatOffset = chord.lickBeatOffset ?? 0;
    const isOverflow = chord.lickBeatOffset != null;
    const effectiveLick = isOverflow
      ? sliceLick(lick, beatOffset, Math.min(chordBeats, lick.beats - beatOffset))
      : lick;

    // Use the user's effective mode/position for mapping
    const { positions } = resolveChordPositions(chord.rootName, eff.modeIdx);
    const pos = positions.find(p => p.id === eff.posId);
    if (pos) {
      return buildPhraseForLick(effectiveLick, chord.rootName, pos, eff.modeIdx, transposeSemitones, highOctave, highInstance);
    }
  }

  return null;
}

/** Build phrase for the anacrusis portion of a chord's saved lick. */
export function buildAnacrusisPhrase(
  chordIdx: number,
  prog: Progression,
  anacrusis: number,
  lickDB: LickDB,
): GeneratedPhrase | null {
  const chords = prog.chords;
  const chord = chords[chordIdx];
  if (!chord?.lickId) return null;

  const lick = findLickById(lickDB, chord.lickId);
  if (!lick) return null;

  const anacrusisSlice = sliceLick(lick, 0, anacrusis);
  const highOctave = chord.lickHighOctave ?? false;
  const highInstance = chord.lickHighInstance ?? false;

  // Compute transposition (same logic as playLickForChord for originators)
  const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
  const iiVType = isIiVLickId(chord.lickId);
  let transposeSemitones: number;
  if (iiVType) {
    const iiV = detectIiVPattern(chords, chordIdx);
    transposeSemitones = getIiVTransposeSemitones(iiV?.keyCenterSemitone ?? 0);
  } else {
    transposeSemitones = getTransposeSemitones(chord.quality, rootSemi);
  }

  // Use effective mode/position
  const effAll = computeEffectiveSelections(chords, prog.songKey);
  const eff = effAll[chordIdx];
  if (!eff) return null;

  const { positions } = resolveChordPositions(chord.rootName, eff.modeIdx);
  const pos = positions.find(p => p.id === eff.posId);
  if (!pos) return null;

  return buildPhraseForLick(anacrusisSlice, chord.rootName, pos, eff.modeIdx, transposeSemitones, highOctave, highInstance);
}

/** Originator判定 (originator = first chord of an overflow lick chain). */
export function isLickOriginator(chord: ChordSlot): boolean {
  const ana = chord.lickAnacrusis ?? 0;
  return chord.lickBeatOffset != null && chord.lickBeatOffset === ana;
}

/** Determine which notes to strum for a given chord in the progression. */
export function getStrumNotes(
  chordIdx: number,
  chords: ChordSlot[],
  songKey?: SongKey,
): { stringIdx: number; fret: number }[] {
  const effAll = computeEffectiveSelections(chords, songKey);
  const chord = chords[chordIdx];
  const eff = effAll[chordIdx];
  if (!chord || !eff || !QUALITY_TO_MODES[chord.quality]) return [];

  const chordMode = resolveMode(chord.rootName, MODE_TEMPLATES[eff.modeIdx]);
  const chordFretMap = buildFretMap(chordMode.semi, chordMode.notes);
  const is8 = chordMode.notes.length > 7;
  const positions = is8
    ? generateDimPositions(chordFretMap, chordMode.semi[0])
    : generatePositions(chordFretMap, chordMode.notes);
  const pos = positions.find(p => p.id === eff.posId);

  // Prefer voicing if set
  if (chord.voicingKey && pos && !is8 && eff.modeIdx <= 6) {
    const voicings = findVoicingsInPosition(pos, chordMode);
    for (const v of voicings) {
      const key = `${v.template.type}-${v.template.inversion}-${v.template.stringIndices.join(',')}`;
      if (key === chord.voicingKey) {
        return v.notes.map(n => ({ stringIdx: n.stringIdx, fret: n.fret }));
      }
    }
  }

  // Fallback: pick one chord tone per string from the position
  if (pos && pos.instances.length > 0) {
    const inst = pos.instances[0];
    const ct = new Set(chordMode.chordTones);
    const notes: { stringIdx: number; fret: number }[] = [];
    for (let s = 5; s >= 0; s--) {
      const strNotes = inst.strings[s];
      if (!strNotes) continue;
      const ctNote = strNotes.find(([n]) => ct.has(n));
      if (ctNote) notes.push({ stringIdx: s, fret: ctNote[1] });
      if (notes.length >= 4) break;
    }
    return notes;
  }

  return [];
}
