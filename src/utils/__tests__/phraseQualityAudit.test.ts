/**
 * Automated Phrase Quality Audit
 *
 * Generates N phrases under various conditions (key × position × approach type),
 * analyzes each phrase for bebop-quality problems, and outputs a structured report.
 *
 * Quality criteria based on Charlie Parker-style bebop lines:
 * 1. Stepwise motion dominance (≥50% of intervals ≤ 2 semitones)
 * 2. No large leaps (≥ P5 / 7 semitones) — especially beat 7→8
 * 3. No oscillation patterns (A→B→A immediate pitch returns)
 * 4. Approach notes must connect smoothly (prev→approach ≤ 5 semitones)
 * 5. Range should be compact (≤ 12 semitones / 1 octave typical)
 * 6. All approach notes have approachGroup metadata (no orphaned chromatic)
 * 7. Strong beats (1,3,5,8) must be chord tones
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generatePhrase, absolutePitch } from '../phraseGenerator';
import { analyzePhrase } from '../phraseAnalysis';
import { resolveMode } from '../noteSpelling';
import { buildFretMap, generatePositions } from '../fretboard';
import { MODE_TEMPLATES } from '../../constants';
import type { PhraseConfig, PhraseNote, PhraseContour, GeneratedPhrase, ApproachType, Mode, Position, FretMap } from '../../types';

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

interface TestContext {
  mode: Mode;
  fretMap: FretMap;
  allPos: Position[];
}

function setup(rootName: string, modeIdx: number): TestContext {
  const mode = resolveMode(rootName as any, MODE_TEMPLATES[modeIdx]);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const allPos = generatePositions(fretMap, mode.notes);
  return { mode, fretMap, allPos };
}

function makeConfig(approachTypes: ApproachType[]): PhraseConfig {
  return { approachTypes };
}

// ---------------------------------------------------------------------------
// Problem detectors
// ---------------------------------------------------------------------------

interface PhraseProblems {
  largeLeaps: { beat: number; interval: number; from: string; to: string }[];
  beat78Leap: number | null;  // interval in semitones, null if ≤ 5
  oscillations: { beats: [number, number, number]; note: string }[];
  orphanedApproach: { beat: number; note: string }[];
  strongBeatNonCT: { beat: number; note: string }[];
  approachLeaps: { beat: number; interval: number; from: string; to: string }[];
  rangeSemitones: number;
  stepwisePct: number;
  totalLeapPct: number;
  // Positive quality metrics
  uniquePitchClasses: number;    // distinct pitch classes (0-12)
  scalarRunCount: number;        // runs of 3+ stepwise notes in same direction
  maxScalarRunLength: number;    // longest scalar run
  guideToneStrongBeats: number;  // strong beats (1,3,5,8) with 3rd or 7th
  directionChanges: number;      // melodic direction changes
  ctOutlineRange: number;        // semitone range of strong-beat CTs
  stagnationCount: number;       // segments of 4 notes within 3 semitones
  halfStepResolution: boolean;   // beat 7→8 interval is exactly 1 semitone
  uniqueStrongBeatCTs: number;   // distinct CT names on strong beats (1,3,5,8) — max 4
  arpeggioFragments: number;     // 3+ consecutive CTs with different names
  weakBeatFunctional: number;    // weak beats serving functional role (passing/approach)
  weakBeatTotal: number;         // total weak beats
  thirdsPct: number;             // percentage of intervals that are 3-4 semitones
  fourthsPct: number;            // percentage of intervals that are 5 semitones
  leapPct: number;               // percentage of intervals that are ≥6 semitones
  consecutiveThirdsRuns: number; // 3+ consecutive thirds in same direction
}

function detectProblems(phrase: GeneratedPhrase, mode: Mode): PhraseProblems {
  const notes = phrase.notes;
  const problems: PhraseProblems = {
    largeLeaps: [],
    beat78Leap: null,
    oscillations: [],
    orphanedApproach: [],
    strongBeatNonCT: [],
    approachLeaps: [],
    rangeSemitones: 0,
    stepwisePct: 0,
    totalLeapPct: 0,
    uniquePitchClasses: 0,
    scalarRunCount: 0,
    maxScalarRunLength: 1,
    guideToneStrongBeats: 0,
    directionChanges: 0,
    ctOutlineRange: 0,
    stagnationCount: 0,
    halfStepResolution: false,
    uniqueStrongBeatCTs: 0,
    arpeggioFragments: 0,
    weakBeatFunctional: 0,
    weakBeatTotal: 0,
    thirdsPct: 0,
    fourthsPct: 0,
    leapPct: 0,
    consecutiveThirdsRuns: 0,
  };

  // Pitch values
  const pitches = notes.map(absolutePitch);
  problems.rangeSemitones = Math.max(...pitches) - Math.min(...pitches);

  // Interval analysis
  let stepwise = 0, leaps = 0, thirds = 0, fourths = 0, leapCount = 0, total = 0;
  for (let i = 1; i < notes.length; i++) {
    const interval = Math.abs(pitches[i] - pitches[i - 1]);
    total++;

    if (interval <= 2) stepwise++;
    if (interval >= 3 && interval <= 4) thirds++;
    if (interval === 5) fourths++;
    if (interval >= 6) leapCount++;

    // Large leap detection (≥ 7 semitones = P5)
    if (interval >= 7) {
      problems.largeLeaps.push({
        beat: notes[i].beatPosition,
        interval,
        from: notes[i - 1].noteName,
        to: notes[i].noteName,
      });
      leaps++;
    }

    // Beat 7→8 specific check
    if (notes[i - 1].beatPosition === 7 && notes[i].beatPosition === 8 && interval > 5) {
      problems.beat78Leap = interval;
    }

    // Approach note leap: if current note is in an approach group (role=approach),
    // check if previous note → approach note is smooth
    if (notes[i].approachGroup?.role === 'approach' && notes[i].approachGroup?.positionInGroup === 0) {
      if (interval > 5) {
        problems.approachLeaps.push({
          beat: notes[i].beatPosition,
          interval,
          from: notes[i - 1].noteName,
          to: notes[i].noteName,
        });
      }
    }
  }

  problems.stepwisePct = total > 0 ? Math.round((stepwise / total) * 100) : 0;
  problems.totalLeapPct = total > 0 ? Math.round((leaps / total) * 100) : 0;
  problems.thirdsPct = total > 0 ? Math.round((thirds / total) * 100) : 0;
  problems.fourthsPct = total > 0 ? Math.round((fourths / total) * 100) : 0;
  problems.leapPct = total > 0 ? Math.round((leapCount / total) * 100) : 0;

  // Consecutive thirds runs: count runs of 3+ notes connected by thirds in same direction
  // 3 notes (R→3→5) = 2 same-direction third-intervals = streak of 1 → counts as 1 run
  {
    let streak = 0; // consecutive same-direction third-intervals
    for (let i = 2; i < notes.length; i++) {
      const prevInt = Math.abs(pitches[i - 1] - pitches[i - 2]);
      const curInt = Math.abs(pitches[i] - pitches[i - 1]);
      const prevDir = pitches[i - 1] - pitches[i - 2];
      const curDir = pitches[i] - pitches[i - 1];
      const sameDir = (prevDir > 0 && curDir > 0) || (prevDir < 0 && curDir < 0);
      if (prevInt >= 3 && prevInt <= 4 && curInt >= 3 && curInt <= 4 && sameDir) {
        streak++;
      } else {
        if (streak >= 1) problems.consecutiveThirdsRuns++;
        streak = 0;
      }
    }
    if (streak >= 1) problems.consecutiveThirdsRuns++;
  }

  // Oscillation detection (A→B→A)
  for (let i = 2; i < notes.length; i++) {
    if (pitches[i] === pitches[i - 2] && pitches[i] !== pitches[i - 1]) {
      problems.oscillations.push({
        beats: [notes[i - 2].beatPosition, notes[i - 1].beatPosition, notes[i].beatPosition],
        note: notes[i].noteName,
      });
    }
  }

  // Orphaned approach notes (isApproach but no approachGroup)
  for (const n of notes) {
    if (n.isApproach && !n.approachGroup) {
      problems.orphanedApproach.push({ beat: n.beatPosition, note: n.noteName });
    }
  }

  // Strong beat non-CT (extensions are allowed)
  for (const n of notes) {
    if (n.isStrong && !n.isChordTone && !n.isExtension) {
      problems.strongBeatNonCT.push({ beat: n.beatPosition, note: n.noteName });
    }
  }

  // --- Positive quality metrics ---

  // Unique pitch classes
  problems.uniquePitchClasses = new Set(notes.map(n => n.semitone)).size;

  // Guide tone emphasis on strong beats (3rd and 7th are melodically richer)
  const guideTones = new Set([mode.chordTones[1], mode.chordTones[3]]);
  for (const n of notes) {
    if (n.isStrong && guideTones.has(n.noteName)) problems.guideToneStrongBeats++;
  }

  // Scalar runs: 3+ notes moving stepwise in the same direction
  let runLen = 1;
  let runDir = 0;
  for (let i = 1; i < notes.length; i++) {
    const step = pitches[i] - pitches[i - 1];
    const isStep = Math.abs(step) > 0 && Math.abs(step) <= 2;
    const dir = step > 0 ? 1 : step < 0 ? -1 : 0;
    if (isStep && dir !== 0 && (runDir === 0 || dir === runDir)) {
      runLen++;
      runDir = dir;
    } else {
      if (runLen >= 3) problems.scalarRunCount++;
      problems.maxScalarRunLength = Math.max(problems.maxScalarRunLength, runLen);
      runLen = isStep && dir !== 0 ? 2 : 1;
      runDir = isStep && dir !== 0 ? dir : 0;
    }
  }
  if (runLen >= 3) problems.scalarRunCount++;
  problems.maxScalarRunLength = Math.max(problems.maxScalarRunLength, runLen);

  // Direction changes
  for (let i = 2; i < notes.length; i++) {
    const prev = pitches[i - 1] - pitches[i - 2];
    const cur = pitches[i] - pitches[i - 1];
    if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) problems.directionChanges++;
  }

  // CT outline range: semitone span of chord tones on strong beats (1,3,5,8)
  const strongBeatNotes = notes.filter(n => n.isStrong && n.isChordTone);
  const strongBeatPitches = strongBeatNotes.map(absolutePitch);
  if (strongBeatPitches.length >= 2) {
    problems.ctOutlineRange = Math.max(...strongBeatPitches) - Math.min(...strongBeatPitches);
  }

  // Unique CT/extension names on strong beats (max 4 = R, 3, 5, 7 all different)
  const strongBeatHarmonicNotes = notes.filter(n => n.isStrong && (n.isChordTone || n.isExtension));
  problems.uniqueStrongBeatCTs = new Set(strongBeatHarmonicNotes.map(n => n.noteName)).size;

  // Stagnation: count how many 4-note windows are within 3 semitones
  for (let i = 3; i < notes.length; i++) {
    const window = [pitches[i - 3], pitches[i - 2], pitches[i - 1], pitches[i]];
    const hi = Math.max(...window);
    const lo = Math.min(...window);
    if (hi - lo <= 3) problems.stagnationCount++;
  }

  // Half-step resolution: beat 7→8 interval is exactly 1 semitone
  if (notes.length >= 2) {
    const beat7 = notes.find(n => n.beatPosition === 7);
    const beat8 = notes.find(n => n.beatPosition === 8);
    if (beat7 && beat8) {
      problems.halfStepResolution = Math.abs(absolutePitch(beat7) - absolutePitch(beat8)) === 1;
    }
  }

  // Arpeggio fragments: 3+ consecutive CTs with different names
  for (let i = 2; i < notes.length; i++) {
    if (notes[i].isChordTone && notes[i - 1].isChordTone && notes[i - 2].isChordTone) {
      const names = new Set([notes[i - 2].noteName, notes[i - 1].noteName, notes[i].noteName]);
      if (names.size === 3) problems.arpeggioFragments++;
    }
  }

  // Weak beat functional usage: approach notes, chord tones, or stepwise passing/neighbor
  for (let i = 1; i < notes.length; i++) {
    const n = notes[i];
    if (n.isStrong) continue;
    problems.weakBeatTotal++;
    // Approach note = functional
    if (n.isApproach || n.approachGroup) { problems.weakBeatFunctional++; continue; }
    // Chord tone on weak beat = functional (outlines harmony)
    if (n.isChordTone) { problems.weakBeatFunctional++; continue; }
    // Stepwise from previous note (passing/neighbor tone)
    const stepFromPrev = Math.abs(pitches[i] - pitches[i - 1]);
    if (stepFromPrev <= 2 && stepFromPrev > 0) {
      problems.weakBeatFunctional++;
      continue;
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Aggregate stats
// ---------------------------------------------------------------------------

interface AggregateStats {
  totalPhrases: number;
  phrasesWithLargeLeaps: number;
  phrasesWithBeat78Leap: number;
  phrasesWithOscillation: number;
  phrasesWithOrphanedApproach: number;
  phrasesWithStrongBeatNonCT: number;
  phrasesWithApproachLeaps: number;
  avgStepwisePct: number;
  avgRange: number;
  avgLeapPct: number;
  maxBeat78Leap: number;
  totalOscillations: number;
  totalLargeLeaps: number;
  totalApproachLeaps: number;
  // Positive quality metrics
  avgUniquePitchClasses: number;
  avgScalarRuns: number;
  phrasesWithScalarRun: number;    // phrases with at least one 3+ note scalar run
  avgGuideTonePct: number;         // avg % of strong beats with 3rd or 7th
  avgDirectionChanges: number;
  avgCtOutlineRange: number;       // avg semitone range of strong-beat CTs
  phrasesWithStagnation: number;   // phrases with at least one stagnation window
  phrasesWithHalfStepResolution: number; // phrases where beat 7→8 is exactly 1 semitone
  avgUniqueStrongBeatCTs: number;  // avg distinct CT names on strong beats (ideal: 3-4)
  avgArpeggioFragments: number;    // avg 3+ consecutive CT outlines per phrase
  avgWeakBeatFunctionPct: number;  // avg % of weak beats serving functional role
  avgThirdsPct: number;            // avg % of intervals that are thirds (3-4st)
  avgFourthsPct: number;           // avg % of intervals that are fourths (5st)
  avgLeapPct: number;              // avg % of intervals that are leaps (≥6st)
  avgConsecutiveThirdsRuns: number; // avg runs of 3+ same-direction thirds per phrase
  // Specific problem details (up to 5 worst examples)
  worstBeat78Examples: { interval: number; phrase: string }[];
  worstLeapExamples: { interval: number; beat: number; phrase: string }[];
  worstOscillationExamples: { beats: [number, number, number]; phrase: string }[];
}

function formatPhrase(phrase: GeneratedPhrase): string {
  return phrase.notes.map(n =>
    `${n.beatPosition}:${n.noteName}(${n.isChordTone ? 'CT' : n.isApproach ? 'App' : 'Sc'})`
  ).join(' ');
}

function aggregate(phrases: GeneratedPhrase[], mode: Mode): AggregateStats {
  const stats: AggregateStats = {
    totalPhrases: phrases.length,
    phrasesWithLargeLeaps: 0,
    phrasesWithBeat78Leap: 0,
    phrasesWithOscillation: 0,
    phrasesWithOrphanedApproach: 0,
    phrasesWithStrongBeatNonCT: 0,
    phrasesWithApproachLeaps: 0,
    avgStepwisePct: 0,
    avgRange: 0,
    avgLeapPct: 0,
    maxBeat78Leap: 0,
    totalOscillations: 0,
    totalLargeLeaps: 0,
    totalApproachLeaps: 0,
    avgUniquePitchClasses: 0,
    avgScalarRuns: 0,
    phrasesWithScalarRun: 0,
    avgGuideTonePct: 0,
    avgDirectionChanges: 0,
    avgCtOutlineRange: 0,
    phrasesWithStagnation: 0,
    phrasesWithHalfStepResolution: 0,
    avgUniqueStrongBeatCTs: 0,
    avgArpeggioFragments: 0,
    avgWeakBeatFunctionPct: 0,
    avgThirdsPct: 0,
    avgFourthsPct: 0,
    avgLeapPct: 0,
    avgConsecutiveThirdsRuns: 0,
    worstBeat78Examples: [],
    worstLeapExamples: [],
    worstOscillationExamples: [],
  };

  let sumStep = 0, sumRange = 0, sumLeap = 0;
  let sumPitch = 0, sumRuns = 0, sumGuide = 0, sumDirChanges = 0, sumCtRange = 0, sumUniqueCTs = 0;
  let sumArpFrags = 0, sumWeakFunc = 0, sumWeakTotal = 0;
  let sumThirdsPct = 0, sumFourthsPct = 0, sumLeapPct = 0, sumConsecThirdsRuns = 0;

  for (const phrase of phrases) {
    const p = detectProblems(phrase, mode);

    if (p.largeLeaps.length > 0) {
      stats.phrasesWithLargeLeaps++;
      stats.totalLargeLeaps += p.largeLeaps.length;
      for (const lp of p.largeLeaps) {
        stats.worstLeapExamples.push({
          interval: lp.interval,
          beat: lp.beat,
          phrase: formatPhrase(phrase),
        });
      }
    }

    if (p.beat78Leap !== null) {
      stats.phrasesWithBeat78Leap++;
      stats.maxBeat78Leap = Math.max(stats.maxBeat78Leap, p.beat78Leap);
      stats.worstBeat78Examples.push({
        interval: p.beat78Leap,
        phrase: formatPhrase(phrase),
      });
    }

    if (p.oscillations.length > 0) {
      stats.phrasesWithOscillation++;
      stats.totalOscillations += p.oscillations.length;
      for (const osc of p.oscillations) {
        stats.worstOscillationExamples.push({
          beats: osc.beats,
          phrase: formatPhrase(phrase),
        });
      }
    }

    if (p.orphanedApproach.length > 0) stats.phrasesWithOrphanedApproach++;
    if (p.strongBeatNonCT.length > 0) stats.phrasesWithStrongBeatNonCT++;
    if (p.approachLeaps.length > 0) {
      stats.phrasesWithApproachLeaps++;
      stats.totalApproachLeaps += p.approachLeaps.length;
    }

    sumStep += p.stepwisePct;
    sumRange += p.rangeSemitones;
    sumLeap += p.totalLeapPct;

    // Positive quality metrics
    sumPitch += p.uniquePitchClasses;
    sumRuns += p.scalarRunCount;
    if (p.scalarRunCount > 0) stats.phrasesWithScalarRun++;
    sumGuide += p.guideToneStrongBeats;  // out of 4 strong beats
    sumDirChanges += p.directionChanges;
    sumCtRange += p.ctOutlineRange;
    if (p.stagnationCount > 0) stats.phrasesWithStagnation++;
    if (p.halfStepResolution) stats.phrasesWithHalfStepResolution++;
    sumUniqueCTs += p.uniqueStrongBeatCTs;
    sumArpFrags += p.arpeggioFragments;
    sumWeakFunc += p.weakBeatFunctional;
    sumWeakTotal += p.weakBeatTotal;
    sumThirdsPct += p.thirdsPct;
    sumFourthsPct += p.fourthsPct;
    sumLeapPct += p.leapPct;
    sumConsecThirdsRuns += p.consecutiveThirdsRuns;
  }

  stats.avgStepwisePct = Math.round(sumStep / phrases.length);
  stats.avgRange = Math.round((sumRange / phrases.length) * 10) / 10;
  stats.avgLeapPct = Math.round(sumLeap / phrases.length);
  stats.avgUniquePitchClasses = Math.round((sumPitch / phrases.length) * 10) / 10;
  stats.avgScalarRuns = Math.round((sumRuns / phrases.length) * 10) / 10;
  stats.avgGuideTonePct = Math.round((sumGuide / phrases.length / 4) * 100); // 4 strong beats
  stats.avgDirectionChanges = Math.round((sumDirChanges / phrases.length) * 10) / 10;
  stats.avgCtOutlineRange = Math.round((sumCtRange / phrases.length) * 10) / 10;
  stats.avgUniqueStrongBeatCTs = Math.round((sumUniqueCTs / phrases.length) * 10) / 10;
  stats.avgArpeggioFragments = Math.round((sumArpFrags / phrases.length) * 10) / 10;
  stats.avgWeakBeatFunctionPct = sumWeakTotal > 0 ? Math.round((sumWeakFunc / sumWeakTotal) * 100) : 0;
  stats.avgThirdsPct = Math.round(sumThirdsPct / phrases.length);
  stats.avgFourthsPct = Math.round(sumFourthsPct / phrases.length);
  stats.avgLeapPct = Math.round(sumLeapPct / phrases.length);
  stats.avgConsecutiveThirdsRuns = Math.round((sumConsecThirdsRuns / phrases.length) * 100) / 100;

  // Sort and trim examples
  stats.worstBeat78Examples.sort((a, b) => b.interval - a.interval);
  stats.worstBeat78Examples = stats.worstBeat78Examples.slice(0, 5);
  stats.worstLeapExamples.sort((a, b) => b.interval - a.interval);
  stats.worstLeapExamples = stats.worstLeapExamples.slice(0, 5);
  stats.worstOscillationExamples = stats.worstOscillationExamples.slice(0, 5);

  return stats;
}

// ---------------------------------------------------------------------------
// Report formatter
// ---------------------------------------------------------------------------

function formatReport(label: string, stats: AggregateStats): string {
  const lines: string[] = [];
  lines.push(`\n${'='.repeat(70)}`);
  lines.push(`  ${label}  (N=${stats.totalPhrases})`);
  lines.push(`${'='.repeat(70)}`);
  lines.push(`  Avg stepwise: ${stats.avgStepwisePct}%  |  Avg leap%: ${stats.avgLeapPct}%  |  Avg range: ${stats.avgRange} st`);
  lines.push('');

  const pct = (n: number) => `${n}/${stats.totalPhrases} (${Math.round(n / stats.totalPhrases * 100)}%)`;

  lines.push(`  Large leaps (≥P5):       ${pct(stats.phrasesWithLargeLeaps)}   total: ${stats.totalLargeLeaps}`);
  lines.push(`  Beat 7→8 leap (>5st):    ${pct(stats.phrasesWithBeat78Leap)}   max: ${stats.maxBeat78Leap}st`);
  lines.push(`  Oscillation (A→B→A):     ${pct(stats.phrasesWithOscillation)}   total: ${stats.totalOscillations}`);
  lines.push(`  Approach leaps (>5st):   ${pct(stats.phrasesWithApproachLeaps)}   total: ${stats.totalApproachLeaps}`);
  lines.push(`  Orphaned approach:       ${pct(stats.phrasesWithOrphanedApproach)}`);
  lines.push(`  Strong beat non-CT:      ${pct(stats.phrasesWithStrongBeatNonCT)}`);
  lines.push('');
  lines.push(`  [Quality] Unique pitches: ${stats.avgUniquePitchClasses}  |  Scalar runs: ${stats.avgScalarRuns}  |  Dir changes: ${stats.avgDirectionChanges}`);
  lines.push(`  [Quality] Guide tone %: ${stats.avgGuideTonePct}%  |  Phrases w/ scalar run: ${pct(stats.phrasesWithScalarRun)}`);
  lines.push(`  [Quality] CT outline range: ${stats.avgCtOutlineRange}st  |  Unique strong CTs: ${stats.avgUniqueStrongBeatCTs}  |  Stagnation: ${pct(stats.phrasesWithStagnation)}  |  Half-step res: ${pct(stats.phrasesWithHalfStepResolution)}`);
  lines.push(`  [Quality] Arp fragments: ${stats.avgArpeggioFragments}  |  Weak beat function: ${stats.avgWeakBeatFunctionPct}%`);
  lines.push(`  [Quality] Thirds %: ${stats.avgThirdsPct}%  |  Fourths %: ${stats.avgFourthsPct}%  |  Leaps (≥6st) %: ${stats.avgLeapPct}%  |  Consecutive 3rds runs: ${stats.avgConsecutiveThirdsRuns}`);

  if (stats.worstBeat78Examples.length > 0) {
    lines.push('\n  Worst beat 7→8 examples:');
    for (const ex of stats.worstBeat78Examples) {
      lines.push(`    ${ex.interval}st: ${ex.phrase}`);
    }
  }
  if (stats.worstLeapExamples.length > 0) {
    lines.push('\n  Worst leap examples:');
    for (const ex of stats.worstLeapExamples) {
      lines.push(`    beat ${ex.beat} ${ex.interval}st: ${ex.phrase}`);
    }
  }
  if (stats.worstOscillationExamples.length > 0) {
    lines.push('\n  Oscillation examples:');
    for (const ex of stats.worstOscillationExamples) {
      lines.push(`    beats [${ex.beats}]: ${ex.phrase}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Test suite: Automated Quality Audit
// ---------------------------------------------------------------------------

const N = 5000; // phrases per condition

// Test conditions: key × position × approach type
const CONDITIONS: {
  label: string;
  root: string;
  modeIdx: number;
  posIdx: number;
  approachTypes: ApproachType[];
}[] = [
  // C Ionian Pos3 — reference condition from manual testing
  { label: 'C Ionian Pos3 — Single↓', root: 'C', modeIdx: 0, posIdx: 2, approachTypes: ['single-below'] },
  { label: 'C Ionian Pos3 — Single↑', root: 'C', modeIdx: 0, posIdx: 2, approachTypes: ['single-above'] },
  { label: 'C Ionian Pos3 — Enclosure', root: 'C', modeIdx: 0, posIdx: 2, approachTypes: ['enclosure'] },
  { label: 'C Ionian Pos3 — All approaches', root: 'C', modeIdx: 0, posIdx: 2, approachTypes: ['single-below', 'single-above', 'enclosure'] },
  // Different keys & positions
  { label: 'G Mixolydian Pos1 — Single↓', root: 'G', modeIdx: 4, posIdx: 0, approachTypes: ['single-below'] },
  { label: 'F Dorian Pos5 — Enclosure', root: 'F', modeIdx: 1, posIdx: 4, approachTypes: ['enclosure'] },
  { label: 'B♭ Ionian Pos2 — All approaches', root: 'B♭', modeIdx: 0, posIdx: 1, approachTypes: ['single-below', 'single-above', 'enclosure'] },
  // Parker Enclosure (3-note approach)
  { label: 'C Ionian Pos3 — Parker Enclosure', root: 'C', modeIdx: 0, posIdx: 2, approachTypes: ['parker-enclosure'] },
  // b9 Arpeggio (4-note approach, Dom7 only → Mixolydian)
  { label: 'G Mixolydian Pos1 — b9 Arpeggio', root: 'G', modeIdx: 4, posIdx: 0, approachTypes: ['b9-arpeggio'] },
  // Full: all 5 approach types on Dom7
  { label: 'G Mixolydian Pos1 — All 5 approaches', root: 'G', modeIdx: 4, posIdx: 0, approachTypes: ['single-below', 'single-above', 'enclosure', 'parker-enclosure', 'b9-arpeggio'] },
  // Scale-only (no approach)
  { label: 'C Ionian Pos3 — Scale only', root: 'C', modeIdx: 0, posIdx: 2, approachTypes: [] },

  // --- Jazz-essential mode coverage (WP7-A) ---

  // Locrian (m7♭5 = minor ii)
  { label: 'B Locrian Pos3 — All approaches', root: 'B', modeIdx: 6, posIdx: 2, approachTypes: ['single-below', 'single-above', 'enclosure'] },
  // Aeolian (natural minor = minor i)
  { label: 'A Aeolian Pos4 — All approaches', root: 'A', modeIdx: 5, posIdx: 3, approachTypes: ['single-below', 'single-above', 'enclosure'] },
  // Altered (V7alt)
  { label: 'G Altered Pos2 — All 5 approaches', root: 'G', modeIdx: 13, posIdx: 1, approachTypes: ['single-below', 'single-above', 'enclosure', 'parker-enclosure', 'b9-arpeggio'] },
  // Lydian Dominant (7#11)
  { label: 'C Lydian-Dom Pos1 — All approaches', root: 'C', modeIdx: 10, posIdx: 0, approachTypes: ['single-below', 'single-above', 'enclosure'] },
  // Phrygian Dominant (V7♭9 from Harmonic Minor)
  { label: 'E Phrygian-Dom Pos3 — All 5 approaches', root: 'E', modeIdx: 15, posIdx: 2, approachTypes: ['single-below', 'single-above', 'enclosure', 'parker-enclosure', 'b9-arpeggio'] },
  // Melodic Minor (mMaj7)
  { label: 'A Melodic-Minor Pos2 — All approaches', root: 'A', modeIdx: 7, posIdx: 1, approachTypes: ['single-below', 'single-above', 'enclosure'] },
];

describe('Phrase Quality Audit', () => {
  const allReports: string[] = [];

  for (const cond of CONDITIONS) {
    describe(cond.label, () => {
      let phrases: GeneratedPhrase[];
      let stats: AggregateStats;
      let ctx: TestContext;

      beforeAll(() => {
        ctx = setup(cond.root, cond.modeIdx);
        const pos = ctx.allPos[cond.posIdx];
        const config = makeConfig(cond.approachTypes);
        phrases = [];
        for (let i = 0; i < N; i++) {
          try {
            phrases.push(generatePhrase(pos, ctx.mode, ctx.fretMap, config));
          } catch {
            // Skip failed generations
          }
        }
        stats = aggregate(phrases, ctx.mode);
        allReports.push(formatReport(cond.label, stats));
      });

      it('generates all phrases', () => {
        expect(phrases.length).toBe(N);
      });

      it('no orphaned approach notes', () => {
        expect(stats.phrasesWithOrphanedApproach).toBe(0);
      });

      it('no strong-beat non-CT', () => {
        expect(stats.phrasesWithStrongBeatNonCT).toBe(0);
      });

      it('stepwise motion ≥ 40%', () => {
        expect(stats.avgStepwisePct).toBeGreaterThanOrEqual(40);
      });

      it('large leaps (≥P5) in ≤ 46% of phrases', () => {
        const pct = stats.phrasesWithLargeLeaps / N;
        expect(pct).toBeLessThanOrEqual(0.46);
      });

      it('beat 7→8 leap (>5st) in < 25% of phrases', () => {
        const pct = stats.phrasesWithBeat78Leap / N;
        expect(pct).toBeLessThan(0.25);
      });

      it('oscillation in < 50% of phrases', () => {
        const pct = stats.phrasesWithOscillation / N;
        expect(pct).toBeLessThan(0.50);
      });

      it('approach leaps (>5st) in < 15% of phrases', () => {
        const pct = stats.phrasesWithApproachLeaps / N;
        expect(pct).toBeLessThan(0.15);
      });

      it('average range ≤ 14 semitones', () => {
        expect(stats.avgRange).toBeLessThanOrEqual(14);
      });

      // --- Positive quality assertions ---

      it('average unique pitch classes ≥ 5', () => {
        expect(stats.avgUniquePitchClasses).toBeGreaterThanOrEqual(5);
      });

      it('at least 25% of phrases have a scalar run', () => {
        const pct = stats.phrasesWithScalarRun / N;
        expect(pct).toBeGreaterThanOrEqual(0.25);
      });

      it('guide tone emphasis ≥ 32%', () => {
        expect(stats.avgGuideTonePct).toBeGreaterThanOrEqual(32);
      });

      it('average CT outline range ≥ 5 semitones', () => {
        expect(stats.avgCtOutlineRange).toBeGreaterThanOrEqual(5);
      });

      it('stagnation in ≤ 50% of phrases', () => {
        const pct = stats.phrasesWithStagnation / N;
        expect(pct).toBeLessThanOrEqual(0.50);
      });

      it('half-step resolution in ≥ 12% of phrases', () => {
        const pct = stats.phrasesWithHalfStepResolution / N;
        expect(pct).toBeGreaterThanOrEqual(0.12);
      });

      it('average unique strong-beat CTs ≥ 2.8', () => {
        expect(stats.avgUniqueStrongBeatCTs).toBeGreaterThanOrEqual(2.8);
      });

      it('arpeggio fragments ≥ 0.3 per phrase', () => {
        expect(stats.avgArpeggioFragments).toBeGreaterThanOrEqual(0.3);
      });

      it('weak beat functional usage ≥ 60%', () => {
        expect(stats.avgWeakBeatFunctionPct).toBeGreaterThanOrEqual(60);
      });

      it('thirds interval percentage 14-32%', () => {
        expect(stats.avgThirdsPct).toBeGreaterThanOrEqual(14);
        // Modes with augmented 2nds (Phrygian-Dom) inherently produce 3st intervals
        expect(stats.avgThirdsPct).toBeLessThanOrEqual(32);
      });

      it('fourths interval percentage 5-22%', () => {
        expect(stats.avgFourthsPct).toBeGreaterThanOrEqual(5);
        expect(stats.avgFourthsPct).toBeLessThanOrEqual(22);
      });

      it('leaps (≥6st) percentage ≤ 18%', () => {
        expect(stats.avgLeapPct).toBeLessThanOrEqual(18);
      });

      it('consecutive thirds runs ≥ 0.08 per phrase', () => {
        expect(stats.avgConsecutiveThirdsRuns).toBeGreaterThanOrEqual(0.08);
      });

      // Print report after all conditions
      it('prints report', () => {
        console.log(formatReport(cond.label, stats));
      });
    });
  }
});

// ---------------------------------------------------------------------------
// WP7-B: Progression context tests (multi-chord chain generation)
// ---------------------------------------------------------------------------

import { getGuideTones } from '../guideTones';

interface ProgressionStep {
  root: string;
  modeIdx: number;
  posIdx: number;
}

interface ChainStats {
  totalSets: number;
  goalResolutionCount: number;       // beat 8 within 1 semitone of next 3rd
  chainIntervalSum: number;         // sum of beat8→beat1 intervals
  chainIntervalCount: number;
  chainIntervalWithin3: number;     // beat8→beat1 intervals ≤ 3 semitones
  voiceLeadingResolutions: number;  // 7th→3rd half-step resolutions
  voiceLeadingOpportunities: number;
  qualityDefiningSum: number;       // 3rd+7th presence ratio sum
  characteristicToneCount: number;  // phrases with characteristic tone
  totalPhrases: number;
}

function computeChainStats(
  steps: ProgressionStep[],
  sets: number,
  approachTypes: ApproachType[],
): ChainStats {
  const stats: ChainStats = {
    totalSets: sets,
    goalResolutionCount: 0,
    chainIntervalSum: 0,
    chainIntervalCount: 0,
    chainIntervalWithin3: 0,
    voiceLeadingResolutions: 0,
    voiceLeadingOpportunities: 0,
    qualityDefiningSum: 0,
    characteristicToneCount: 0,
    totalPhrases: 0,
  };

  // Pre-resolve all modes
  const contexts = steps.map(s => {
    const m = resolveMode(s.root as any, MODE_TEMPLATES[s.modeIdx]);
    const fm = buildFretMap(m.semi, m.notes);
    const positions = generatePositions(fm, m.notes);
    return { mode: m, fretMap: fm, pos: positions[s.posIdx], guideTones: getGuideTones(m) };
  });

  for (let set = 0; set < sets; set++) {
    let prevLastNote: PhraseNote | undefined;
    let prevContour: PhraseContour | undefined;

    for (let si = 0; si < steps.length; si++) {
      const ctx = contexts[si];
      const nextCtx = contexts[(si + 1) % steps.length];

      const config: PhraseConfig = {
        approachTypes,
        startHint: prevLastNote ? {
          noteName: prevLastNote.noteName,
          stringIdx: prevLastNote.stringIdx,
          fret: prevLastNote.fret,
          semitone: prevLastNote.semitone,
        } : undefined,
        prevContour,
        nextChordContext: {
          thirdNote: nextCtx.guideTones.third,
          seventhNote: nextCtx.guideTones.seventh,
          rootNote: nextCtx.mode.notes[0],
          quality: nextCtx.mode.chordQuality,
        },
      };

      try {
        const phrase = generatePhrase(ctx.pos, ctx.mode, ctx.fretMap, config, nextCtx.guideTones.third);
        stats.totalPhrases++;

        // Goal resolution: beat 8 within 1 semitone of next 3rd
        const lastNote = phrase.notes[phrase.notes.length - 1];
        const nextThirdSemi = nextCtx.mode.semi[nextCtx.mode.notes.indexOf(nextCtx.guideTones.third)];
        if (nextThirdSemi !== undefined) {
          const dist = Math.min(
            Math.abs(lastNote.semitone - nextThirdSemi),
            12 - Math.abs(lastNote.semitone - nextThirdSemi),
          );
          if (dist <= 1) stats.goalResolutionCount++;
        }

        // Chain interval: previous beat8 → current beat1
        if (prevLastNote) {
          const firstNote = phrase.notes[0];
          const interval = Math.abs(absolutePitch(firstNote) - absolutePitch(prevLastNote));
          stats.chainIntervalSum += interval;
          stats.chainIntervalCount++;
          if (interval <= 3) stats.chainIntervalWithin3++;
        }

        // Voice leading: current 7th resolving to next 3rd by half step
        if (si < steps.length - 1) {
          stats.voiceLeadingOpportunities++;
          const seventh = ctx.mode.chordTones[3];
          const seventhSemi = ctx.mode.semi[ctx.mode.notes.indexOf(seventh)];
          if (seventhSemi !== undefined && nextThirdSemi !== undefined) {
            const vlDist = Math.min(
              Math.abs(seventhSemi - nextThirdSemi),
              12 - Math.abs(seventhSemi - nextThirdSemi),
            );
            if (vlDist === 1 && lastNote.noteName === seventh) {
              stats.voiceLeadingResolutions++;
            }
          }
        }

        // Quality-defining presence: 3rd + 7th in phrase
        const third = ctx.mode.chordTones[1];
        const seventh = ctx.mode.chordTones[3];
        const qualBeats = phrase.notes.filter(n => n.noteName === third || n.noteName === seventh).length;
        stats.qualityDefiningSum += qualBeats / phrase.notes.length;

        prevLastNote = phrase.notes[phrase.notes.length - 1];
        prevContour = phrase.config.contour;
      } catch {
        prevLastNote = undefined;
        prevContour = undefined;
      }
    }
  }

  return stats;
}

const CHAIN_N = 1000;

const PROGRESSIONS: { label: string; steps: ProgressionStep[]; approachTypes: ApproachType[] }[] = [
  {
    label: 'Major ii-V-I (C)',
    steps: [
      { root: 'D', modeIdx: 1, posIdx: 2 },  // Dm7 (Dorian)
      { root: 'G', modeIdx: 4, posIdx: 2 },  // G7 (Mixolydian)
      { root: 'C', modeIdx: 0, posIdx: 2 },  // Cmaj7 (Ionian)
    ],
    approachTypes: ['single-below', 'single-above', 'enclosure'],
  },
  {
    label: 'Minor ii-V-i (A)',
    steps: [
      { root: 'B', modeIdx: 6, posIdx: 1 },  // Bm7♭5 (Locrian)
      { root: 'E', modeIdx: 15, posIdx: 1 },  // E7♭9 (Phrygian-Dom)
      { root: 'A', modeIdx: 5, posIdx: 1 },  // Am7 (Aeolian)
    ],
    approachTypes: ['single-below', 'single-above', 'enclosure'],
  },
  {
    label: 'Blues turnaround (B♭)',
    steps: [
      { root: 'B♭', modeIdx: 4, posIdx: 1 }, // B♭7
      { root: 'E♭', modeIdx: 4, posIdx: 1 }, // E♭7
      { root: 'B♭', modeIdx: 4, posIdx: 1 }, // B♭7
      { root: 'F', modeIdx: 4, posIdx: 1 },  // F7
    ],
    approachTypes: ['single-below', 'single-above', 'enclosure', 'parker-enclosure'],
  },
];

describe('Progression Context Quality', () => {
  for (const prog of PROGRESSIONS) {
    describe(prog.label, () => {
      let stats: ChainStats;

      beforeAll(() => {
        stats = computeChainStats(prog.steps, CHAIN_N, prog.approachTypes);
      });

      it('generates all phrases', () => {
        expect(stats.totalPhrases).toBe(CHAIN_N * prog.steps.length);
      });

      it('goal resolution accuracy ≥ 35%', () => {
        const pct = stats.goalResolutionCount / stats.totalPhrases;
        expect(pct).toBeGreaterThanOrEqual(0.35);
      });

      it('average chain interval ≤ 5.5 semitones', () => {
        const avg = stats.chainIntervalCount > 0
          ? stats.chainIntervalSum / stats.chainIntervalCount : 0;
        expect(avg).toBeLessThanOrEqual(5.5);
      });

      it('chain interval within 3 semitones ≥ 60%', () => {
        const pct = stats.chainIntervalCount > 0
          ? stats.chainIntervalWithin3 / stats.chainIntervalCount : 0;
        expect(pct).toBeGreaterThanOrEqual(0.60);
      });

      it('quality-defining tone presence ≥ 35%', () => {
        const avg = stats.qualityDefiningSum / stats.totalPhrases;
        expect(avg).toBeGreaterThanOrEqual(0.35);
      });

      it('prints chain stats', () => {
        const goalPct = Math.round((stats.goalResolutionCount / stats.totalPhrases) * 100);
        const avgChain = stats.chainIntervalCount > 0
          ? Math.round((stats.chainIntervalSum / stats.chainIntervalCount) * 10) / 10 : 0;
        const within3Pct = stats.chainIntervalCount > 0
          ? Math.round((stats.chainIntervalWithin3 / stats.chainIntervalCount) * 100) : 0;
        const vlPct = stats.voiceLeadingOpportunities > 0
          ? Math.round((stats.voiceLeadingResolutions / stats.voiceLeadingOpportunities) * 100) : 0;
        const qualPct = Math.round((stats.qualityDefiningSum / stats.totalPhrases) * 100);
        console.log(`\n  [Chain] ${prog.label}: goal=${goalPct}% chain=${avgChain}st ≤3st=${within3Pct}% VL=${vlPct}% qual=${qualPct}%`);
      });
    });
  }
});
