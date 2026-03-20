import type { BackingStyle } from '../types';
import { getCompConfig } from './configLoader';

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
  const cfg = getCompConfig();

  if (beats <= 1) {
    return [{ beatStart: 0, duration: beats, velocity: cfg.shortChordVelocity }];
  }

  let events: CompEvent[];

  switch (style) {
    case 'medium-up-swing':
    case 'up-tempo-swing':
    case 'medium-swing': {
      const measureIdx = Math.floor(globalBeatOffset / 4);
      events = (measureIdx % 2 === 0 ? cfg.swing.even : cfg.swing.odd).map(e => ({ ...e }));
      break;
    }
    case 'bossa':
      events = cfg.bossa.map(e => ({ ...e }));
      break;
    case 'ballad':
      events = cfg.ballad.map(e => ({ ...e }));
      break;
    case 'latin':
      events = cfg.latin.map(e => ({ ...e }));
      break;
    default:
      events = [{ beatStart: 0, duration: beats, velocity: cfg.defaultVelocity }];
  }

  return events.filter(e => e.beatStart < beats);
}
