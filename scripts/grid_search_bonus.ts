/**
 * APPROACH_BONUS のグリッドサーチ最適化。
 * TS 実コードで generateBassLine を実行し、iReal Pro 分布との誤差を最小化。
 *
 * Usage: npx tsx scripts/grid_search_bonus.ts
 */

import * as fs from 'fs';

const bassPhrasesJson = fs.readFileSync('public/bass-phrases.generated.json', 'utf-8');
const bassConfigJson = fs.readFileSync('public/bass-config.json', 'utf-8');
(globalThis as any).fetch = async (url: string) => {
  if (url.includes('bass-phrases')) return { ok: true, json: async () => JSON.parse(bassPhrasesJson) };
  if (url.includes('bass-config')) return { ok: true, json: async () => JSON.parse(bassConfigJson) };
  return { ok: false };
};

async function main() {
  // We need to modify APPROACH_BONUS at runtime.
  // Since it's a const in the module, we'll use a workaround:
  // Read the source, inject different values, and use eval-like approach.
  // Actually, simpler: the APPROACH_BONUS is used inside selectDBPattern.
  // We can access it via the module's internal state if we export it,
  // or we can just modify the .ts file and re-import.
  //
  // Simplest approach: since APPROACH_BONUS values only affect selectDBPattern's
  // weight calculation, and the patterns + base weights are fixed,
  // we can compute the effective weights externally.

  const db = JSON.parse(bassPhrasesJson);
  const timelines = JSON.parse(fs.readFileSync('scripts/compare_timelines.json', 'utf-8'));
  const irealStats = JSON.parse(fs.readFileSync('scripts/compare_ireal_stats.json', 'utf-8'));

  const targetApproach: Record<number, number> = irealStats.approach;
  const targetTotal = Object.values(targetApproach).reduce((a: number, b: any) => a + (b as number), 0);
  const target = Array.from({ length: 7 }, (_, d) => ((targetApproach[d] || 0) as number) / targetTotal);

  const QUALITY_MAP: Record<string, string> = {
    'maj7': 'maj7', 'dom7': 'dom7', 'm7': 'm7', 'm7b5': 'm7b5', 'dim7': 'dim7',
    '7': 'dom7', '7alt': 'dom7',
  };

  function qualityToPatternKey(q: string): string {
    if (q.startsWith('m7b5') || q.startsWith('m7♭5')) return 'm7b5';
    if (q === 'dim7' || q === 'dim') return 'dim7';
    if (q.startsWith('m')) return 'm7';
    if (q === '7' || q.startsWith('7')) return 'dom7';
    return 'maj7';
  }

  // Mulberry32 PRNG (must match TS exactly)
  function mulberry32(seed: number): () => number {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function simulate(bonus: number[]): number[] {
    const approach: Record<number, number> = {};

    for (const [, timeline] of Object.entries(timelines)) {
      const tl = timeline as any[];
      for (let ci = 0; ci < 30; ci++) {
        for (let si = 0; si < tl.length; si++) {
          const span = tl[si];
          const nextSpan = si + 1 < tl.length ? tl[si + 1] : null;
          const refSemi: number = span.bassSemi ?? span.rootSemi;
          const nextRefSemi: number | null = nextSpan ? (nextSpan.bassSemi ?? nextSpan.rootSemi) : null;

          if (span.beats < 4 || nextRefSemi === null) continue;

          const patKey = qualityToPatternKey(span.quality);
          const pats = db.patterns?.[patKey]?.[String(span.beats)];
          const weights = db.weights?.[patKey]?.[String(span.beats)];
          if (!pats || !weights || pats.length === 0) continue;

          // Compute effective weights with approach bonus
          const measureIdx = Math.floor(
            (ci * tl.reduce((s: number, c: any) => s + c.beats, 0)
              + tl.slice(0, si).reduce((s: number, c: any) => s + c.beats, 0)) / 4,
          );
          const rng = mulberry32(measureIdx * 7919 + 17);

          const eff = weights.map((w: number, i: number) => {
            const pat = pats[i];
            const lastSemi = pat[pat.length - 1][1];
            const lastPC = (refSemi + lastSemi) % 12;
            let d = Math.abs(lastPC - nextRefSemi) % 12;
            if (d > 6) d = 12 - d;
            return w * bonus[d];
          });

          const totalEff = eff.reduce((a: number, b: number) => a + b, 0);
          let r = rng() * totalEff;
          let selectedIdx = 0;
          for (let i = 0; i < eff.length; i++) {
            r -= eff[i];
            if (r <= 0) { selectedIdx = i; break; }
          }

          const selectedPat = pats[selectedIdx];
          const lastSemi = selectedPat[selectedPat.length - 1][1];
          // rootToBassMidi equivalent
          const base = 36;
          let rootMidi = base + refSemi;
          if (rootMidi > base + 6) rootMidi -= 12;
          const lastMidi = rootMidi + lastSemi;
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

  function error(bonus: number[]): number {
    const result = simulate(bonus);
    return result.reduce((sum, v, i) => sum + (v - target[i]) ** 2, 0);
  }

  // Grid search: try variations around current values
  const current = [0.716, 0.570, 0.561, 0.544, 0.583, 0.455, 0.503];
  let bestBonus = [...current];
  let bestError = error(current);
  console.log(`Initial error: ${(bestError * 10000).toFixed(2)}`);

  // Iterative coordinate descent
  const steps = [0.3, 0.1, 0.03, 0.01];
  for (const step of steps) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let d = 0; d < 7; d++) {
        for (const delta of [-step, step]) {
          const trial = [...bestBonus];
          trial[d] = Math.max(0.01, trial[d] + delta);
          const e = error(trial);
          if (e < bestError) {
            bestError = e;
            bestBonus = trial;
            improved = true;
          }
        }
      }
    }
    console.log(`Step ${step}: error=${(bestError * 10000).toFixed(4)}, bonus=[${bestBonus.map(b => b.toFixed(3)).join(', ')}]`);
  }

  // Final verification
  const finalResult = simulate(bestBonus);
  console.log('\n=== Optimized APPROACH_BONUS ===');
  for (let d = 0; d < 7; d++) {
    console.log(`  ${d}: ${bestBonus[d].toFixed(3)} (was ${current[d].toFixed(3)})`);
  }
  console.log('\n=== Verification ===');
  console.log('  D   Target   Result   Delta');
  for (let d = 0; d < 7; d++) {
    const err = finalResult[d] - target[d];
    console.log(`  ${d}   ${(target[d] * 100).toFixed(1).padStart(5)}%  ${(finalResult[d] * 100).toFixed(1).padStart(5)}%  ${(err >= 0 ? '+' : '') + (err * 100).toFixed(1).padStart(5)}%`);
  }
}

main().catch(console.error);
