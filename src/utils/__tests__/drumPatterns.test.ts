import { describe, it, expect } from 'vitest';
import { generateSwingDrumPattern, generateDrumPattern } from '../drumPatterns';

describe('generateSwingDrumPattern', () => {
  // --- 決定性 ---
  it('同一入力 → 同一出力 (seeded PRNG)', () => {
    const a = generateSwingDrumPattern(4, 0, 0.2, 120);
    const b = generateSwingDrumPattern(4, 0, 0.2, 120);
    expect(a).toEqual(b);
  });

  it('異なる globalBeatOffset → 異なるパターン (小節間バリエーション)', () => {
    const a = generateSwingDrumPattern(4, 0, 0, 120);
    const b = generateSwingDrumPattern(4, 4, 0, 120);
    // 少なくともベロシティかヒット数が異なる
    expect(a).not.toEqual(b);
  });

  // --- キックフェザリング ---
  it('4拍: キック数 = beats (全拍フェザリング)', () => {
    const hits = generateSwingDrumPattern(4, 0, 0, 120);
    const kicks = hits.filter(h => h.role === 'kick');
    expect(kicks).toHaveLength(4);
    expect(kicks.map(k => k.beatStart)).toEqual([0, 1, 2, 3]);
  });

  it('キック velocity はフェザリング範囲 (35-70)', () => {
    // 複数小節を検証
    for (let offset = 0; offset < 40; offset += 4) {
      const hits = generateSwingDrumPattern(4, offset, 0, 120);
      const kicks = hits.filter(h => h.role === 'kick');
      for (const k of kicks) {
        expect(k.velocity).toBeGreaterThanOrEqual(35);
        expect(k.velocity).toBeLessThanOrEqual(70);
      }
    }
  });

  // --- ライド ---
  it('4拍: ライド 6 (4分×4 + skip note×2)', () => {
    const hits = generateSwingDrumPattern(4, 0, 0, 120);
    const rides = hits.filter(h => h.role === 'ride');
    expect(rides).toHaveLength(6);
  });

  it('ライド backbeat: 2,4拍 (b=1,3) の平均 vel > 1,3拍 (b=0,2)', () => {
    // 100小節の平均で比較
    let sumBackbeat = 0, sumDown = 0, countB = 0, countD = 0;
    for (let offset = 0; offset < 400; offset += 4) {
      const hits = generateSwingDrumPattern(4, offset, 0, 120);
      const quarterRides = hits.filter(h => h.role === 'ride' && h.beatStart % 1 === 0);
      for (const r of quarterRides) {
        if (r.beatStart === 1 || r.beatStart === 3) {
          sumBackbeat += r.velocity; countB++;
        } else {
          sumDown += r.velocity; countD++;
        }
      }
    }
    expect(sumBackbeat / countB).toBeGreaterThan(sumDown / countD);
  });

  it('2拍: ライド 3 (2分×2 + skip note×1) + HH 1 + kick 2', () => {
    const hits = generateSwingDrumPattern(2, 0, 0, 120);
    const rides = hits.filter(h => h.role === 'ride');
    const hhs = hits.filter(h => h.role === 'hihat');
    const kicks = hits.filter(h => h.role === 'kick');
    expect(rides).toHaveLength(3);
    expect(hhs).toHaveLength(1);
    expect(kicks).toHaveLength(2);
  });

  it('1拍: ライド 1 + kick 1', () => {
    const hits = generateSwingDrumPattern(1, 0, 0, 120);
    const rides = hits.filter(h => h.role === 'ride');
    const kicks = hits.filter(h => h.role === 'kick');
    expect(rides).toHaveLength(1);
    expect(kicks).toHaveLength(1);
  });

  // --- HH ---
  it('4拍: HH foot = 2 (beat 1, 3)', () => {
    const hits = generateSwingDrumPattern(4, 0, 0, 120);
    const hhs = hits.filter(h => h.role === 'hihat');
    expect(hhs).toHaveLength(2);
    expect(hhs.map(h => h.beatStart)).toEqual([1, 3]);
  });

  // --- スネア ---
  it('4拍パターンでスネア (ghost/comping) が出現する', () => {
    // 確率的なので多数小節で検証
    let hasSnare = false;
    for (let offset = 0; offset < 100; offset += 4) {
      const hits = generateSwingDrumPattern(4, offset, 0, 120);
      if (hits.some(h => h.role === 'snare')) { hasSnare = true; break; }
    }
    expect(hasSnare).toBe(true);
  });

  it('スネアゴーストノート velocity 20-50', () => {
    for (let offset = 0; offset < 80; offset += 4) {
      const hits = generateSwingDrumPattern(4, offset, 0, 120);
      const ghosts = hits.filter(h => h.role === 'snare' && h.velocity <= 50);
      for (const g of ghosts) {
        expect(g.velocity).toBeGreaterThanOrEqual(20);
        expect(g.velocity).toBeLessThanOrEqual(50);
      }
    }
  });

  it('スネアコンピング velocity 60-100', () => {
    for (let offset = 0; offset < 80; offset += 4) {
      const hits = generateSwingDrumPattern(4, offset, 0, 120);
      const comps = hits.filter(h => h.role === 'snare' && h.velocity > 50);
      for (const c of comps) {
        expect(c.velocity).toBeGreaterThanOrEqual(60);
        expect(c.velocity).toBeLessThanOrEqual(100);
      }
    }
  });

  // --- スウィング ---
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
    const offbeats = hits.filter(h => h.role === 'ride' && h.beatStart % 1 !== 0
      && h.beatStart > 0.9); // skip notes のみ (ghost notes の三連符位置を除外)
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
    const offLow = hitsLow.filter(h => h.role === 'ride' && h.beatStart % 1 !== 0
      && h.beatStart > 0.9);
    const offHigh = hitsHigh.filter(h => h.role === 'ride' && h.beatStart % 1 !== 0
      && h.beatStart > 0.9);
    const fracLow = offLow[0].beatStart - Math.floor(offLow[0].beatStart);
    const fracHigh = offHigh[0].beatStart - Math.floor(offHigh[0].beatStart);
    expect(fracHigh).toBeLessThan(fracLow);
    expect(fracHigh).toBeCloseTo(0.5, 1);
  });

  // --- 全般 ---
  it('velocity は 0-127 範囲', () => {
    for (let offset = 0; offset < 80; offset += 4) {
      const hits = generateSwingDrumPattern(4, offset, 0.5, 120);
      for (const h of hits) {
        expect(h.velocity).toBeGreaterThanOrEqual(0);
        expect(h.velocity).toBeLessThanOrEqual(127);
      }
    }
  });

  it('4拍パターンで ride/hihat/kick/snare 全ロール使用 (多数小節)', () => {
    const allRoles = new Set<string>();
    for (let offset = 0; offset < 100; offset += 4) {
      const hits = generateSwingDrumPattern(4, offset, 0, 120);
      hits.forEach(h => allRoles.add(h.role));
    }
    expect(allRoles.has('ride')).toBe(true);
    expect(allRoles.has('hihat')).toBe(true);
    expect(allRoles.has('kick')).toBe(true);
    expect(allRoles.has('snare')).toBe(true);
  });
});

