import type { GeneratedPhrase, Mode, PhraseNote, NoteAnalysis, PhraseAnalysis, PhraseAnalysisSummary, ApproachType, PhraseContour } from '../types';
import { absolutePitch } from './phraseGenerator';

// ---------------------------------------------------------------------------
// Interval naming
// ---------------------------------------------------------------------------

const INTERVAL_NAMES: Record<number, string> = {
  0: 'P1', 1: 'm2', 2: 'M2', 3: 'm3', 4: 'M3', 5: 'P4',
  6: 'TT', 7: 'P5', 8: 'm6', 9: 'M6', 10: 'm7', 11: 'M7', 12: 'P8',
};

function intervalLabel(semitones: number, direction: 'up' | 'down' | 'unison'): string {
  if (direction === 'unison') return 'unison';
  const arrow = direction === 'up' ? '↑' : '↓';
  const name = INTERVAL_NAMES[Math.min(semitones, 12)] ?? `${semitones}st`;
  return `${arrow}${name}`;
}

// ---------------------------------------------------------------------------
// Scale degree computation
// ---------------------------------------------------------------------------

/** Chromatic degree labels indexed by semitone distance from root */
const CHROMATIC_DEGREE: Record<number, string> = {
  0: '1', 1: '♭2', 2: '2', 3: '♭3', 4: '3', 5: '4',
  6: '♭5', 7: '5', 8: '♭6', 9: '6', 10: '♭7', 11: '7',
};

function getScaleDegree(noteName: string, mode: Mode): string {
  // In-scale notes use mode.degrees directly
  if (mode.degrees[noteName]) return mode.degrees[noteName];
  // Chromatic notes: compute from root semitone
  const rootSemi = mode.semi[0];
  const SEMI_MAP: Record<string, number> = {
    'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
    'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
    'C#': 1, 'D#': 3, 'F#': 6, 'G#': 8, 'A#': 10,
  };
  const noteSemi = SEMI_MAP[noteName];
  if (noteSemi === undefined) return 'chr.';
  const interval = ((noteSemi - rootSemi) + 12) % 12;
  return CHROMATIC_DEGREE[interval] ?? 'chr.';
}

// ---------------------------------------------------------------------------
// Function label
// ---------------------------------------------------------------------------

const CT_LABELS = ['R', '3rd', '5th', '7th'];

function chordToneLabel(noteName: string, mode: Mode): string {
  const idx = mode.chordTones.indexOf(noteName);
  return idx >= 0 ? CT_LABELS[idx] : mode.degrees[noteName] ?? noteName;
}

function getFunctionLabel(note: PhraseNote, mode: Mode): string {
  if (note.approachGroup) {
    const { approachType, role, positionInGroup } = note.approachGroup;
    if (role === 'target') return `CT (${chordToneLabel(note.noteName, mode)})`;
    switch (approachType) {
      case 'single-below': return 'Approach ↑';
      case 'single-above': return 'Approach ↓';
      case 'enclosure':
        return positionInGroup === 0 ? 'Encl. above' : 'Encl. below';
      case 'parker-enclosure':
        return `Parker (${positionInGroup + 1}/3)`;
      case 'b9-arpeggio':
        return `♭9 Arp (${positionInGroup + 1}/4)`;
    }
  }
  if (note.isChordTone) return `CT (${chordToneLabel(note.noteName, mode)})`;
  // Heuristic: if isApproach and next note is CT at 1 semitone distance, label direction
  if (note.isApproach) return 'Chromatic';
  return 'Scale tone';
}

// ---------------------------------------------------------------------------
// Contour descriptions
// ---------------------------------------------------------------------------

const CONTOUR_LABELS: Record<PhraseContour, string> = {
  'arch': 'Arch',
  'reverse-arch': 'Reverse Arch',
  'descending': 'Descending',
  'wave': 'Wave',
};

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export function analyzePhrase(phrase: GeneratedPhrase, mode: Mode): PhraseAnalysis {
  const notes: NoteAnalysis[] = phrase.notes.map((note, i) => {
    const prev = i > 0 ? phrase.notes[i - 1] : null;
    const absPitch = absolutePitch(note);
    const prevPitch = prev ? absolutePitch(prev) : null;
    const interval = prevPitch !== null ? Math.abs(absPitch - prevPitch) : null;
    const direction: NoteAnalysis['intervalDirection'] = prevPitch !== null
      ? (absPitch > prevPitch ? 'up' : absPitch < prevPitch ? 'down' : 'unison')
      : null;

    return {
      beatPosition: note.beatPosition,
      noteName: note.noteName,
      scaleDegree: getScaleDegree(note.noteName, mode),
      intervalFromPrev: interval,
      intervalDirection: direction,
      intervalLabel: interval !== null && direction !== null
        ? intervalLabel(interval, direction) : '—',
      functionLabel: getFunctionLabel(note, mode),
      approachGroup: note.approachGroup,
    };
  });

  const summary = computeSummary(phrase, notes);
  return { notes, summary };
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(phrase: GeneratedPhrase, notes: NoteAnalysis[]): PhraseAnalysisSummary {
  let stepwise = 0, thirds = 0, fourths = 0, leaps = 0;
  for (const n of notes) {
    if (n.intervalFromPrev === null) continue;
    if (n.intervalFromPrev <= 2) stepwise++;
    else if (n.intervalFromPrev <= 4) thirds++;
    else if (n.intervalFromPrev === 5) fourths++;
    else leaps++;
  }
  const total = stepwise + thirds + fourths + leaps;
  const pct = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0;

  // Range
  const pitches = phrase.notes.map(absolutePitch);
  const rangeSemitones = Math.max(...pitches) - Math.min(...pitches);

  // Direction changes
  let directionChanges = 0;
  for (let i = 2; i < phrase.notes.length; i++) {
    const prevDir = absolutePitch(phrase.notes[i - 1]) - absolutePitch(phrase.notes[i - 2]);
    const curDir = absolutePitch(phrase.notes[i]) - absolutePitch(phrase.notes[i - 1]);
    if ((prevDir > 0 && curDir < 0) || (prevDir < 0 && curDir > 0)) directionChanges++;
  }

  // Approach patterns used
  const patternCounts = new Map<ApproachType, number>();
  const seenGroups = new Set<number>();
  for (const note of phrase.notes) {
    if (note.approachGroup && !seenGroups.has(note.approachGroup.groupId)) {
      seenGroups.add(note.approachGroup.groupId);
      const t = note.approachGroup.approachType;
      patternCounts.set(t, (patternCounts.get(t) ?? 0) + 1);
    }
  }

  return {
    stepwisePct: pct(stepwise),
    thirdsPct: pct(thirds),
    fourthsPct: pct(fourths),
    leapsPct: pct(leaps),
    rangeSemitones,
    contourLabel: CONTOUR_LABELS[phrase.config.contour!] ?? '',
    approachPatternsUsed: Array.from(patternCounts.entries()).map(([type, count]) => ({ type, count })),
    directionChanges,
    chordToneCount: phrase.notes.filter(n => n.isChordTone && !n.isApproach).length,
    approachNoteCount: phrase.notes.filter(n => n.isApproach).length,
    scaleNoteCount: phrase.notes.filter(n => !n.isChordTone && !n.isApproach).length,
  };
}
