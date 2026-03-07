import type { Position, Mode, FretMap, PhraseConfig, GeneratedPhrase, PhraseContour } from '../types';
import {
  buildNotePool, chooseGoalNote, absolutePitch, pickRandom, pickWeighted,
  ALL_CONTOURS, type PoolNote,
} from './phraseGenerator';
import { selectTemplate } from './bebopTemplates';
import { buildPhrase } from './bebopScheduler';
import { SEGMENT_FNS } from './bebopSegments';

// ---------------------------------------------------------------------------
// Rule-based bebop phrase generator entry point
// ---------------------------------------------------------------------------

export function generatePhraseRule(
  position: Position,
  mode: Mode,
  fretMap: FretMap,
  config: PhraseConfig,
  targetThirdNote?: string,
): GeneratedPhrase | null {
  // 1. Build note pool (always include chromatic for approach notes)
  const pool = buildNotePool(position, mode, fretMap, true);
  const ctSet = new Set(mode.chordTones);
  const ctPool = pool.filter(n => ctSet.has(n.noteName));

  if (ctPool.length === 0) return null;

  // 2. Instance scope (first instance ±1 fret)
  const firstInst = position.instances[0];
  const instPool = pool.filter(n =>
    n.fret >= firstInst.fretMin - 1 && n.fret <= firstInst.fretMax + 1
  );
  const instCtPool = instPool.filter(n => ctSet.has(n.noteName));
  const activePool = instPool.length > 6 ? instPool : pool;
  const activeCtPool = instCtPool.length >= 2 ? instCtPool : ctPool;

  // 3. Contour selection
  const contour: PhraseContour = config.contour ?? pickRandom(ALL_CONTOURS);

  // 4. Compute total eighths (adjusted later for beatOffset)
  const totalBeats = config.beatCount ? config.beatCount : (config.phraseLength ? config.phraseLength / 2 : 4);

  // 5. Goal note
  let goalNote: PoolNote;
  let goalReason: string;
  if (config.goalNoteOverride) {
    const override = config.goalNoteOverride;
    const exact = activeCtPool.find(n => n.stringIdx === override.stringIdx && n.fret === override.fret);
    const byName = activeCtPool.filter(n => n.noteName === override.noteName);
    const closest = exact ?? (byName.length > 0 ? byName.reduce((best, n) =>
      Math.abs(absolutePitch(n) - absolutePitch(override as any)) < Math.abs(absolutePitch(best) - absolutePitch(override as any)) ? n : best
    ) : null);
    if (closest) {
      goalNote = closest;
      goalReason = 'ユーザー指定ゴール';
    } else {
      const result = chooseGoalNote(activeCtPool, mode, targetThirdNote, config.nextChordContext);
      goalNote = result.note;
      goalReason = result.reason;
    }
  } else {
    const result = chooseGoalNote(activeCtPool, mode, targetThirdNote, config.nextChordContext);
    goalNote = result.note;
    goalReason = result.reason;
  }

  // 6. Beat offset: upbeat start for standalone phrases (50% chance)
  const beatOffset = config.startHint ? 0 : (Math.random() < 0.5 ? 0.5 : 0);
  const totalEighths = Math.floor((totalBeats - beatOffset) * 2);

  // 7. Start note with GT priority (3rd/7th get 2x weight)
  const gtNames = new Set<string>();
  if (mode.chordTones.length >= 2) gtNames.add(mode.chordTones[1]); // 3rd
  if (mode.chordTones.length >= 4) gtNames.add(mode.chordTones[3]); // 7th

  const startNote: PoolNote = config.startHint
    ? (activeCtPool.find(n =>
        n.stringIdx === config.startHint!.stringIdx && n.fret === config.startHint!.fret
      ) ??
      activeCtPool.reduce((best, n) =>
        Math.abs(absolutePitch(n) - absolutePitch(config.startHint as any)) <
        Math.abs(absolutePitch(best) - absolutePitch(config.startHint as any)) ? n : best
      ))
    : pickWeighted(activeCtPool, activeCtPool.map(n => gtNames.has(n.noteName) ? 2 : 1));

  // 8. Template selection + execution with 3 retries
  for (let attempt = 0; attempt < 3; attempt++) {
    const template = selectTemplate(mode.chordQuality, totalBeats, contour);

    const phraseNotes = buildPhrase(
      template, activePool, mode,
      startNote, goalNote, totalEighths, beatOffset,
    );

    if (phraseNotes && phraseNotes.length >= 3) {
      // Verify final note — update goal reason
      const finalNote = phraseNotes[phraseNotes.length - 1];
      let actualGoalReason = goalReason;
      if (finalNote.noteName !== goalNote.noteName) {
        if (ctSet.has(finalNote.noteName)) {
          actualGoalReason = `CT到達 (${finalNote.noteName})`;
        } else {
          actualGoalReason = 'テンプレート終端';
        }
      }

      // Extract motif
      const motif: number[] = [];
      for (let i = 1; i < Math.min(3, phraseNotes.length); i++) {
        motif.push(absolutePitch(phraseNotes[i]) - absolutePitch(phraseNotes[i - 1]));
      }

      return {
        notes: phraseNotes,
        posId: position.id,
        modeKey: mode.key,
        rootName: mode.notes[0],
        config: { ...config, contour },
        motif,
        goalReason: actualGoalReason,
        templateId: template.id,
        totalBeats,
      };
    }
  }

  // 9. Final fallback: simple descending scale run
  const fallbackNotes = SEGMENT_FNS.scaleRun(activePool, mode, startNote, 'desc', totalEighths);
  if (fallbackNotes && fallbackNotes.length >= 3) {
    const ctSetLocal = new Set(mode.chordTones);
    let accBeat = beatOffset;
    const pNotes = fallbackNotes.slice(0, totalEighths).map((n): import('../types').PhraseNote => {
      const beatPos = Math.min(Math.floor(accBeat * 2) + 1, 8);
      const isStrong = Math.abs(accBeat - Math.round(accBeat)) < 0.05;
      const pn: import('../types').PhraseNote = {
        noteName: n.noteName,
        stringIdx: n.stringIdx,
        fret: n.fret,
        semitone: n.semitone,
        isChordTone: ctSetLocal.has(n.noteName),
        isApproach: n.isApproach,
        beatPosition: beatPos,
        isStrong,
        duration: 'e',
        beatStart: accBeat,
        segmentIdx: 0,
      };
      accBeat += 0.5;
      return pn;
    });

    const motif: number[] = [];
    for (let i = 1; i < Math.min(3, pNotes.length); i++) {
      motif.push(absolutePitch(pNotes[i]) - absolutePitch(pNotes[i - 1]));
    }

    return {
      notes: pNotes,
      posId: position.id,
      modeKey: mode.key,
      rootName: mode.notes[0],
      config: { ...config, contour: 'descending' },
      motif,
      goalReason: 'スケールラン (フォールバック)',
      templateId: 'scale-down-fallback',
      totalBeats,
    };
  }

  return null;
}
