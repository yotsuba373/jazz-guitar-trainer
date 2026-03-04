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
import type { PhraseConfig, GeneratedPhrase, ApproachType, Mode, Position, FretMap } from '../../types';

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
  return {
    source: approachTypes.length > 0 ? 'both' : 'scale',
    approachTypes,
  };
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
  };

  // Pitch values
  const pitches = notes.map(absolutePitch);
  problems.rangeSemitones = Math.max(...pitches) - Math.min(...pitches);

  // Interval analysis
  let stepwise = 0, leaps = 0, total = 0;
  for (let i = 1; i < notes.length; i++) {
    const interval = Math.abs(pitches[i] - pitches[i - 1]);
    total++;

    if (interval <= 2) stepwise++;

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

  // Strong beat non-CT
  for (const n of notes) {
    if (n.isStrong && !n.isChordTone) {
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

  // Unique CT names on strong beats (max 4 = R, 3, 5, 7 all different)
  problems.uniqueStrongBeatCTs = new Set(strongBeatNotes.map(n => n.noteName)).size;

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
    worstBeat78Examples: [],
    worstLeapExamples: [],
    worstOscillationExamples: [],
  };

  let sumStep = 0, sumRange = 0, sumLeap = 0;
  let sumPitch = 0, sumRuns = 0, sumGuide = 0, sumDirChanges = 0, sumCtRange = 0, sumUniqueCTs = 0;

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

const N = 50; // phrases per condition

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
  // Scale-only (no approach)
  { label: 'C Ionian Pos3 — Scale only', root: 'C', modeIdx: 0, posIdx: 2, approachTypes: [] },
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

      it('stepwise motion ≥ 35%', () => {
        expect(stats.avgStepwisePct).toBeGreaterThanOrEqual(35);
      });

      it('large leaps (≥P5) in ≤ 50% of phrases', () => {
        const pct = stats.phrasesWithLargeLeaps / N;
        expect(pct).toBeLessThanOrEqual(0.5);
      });

      it('beat 7→8 leap (>5st) in < 25% of phrases', () => {
        const pct = stats.phrasesWithBeat78Leap / N;
        expect(pct).toBeLessThan(0.25);
      });

      it('oscillation in < 65% of phrases', () => {
        // 4 CTs in compact positions + 3 strong beats requiring CTs = some oscillation unavoidable
        const pct = stats.phrasesWithOscillation / N;
        expect(pct).toBeLessThan(0.65);
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
        // Good bebop lines use variety; 5+ of 12 pitch classes in 8 notes
        expect(stats.avgUniquePitchClasses).toBeGreaterThanOrEqual(5);
      });

      it('at least 20% of phrases have a scalar run', () => {
        // Parker-style lines often include 3+ note stepwise runs
        const pct = stats.phrasesWithScalarRun / N;
        expect(pct).toBeGreaterThanOrEqual(0.2);
      });

      it('guide tone emphasis ≥ 20%', () => {
        // 3rd and 7th should appear on strong beats at least sometimes
        expect(stats.avgGuideTonePct).toBeGreaterThanOrEqual(20);
      });

      it('average CT outline range ≥ 4 semitones', () => {
        // Strong-beat CTs should span at least a major 3rd (audible chord outline)
        expect(stats.avgCtOutlineRange).toBeGreaterThanOrEqual(4);
      });

      it('stagnation in ≤ 60% of phrases', () => {
        // Approach patterns inherently use narrow ranges (chromatic neighbors),
        // so some stagnation is structural; ensure it doesn't dominate
        const pct = stats.phrasesWithStagnation / N;
        expect(pct).toBeLessThanOrEqual(0.6);
      });

      it('half-step resolution in ≥ 10% of phrases', () => {
        // Some phrases should resolve beat 7→8 via chromatic approach
        const pct = stats.phrasesWithHalfStepResolution / N;
        expect(pct).toBeGreaterThanOrEqual(0.1);
      });

      it('average unique strong-beat CTs ≥ 2.5', () => {
        // Skeleton planning should produce diverse CT outlines (not just repeating 2 CTs)
        expect(stats.avgUniqueStrongBeatCTs).toBeGreaterThanOrEqual(2.5);
      });

      // Print report after all conditions
      it('prints report', () => {
        console.log(formatReport(cond.label, stats));
      });
    });
  }
});
