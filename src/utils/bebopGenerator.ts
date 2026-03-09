import type { Position, Mode, FretMap, PhraseConfig, GeneratedPhrase, PhraseContour, PoolNote } from '../types';
import { OPEN_STRINGS } from '../constants';
import { absolutePitch, pickRandom, fillSkeleton } from './bebopScheduler';
import { pickWeighted, selectTemplate } from './bebopTemplates';
import { buildPhrase } from './bebopScheduler';
import { SEGMENT_FNS } from './bebopSegments';
import { buildSkeleton } from './skeleton';

// ---------------------------------------------------------------------------
// Strong-resolution mapping (normal mode: where does this mode resolve to?)
// ---------------------------------------------------------------------------

const STRONG_RESOLUTION_DEGREE_IDX: Record<string, number> = {
  'ionian': 5, 'dorian': 6, 'phrygian': 0, 'lydian': 6,
  'mixolydian': 2, 'aeolian': 3, 'locrian': 2,
  'melodic-minor': 4, 'dorian-b2': 6, 'lydian-aug': 6,
  'lydian-dom': 2, 'mixo-b6': 2, 'locrian-nat2': 2, 'altered': 2,
  'harmonic-minor': 4, 'phrygian-dom': 2,
};

// ---------------------------------------------------------------------------
// Note pool construction
// ---------------------------------------------------------------------------

