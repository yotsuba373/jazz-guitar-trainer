import type { GeneratedPhrase, Mode, PhraseNote, NoteAnalysis, PhraseAnalysis, PhraseAnalysisSummary, ApproachType, PhraseContour } from '../types';
import { absolutePitch } from './bebopScheduler';
import { PHRASE_TEMPLATES } from './bebopTemplates';

const FALLBACK_LABELS: Record<string, string> = {
  'scale-down-fallback': 'スケール下降 (フォールバック)',
};

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
  // dim7 arpeggio tone (e.g. ♭9 in dim7-from-3rd)
  if (note.isDim7Tone) {
    const deg = getScaleDegree(note.noteName, mode);
    return `dim7構成音 (${deg})`;
  }
  // Bebop passing tone (e.g. nat7 in Mixolydian)
  if (note.isBebopPassing) {
    const deg = getScaleDegree(note.noteName, mode);
    return `ビバップ経過音 (${deg})`;
  }
  // Extension tone (9th/13th)
  if (note.isExtension) {
    const deg = getScaleDegree(note.noteName, mode);
    return `テンション (${deg})`;
  }
  // Heuristic: if isApproach and next note is CT at 1 semitone distance, label direction
  if (note.isApproach) return 'クロマチック';
  return 'スケール音';
}

// ---------------------------------------------------------------------------
// Contour descriptions
// ---------------------------------------------------------------------------

const CONTOUR_LABELS: Record<PhraseContour, string> = {
  'arch': 'アーチ',
  'reverse-arch': '逆アーチ',
  'descending': '下行',
  'wave': '波形',
  'ascending': '上行',
};

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

    const na: NoteAnalysis = {
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
    // Pass through generation metadata
    if (note.digitalPattern) na.digitalPattern = note.digitalPattern;
    if (note.isDim7Tone) na.isDim7Tone = true;
    if (note.isBebopPassing) na.isBebopPassing = true;
    if (note.isExtension) na.isExtension = true;
    if (note.isSkeletonBeat) na.isSkeletonBeat = true;
    return na;
  });

  const summary = computeSummary(phrase, notes);
  const narrative = buildNarrative(summary);
  return { notes, summary, narrative };
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

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

const CONTOUR_LABELS_NARRATIVE: Record<string, string> = {
  'arch': 'アーチ',
  'reverse-arch': '逆アーチ',
  'descending': '下行',
  'wave': '波形',
  'ascending': '上行',
};

