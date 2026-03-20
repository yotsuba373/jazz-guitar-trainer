import { describe, it, expect } from 'vitest';
import { BACKING_STYLES } from '../backingStyles';
import { generateCompPattern, type CompEvent } from '../compPatterns';
import { generateBassLine } from '../bassPatterns';
import { generateDrumPattern } from '../drumPatterns';
import type { BackingStyle } from '../../types';

const ALL_STYLES: BackingStyle[] = ['medium-swing', 'medium-up-swing', 'up-tempo-swing', 'bossa', 'ballad', 'latin'];

// ---------------------------------------------------------------------------
// backingStyles.ts — 定数構造
// ---------------------------------------------------------------------------
describe('BACKING_STYLES', () => {
  it('6スタイル定義', () => {
    expect(BACKING_STYLES).toHaveLength(6);
  });

  it('全スタイルに key と label がある', () => {
    for (const s of BACKING_STYLES) {
      expect(s.key).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });

  it('key が6種と一致', () => {
    const keys = BACKING_STYLES.map(s => s.key);
    expect(keys).toEqual(['medium-swing', 'medium-up-swing', 'up-tempo-swing', 'bossa', 'ballad', 'latin']);
  });
});

// ---------------------------------------------------------------------------
// compPatterns.ts — スタイル別コンピングパターン
// ---------------------------------------------------------------------------
describe('generateCompPattern', () => {
  it('1拍以下: 全スタイル共通で単発イベント', () => {
    for (const style of ALL_STYLES) {
      const events = generateCompPattern(1, style, 0);
      expect(events).toHaveLength(1);
      expect(events[0].beatStart).toBe(0);
      expect(events[0].duration).toBe(1);
    }
  });

  it('Swing (偶数小節): Charleston パターン (2イベント)', () => {
    const events = generateCompPattern(4, 'medium-swing', 0); // globalBeatOffset=0 → measureIdx=0 (偶数)
    expect(events).toHaveLength(2);
    expect(events[0].beatStart).toBe(0);
    expect(events[0].duration).toBe(1.5);
    expect(events[1].beatStart).toBe(2.5);
  });

  it('Swing (奇数小節): ロングバリエーション (1イベント)', () => {
    const events = generateCompPattern(4, 'medium-swing', 4); // globalBeatOffset=4 → measureIdx=1 (奇数)
    expect(events).toHaveLength(1);
    expect(events[0].beatStart).toBe(0);
    expect(events[0].duration).toBe(2);
  });

  it('Bossa: 3イベント (シンコペーション)', () => {
    const events = generateCompPattern(4, 'bossa', 0);
    expect(events).toHaveLength(3);
    expect(events[0].beatStart).toBe(0);
    expect(events[1].beatStart).toBe(1.5);
    expect(events[2].beatStart).toBe(3);
  });

  it('Ballad: 全音符1イベント', () => {
    const events = generateCompPattern(4, 'ballad', 0);
    expect(events).toHaveLength(1);
    expect(events[0].beatStart).toBe(0);
    expect(events[0].duration).toBe(4);
  });

  it('Latin: 6イベント (モントゥーノ風)', () => {
    const events = generateCompPattern(4, 'latin', 0);
    expect(events).toHaveLength(6);
    // 全て0.5拍間隔のシンコペーション
    for (const e of events) {
      expect(e.duration).toBe(0.5);
    }
  });

  it('全スタイル: イベントが拍数を超えない', () => {
    for (const style of ALL_STYLES) {
      for (const beats of [2, 3, 4]) {
        const events = generateCompPattern(beats, style, 0);
        for (const e of events) {
          expect(e.beatStart).toBeLessThan(beats);
        }
      }
    }
  });

  it('全スタイル: velocity が正の値', () => {
    for (const style of ALL_STYLES) {
      const events = generateCompPattern(4, style, 0);
      for (const e of events) {
        expect(e.velocity).toBeGreaterThan(0);
        expect(e.velocity).toBeLessThanOrEqual(127);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// スタイル別統合テスト — コンピング + ベース + ドラムの整合性
// ---------------------------------------------------------------------------
describe('スタイル別統合: 全楽器パターン生成', () => {
  it('Swing: ベース4音 + ドラムにride含む', () => {
    const bass = generateBassLine(0, 'maj7', 4, 7, 'medium-swing');
    const drums = generateDrumPattern(4, 0, 0.2, 140, 'medium-swing');
    expect(bass).toHaveLength(4); // 4-feel
    expect(drums.some(h => h.role === 'ride')).toBe(true);
  });

  it('Bossa: ベース2音 + ドラムにxstick (cross-stick)', () => {
    const bass = generateBassLine(0, 'm7', 4, 7, 'bossa');
    const drums = generateDrumPattern(4, 0, 0, 140, 'bossa');
    expect(bass).toHaveLength(2); // 2-feel
    expect(drums.some(h => h.role === 'xstick')).toBe(true);
  });

  it('Ballad: ベース2音 + ドラム低ベロシティ', () => {
    const bass = generateBassLine(7, '7', 4, 0, 'ballad');
    const drums = generateDrumPattern(4, 0, 0, 60, 'ballad');
    expect(bass).toHaveLength(2); // 2-feel
    for (const h of drums) {
      expect(h.velocity).toBeLessThanOrEqual(70);
    }
  });

  it('Latin: ベース3音 (シンコペーション) + ドラムにstraight 8th ride', () => {
    const bass = generateBassLine(0, 'm7', 4, 7, 'latin');
    const drums = generateDrumPattern(4, 0, 0, 160, 'latin');
    expect(bass).toHaveLength(3); // tumbao
    expect(bass[1].beatStart).toBe(1.5); // syncopated
    const rides = drums.filter(h => h.role === 'ride');
    expect(rides.length).toBeGreaterThanOrEqual(7); // straight 8ths
  });

  it('全スタイル: 2拍コードでもエラーなく生成', () => {
    for (const style of ALL_STYLES) {
      const comp = generateCompPattern(2, style, 0);
      const bass = generateBassLine(0, '7', 2, 5, style);
      const drums = generateDrumPattern(2, 0, 0, 120, style);
      expect(comp.length).toBeGreaterThan(0);
      expect(bass.length).toBeGreaterThan(0);
      expect(drums.length).toBeGreaterThan(0);
    }
  });

  it('全スタイル: 1拍コードでもエラーなく生成', () => {
    for (const style of ALL_STYLES) {
      const comp = generateCompPattern(1, style, 0);
      const bass = generateBassLine(5, 'maj7', 1, 0, style);
      const drums = generateDrumPattern(1, 0, 0, 120, style);
      expect(comp.length).toBeGreaterThan(0);
      expect(bass.length).toBeGreaterThan(0);
      expect(drums.length).toBeGreaterThan(0);
    }
  });
});