export function buildNotePool(
  position: Position,
  mode: Mode,
  _fretMap: FretMap,
  includeChromatic: boolean,
): PoolNote[] {
  const ctSet = new Set(mode.chordTones);
  const pool: PoolNote[] = [];
  const seen = new Set<string>();

  for (const inst of position.instances) {
    for (let s = 0; s < 6; s++) {
      const notes = inst.strings[s];
      if (!notes) continue;
      for (const [noteName, fret, semi] of notes) {
        const key = `${s}:${fret}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pool.push({ noteName, stringIdx: s, fret, semitone: semi, isChordTone: ctSet.has(noteName), isApproach: false });
      }
    }

    if (includeChromatic) {
      for (let s = 0; s < 6; s++) {
        const strNotes = inst.strings[s];
        if (!strNotes) continue;
        const minFret = Math.max(0, inst.fretMin - 1);
        const maxFret = inst.fretMax + 1;
        for (let fret = minFret; fret <= maxFret; fret++) {
          const key = `${s}:${fret}`;
          if (seen.has(key)) continue;
          const semi = (OPEN_STRINGS[s] + fret) % 12;
          const allScaleSemis = new Set(mode.semi);
          if (!allScaleSemis.has(semi)) {
            seen.add(key);
            const CHROMATIC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
            pool.push({ noteName: CHROMATIC_NAMES[semi], stringIdx: s, fret, semitone: semi, isChordTone: false, isApproach: true });
          }
        }
      }
    }
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Goal note selection
// ---------------------------------------------------------------------------

export interface GoalResult {
  note: PoolNote;
  reason: string;
  /** Resolved start note for the next chord (from nextChordPool) */
  resolvedNextStart?: {
    note: PoolNote;
    inPosition: boolean;
  };
}

const SEMI_MAP: Record<string, number> = {
  'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
  'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  'C#': 1, 'D#': 3, 'F#': 6, 'G#': 8, 'A#': 10,
};

function findSemitone(noteName: string): number | null {
  return SEMI_MAP[noteName] ?? null;
}

export function chooseGoalNote(
  ctPool: PoolNote[],
  mode: Mode,
  targetThirdNote?: string,
  nextChordContext?: PhraseConfig['nextChordContext'],
  nextChordPool?: PoolNote[],
  nextPosFretRange?: { fretMin: number; fretMax: number },
): GoalResult {
  // Helper: find resolved start in next chord's pool closest to goal note
  const findResolvedNext = (goalNote: PoolNote, targetNoteName?: string): GoalResult['resolvedNextStart'] => {
    if (!nextChordPool) return undefined;
    // If we have a specific target note name (e.g. next 3rd), prefer it
    const candidates = targetNoteName
      ? nextChordPool.filter(n => n.noteName === targetNoteName)
      : nextChordPool.filter(n => n.isChordTone);
    if (candidates.length === 0) return undefined;
    const goalPitch = absolutePitch(goalNote);
    const closest = candidates.reduce((best, n) =>
      Math.abs(absolutePitch(n) - goalPitch) < Math.abs(absolutePitch(best) - goalPitch) ? n : best
    );
    const inPosition = nextPosFretRange
      ? closest.fret >= nextPosFretRange.fretMin && closest.fret <= nextPosFretRange.fretMax
      : true;
    return { note: closest, inPosition };
  };

  // §7 HIGH: 7th→3rd half-step resolution (works with nextChordContext alone)
  if (nextChordContext) {
    const nextThirdSemi = findSemitone(nextChordContext.thirdNote);
    if (nextThirdSemi !== null) {
      const seventh = mode.chordTones[3];
      const seventhCTs = ctPool.filter(n => n.noteName === seventh);
      if (seventhCTs.length > 0) {
        const seventhSemi = seventhCTs[0].semitone;
        const diff = ((nextThirdSemi - seventhSemi) + 12) % 12;
        if (diff === 1 || diff === 11) {
          const chosen = pickRandom(seventhCTs);
          const inPos = nextPosFretRange
            ? nextChordPool?.some(n => n.noteName === nextChordContext.thirdNote
              && n.fret >= nextPosFretRange.fretMin && n.fret <= nextPosFretRange.fretMax) ?? true
            : true;
          const caseLabel = inPos ? 'Case A: ポジション内' : 'Case B: ポジション外';
          return {
            note: chosen,
            reason: `→${nextChordContext.quality}の3rd(${nextChordContext.thirdNote}) [${caseLabel}]`,
            resolvedNextStart: findResolvedNext(chosen, nextChordContext.thirdNote),
          };
        }
      }
    }
  }

  if (targetThirdNote) {
    const targetSemi = findSemitone(targetThirdNote);
    if (targetSemi !== null) {
      const halfStepCTs = ctPool.filter(n => {
        const diff = ((targetSemi - n.semitone) + 12) % 12;
        return diff === 1 || diff === 11;
      });
      if (halfStepCTs.length > 0) {
        const chosen = pickRandom(halfStepCTs);
        return {
          note: chosen,
          reason: `次3rd(${targetThirdNote})へ半音VL`,
          resolvedNextStart: findResolvedNext(chosen, targetThirdNote),
        };
      }
    }
    const exact = ctPool.filter(n => n.noteName === targetThirdNote);
    if (exact.length > 0) {
      const chosen = pickRandom(exact);
      return { note: chosen, reason: `次3rd(${targetThirdNote})一致`, resolvedNextStart: findResolvedNext(chosen) };
    }
  }

  const degIdx = STRONG_RESOLUTION_DEGREE_IDX[mode.key];
  if (degIdx !== undefined && degIdx < mode.notes.length) {
    const targetSemi = mode.semi[degIdx];
    const halfStepCTs = ctPool.filter(n => {
      const diff = ((targetSemi - n.semitone) + 12) % 12;
      return diff === 1 || diff === 11;
    });
    if (halfStepCTs.length > 0) {
      const chosen = pickRandom(halfStepCTs);
      return { note: chosen, reason: '強進行→半音解決', resolvedNextStart: findResolvedNext(chosen) };
    }
  }

  const preferred = ctPool.filter(n =>
    n.noteName === mode.chordTones[1] || n.noteName === mode.chordTones[3]
  );
  if (preferred.length > 0) {
    const chosen = pickRandom(preferred);
    return { note: chosen, reason: '3rd/7th優先', resolvedNextStart: findResolvedNext(chosen) };
  }

  const chosen = pickRandom(ctPool);
  return { note: chosen, reason: 'CT (ランダム)', resolvedNextStart: findResolvedNext(chosen) };
}

// ---------------------------------------------------------------------------
// Rule-based bebop phrase generator entry point
// ---------------------------------------------------------------------------

export function generatePhraseRule(
  position: Position,
  mode: Mode,
  fretMap: FretMap,
  config: PhraseConfig,
  targetThirdNote?: string,
  nextChordPool?: PoolNote[],
  nextPosFretRange?: { fretMin: number; fretMax: number },
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
  // Contour weights: arch(35) > descending(30) > wave(20) > reverse-arch(15)
  // §5: arch is the most important pattern; §2: descending is bebop scale default
  const CONTOUR_WEIGHTS: [PhraseContour, number][] = [
    ['arch', 33], ['descending', 28], ['wave', 18], ['reverse-arch', 13], ['ascending', 8],
  ];
  const contour: PhraseContour = config.contour
    ?? pickWeighted(CONTOUR_WEIGHTS.map(c => c[0]), CONTOUR_WEIGHTS.map(c => c[1]));

  // 4. Compute total eighths (adjusted later for beatOffset)
  const totalBeats = config.beatCount ? config.beatCount : (config.phraseLength ? config.phraseLength / 2 : 4);

  // 5. Goal note
  let goalNote: PoolNote;
  let goalReason: string;
  let goalResult: GoalResult;
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
      goalResult = { note: closest, reason: goalReason };
    } else {
      goalResult = chooseGoalNote(activeCtPool, mode, targetThirdNote, config.nextChordContext, nextChordPool, nextPosFretRange);
      goalNote = goalResult.note;
      goalReason = goalResult.reason;
    }
  } else {
    goalResult = chooseGoalNote(activeCtPool, mode, targetThirdNote, config.nextChordContext, nextChordPool, nextPosFretRange);
    goalNote = goalResult.note;
    goalReason = goalResult.reason;
  }

  // 6. Resolved start handling + beat offset
  const rs = config.resolvedStart;
  let resolvedPickupNote: PoolNote | undefined;
  let bodyBeatBudget = totalBeats;

  if (rs && !rs.inPosition) {
    // Out-of-position resolved start: play as pickup (8th) + rest (8th) = 1 beat
    resolvedPickupNote = rs.note;
    bodyBeatBudget = Math.max(1, totalBeats - 1);
  }

  const hasChaining = !!(rs || config.startHint);
  const beatOffset = hasChaining ? 0 : (Math.random() < 0.7 ? 0.5 : 0);
  const bodyBeatOffset = resolvedPickupNote ? 1 : beatOffset;
  const totalEighths = Math.floor((bodyBeatBudget - bodyBeatOffset + (resolvedPickupNote ? 1 : 0)) * 2);
  const bodyEighths = resolvedPickupNote ? Math.floor(bodyBeatBudget * 2) - 2 : totalEighths;

  // 7. Start note with GT priority (3rd/7th get 2x weight)
  const gtNames = new Set<string>();
  if (mode.chordTones.length >= 2) gtNames.add(mode.chordTones[1]); // 3rd
  if (mode.chordTones.length >= 4) gtNames.add(mode.chordTones[3]); // 7th

  let startNote: PoolNote;
  if (rs?.inPosition) {
    // In-position resolved start: use directly
    startNote = rs.note;
  } else if (rs && !rs.inPosition) {
    // Out-of-position: body starts with GT-weighted random from pool
    startNote = pickWeighted(activeCtPool, activeCtPool.map(n => gtNames.has(n.noteName) ? 2 : 1));
  } else if (config.startHint) {
    startNote = activeCtPool.find(n =>
        n.stringIdx === config.startHint!.stringIdx && n.fret === config.startHint!.fret
      ) ??
      activeCtPool.reduce((best, n) =>
        Math.abs(absolutePitch(n) - absolutePitch(config.startHint as any)) <
        Math.abs(absolutePitch(best) - absolutePitch(config.startHint as any)) ? n : best
      );
  } else {
    startNote = pickWeighted(activeCtPool, activeCtPool.map(n => gtNames.has(n.noteName) ? 2 : 1));
  }

  // 7b. Tension ending at skeleton stage: 26% chance to swap CT goal to non-CT scale tone
  // Only applies when goalIsVL is false (no voice-leading resolution)
  const goalIsVL = !!(goalResult.resolvedNextStart);
  if (!goalIsVL && ctSet.has(goalNote.noteName) && Math.random() < 0.26) {
    const goalPitch = absolutePitch(goalNote);
    const scaleSemis = new Set(mode.semi);
    let bestTension: PoolNote | null = null;
    let bestDist = Infinity;
    for (const n of activePool) {
      if (ctSet.has(n.noteName)) continue;
      if (n.isApproach) continue;
      if (!scaleSemis.has(n.semitone)) continue;
      const pd = Math.abs(absolutePitch(n) - goalPitch);
      const sd = Math.abs(n.stringIdx - goalNote.stringIdx);
      if (pd <= 2 && sd <= 1 && pd < bestDist) {
        bestDist = pd;
        bestTension = n;
      }
    }
    if (bestTension) {
      goalNote = bestTension;
      goalReason = `テンション終止 (${bestTension.noteName})`;
    }
  }

  // 8. Skeleton-driven generation with fallback to legacy buildPhrase
  const forceStart = rs?.inPosition ? rs.note : undefined;

  // Helper to finalize phrase result
  const finalize = (phraseNotes: import('../types').PhraseNote[], templateId: string, skelContour?: import('../types').PhraseContour): GeneratedPhrase | null => {
    // Prepend resolved pickup note + rest if out-of-position
    let finalNotes = phraseNotes;
    if (resolvedPickupNote) {
      const pickupPhraseNote: import('../types').PhraseNote = {
        noteName: resolvedPickupNote.noteName,
        stringIdx: resolvedPickupNote.stringIdx,
        fret: resolvedPickupNote.fret,
        semitone: resolvedPickupNote.semitone,
        isChordTone: ctSet.has(resolvedPickupNote.noteName),
        isApproach: resolvedPickupNote.isApproach,
        beatPosition: 1,
        isStrong: true,
        duration: 'e',
        beatStart: 0,
        segmentIdx: 0,
      };
      const restNote: import('../types').PhraseNote = {
        ...pickupPhraseNote,
        beatPosition: 1,
        isStrong: false,
        isRest: true,
        duration: 'e',
        beatStart: 0.5,
      };
      finalNotes = [pickupPhraseNote, restNote, ...phraseNotes];
    }

    const finalNote = finalNotes[finalNotes.length - 1];
    let actualGoalReason = goalReason;
    if (finalNote.noteName !== goalNote.noteName) {
      if (ctSet.has(finalNote.noteName)) {
        actualGoalReason = `CT到達 (${finalNote.noteName})`;
      } else {
        actualGoalReason = 'テンプレート終端';
      }
    }

    const goalReached = finalNote.noteName === goalNote.noteName;
    const resolvedGoalForNext = goalReached && goalResult.resolvedNextStart
      ? goalResult.resolvedNextStart
      : undefined;

    const motif: number[] = [];
    const soundNotes = finalNotes.filter(n => !n.isRest);
    for (let i = 1; i < Math.min(3, soundNotes.length); i++) {
      motif.push(absolutePitch(soundNotes[i]) - absolutePitch(soundNotes[i - 1]));
    }

    return {
      notes: finalNotes,
      posId: position.id,
      modeKey: mode.key,
      rootName: mode.notes[0],
      config: { ...config, contour: skelContour ?? contour },
      motif,
      goalReason: actualGoalReason,
      templateId,
      totalBeats,
      resolvedGoalForNext,
    };
  };

  // 8a. Try skeleton-driven approach (2 retries)
  for (let attempt = 0; attempt < 2; attempt++) {
    const skeleton = buildSkeleton(
      activePool, activeCtPool, mode,
      startNote, goalNote, bodyBeatBudget, bodyBeatOffset,
      config.prevContour,
    );
    if (!skeleton) continue;

    const template = selectTemplate(mode.chordQuality, totalBeats, skeleton.contour);

    const phraseNotes = fillSkeleton(
      skeleton, template, activePool, mode,
      goalIsVL, forceStart,
    );

    if (phraseNotes && phraseNotes.length >= 3) {
      const result = finalize(phraseNotes, template.id, skeleton.contour);
      if (result) {
        // Attach skeleton metadata
        const skelSlots = skeleton.slots;
        const CT_LABELS_SKEL = ['R', '3rd', '5th', '7th'];
        result.skeleton = {
          patternLabel: skelSlots
            .filter(s => s.role !== 'target')
            .map(s => {
              const ctIdx = mode.chordTones.indexOf(s.note.noteName);
              return ctIdx >= 0 ? ['R', '3', '5', '7'][ctIdx] : s.note.noteName;
            }).join('→'),
          direction: skeleton.contour === 'ascending' ? 'asc'
            : skeleton.contour === 'descending' ? 'desc' : 'mixed',
          slots: skelSlots.map(s => {
            const ctIdx = mode.chordTones.indexOf(s.note.noteName);
            return {
              beatPos: s.beatPos,
              noteName: s.note.noteName,
              role: s.role,
              ctLabel: ctIdx >= 0 ? CT_LABELS_SKEL[ctIdx] : undefined,
            };
          }),
          contour: skeleton.contour,
        };
        return result;
      }
    }
  }

  // 8b. Fallback to legacy buildPhrase (3 retries)
  for (let attempt = 0; attempt < 3; attempt++) {
    const template = selectTemplate(mode.chordQuality, totalBeats, contour);

    const phraseNotes = buildPhrase(
      template, activePool, mode,
      startNote, goalNote, bodyEighths > 0 ? bodyEighths : totalEighths, bodyBeatOffset,
      goalIsVL,
      forceStart,
    );

    if (phraseNotes && phraseNotes.length >= 3) {
      return finalize(phraseNotes, template.id);
    }
  }

  // 9. Final fallback: simple descending scale run
  const fallbackNotes = SEGMENT_FNS.scaleRun(activePool, mode, startNote, 'desc', totalEighths);
  if (fallbackNotes && fallbackNotes.length >= 3) {
    // Trim to range <= 15 semitones
    let fbSlice = fallbackNotes.slice(0, totalEighths);
    while (fbSlice.length > 3) {
      const ps = fbSlice.map(n => absolutePitch(n));
      if (Math.max(...ps) - Math.min(...ps) <= 15) break;
      // Remove last note (widest end of descending run)
      fbSlice = fbSlice.slice(0, -1);
    }
    if (fbSlice.length < 3) return null;

    // Prepend forceStartNote if fallback didn't start with it
    if (forceStart && fbSlice.length > 0) {
      const first = fbSlice[0];
      if (absolutePitch(first) !== absolutePitch(forceStart) || first.stringIdx !== forceStart.stringIdx) {
        fbSlice.unshift(forceStart);
      }
    }

    const ctSetLocal = new Set(mode.chordTones);
    let accBeat = beatOffset;
    const pNotes = fbSlice.map((n): import('../types').PhraseNote => {
      const beatPos = Math.min(Math.floor(accBeat * 2) + 1, 8);
      const isOnBeat = Math.abs(accBeat - Math.round(accBeat)) < 0.05;
      const pn: import('../types').PhraseNote = {
        noteName: n.noteName,
        stringIdx: n.stringIdx,
        fret: n.fret,
        semitone: n.semitone,
        isChordTone: ctSetLocal.has(n.noteName),
        isApproach: n.isApproach,
        beatPosition: beatPos,
        isStrong: isOnBeat,
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
