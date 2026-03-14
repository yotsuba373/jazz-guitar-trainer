import type { GeneratedPhrase, Mode, PhraseNote, NoteAnalysis, PhraseAnalysis, PhraseAnalysisSummary, ApproachType } from '../types';
import { CHROMATIC_DEGREE, NOTE_TO_SEMI } from '../constants';
import { absolutePitch } from './lickEngine';

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

function getScaleDegree(noteName: string, mode: Mode): string {
  // In-scale notes use mode.degrees directly
  if (mode.degrees[noteName]) return mode.degrees[noteName];
  // Chromatic notes: compute from root semitone
  const rootSemi = mode.semi[0];
  const noteSemi = NOTE_TO_SEMI[noteName];
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
    const { approachType, role, positionInGroup, groupSize } = note.approachGroup;
    if (role === 'target') return `CT (${chordToneLabel(note.noteName, mode)})`;
    switch (approachType) {
      case 'single-below': return '半音↑アプローチ';
      case 'single-above': return '半音↓アプローチ';
      case 'diatonic-above': return '全音↓アプローチ';
      case 'diatonic-below': return '全音↑アプローチ';
      case 'double-chromatic': return `ダブルクロマチック (${positionInGroup + 1}/${groupSize - 1})`;
      case 'enclosure':
        return positionInGroup === 0 ? 'エンクロージャー上' : 'エンクロージャー下';
      case 'parker-enclosure':
        return `パーカーEncl. (${positionInGroup + 1}/3)`;
      case 'b9-arpeggio':
        return `♭9アルペジオ (${positionInGroup + 1}/4)`;
    }
  }
  if (note.isChordTone) return `CT (${chordToneLabel(note.noteName, mode)})`;
  // Heuristic: if isApproach and next note is CT at 1 semitone distance, label direction
  if (note.isApproach) return 'クロマチック';
  return 'スケール音';
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export function analyzePhrase(phrase: GeneratedPhrase, mode: Mode): PhraseAnalysis {
  const notes: NoteAnalysis[] = phrase.notes.map((note, i) => {
    // Rest notes get minimal analysis
    if (note.isRest) {
      return {
        beatPosition: note.beatPosition,
        noteName: '—',
        scaleDegree: '—',
        intervalFromPrev: null,
        intervalDirection: null,
        intervalLabel: '—',
        functionLabel: '休符',
      } as NoteAnalysis;
    }

    // Find previous non-rest note for interval computation
    let prev: PhraseNote | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!phrase.notes[j].isRest) { prev = phrase.notes[j]; break; }
    }
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
  const narrative = buildNarrative(summary);
  return { notes, summary, narrative };
}

// ---------------------------------------------------------------------------
// Narrative generation
// ---------------------------------------------------------------------------

const APPROACH_TYPE_LABEL: Record<string, string> = {
  'single-below': '半音↑',
  'single-above': '半音↓',
  'diatonic-above': '全音↓',
  'diatonic-below': '全音↑',
  'double-chromatic': 'ダブルクロマチック',
  'enclosure': 'エンクロージャー',
  'parker-enclosure': 'パーカーEncl.',
  'b9-arpeggio': '♭9アルペジオ',
};

function buildNarrative(summary: PhraseAnalysisSummary): string {
  const parts: string[] = [];

  if (summary.contourLabel) {
    parts.push(`${summary.contourLabel}コンター`);
  }

  // Approach patterns
  if (summary.approachPatternsUsed.length > 0) {
    const labels = summary.approachPatternsUsed
      .map(p => `${APPROACH_TYPE_LABEL[p.type] ?? p.type}×${p.count}`)
      .join('、');
    parts.push(`アプローチ: ${labels}`);
  }

  return parts.join('。') + (parts.length > 0 ? '。' : '');
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

  // Range (exclude rests)
  const soundPhraseNotes = phrase.notes.filter(n => !n.isRest);
  const pitches = soundPhraseNotes.map(absolutePitch);
  const rangeSemitones = pitches.length > 0 ? Math.max(...pitches) - Math.min(...pitches) : 0;

  // Direction changes (exclude rests)
  let directionChanges = 0;
  for (let i = 2; i < soundPhraseNotes.length; i++) {
    const prevDir = absolutePitch(soundPhraseNotes[i - 1]) - absolutePitch(soundPhraseNotes[i - 2]);
    const curDir = absolutePitch(soundPhraseNotes[i]) - absolutePitch(soundPhraseNotes[i - 1]);
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

  // Extension count
  const extensionCount = phrase.notes.filter(n =>
    !n.isChordTone && !n.isApproach && !n.isRest
  ).length;

  return {
    stepwisePct: pct(stepwise),
    thirdsPct: pct(thirds),
    fourthsPct: pct(fourths),
    leapsPct: pct(leaps),
    rangeSemitones,
    contourLabel: '',
    approachPatternsUsed: Array.from(patternCounts.entries()).map(([type, count]) => ({ type, count })),
    directionChanges,
    chordToneCount: soundPhraseNotes.filter(n => n.isChordTone && !n.isApproach).length,
    approachNoteCount: soundPhraseNotes.filter(n => n.isApproach).length,
    scaleNoteCount: soundPhraseNotes.filter(n => !n.isChordTone && !n.isApproach).length,
    extensionCount: extensionCount > 0 ? extensionCount : undefined,
  };
}
