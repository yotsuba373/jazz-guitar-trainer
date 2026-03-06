import type { Mode, PhraseNote, RhythmType } from '../types';
import { absolutePitch, isStrongBeat, isExtensionTone, type PoolNote } from './phraseGenerator';
import { SEGMENT_FNS } from './bebopSegments';
import { getBebopPassingTone } from '../constants/bebopScales';
import type { PhraseTemplate } from './bebopTemplates';
import { allocateEighths } from './bebopTemplates';

// ---------------------------------------------------------------------------
// Rhythm constants
// ---------------------------------------------------------------------------

const RHYTHM_BEATS: Record<RhythmType, number> = {
  'q': 1.0, 't': 2/3, 'e': 0.5, 's': 0.25,
};

// ---------------------------------------------------------------------------
// buildPhrase — execute a template and produce PhraseNote[]
// ---------------------------------------------------------------------------

export function buildPhrase(
  template: PhraseTemplate,
  pool: PoolNote[],
  mode: Mode,
  startNote: PoolNote,
  goalNote: PoolNote,
  totalEighths: number,
  beatOffset = 0,
): PhraseNote[] | null {
  const eighthsPerSeg = allocateEighths(template, totalEighths);
  const ctSet = new Set(mode.chordTones);
  const bebopPassing = getBebopPassingTone(mode);
  const quality = mode.chordQuality;

  const allNotes: { note: PoolNote; segIdx: number }[] = [];
  let current = startNote;

  // Execute each segment
  for (let si = 0; si < template.segments.length; si++) {
    const spec = template.segments[si];
    const segFn = SEGMENT_FNS[spec.type];
    if (!segFn) continue;

    const isLast = si === template.segments.length - 1;
    const segEighths = eighthsPerSeg[si];

    const segNotes = segFn(
      pool, mode, current, spec.direction, segEighths,
      { goalNote: isLast ? goalNote : undefined, quality },
    );

    if (!segNotes || segNotes.length === 0) {
      // Segment failed — try a simple scale run as fallback
      const fallback = SEGMENT_FNS.scaleRun(pool, mode, current, spec.direction, segEighths);
      if (fallback && fallback.length > 0) {
        for (const n of fallback) allNotes.push({ note: n, segIdx: si });
        current = fallback[fallback.length - 1];
        continue;
      }
      return null; // can't recover
    }

    // Segment junction smoothness: check distance from previous segment's last note
    if (allNotes.length > 0) {
      const prevNote = allNotes[allNotes.length - 1].note;
      const firstNote = segNotes[0];
      const junctionLeap = Math.abs(absolutePitch(firstNote) - absolutePitch(prevNote));
      const stringDist = Math.abs(firstNote.stringIdx - prevNote.stringIdx);
      // Reject if junction is too disjunct (> major 6th or > 2 strings apart)
      if (junctionLeap > 9 || stringDist > 3) {
        // Try fallback scale run instead
        const fallback = SEGMENT_FNS.scaleRun(pool, mode, allNotes[allNotes.length - 1].note, spec.direction, segEighths);
        if (fallback && fallback.length > 0) {
          const fb0 = fallback[0];
          const fbLeap = Math.abs(absolutePitch(fb0) - absolutePitch(prevNote));
          if (fbLeap <= 9) {
            for (const n of fallback) allNotes.push({ note: n, segIdx: si });
            current = fallback[fallback.length - 1];
            continue;
          }
        }
        return null;
      }
    }

    for (const n of segNotes) allNotes.push({ note: n, segIdx: si });
    current = segNotes[segNotes.length - 1];
  }

  if (allNotes.length < 3) return null;

  // Trim to totalEighths
  const trimmed = allNotes.slice(0, totalEighths);

  // Try to append goal connector if not reached
  const lastEntry = trimmed[trimmed.length - 1];
  if (lastEntry.note.noteName !== goalNote.noteName && trimmed.length < totalEighths) {
    trimmed.push({ note: goalNote, segIdx: trimmed[trimmed.length - 1].segIdx });
  }

  // --- Quality checks ---
  // CT on strong beats check
  let strongCount = 0;
  let strongCTCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const beatPos = i + 1;
    const goalBeat = trimmed.length;
    if (isStrongBeat(beatPos, goalBeat)) {
      strongCount++;
      if (ctSet.has(trimmed[i].note.noteName) || isExtensionTone(trimmed[i].note.noteName, mode)) {
        strongCTCount++;
      }
    }
  }
  if (strongCount > 0 && strongCTCount / strongCount < 0.4) return null;

  // Range check
  const pitches = trimmed.map(e => absolutePitch(e.note));
  const range = Math.max(...pitches) - Math.min(...pitches);
  if (range > 18 || range < 3) return null;

  // Leap check
  for (let i = 1; i < trimmed.length; i++) {
    const leap = Math.abs(absolutePitch(trimmed[i].note) - absolutePitch(trimmed[i - 1].note));
    if (leap > 9) return null;
  }

  // --- Convert to PhraseNote[] ---
  let accBeat = beatOffset;
  const phraseNotes: PhraseNote[] = trimmed.map((entry) => {
    const { note, segIdx } = entry;
    const duration: RhythmType = 'e';
    const beatPos = Math.min(Math.floor(accBeat * 2) + 1, 8);
    const isStrong = Math.abs(accBeat - Math.round(accBeat)) < 0.05 && accBeat === Math.round(accBeat);
    const isCT = ctSet.has(note.noteName);
    const isBebopPass = bebopPassing !== null && note.semitone === bebopPassing && !isCT;

    const pn: PhraseNote = {
      noteName: note.noteName,
      stringIdx: note.stringIdx,
      fret: note.fret,
      semitone: note.semitone,
      isChordTone: isCT,
      isApproach: note.isApproach,
      beatPosition: beatPos,
      isStrong,
      duration,
      beatStart: accBeat,
      segmentIdx: segIdx,
      isBebopPassing: isBebopPass || undefined,
    };
    accBeat += RHYTHM_BEATS[duration];
    return pn;
  });

  return phraseNotes;
}
