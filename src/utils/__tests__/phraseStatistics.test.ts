/**
 * phraseStatistics.test.ts
 *
 * Detailed statistical report for the rule-based bebop phrase generator.
 * Same generation logic as phraseQualityAudit.test.ts but outputs
 * trial counts, rates, margins, and distributions.
 *
 * Run: npx vitest run src/utils/__tests__/phraseStatistics.test.ts
 */
import { describe, it } from 'vitest';
import { generatePhraseRule } from '../bebopGenerator';
import { buildFretMap, generatePositions, generateDimPositions, resolveMode } from '../../utils';
import { MODE_TEMPLATES } from '../../constants';
import { absolutePitch } from '../phraseGenerator';
import { RHYTHM_BEATS } from '../bebopScheduler';
import { MODE_TO_BEBOP, getBebopPassingTone } from '../../constants/bebopScales';
import type { PhraseConfig, RootName, GeneratedPhrase, Mode } from '../../types';

// ===========================================================================
// Helpers (same as audit)
// ===========================================================================

function buildFixtures(rootName: RootName, modeKey: string) {
  const template = MODE_TEMPLATES.find(t => t.key === modeKey)!;
  const mode = resolveMode(rootName, template);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const positions = modeKey.startsWith('dim-')
    ? generateDimPositions(fretMap, mode.notes)
    : generatePositions(fretMap, mode.notes);
  return { mode, fretMap, positions };
}

interface BatchResult {
  phrase: GeneratedPhrase;
  mode: Mode;
  posIdx: number;
  beatCount: number;
}

function generateBatch(
  configs: { rootName: RootName; modeKey: string }[],
  nPerConfig: number,
  beatCounts: (2 | 3 | 4)[] = [2, 3, 4],
): { results: BatchResult[]; attempted: number } {
  const results: BatchResult[] = [];
  let attempted = 0;
  for (const { rootName, modeKey } of configs) {
    const { mode, fretMap, positions } = buildFixtures(rootName, modeKey);
    for (let pi = 0; pi < positions.length; pi++) {
      for (const bc of beatCounts) {
        const config: PhraseConfig = { approachTypes: [], beatCount: bc };
        for (let i = 0; i < nPerConfig; i++) {
          attempted++;
          const phrase = generatePhraseRule(positions[pi], mode, fretMap, config);
          if (phrase) results.push({ phrase, mode, posIdx: pi, beatCount: bc });
        }
      }
    }
  }
  return { results, attempted };
}

// ---------------------------------------------------------------------------

const PRIMARY_CONFIGS: { rootName: RootName; modeKey: string }[] = [
  { rootName: 'C', modeKey: 'mixolydian' },
  { rootName: 'F', modeKey: 'mixolydian' },
  { rootName: 'B♭', modeKey: 'mixolydian' },
  { rootName: 'C', modeKey: 'ionian' },
  { rootName: 'G', modeKey: 'ionian' },
  { rootName: 'D', modeKey: 'dorian' },
  { rootName: 'A', modeKey: 'dorian' },
  { rootName: 'B', modeKey: 'locrian' },
  { rootName: 'A', modeKey: 'harmonic-minor' },
];

const DOM7_CONFIGS: { rootName: RootName; modeKey: string }[] = [
  { rootName: 'C', modeKey: 'mixolydian' },
  { rootName: 'F', modeKey: 'mixolydian' },
  { rootName: 'B♭', modeKey: 'mixolydian' },
];

