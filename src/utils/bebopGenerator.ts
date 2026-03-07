import type { Position, Mode, FretMap, PhraseConfig, GeneratedPhrase, PhraseContour, PoolNote } from '../types';
import { OPEN_STRINGS } from '../constants';
import { absolutePitch, pickRandom } from './bebopScheduler';
import { pickWeighted, selectTemplate } from './bebopTemplates';
import { buildPhrase } from './bebopScheduler';
import { SEGMENT_FNS } from './bebopSegments';

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

export interface GoalResult { note: PoolNote; reason: string }

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
): GoalResult {
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
          if (Math.random() < 0.70) return { note: pickRandom(seventhCTs), reason: '7th→次3rd半音解決' };
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
      if (halfStepCTs.length > 0) return { note: pickRandom(halfStepCTs), reason: '次3rdへ半音VL' };
    }
    const exact = ctPool.filter(n => n.noteName === targetThirdNote);
    if (exact.length > 0) return { note: pickRandom(exact), reason: '次3rd一致' };
  }

  const degIdx = STRONG_RESOLUTION_DEGREE_IDX[mode.key];
  if (degIdx !== undefined && degIdx < mode.notes.length) {
    const targetSemi = mode.semi[degIdx];
    const halfStepCTs = ctPool.filter(n => {
      const diff = ((targetSemi - n.semitone) + 12) % 12;
      return diff === 1 || diff === 11;
    });
    if (halfStepCTs.length > 0) return { note: pickRandom(halfStepCTs), reason: '強進行→半音解決' };
  }

  const preferred = ctPool.filter(n =>
    n.noteName === mode.chordTones[1] || n.noteName === mode.chordTones[3]
  );
  if (preferred.length > 0) return { note: pickRandom(preferred), reason: '3rd/7th優先' };

  return { note: pickRandom(ctPool), reason: 'CT (ランダム)' };
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
  const beatOffset = config.startHint ? 0 : (Math.random() < 0.7 ? 0.5 : 0);
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
  for (let attempt = 0; attempt < 5; attempt++) {
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
    // Trim to range <= 15 semitones
    let fbSlice = fallbackNotes.slice(0, totalEighths);
    while (fbSlice.length > 3) {
      const ps = fbSlice.map(n => absolutePitch(n));
      if (Math.max(...ps) - Math.min(...ps) <= 15) break;
      // Remove last note (widest end of descending run)
      fbSlice = fbSlice.slice(0, -1);
    }
    if (fbSlice.length < 3) return null;

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
