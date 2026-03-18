/**
 * リック・ポジション・モードのデバッグスクリプト
 *
 * 使用例:
 *   npx tsx scripts/debug_lick.ts D-e67f F Mixolydian 3
 *   npx tsx scripts/debug_lick.ts D-e67f F Mixolydian       # 全ポジション
 *   npx tsx scripts/debug_lick.ts D-e67f                    # buildLickContext 自動推定
 */

import { buildFretMap, generatePositions, generateDimPositions } from '../src/utils/fretboard';
import { MODE_TEMPLATES, ROOTS, CHROMATIC_NAMES } from '../src/constants/music';
import {
  buildNotePool, absolutePitch,
  selectBestInstance, mapLickToFretboard, hasAlternateOctave,
  buildLickContext, QUALITY_TO_LICK_TYPE,
} from '../src/utils/lickEngine';
import * as fs from 'fs';
import { resolveMode } from '../src/utils/noteSpelling';
import type { LickEntry, Position } from '../src/types';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const [lickId, rootArg, modeArg, posArg] = process.argv.slice(2);

if (!lickId) {
  console.log('Usage: npx tsx scripts/debug_lick.ts <lickId> [root] [modeName] [posId]');
  console.log('  例: npx tsx scripts/debug_lick.ts D-e67f F Mixolydian 3');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROOTS_SEMI: Record<string, number> = {};
ROOTS.forEach(r => { ROOTS_SEMI[r.name] = r.semitone; });

function analyzeMapping(
  label: string,
  lick: LickEntry,
  pool: ReturnType<typeof buildNotePool>,
  transposeSemitones: number,
  alternateOctave: boolean,
  fretMin: number,
  fretMax: number,
) {
  console.log(`\n=== ${label} ===`);
  const mapped = mapLickToFretboard(lick, pool, transposeSemitones, alternateOctave);
  let outOfPos = 0;
  for (let i = 0; i < mapped.length; i++) {
    const m = mapped[i];
    if (!m) { console.log(`  note ${i}: (rest)`); continue; }
    const flag = (m.fret < fretMin - 1 || m.fret > fretMax + 1) ? ' ⚠ OUT-OF-POS' : '';
    if (flag) outOfPos++;
    console.log(`  note ${i}: s${m.stringIdx}:f${m.fret} ${m.noteName.padEnd(3)} pool=${m.poolMatch}${flag}`);
  }
  if (outOfPos > 0) console.log(`  ⚠ ${outOfPos}/${mapped.length} notes outside position!`);
  return mapped;
}

function analyzeCoverages(
  lick: LickEntry,
  pool: ReturnType<typeof buildNotePool>,
  transposeSemitones: number,
) {
  const poolPitchSet = new Set(pool.map(p => absolutePitch(p)));
  const basePitches = lick.notes
    .filter(n => !n.rest && n.pitch != null)
    .map(n => n.pitch! + transposeSemitones);
  const total = basePitches.length;

  for (const shift of [-12, 0, 12]) {
    let cov = 0;
    const missed: number[] = [];
    for (const p of basePitches) {
      if (poolPitchSet.has(p + shift)) cov++;
      else missed.push(p + shift);
    }
    const viable = cov >= total * 0.5 ? 'VIABLE' : '';
    const missedStr = missed.length > 0
      ? `  missed: [${[...new Set(missed)].sort((a,b) => a-b).map(m => `${CHROMATIC_NAMES[((m%12)+12)%12]}(${m})`)}]`
      : '';
    console.log(`  shift ${shift >= 0 ? '+' : ''}${shift}: cov=${cov}/${total} ${viable}`);
    if (missedStr) console.log(`  ${missedStr}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const dbPath = new URL('../public/licks.generated.json', import.meta.url);
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

  // Find the lick by ID
  let lick: LickEntry | null = null;
  let lickType = '';
  for (const [type, entries] of Object.entries(db)) {
    const found = entries.find((l: LickEntry) => l.id === lickId);
    if (found) {
      lick = found;
      lickType = type;
      break;
    }
  }
  if (!lick) {
    console.error(`Lick "${lickId}" not found in DB`);
    process.exit(1);
  }

  const pitched = lick.notes.filter(n => !n.rest && n.pitch != null);
  console.log(`=== Lick: ${lickId} (type: ${lickType}) ===`);
  console.log(`Notes: ${pitched.length}, Beats: ${lick.beats}`);
  console.log(`Pitches: [${pitched.map(n => `${CHROMATIC_NAMES[((n.pitch!%12)+12)%12]}(${n.pitch})`)}]`);
  console.log(`Range: MIDI ${Math.min(...pitched.map(n=>n.pitch!))} - ${Math.max(...pitched.map(n=>n.pitch!))}`);

  // --- Mode: auto or specified ---
  if (!rootArg) {
    // Auto mode: use buildLickContext
    console.log('\n--- Auto mode (buildLickContext) ---');
    // Determine a reasonable quality from lickType
    const qualityMap: Record<string, string> = {
      dom7: '7', min7: 'm7', maj7: 'maj7', m7b5: 'm7♭5',
    };
    const quality = qualityMap[lickType] ?? '7';
    // Licks are stored at C root (semitone 0)
    const rootSemi = 0;
    const rootName = 'C';

    for (const altOct of [false, true]) {
      for (const hiInst of [false, true]) {
        const ctx = buildLickContext(lick, quality, rootName, rootSemi, altOct, hiInst);
        if (!ctx) { console.log(`  buildLickContext returned null (altOct=${altOct}, hiInst=${hiInst})`); continue; }
        const pos = ctx.positions.find(p => p.id === ctx.posId)!;
        const inst = pos.instances[0]; // single-inst position
        console.log(`  altOct=${altOct} hiInst=${hiInst} → mode=${MODE_TEMPLATES[ctx.modeIdx].name} pos=${ctx.posId} frets=${inst?.fretMin}-${inst?.fretMax}`);
      }
    }
    return;
  }

  // --- Explicit mode/root/pos ---
  const root = rootArg;
  const modeName = modeArg;
  const posId = posArg ? parseInt(posArg) : null;

  const rootSemi = ROOTS_SEMI[root];
  if (rootSemi == null) {
    console.error(`Unknown root: ${root}. Valid: ${ROOTS.map(r => r.name).join(', ')}`);
    process.exit(1);
  }

  const tmpl = MODE_TEMPLATES.find(m => m.name === modeName);
  if (!tmpl) {
    console.error(`Unknown mode: ${modeName}. Valid: ${MODE_TEMPLATES.map(m => m.name).join(', ')}`);
    process.exit(1);
  }

  const modeObj = resolveMode(root, tmpl);
  const fm = buildFretMap(modeObj.semi, modeObj.notes);
  const positions = modeObj.notes.length > 7
    ? generateDimPositions(fm, modeObj.semi[0])
    : generatePositions(fm, modeObj.notes);

  const transposeSemitones = rootSemi;  // licks stored at C root
  console.log(`\nRoot: ${root} (semi=${rootSemi}), Mode: ${modeName}`);
  console.log(`TransposeSemitones: ${transposeSemitones}`);
  console.log(`Transposed pitches: [${pitched.map(n => `${CHROMATIC_NAMES[(((n.pitch!+transposeSemitones)%12)+12)%12]}(${n.pitch!+transposeSemitones})`)}]`);

  const targetPositions = posId != null
    ? positions.filter(p => p.id === posId)
    : positions;

  if (targetPositions.length === 0) {
    console.error(`Position ${posId} not found. Available: ${positions.map(p => p.id).join(', ')}`);
    process.exit(1);
  }

  for (const pos of targetPositions) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Position ${pos.id} — ${pos.instances.length} instance(s)`);
    console.log(`${'='.repeat(60)}`);

    const lickPitches = pitched.map(n => n.pitch! + transposeSemitones);
    const bestInstLow = selectBestInstance(pos, lickPitches, false);
    const bestInstHigh = selectBestInstance(pos, lickPitches, true);
    console.log(`selectBestInstance: low=${bestInstLow}, high=${bestInstHigh}`);

    for (let i = 0; i < pos.instances.length; i++) {
      const inst = pos.instances[i];
      console.log(`\n--- Instance ${i} (frets ${inst.fretMin}-${inst.fretMax}) ---`);

      const singlePos = { ...pos, instances: [inst] };
      const pool = buildNotePool(singlePos, modeObj, fm, true);
      const poolPitchSet = new Set(pool.map(p => absolutePitch(p)));

      console.log(`Pool: ${poolPitchSet.size} pitches, range MIDI ${Math.min(...poolPitchSet)}-${Math.max(...poolPitchSet)}`);

      // Show pool details per string
      const poolByString: Record<number, { fret: number; midi: number; name: string; approach: boolean }[]> = {};
      for (const p of pool) {
        if (!poolByString[p.stringIdx]) poolByString[p.stringIdx] = [];
        poolByString[p.stringIdx].push({
          fret: p.fret,
          midi: absolutePitch(p),
          name: p.noteName,
          approach: p.isApproach,
        });
      }
      const STRING_NAMES = ['1E', 'B', 'G', 'D', 'A', '6E'];
      for (let s = 0; s < 6; s++) {
        const notes = poolByString[s];
        if (!notes) continue;
        notes.sort((a, b) => a.fret - b.fret);
        const desc = notes.map(n => `f${n.fret}=${n.name}(${n.midi})${n.approach ? '*' : ''}`).join(' ');
        console.log(`  ${STRING_NAMES[s]}: ${desc}`);
      }

      // Coverage analysis
      analyzeCoverages(lick, pool, transposeSemitones);

      // hasAlternateOctave
      const canAlt = hasAlternateOctave(lick, pool, transposeSemitones);
      console.log(`hasAlternateOctave: ${canAlt}`);

      // Mapping analysis
      analyzeMapping(`8va OFF`, lick, pool, transposeSemitones, false, inst.fretMin, inst.fretMax);
      if (canAlt) {
        analyzeMapping(`8va ON`, lick, pool, transposeSemitones, true, inst.fretMin, inst.fretMax);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