const ALL_MODE_CONFIGS: { rootName: RootName; modeKey: string }[] = [
  { rootName: 'C', modeKey: 'ionian' },
  { rootName: 'D', modeKey: 'dorian' },
  { rootName: 'E', modeKey: 'phrygian' },
  { rootName: 'F', modeKey: 'lydian' },
  { rootName: 'G', modeKey: 'mixolydian' },
  { rootName: 'A', modeKey: 'aeolian' },
  { rootName: 'B', modeKey: 'locrian' },
  { rootName: 'C', modeKey: 'melodic-minor' },
  { rootName: 'D', modeKey: 'dorian-b2' },
  { rootName: 'C', modeKey: 'lydian-aug' },
  { rootName: 'F', modeKey: 'lydian-dom' },
  { rootName: 'C', modeKey: 'mixolydian-b6' },
  { rootName: 'C', modeKey: 'locrian-s2' },
  { rootName: 'G', modeKey: 'altered' },
  { rootName: 'A', modeKey: 'harmonic-minor' },
  { rootName: 'E', modeKey: 'phrygian-dom' },
  { rootName: 'C', modeKey: 'dim-wh' },
  { rootName: 'C', modeKey: 'dim-hw' },
];

const BEBOP_MODES = Object.keys(MODE_TO_BEBOP);

// ===========================================================================
// Formatting helpers
// ===========================================================================

function pct(n: number, total: number): string {
  if (total === 0) return '  N/A  ';
  return `${(n / total * 100).toFixed(1).padStart(5)}%`;
}

