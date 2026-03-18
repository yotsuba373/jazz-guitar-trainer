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

export type DrumPatternDB = Record<string, DrumPatternEntry[]>;

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
    if (Object.keys(data).length === 0) return null;
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

/** テスト用: キャッシュクリア */
export function clearDrumPatternDBCache(): void {
  cachedDB = null;
  loadAttempted = false;
}
