/**
 * ドラムパターン DB のロード・取得。
 *
 * public/drum-patterns.json を fetch してキャッシュ。
 * DB がなくてもアルゴリズム生成にフォールバックするため、ロード失敗はエラーにしない。
 */

import type { DrumHit } from './drumPatterns';

/** 4小節パターン。measures[0]〜[3] が各小節の DrumHit[] */
export interface DrumPatternEntry {
  id: string;
  measures: DrumHit[][];
}

/**
 * スタイル別サンプルマップ: pitch(文字列) → 利用可能ベロシティ値の昇順配列。
 * 例: { "51": [20, 60, 100, 127], "38": [40, 80] }
 */
export type SampleMap = Record<string, number[]>;

export interface DrumPatternDB {
  patterns: Record<string, DrumPatternEntry[]>;
  samples: Record<string, SampleMap>;  // style → SampleMap
  kits: Record<string, string>;        // style → kit フォルダ名
}

let cachedDB: DrumPatternDB | null = null;
let loadAttempted = false;

/** DB を非同期ロード (キャッシュ)。ファイル不在時は null を返す */
export async function loadDrumPatternDB(): Promise<DrumPatternDB | null> {
  if (cachedDB) return cachedDB;
  if (loadAttempted) return null;
  loadAttempted = true;
  try {
    const resp = await fetch('/drum-patterns.json');
    if (!resp.ok) return null;
    const data = await resp.json() as DrumPatternDB;
    if (!data.patterns || Object.keys(data.patterns).length === 0) return null;
    cachedDB = data;
    return cachedDB;
  } catch {
    return null;
  }
}

/** ロード済み DB を同期取得 (未ロードなら null) */
export function getDrumPatternDB(): DrumPatternDB | null {
  return cachedDB;
}

/**
 * 利用可能なベロシティ値の中から最も近いものを返す。
 * velocities は昇順ソート済みを想定。
 */
export function findNearestVelocity(velocities: number[], target: number): number {
  if (velocities.length === 1) return velocities[0];
  let best = velocities[0];
  let bestDist = Math.abs(target - best);
  for (let i = 1; i < velocities.length; i++) {
    const dist = Math.abs(target - velocities[i]);
    if (dist < bestDist) {
      best = velocities[i];
      bestDist = dist;
    }
  }
  return best;
}

/** テスト用: キャッシュクリア */
export function clearDrumPatternDBCache(): void {
  cachedDB = null;
  loadAttempted = false;
}