function bar(rate: number, width = 30): string {
  const filled = Math.round(rate * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function printRow(label: string, value: number, total: number, threshold?: number) {
  const rate = total > 0 ? value / total : 0;
  const threshStr = threshold != null ? ` (threshold: ${(threshold * 100).toFixed(0)}%)` : '';
  const margin = threshold != null && total > 0
    ? ` margin: ${rate >= threshold ? '+' : ''}${((rate - threshold) * 100).toFixed(1)}%`
    : '';
  const status = threshold != null ? (rate >= threshold ? ' PASS' : ' FAIL') : '';
  console.log(`  ${label.padEnd(40)} ${String(value).padStart(5)}/${String(total).padStart(5)} = ${pct(value, total)} ${bar(rate)}${threshStr}${margin}${status}`);
}

// ===========================================================================
// MAIN REPORT
// ===========================================================================

describe('Rule-based engine statistics report', () => {
  it('generates detailed statistics', () => {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║            RULE-BASED PHRASE GENERATOR — DETAILED STATISTICS REPORT             ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════════╝');

    // =====================================================================
    // 1. Overall success rate
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 1. OVERALL SUCCESS RATE                                                         │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const { results: primary, attempted: primaryAttempted } = generateBatch(PRIMARY_CONFIGS, 10);
    printRow('Overall (PRIMARY_CONFIGS, n=10/combo)', primary.length, primaryAttempted);

    for (const bc of [2, 3, 4] as const) {
      const sub = primary.filter(r => r.beatCount === bc);
      // approximate attempted count
      const attPerBc = Math.round(primaryAttempted / 3);
      printRow(`  beatCount=${bc}`, sub.length, attPerBc);
    }

    // =====================================================================
    // 2. §1 Beat position: CT on strong beats
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 2. §1 BEAT POSITION — CT ON STRONG BEATS                                       │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    for (const bc of [2, 3, 4] as const) {
      const subset = primary.filter(r => r.beatCount === bc);
      let strongTotal = 0, strongCT = 0, strongGT = 0;
      let phrasesWithGT = 0;
      for (const { phrase, mode } of subset) {
        const ctSet = new Set(mode.chordTones);
        const gtNames = new Set<string>();
        if (mode.chordTones.length >= 2) gtNames.add(mode.chordTones[1]);
        if (mode.chordTones.length >= 4) gtNames.add(mode.chordTones[3]);
        let hasGT = false;
        for (const n of phrase.notes) {
          if (n.isStrong) {
            strongTotal++;
            if (n.isChordTone || ctSet.has(n.noteName)) strongCT++;
            if (gtNames.has(n.noteName)) { strongGT++; hasGT = true; }
          }
        }
        if (hasGT) phrasesWithGT++;
      }
      const ctThreshold = bc === 2 ? 0.30 : 0.38;
      const gtThreshold = bc === 2 ? 0.25 : 0.60;
      printRow(`beatCount=${bc}: CT on strong beats`, strongCT, strongTotal, ctThreshold);
      printRow(`beatCount=${bc}: GT on strong beats (note-level)`, strongGT, strongTotal);
      printRow(`beatCount=${bc}: phrases with GT on strong beat`, phrasesWithGT, subset.length, gtThreshold);
    }

    // =====================================================================
    // 3. §2 Bebop scale: passing tone check
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 3. §2 BEBOP SCALE — PASSING TONE ON STRONG BEATS                               │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const bebopConfigs: { rootName: RootName; modeKey: string }[] = [];
    const keyPairs: Record<string, RootName[]> = {
      'mixolydian': ['C', 'F'], 'ionian': ['C', 'G'], 'dorian': ['D', 'A'],
      'aeolian': ['A', 'E'], 'lydian': ['F', 'B♭'], 'phrygian': ['E', 'B'],
      'locrian': ['B', 'G♭'], 'lydian-dom': ['F', 'B♭'], 'altered': ['G', 'D♭'],
      'harmonic-minor': ['A', 'D'], 'phrygian-dom': ['E', 'A'],
    };
    for (const [modeKey, keys] of Object.entries(keyPairs)) {
      for (const k of keys) bebopConfigs.push({ rootName: k, modeKey });
    }
    const { results: bebopBatch } = generateBatch(bebopConfigs, 5);
    let passingTotal = 0, passingOnStrong = 0;
    for (const { phrase } of bebopBatch) {
      for (const n of phrase.notes) {
        if (n.isBebopPassing) {
          passingTotal++;
          if (n.isStrong) passingOnStrong++;
        }
      }
    }
    printRow('Passing tone on strong beat (violation)', passingOnStrong, passingTotal, undefined);
    console.log(`  → violation rate: ${pct(passingOnStrong, passingTotal)} (should be <= 35%)`);

    // Scale run descending
    const { results: scaleRunBatch } = generateBatch(PRIMARY_CONFIGS, 10);
    const scaleDown = scaleRunBatch.filter(r =>
      r.phrase.templateId?.includes('scale-down') || r.phrase.templateId === 'scale-down'
    );
    let descPairs = 0, totalPairs = 0;
    for (const { phrase } of scaleDown) {
      for (let i = 1; i < phrase.notes.length; i++) {
        if (phrase.notes[i].segmentIdx === phrase.notes[i - 1].segmentIdx) {
          const prev = absolutePitch(phrase.notes[i - 1]);
          const cur = absolutePitch(phrase.notes[i]);
          if (prev !== cur) { totalPairs++; if (cur < prev) descPairs++; }
        }
      }
    }
    printRow('Scale run: descending pairs', descPairs, totalPairs, 0.55);

    // =====================================================================
    // 4. §3 Approach direction (dom7)
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 4. §3 APPROACH DIRECTION (dom7)                                                 │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const { results: dom7Batch } = generateBatch(DOM7_CONFIGS, 5);
    let diaAbove = 0, chromAbove = 0, diaBelow = 0, chromBelow = 0, otherApproach = 0;
    for (const { phrase, mode } of dom7Batch) {
      const ctSet = new Set(mode.chordTones);
      const scaleSemis = new Set(mode.semi);
      for (let i = 0; i < phrase.notes.length - 1; i++) {
        const cur = phrase.notes[i];
        const next = phrase.notes[i + 1];
        if (!ctSet.has(cur.noteName) && ctSet.has(next.noteName)) {
          const diff = ((cur.semitone - next.semitone) + 12) % 12;
          const isDia = scaleSemis.has(cur.semitone);
          if (diff >= 1 && diff <= 3) {
            // above
            if (diff === 1 && !isDia) chromAbove++;
            else if (isDia) diaAbove++;
            else otherApproach++;
          } else if (diff >= 9 && diff <= 11) {
            // below
            if ((12 - diff) === 1 && !isDia) chromBelow++;
            else if (isDia) diaBelow++;
            else otherApproach++;
          } else {
            otherApproach++;
          }
        }
      }
    }
    const totalApproach = diaAbove + chromAbove + diaBelow + chromBelow + otherApproach;
    printRow('Diatonic from above', diaAbove, totalApproach);
    printRow('Chromatic from above', chromAbove, totalApproach);
    printRow('Diatonic from below', diaBelow, totalApproach);
    printRow('Chromatic from below', chromBelow, totalApproach);
    printRow('Other approach', otherApproach, totalApproach);
    console.log(`  → dia-above >= chrom-above? ${diaAbove >= chromAbove ? 'YES' : 'NO'} (${diaAbove} vs ${chromAbove})`);

    // =====================================================================
    // 5. §4 Enclosure
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 5. §4 ENCLOSURE TYPES & DELAYED RESOLUTION                                     │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const enclConfigs = [
      ...DOM7_CONFIGS,
      { rootName: 'C' as RootName, modeKey: 'ionian' },
      { rootName: 'D' as RootName, modeKey: 'dorian' },
    ];
    const { results: enclBatch } = generateBatch(enclConfigs, 5);
    const enclPhrases = enclBatch.filter(r => r.phrase.templateId?.startsWith('encl-'));
    let mixedEncl = 0, diaEncl = 0, chromEncl = 0, otherEncl = 0, totalEncl = 0;
    let offBeatTargets = 0;
    for (const { phrase, mode } of enclPhrases) {
      const seg0 = phrase.notes.filter(n => n.segmentIdx === 0);
      if (seg0.length < 3) continue;
      totalEncl++;
      const last3 = seg0.slice(-3);
      const scaleSemis = new Set(mode.semi);
      const aboveIsDia = scaleSemis.has(last3[0].semitone);
      const belowIsDia = scaleSemis.has(last3[1].semitone);
      if (aboveIsDia && !belowIsDia) mixedEncl++;
      else if (aboveIsDia && belowIsDia) diaEncl++;
      else if (!aboveIsDia && !belowIsDia) chromEncl++;
      else otherEncl++;
      if (!seg0[seg0.length - 1].isStrong) offBeatTargets++;
    }
    console.log(`  Enclosure phrases found: ${enclPhrases.length} / ${enclBatch.length} total`);
    printRow('Mixed (dia+chrom)', mixedEncl, totalEncl, 0.25);
    printRow('Diatonic', diaEncl, totalEncl);
    printRow('Chromatic', chromEncl, totalEncl);
    printRow('Other', otherEncl, totalEncl);
    printRow('Delayed Resolution (off-beat target)', offBeatTargets, totalEncl);
    console.log(`  → Delayed Resolution rate: ${pct(offBeatTargets, totalEncl)} (target: 10-50%)`);

    // =====================================================================
    // 6. §5 Template distribution
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 6. §5 TEMPLATE DISTRIBUTION                                                    │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const templateCounts = new Map<string, number>();
    for (const { phrase } of primary) {
      const id = phrase.templateId ?? 'unknown';
      templateCounts.set(id, (templateCounts.get(id) ?? 0) + 1);
    }
    const sorted = [...templateCounts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  Total generated: ${primary.length}`);
    console.log('');
    for (const [id, count] of sorted) {
      printRow(id, count, primary.length);
    }

    // Per beat count
    for (const bc of [2, 3, 4] as const) {
      console.log(`\n  --- beatCount=${bc} ---`);
      const sub = primary.filter(r => r.beatCount === bc);
      const subCounts = new Map<string, number>();
      for (const { phrase } of sub) {
        const id = phrase.templateId ?? 'unknown';
        subCounts.set(id, (subCounts.get(id) ?? 0) + 1);
      }
      const subSorted = [...subCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [id, count] of subSorted) {
        printRow(id, count, sub.length);
      }
    }

    // =====================================================================
    // 7. §6 Start / End
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 7. §6 START / END RULES                                                        │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    for (const bc of [2, 3, 4] as const) {
      const subset = primary.filter(r => r.beatCount === bc);
      if (subset.length < 5) continue;
      const upbeats = subset.filter(r => {
        const bs = r.phrase.notes[0].beatStart;
        return bs !== undefined && Math.abs(bs! - Math.round(bs!)) > 0.05;
      });
      let ctEnd = 0;
      for (const { phrase } of subset) {
        if (phrase.notes[phrase.notes.length - 1].isChordTone) ctEnd++;
      }
      const ctThreshold = bc === 2 ? 0.40 : 0.50;
      printRow(`beatCount=${bc}: upbeat start`, upbeats.length, subset.length);
      printRow(`beatCount=${bc}: CT ending`, ctEnd, subset.length, ctThreshold);
    }

    // Forward motion
    let upAll = 0, downAll = 0;
    for (const { phrase } of primary) {
      const bs = phrase.notes[0].beatStart;
      if (bs !== undefined && Math.abs(bs! - Math.round(bs!)) > 0.05) upAll++;
      else downAll++;
    }
    console.log(`\n  Forward motion ratio: ${upAll}up / ${downAll}down = ${downAll > 0 ? (upAll / downAll).toFixed(2) : 'inf'} (threshold: >= 1.3)`);

    // Start note distribution
    const startNotes = new Map<string, number>();
    for (const { phrase } of primary) {
      const n = phrase.notes[0].noteName;
      startNotes.set(n, (startNotes.get(n) ?? 0) + 1);
    }
    console.log('\n  Start note distribution:');
    const startSorted = [...startNotes.entries()].sort((a, b) => b[1] - a[1]);
    for (const [note, count] of startSorted) {
      printRow(`  ${note}`, count, primary.length);
    }

    // =====================================================================
    // 8. §7 Voice leading
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 8. §7 VOICE LEADING — 7th→3rd RESOLUTION                                       │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const vlScenarios = [
      { rootName: 'G' as RootName, modeKey: 'mixolydian',
        nextChordContext: { thirdNote: 'E', seventhNote: 'B', rootNote: 'C', quality: 'maj7' as const },
        label: 'G7 → Cmaj7' },
      { rootName: 'D' as RootName, modeKey: 'dorian',
        nextChordContext: { thirdNote: 'B', seventhNote: 'F', rootNote: 'G', quality: '7' as const },
        label: 'Dm7 → G7' },
    ];
    for (const { rootName, modeKey, nextChordContext, label } of vlScenarios) {
      const { mode, fretMap, positions } = buildFixtures(rootName, modeKey);
      let resolved = 0, total = 0;
      for (const pi of [0, 2, 4]) {
        if (pi >= positions.length) continue;
        for (const bc of [3, 4] as const) {
          for (let i = 0; i < 20; i++) {
            const config: PhraseConfig = { approachTypes: [], beatCount: bc, nextChordContext };
            const phrase = generatePhraseRule(positions[pi], mode, fretMap, config);
            if (!phrase) continue;
            total++;
            const last = phrase.notes[phrase.notes.length - 1];
            if (last.noteName === nextChordContext.thirdNote) resolved++;
            else {
              const diff = Math.min(
                Math.abs(last.semitone - (['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'].indexOf(nextChordContext.thirdNote))),
                12 - Math.abs(last.semitone - (['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'].indexOf(nextChordContext.thirdNote)))
              );
              if (diff <= 1) resolved++;
            }
          }
        }
      }
      printRow(`${label}: resolved to 3rd (±1 semi)`, resolved, total, 0.20);
    }

    // =====================================================================
    // 9. §9 Musical Forces
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 9. §9 MUSICAL FORCES                                                           │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const { results: forcesBatch } = generateBatch(PRIMARY_CONFIGS, 5, [3, 4]);
    let totalDirChanges = 0, offBeatDirChanges = 0;
    let highDesc = 0, highTotal = 0;
    for (const { phrase } of forcesBatch) {
      const notes = phrase.notes;
      const pitches = notes.map(n => absolutePitch(n));
      for (let i = 2; i < notes.length; i++) {
        const prev = pitches[i - 1] - pitches[i - 2];
        const cur = pitches[i] - pitches[i - 1];
        if (prev !== 0 && cur !== 0 && ((prev > 0 && cur < 0) || (prev < 0 && cur > 0))) {
          totalDirChanges++;
          if (!notes[i].isStrong) offBeatDirChanges++;
        }
      }
      const sorted = [...pitches].sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      for (let i = 0; i < notes.length - 1; i++) {
        if (pitches[i] >= p75) {
          highTotal++;
          if (pitches[i + 1] < pitches[i]) highDesc++;
        }
      }
    }
    printRow('Direction changes on off-beats', offBeatDirChanges, totalDirChanges, 0.45);
    printRow('High notes descend (gravity)', highDesc, highTotal, 0.45);

    // =====================================================================
    // 10. All-mode coverage
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 10. ALL-MODE COVERAGE                                                          │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const HARD_MODES = new Set(['lydian-aug', 'dim-wh', 'dim-hw']);
    for (const { rootName, modeKey } of ALL_MODE_CONFIGS) {
      const { mode, fretMap, positions } = buildFixtures(rootName, modeKey);
      const posIdxs = [...new Set([0, Math.min(3, positions.length - 1), positions.length - 1])];
      let total = 0, success = 0;
      let fallbackCount = 0;
      const templateUsed = new Map<string, number>();
      for (const pi of posIdxs) {
        for (const bc of [2, 3, 4] as const) {
          for (let i = 0; i < 10; i++) {
            total++;
            const config: PhraseConfig = { approachTypes: [], beatCount: bc };
            const phrase = generatePhraseRule(positions[pi], mode, fretMap, config);
            if (phrase) {
              success++;
              const tid = phrase.templateId ?? 'unknown';
              templateUsed.set(tid, (templateUsed.get(tid) ?? 0) + 1);
              if (tid === 'scale-down-fallback') fallbackCount++;
            }
          }
        }
      }
      const hasBebop = BEBOP_MODES.includes(modeKey);
      const isHard = HARD_MODES.has(modeKey);
      const threshold = hasBebop ? 0.30 : isHard ? 0 : 0.05;
      const status = (success / total) >= threshold ? 'PASS' : 'FAIL';
      const templates = [...templateUsed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(', ');
      console.log(`  ${(rootName + ' ' + modeKey).padEnd(25)} ${String(success).padStart(4)}/${String(total).padStart(4)} = ${pct(success, total)} fallback=${fallbackCount} ${status} [${templates}]`);
    }

    // =====================================================================
    // 11. Diversity
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 11. DIVERSITY                                                                   │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    // Pitch sequence uniqueness
    const { mode: cMixo, fretMap: cFret, positions: cPos } = buildFixtures('C', 'mixolydian');
    const seqs: string[] = [];
    for (let i = 0; i < 100; i++) {
      const config: PhraseConfig = { approachTypes: [], beatCount: 4 };
      const phrase = generatePhraseRule(cPos[0], cMixo, cFret, config);
      if (phrase) seqs.push(phrase.notes.map(n => n.semitone).join(','));
    }
    const uniqueSeqs = new Set(seqs).size;
    printRow('Pitch sequence uniqueness (C mixo, pos0, 4b)', uniqueSeqs, seqs.length, 0.40);

    // Start note diversity
    const starts: string[] = [];
    for (let i = 0; i < 100; i++) {
      const config: PhraseConfig = { approachTypes: [], beatCount: 4 };
      const phrase = generatePhraseRule(cPos[0], cMixo, cFret, config);
      if (phrase) starts.push(phrase.notes[0].noteName);
    }
    const startCounts = new Map<string, number>();
    for (const s of starts) startCounts.set(s, (startCounts.get(s) ?? 0) + 1);
    console.log(`  Start note types: ${startCounts.size} (threshold: >= 3), max share: ${pct(Math.max(...startCounts.values()), starts.length)} (threshold: <= 50%)`);

    // Contour distribution
    const contourCounts = new Map<string, number>();
    for (const { phrase } of primary) {
      const c = phrase.config.contour ?? 'unknown';
      contourCounts.set(c, (contourCounts.get(c) ?? 0) + 1);
    }
    console.log('\n  Contour distribution:');
    const contourSorted = [...contourCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [contour, count] of contourSorted) {
      printRow(contour, count, primary.length);
    }

    // =====================================================================
    // 12. Range, leap, note count
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 12. RANGE, LEAP, NOTE COUNT                                                    │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const ranges: number[] = [];
    const leaps: number[] = [];
    const noteCounts: number[] = [];
    const noteCountsByBeat = new Map<number, number[]>();
    for (const { phrase, beatCount } of primary) {
      const pitches = phrase.notes.map(n => absolutePitch(n));
      ranges.push(Math.max(...pitches) - Math.min(...pitches));
      for (let i = 1; i < pitches.length; i++) {
        leaps.push(Math.abs(pitches[i] - pitches[i - 1]));
      }
      noteCounts.push(phrase.notes.length);
      if (!noteCountsByBeat.has(beatCount)) noteCountsByBeat.set(beatCount, []);
      noteCountsByBeat.get(beatCount)!.push(phrase.notes.length);
    }

    const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const p5 = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.05)]; };
    const p95 = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)]; };

    console.log(`  Range:      min=${Math.min(...ranges)} max=${Math.max(...ranges)} median=${median(ranges)} avg=${avg(ranges).toFixed(1)} p5=${p5(ranges)} p95=${p95(ranges)}`);
    console.log(`  Leap:       min=${Math.min(...leaps)} max=${Math.max(...leaps)} median=${median(leaps)} avg=${avg(leaps).toFixed(1)} p5=${p5(leaps)} p95=${p95(leaps)}`);
    console.log(`  Note count: min=${Math.min(...noteCounts)} max=${Math.max(...noteCounts)} median=${median(noteCounts)} avg=${avg(noteCounts).toFixed(1)}`);

    for (const bc of [2, 3, 4]) {
      const arr = noteCountsByBeat.get(bc);
      if (!arr || arr.length === 0) continue;
      console.log(`    beatCount=${bc}: median=${median(arr)} avg=${avg(arr).toFixed(1)} min=${Math.min(...arr)} max=${Math.max(...arr)}`);
    }

    // =====================================================================
    // 13. Rhythm distribution
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 13. RHYTHM DISTRIBUTION                                                        │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const rhythmCounts = new Map<string, number>();
    let totalNotes = 0;
    for (const { phrase } of primary) {
      for (const n of phrase.notes) {
        totalNotes++;
        const d = n.duration ?? 'e';
        rhythmCounts.set(d, (rhythmCounts.get(d) ?? 0) + 1);
      }
    }
    const rhythmLabels: Record<string, string> = { 'q': 'quarter', 't': 'triplet', 'e': 'eighth', 's': 'sixteenth' };
    for (const [r, label] of Object.entries(rhythmLabels)) {
      printRow(label, rhythmCounts.get(r) ?? 0, totalNotes);
    }

    // =====================================================================
    // 14. Usability
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 14. USABILITY — POSITION / STRING / APPROACH                                   │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    // Approach resolution
    let approachTotal = 0, approachResolved = 0;
    for (const { phrase } of primary) {
      for (let i = 0; i < phrase.notes.length - 1; i++) {
        if (phrase.notes[i].isApproach) {
          approachTotal++;
          if (phrase.notes[i + 1].isChordTone) approachResolved++;
        }
      }
    }
    printRow('Approach → CT resolution', approachResolved, approachTotal, 0.50);

    // String jump distribution
    const stringJumps = new Map<number, number>();
    let totalJumps = 0;
    for (const { phrase } of primary) {
      for (let i = 1; i < phrase.notes.length; i++) {
        const jump = Math.abs(phrase.notes[i].stringIdx - phrase.notes[i - 1].stringIdx);
        stringJumps.set(jump, (stringJumps.get(jump) ?? 0) + 1);
        totalJumps++;
      }
    }
    console.log('\n  String jump distribution:');
    for (let j = 0; j <= 3; j++) {
      printRow(`  ${j}-string jump`, stringJumps.get(j) ?? 0, totalJumps);
    }

    // Fallback rate
    const fallbacks = primary.filter(r => r.phrase.templateId === 'scale-down-fallback');
    printRow('\n  Fallback rate', fallbacks.length, primary.length);

    // =====================================================================
    // 15. Segment junction
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 15. SEGMENT JUNCTION                                                           │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const { results: jBatch } = generateBatch(PRIMARY_CONFIGS, 10, [4]);
    let junctions = 0, jLeapTotal = 0, jStringTotal = 0, samePitch = 0;
    let strongAfterJ = 0, ctAfterJ = 0;
    const jLeaps: number[] = [];
    for (const { phrase } of jBatch) {
      for (let i = 1; i < phrase.notes.length; i++) {
        if (phrase.notes[i].segmentIdx !== phrase.notes[i - 1].segmentIdx) {
          junctions++;
          const leap = Math.abs(absolutePitch(phrase.notes[i]) - absolutePitch(phrase.notes[i - 1]));
          jLeaps.push(leap);
          jLeapTotal += leap;
          jStringTotal += Math.abs(phrase.notes[i].stringIdx - phrase.notes[i - 1].stringIdx);
          if (phrase.notes[i].semitone === phrase.notes[i - 1].semitone &&
              phrase.notes[i].stringIdx === phrase.notes[i - 1].stringIdx) {
            samePitch++;
          }
          for (let j = i; j < phrase.notes.length; j++) {
            if (phrase.notes[j].isStrong) {
              strongAfterJ++;
              if (phrase.notes[j].isChordTone) ctAfterJ++;
              break;
            }
          }
        }
      }
    }
    console.log(`  Total junctions: ${junctions}`);
    if (junctions > 0) {
      console.log(`  Avg junction leap: ${(jLeapTotal / junctions).toFixed(1)} semitones`);
      console.log(`  Max junction leap: ${Math.max(...jLeaps)}`);
      console.log(`  Avg string distance: ${(jStringTotal / junctions).toFixed(1)}`);
      printRow('Same-pitch junctions', samePitch, junctions);
      printRow('Post-junction strong beat CT', ctAfterJ, strongAfterJ, 0.35);
    }

    // Arch template
    const archPhrases = jBatch.filter(r => r.phrase.templateId === 'arp-up-scale-down');
    let naturalT = 0, correctDir = 0, archTotal = 0;
    for (const { phrase } of archPhrases) {
      const seg0 = phrase.notes.filter(n => n.segmentIdx === 0);
      const seg1 = phrase.notes.filter(n => n.segmentIdx === 1);
      if (seg0.length === 0 || seg1.length === 0) continue;
      archTotal++;
      const diff = Math.abs(absolutePitch(seg1[0]) - absolutePitch(seg0[seg0.length - 1]));
      if (diff <= 4) naturalT++;
      if (absolutePitch(seg0[seg0.length - 1]) >= absolutePitch(seg1[0])) correctDir++;
    }
    if (archTotal > 0) {
      printRow('Arch: natural transition (<=4 semi)', naturalT, archTotal, 0.70);
      printRow('Arch: correct direction (seg0 peak >= seg1 start)', correctDir, archTotal, 0.60);
    }

    // =====================================================================
    // 16. CT ending per position (C mixolydian, all 7 pos)
    // =====================================================================
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 16. CT ENDING PER POSITION (C Mixolydian)                                      │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    const { mode: posMd, fretMap: posFm, positions: allPos } = buildFixtures('C', 'mixolydian');
    for (let pi = 0; pi < allPos.length; pi++) {
      let total = 0, ctEnd = 0;
      for (const bc of [2, 3, 4] as const) {
        for (let i = 0; i < 20; i++) {
          const config: PhraseConfig = { approachTypes: [], beatCount: bc };
          const phrase = generatePhraseRule(allPos[pi], posMd, posFm, config);
          if (!phrase) continue;
          total++;
          if (phrase.notes[phrase.notes.length - 1].isChordTone) ctEnd++;
        }
      }
      printRow(`Pos ${pi + 1}`, ctEnd, total, 0.40);
    }

    console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                  REPORT END                                     ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');
  });
});
