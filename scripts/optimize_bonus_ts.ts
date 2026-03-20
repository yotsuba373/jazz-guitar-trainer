/**
 * TS 実コードで APPROACH_BONUS を探索最適化。
 * 各ボーナスセットで generateBassLine を30コーラス実行し、
 * iReal Pro の approach 分布との誤差を最小化するパラメータを見つける。
 *
 * Usage: npx tsx scripts/optimize_bonus_ts.ts
 */

import * as fs from 'fs';

// Mock fetch before any imports that use it
const bassPhrasesJson = fs.readFileSync('public/bass-phrases.generated.json', 'utf-8');
const bassConfigJson = fs.readFileSync('public/bass-config.json', 'utf-8');
(globalThis as any).fetch = async (url: string) => {
  if (url.includes('bass-phrases')) return { ok: true, json: async () => JSON.parse(bassPhrasesJson) };
  if (url.includes('bass-config')) return { ok: true, json: async () => JSON.parse(bassConfigJson) };
  return { ok: false };
};

async function main() {
  // Dynamic import after fetch mock
  const { generateBassLine, loadBassPhraseDB } = await import('../src/utils/bassPatterns');
  const bassPatterns = await import('../src/utils/bassPatterns');
  await loadBassPhraseDB();

  // Load timelines and target
  const timelines = JSON.parse(fs.readFileSync('scripts/compare_timelines.json', 'utf-8'));
  const irealStats = JSON.parse(fs.readFileSync('scripts/compare_ireal_stats.json', 'utf-8'));

  const targetApproach: Record<number, number> = irealStats.approach;
  const targetTotal = Object.values(targetApproach).reduce((a: number, b: any) => a + (b as number), 0);
  const target = Array.from({ length: 7 }, (_, d) => (targetApproach[d] || 0) / targetTotal);
  console.log('Target:', target.map(t => (t * 100).toFixed(1) + '%').join(' '));

  // Access the APPROACH_BONUS via module internals
  // We'll modify the source and re-evaluate by rewriting the bonus in the module
  // Since we can't easily modify module constants, we'll use a different approach:
  // Run the simulation for the current bonus and see the result

  function simulate(): number[] {
    const approach: Record<number, number> = {};
    for (const [, timeline] of Object.entries(timelines)) {
      const tl = timeline as any[];
      for (let ci = 0; ci < 30; ci++) {
        for (let si = 0; si < tl.length; si++) {
          const span = tl[si];
          const nextSpan = si + 1 < tl.length ? tl[si + 1] : null;
          const refSemi = span.bassSemi ?? span.rootSemi;
          const nextRefSemi = nextSpan ? (nextSpan.bassSemi ?? nextSpan.rootSemi) : null;
          const globalBeatOffset = ci * tl.reduce((s: number, c: any) => s + c.beats, 0)
            + tl.slice(0, si).reduce((s: number, c: any) => s + c.beats, 0);

          const notes = generateBassLine(
            refSemi, span.quality, span.beats, nextRefSemi, 'medium-swing', globalBeatOffset,
          );
          if (notes.length === 0) continue;
          if (span.beats < 4 || nextRefSemi === null) continue;

          const lastMidi = notes[notes.length - 1].midi;
          const lastPC = lastMidi % 12;
          let d = Math.abs(lastPC - nextRefSemi) % 12;
          if (d > 6) d = 12 - d;
          approach[d] = (approach[d] || 0) + 1;
        }
      }
    }

    const total = Object.values(approach).reduce((a, b) => a + b, 0);
    return Array.from({ length: 7 }, (_, d) => (approach[d] || 0) / total);
  }

  const result = simulate();
  console.log('\nCurrent TS result:');
  console.log('  D   Target   Actual   Delta');
  let totalError = 0;
  for (let d = 0; d < 7; d++) {
    const err = result[d] - target[d];
    totalError += err * err;
    console.log(`  ${d}   ${(target[d] * 100).toFixed(1).padStart(5)}%  ${(result[d] * 100).toFixed(1).padStart(5)}%  ${(err >= 0 ? '+' : '') + (err * 100).toFixed(1).padStart(5)}%`);
  }
  console.log(`  Total squared error: ${(totalError * 10000).toFixed(2)}`);
}

main().catch(console.error);
