import type { BackingStyle } from '../types';

export interface CompEvent {
  beatStart: number;  // コード内 beat offset (0-based)
  duration: number;   // beats
  velocity: number;   // 0-127
}

/**
 * スタイル別コンピングパターンを生成。
 *
 * @param beats           コードの拍数
 * @param style           バッキングスタイル
 * @param globalBeatOffset 曲全体での累積拍数 (バリエーション用)
 */
export function generateCompPattern(
  beats: number,
  style: BackingStyle,
  globalBeatOffset: number,
): CompEvent[] {
  if (beats <= 1) {
    return [{ beatStart: 0, duration: beats, velocity: 80 }];
  }

  let events: CompEvent[];

  switch (style) {
    case 'medium-swing': {
      const measureIdx = Math.floor(globalBeatOffset / 4);
      if (measureIdx % 2 === 0) {
        // Charleston: beat 0 (1.5拍) + and-of-2 (0.5拍)
        events = [
          { beatStart: 0, duration: 1.5, velocity: 80 },
          { beatStart: 2.5, duration: 0.5, velocity: 65 },
        ];
      } else {
        // Variation: beat 0 long (2拍)
        events = [
          { beatStart: 0, duration: 2, velocity: 75 },
        ];
      }
      break;
    }
    case 'bossa':
      events = [
        { beatStart: 0, duration: 1, velocity: 75 },
        { beatStart: 1.5, duration: 1, velocity: 65 },
        { beatStart: 3, duration: 0.5, velocity: 60 },
      ];
      break;
    case 'ballad':
      events = [
        { beatStart: 0, duration: 4, velocity: 70 },
      ];
      break;
    case 'latin':
      events = [
        { beatStart: 0, duration: 0.5, velocity: 75 },
        { beatStart: 0.5, duration: 0.5, velocity: 65 },
        { beatStart: 1.5, duration: 0.5, velocity: 70 },
        { beatStart: 2, duration: 0.5, velocity: 65 },
        { beatStart: 3, duration: 0.5, velocity: 70 },
        { beatStart: 3.5, duration: 0.5, velocity: 65 },
      ];
      break;
    default:
      events = [{ beatStart: 0, duration: beats, velocity: 80 }];
  }

  return events.filter(e => e.beatStart < beats);
}