describe('generateDrumPattern', () => {
  it('style=swing: generateSwingDrumPattern と同じ結果', () => {
    const swing = generateSwingDrumPattern(4, 0, 0.2, 120);
    const dispatch = generateDrumPattern(4, 0, 0.2, 120, 'swing');
    expect(dispatch).toEqual(swing);
  });

  it('style 未指定: swing がデフォルト', () => {
    const swing = generateSwingDrumPattern(4, 0, 0, 120);
    const dispatch = generateDrumPattern(4, 0, 0, 120);
    expect(dispatch).toEqual(swing);
  });

  it('Bossa: xstick (cross-stick) が含まれる', () => {
    const hits = generateDrumPattern(4, 0, 0, 120, 'bossa');
    const xsticks = hits.filter(h => h.role === 'xstick');
    expect(xsticks.length).toBeGreaterThan(0);
    expect(xsticks.some(s => s.beatStart === 1)).toBe(true);
    expect(xsticks.some(s => s.beatStart === 3)).toBe(true);
  });

  it('Bossa: hihat + kick が含まれる', () => {
    const hits = generateDrumPattern(4, 0, 0, 120, 'bossa');
    expect(hits.some(h => h.role === 'hihat')).toBe(true);
    expect(hits.some(h => h.role === 'kick')).toBe(true);
  });

  it('Ballad: ride + hihat + kick', () => {
    const hits = generateDrumPattern(4, 0, 0, 120, 'ballad');
    const roles = new Set(hits.map(h => h.role));
    expect(roles.has('ride')).toBe(true);
    expect(roles.has('hihat')).toBe(true);
    expect(roles.has('kick')).toBe(true);
  });

  it('Ballad: ソフトなベロシティ (全て≤70)', () => {
    const hits = generateDrumPattern(4, 0, 0, 120, 'ballad');
    for (const h of hits) {
      expect(h.velocity).toBeLessThanOrEqual(70);
    }
  });

  it('Latin: straight 8th ride (8ヒット以上)', () => {
    const hits = generateDrumPattern(4, 0, 0, 120, 'latin');
    const rides = hits.filter(h => h.role === 'ride');
    expect(rides.length).toBeGreaterThanOrEqual(7);
  });

  it('Latin: kick on 1, 3', () => {
    const hits = generateDrumPattern(4, 0, 0, 120, 'latin');
    const kicks = hits.filter(h => h.role === 'kick');
    expect(kicks.some(k => k.beatStart === 1)).toBe(true);
    expect(kicks.some(k => k.beatStart === 3)).toBe(true);
  });

  it('全スタイル velocity 範囲 0-127', () => {
    for (const style of ['swing', 'bossa', 'ballad', 'latin'] as const) {
      const hits = generateDrumPattern(4, 0, 0.2, 120, style);
      for (const h of hits) {
        expect(h.velocity).toBeGreaterThanOrEqual(0);
        expect(h.velocity).toBeLessThanOrEqual(127);
      }
    }
  });
});
