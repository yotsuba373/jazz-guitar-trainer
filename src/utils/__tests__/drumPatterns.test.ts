import { describe, it, expect } from 'vitest';
import { generateSwingDrumPattern } from '../drumPatterns';

describe('generateSwingDrumPattern', () => {
  it('4拍: ライド6 + HH 2 + kick 1 = 計9', () => {
    const hits = generateSwingDrumPattern(4, 0, 0, 120);
    const rides = hits.filter(h => h.role === 'ride');
    const hhs = hits.filter(h => h.role === 'hihat');
    const kicks = hits.filter(h => h.role === 'kick');
    expect(rides).toHaveLength(6);   // 4 quarters + 2 offbeats (and of 2, and of 4)
    expect(hhs).toHaveLength(2);     // foot on 2, 4
    expect(kicks).toHaveLength(1);   // beat 0 only (non-variation measure)
    expect(hits).toHaveLength(9);
  });

  it('2拍: ライド3 + HH 1 + kick 1', () => {
    const hits = generateSwingDrumPattern(2, 0, 0, 120);
    const rides = hits.filter(h => h.role === 'ride');
    const hhs = hits.filter(h => h.role === 'hihat');
    const kicks = hits.filter(h => h.role === 'kick');
    expect(rides).toHaveLength(3);   // 2 quarters + 1 offbeat (and of 2)
    expect(hhs).toHaveLength(1);     // foot on 2
    expect(kicks).toHaveLength(1);
  });

  it('1拍: ライド1 + kick 1', () => {
    const hits = generateSwingDrumPattern(1, 0, 0, 120);
    const rides = hits.filter(h => h.role === 'ride');
    const kicks = hits.filter(h => h.role === 'kick');
    expect(rides).toHaveLength(1);
    expect(kicks).toHaveLength(1);
    expect(hits).toHaveLength(2);
  });

  it('swing=0 → 裏拍は0.5ちょうど', () => {
    const hits = generateSwingDrumPattern(4, 0, 0, 120);
    const offbeats = hits.filter(h => h.role === 'ride' && h.beatStart % 1 !== 0);
    expect(offbeats).toHaveLength(2);
    for (const ob of offbeats) {
      expect(ob.beatStart % 1).toBeCloseTo(0.5, 5);
    }
  });

  it('swing=1 → 裏拍が~0.67に移動', () => {
    const hits = generateSwingDrumPattern(4, 0, 1.0, 120);
    const offbeats = hits.filter(h => h.role === 'ride' && h.beatStart % 1 !== 0);
    expect(offbeats).toHaveLength(2);
    for (const ob of offbeats) {
      const frac = ob.beatStart - Math.floor(ob.beatStart);
      expect(frac).toBeGreaterThan(0.6);
      expect(frac).toBeLessThan(0.7);
    }
  });

  it('高テンポ (280BPM) → スウィング減衰', () => {
    const hitsLow = generateSwingDrumPattern(4, 0, 1.0, 120);
    const hitsHigh = generateSwingDrumPattern(4, 0, 1.0, 280);
    const offLow = hitsLow.filter(h => h.role === 'ride' && h.beatStart % 1 !== 0);
    const offHigh = hitsHigh.filter(h => h.role === 'ride' && h.beatStart % 1 !== 0);
    const fracLow = offLow[0].beatStart - Math.floor(offLow[0].beatStart);
    const fracHigh = offHigh[0].beatStart - Math.floor(offHigh[0].beatStart);
    expect(fracHigh).toBeLessThan(fracLow);
    expect(fracHigh).toBeCloseTo(0.5, 1); // ほぼストレート
  });

  it('velocity は 0-127 範囲', () => {
    const hits = generateSwingDrumPattern(4, 0, 1.0, 120);
    for (const h of hits) {
      expect(h.velocity).toBeGreaterThanOrEqual(0);
      expect(h.velocity).toBeLessThanOrEqual(127);
    }
  });

  it('4小節ごとバリエーション: measureIdx%4===3 で kick が2つ', () => {
    // globalBeatOffset = 12 → measureIdx = 3
    const hits = generateSwingDrumPattern(4, 12, 0, 120);
    const kicks = hits.filter(h => h.role === 'kick');
    expect(kicks).toHaveLength(2);
    expect(kicks[0].beatStart).toBe(0);
    expect(kicks[0].velocity).toBe(100);
    expect(kicks[1].beatStart).toBe(2);
    expect(kicks[1].velocity).toBe(85);
  });

  it('通常小節 (measureIdx%4!==3) は kick 1つ', () => {
    const hits = generateSwingDrumPattern(4, 0, 0, 120);
    const kicks = hits.filter(h => h.role === 'kick');
    expect(kicks).toHaveLength(1);
  });

  it('role は ride/hihat/kick のみ使用', () => {
    const hits = generateSwingDrumPattern(4, 0, 0.5, 120);
    const roles = new Set(hits.map(h => h.role));
    expect(roles.has('ride')).toBe(true);
    expect(roles.has('hihat')).toBe(true);
    expect(roles.has('kick')).toBe(true);
  });
});
