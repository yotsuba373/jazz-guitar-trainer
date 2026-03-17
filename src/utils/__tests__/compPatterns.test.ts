import { describe, it, expect } from 'vitest';
import { generateCompPattern } from '../compPatterns';

describe('generateCompPattern', () => {
  describe('Swing', () => {
    it('偶数小節: Charleston (2イベント)', () => {
      const events = generateCompPattern(4, 'swing', 0); // measureIdx=0 (偶数)
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ beatStart: 0, duration: 1.5, velocity: 80 });
      expect(events[1]).toEqual({ beatStart: 2.5, duration: 0.5, velocity: 65 });
    });

    it('奇数小節: ロングサスティーン (1イベント)', () => {
      const events = generateCompPattern(4, 'swing', 4); // measureIdx=1 (奇数)
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ beatStart: 0, duration: 2, velocity: 75 });
    });
  });

  describe('Bossa', () => {
    it('4拍: 3イベント', () => {
      const events = generateCompPattern(4, 'bossa', 0);
      expect(events).toHaveLength(3);
      expect(events[0].beatStart).toBe(0);
      expect(events[1].beatStart).toBe(1.5);
      expect(events[2].beatStart).toBe(3);
    });

    it('2拍: beat 0 と beat 1.5 のみ', () => {
      const events = generateCompPattern(2, 'bossa', 0);
      expect(events).toHaveLength(2);
      expect(events.every(e => e.beatStart < 2)).toBe(true);
    });
  });

  describe('Ballad', () => {
    it('4拍: 1イベント (ロングサスティーン)', () => {
      const events = generateCompPattern(4, 'ballad', 0);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ beatStart: 0, duration: 4, velocity: 70 });
    });
  });

  describe('Latin', () => {
    it('4拍: 6イベント (モンテューノ風)', () => {
      const events = generateCompPattern(4, 'latin', 0);
      expect(events).toHaveLength(6);
      expect(events[0].beatStart).toBe(0);
      expect(events[5].beatStart).toBe(3.5);
    });

    it('2拍: beatStart < 2 のみ', () => {
      const events = generateCompPattern(2, 'latin', 0);
      expect(events.every(e => e.beatStart < 2)).toBe(true);
    });
  });

  describe('共通', () => {
    it('beats=1: 全スタイル共通で1イベント', () => {
      for (const style of ['swing', 'bossa', 'ballad', 'latin'] as const) {
        const events = generateCompPattern(1, style, 0);
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ beatStart: 0, duration: 1, velocity: 80 });
      }
    });

    it('velocity 範囲 0-127', () => {
      for (const style of ['swing', 'bossa', 'ballad', 'latin'] as const) {
        const events = generateCompPattern(4, style, 0);
        for (const e of events) {
          expect(e.velocity).toBeGreaterThanOrEqual(0);
          expect(e.velocity).toBeLessThanOrEqual(127);
        }
      }
    });

    it('全イベントの beatStart < beats', () => {
      for (const style of ['swing', 'bossa', 'ballad', 'latin'] as const) {
        for (const beats of [2, 3, 4]) {
          const events = generateCompPattern(beats, style, 0);
          for (const e of events) {
            expect(e.beatStart).toBeLessThan(beats);
          }
        }
      }
    });
  });
});