function buildNarrative(summary: PhraseAnalysisSummary): string {
  const parts: string[] = [];

  // Skeleton — show start CT, anchor chain, contour, strong-GT info
  if (summary.skeletonLabel) {
    let skelDesc = '';
    // Start note CT label
    if (summary.skeletonStartCtLabel) {
      const startSlotNote = summary.skeletonLabel.split(' ')[0].split('→')[0];
      skelDesc += `${startSlotNote}(${summary.skeletonStartCtLabel})起点`;
    }
    // Contour from skeleton (more precise than config contour)
    const contourStr = summary.skeletonContour
      ? CONTOUR_LABELS_NARRATIVE[summary.skeletonContour] ?? summary.skeletonContour
      : summary.contourLabel;
    if (contourStr) {
      skelDesc += (skelDesc ? '、' : '') + `${contourStr}コンター`;
    }
    // Strong-GT info
    if (summary.skeletonHasStrongGT) {
      skelDesc += (skelDesc ? '、' : '') + '強拍GT配置';
    }
    parts.push(`${summary.skeletonLabel}骨格${skelDesc ? ' (' + skelDesc + ')' : ''}でCTを配置`);
  } else if (summary.contourLabel) {
    parts.push(`${summary.contourLabel}コンター`);
  }

  // Template
  if (summary.templateLabel) {
    parts.push(`テンプレート: ${summary.templateLabel}`);
  }

  // Digital pattern
  if (summary.digitalPatternUsed && summary.digitalPatternBeats) {
    parts.push(`拍${summary.digitalPatternBeats}でデジタルパターン「${summary.digitalPatternUsed}」を使用`);
  }

  // Approach patterns
  if (summary.approachPatternsUsed.length > 0) {
    const labels = summary.approachPatternsUsed
      .map(p => `${APPROACH_TYPE_LABEL[p.type] ?? p.type}×${p.count}`)
      .join('、');
    parts.push(`アプローチ: ${labels}`);
  }

  // Goal reason — enriched with next chord info when available
  if (summary.goalReason) {
    parts.push(`ゴール: ${summary.goalReason}`);
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

  // Skeleton label
  const DIR_ARROW: Record<string, string> = { asc: '↑', desc: '↓', mixed: '↕' };
  const skeletonLabel = phrase.skeleton
    ? `${phrase.skeleton.patternLabel} ${DIR_ARROW[phrase.skeleton.direction] ?? ''}`
    : undefined;

  // Skeleton detail fields
  const skeletonStartCtLabel = phrase.skeleton?.slots?.find(s => s.role === 'start')?.ctLabel;
  const skeletonContour = phrase.skeleton?.contour;
  const skeletonHasStrongGT = phrase.skeleton?.slots?.some(s => s.role === 'strong-gt') ?? false;

  // Digital pattern used
  const dpNotes = phrase.notes.filter(n => n.digitalPattern);
  let digitalPatternUsed: string | undefined;
  let digitalPatternBeats: string | undefined;
  if (dpNotes.length > 0) {
    digitalPatternUsed = dpNotes[0].digitalPattern!.name;
    const beats = dpNotes.map(n => n.beatPosition);
    digitalPatternBeats = `${Math.min(...beats)}-${Math.max(...beats)}`;
  }

  // Motif label
  const motifLabel = phrase.motif && phrase.motif.length > 0
    ? phrase.motif.map(v => v > 0 ? `↑${v}半音` : v < 0 ? `↓${Math.abs(v)}半音` : '同音').join(', ')
    : undefined;

  // Bebop & extension counts
  const bebopPassingCount = phrase.notes.filter(n => n.isBebopPassing).length;
  const extensionCount = phrase.notes.filter(n => n.isExtension).length;

  // Template label (rule-based engine): resolve ID to human-readable label
  const templateLabel = phrase.templateId
    ? (PHRASE_TEMPLATES.find(t => t.id === phrase.templateId)?.label
      ?? FALLBACK_LABELS[phrase.templateId]
      ?? phrase.templateId)
    : undefined;

  return {
    stepwisePct: pct(stepwise),
    thirdsPct: pct(thirds),
    fourthsPct: pct(fourths),
    leapsPct: pct(leaps),
    rangeSemitones,
    contourLabel: CONTOUR_LABELS[phrase.config.contour!] ?? '',
    approachPatternsUsed: Array.from(patternCounts.entries()).map(([type, count]) => ({ type, count })),
    directionChanges,
    chordToneCount: soundPhraseNotes.filter(n => n.isChordTone && !n.isApproach).length,
    approachNoteCount: soundPhraseNotes.filter(n => n.isApproach).length,
    scaleNoteCount: soundPhraseNotes.filter(n => !n.isChordTone && !n.isApproach).length,
    skeletonLabel,
    skeletonStartCtLabel: skeletonStartCtLabel ?? undefined,
    skeletonContour: skeletonContour ?? undefined,
    skeletonHasStrongGT: skeletonHasStrongGT || undefined,
    digitalPatternUsed,
    digitalPatternBeats,
    goalReason: phrase.goalReason,
    motifLabel,
    bebopPassingCount: bebopPassingCount > 0 ? bebopPassingCount : undefined,
    extensionCount: extensionCount > 0 ? extensionCount : undefined,
    templateLabel,
  };
}
