import { Sampler } from 'smplr';
import type { Soundfont } from 'smplr';
import type { BackingStyle } from '../types';
import type { DrumAudioHandle } from '../hooks/useAudioContext';
import { getBassConfig } from './configLoader';
import type { BassConfig, SwingStyleOverrides } from './configLoader';
import { midiToFileName } from './drumPatterns';
import { findNearestVelocity } from './drumPatternDB';

export interface BassNote {
  midi: number;       // MIDI note number (E1=28 ~ C4=60)
  beatStart: number;  // beat offset within chord (0-based)
  duration: number;   // beats
  velocity?: number;  // 0-127, undefined → config default
}

/** Root name → pitch class (0-11) */
const ROOT_PC: Record<string, number> = {
  'C': 0, 'D♭': 1, 'Db': 1, 'C#': 1,
  'D': 2, 'E♭': 3, 'Eb': 3, 'D#': 3,
  'E': 4, 'F♭': 4, 'Fb': 4,
  'F': 5, 'G♭': 6, 'Gb': 6, 'F#': 6,
  'G': 7, 'A♭': 8, 'Ab': 8, 'G#': 8,
  'A': 9, 'B♭': 10, 'Bb': 10, 'A#': 10,
  'B': 11, 'C♭': 11, 'Cb': 11,
};

// ---------------------------------------------------------------------------
// Seeded PRNG (小節ごとに再現可能なランダム)
// ---------------------------------------------------------------------------

/** Mulberry32 — 軽量な 32-bit PRNG, 0-1 を返す */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ベース値 ± range のランダム揺れ, [lo, hi] にクランプ */
function humanize(
  rng: () => number, base: number, range: number,
  lo = 0, hi = 127,
): number {
  const v = Math.round(base + (rng() * 2 - 1) * range);
  return Math.max(lo, Math.min(hi, v));
}

/** BassNote を生成 (velocity は cfg から humanize) */
function mkNote(
  midi: number, beatStart: number, duration: number,
  rng: () => number, cfg: BassConfig,
  velocityOverride?: number,
): BassNote {
  return {
    midi, beatStart, duration,
    velocity: velocityOverride ?? humanize(rng, cfg.velocity, cfg.velocityHumanize),
  };
}

// ---------------------------------------------------------------------------
// Chord tone helpers
// ---------------------------------------------------------------------------

/**
 * コード品質からコードトーン半音オフセットを返す。
 * [root=0, 3rd, 5th, 7th]
 */
function chordToneOffsets(quality: string): number[] {
  if (quality.startsWith('m7b5') || quality.startsWith('m7♭5')) return [0, 3, 6, 10];
  if (quality === 'dim7' || quality === 'dim') return [0, 3, 6, 9];
  if (quality.startsWith('m')) return [0, 3, 7, 10]; // m7, m6, mM7
  if (quality === '7' || quality.startsWith('7')) return [0, 4, 7, 10]; // dominant
  return [0, 4, 7, 11]; // maj7 default
}

/** コード品質 → パターンテンプレートキー */
function qualityToPatternKey(quality: string): string {
  if (quality.startsWith('m7b5') || quality.startsWith('m7♭5')) return 'm7b5';
  if (quality === 'dim7' || quality === 'dim') return 'dim7';
  if (quality.startsWith('m')) return 'm7';
  if (quality === '7' || quality.startsWith('7')) return 'dom7';
  return 'maj7';
}

/**
 * ルートごとの上オクターブ使用確率。
 * iReal Pro 5曲×30コーラスの MIDI 分析に基づく。
 */
const ALT_OCTAVE_PROB: Record<number, number> = {
  3: 0.07,  // Eb
  7: 0.34,  // G
  8: 0.30,  // Ab
  9: 0.22,  // A
  10: 0.18, // Bb
  11: 0.22, // B
};

/**
 * ルートの半音値 (0-11) からベースレジスター内の MIDI ノートを返す。
 * rng が渡された場合、iReal Pro 分析に基づく確率でオクターブを切替。
 * isAlt 出力: 上オクターブが選択されたかどうかを返す。
 */
function rootToBassMidi(
  rootSemi: number,
  rng?: () => number,
): { midi: number; isAlt: boolean } {
  const cfg = getBassConfig();
  const base = cfg.bassRootBase;
  const basePc = base % 12;
  let midi = base + ((rootSemi - basePc + 12) % 12);
  if (midi > base + 6) midi -= 12;

  const altProb = ALT_OCTAVE_PROB[rootSemi] ?? 0;
  if (altProb > 0 && rng && rng() < altProb) {
    const alt = midi + 12;
    if (alt <= cfg.midiRange.high) {
      return { midi: alt, isAlt: true };
    }
  }
  return { midi, isAlt: false };
}

/** MIDI ノートを音域内にクランプ (オクターブ単位) */
function clampMidi(n: number, cfg: BassConfig): number {
  let m = n;
  while (m > cfg.midiRange.high) m -= 12;
  while (m < cfg.midiRange.low) m += 12;
  return m;
}

// ---------------------------------------------------------------------------
// Approach note generation
// ---------------------------------------------------------------------------

/**
 * 次ルートへのアプローチノートを返す (種類は rng で選択)。
 *
 * 教育的コンセンサスに基づく5種類:
 *   chromatic: 半音下(35%) + 半音上(15%) = 50%
 *   diatonic:  全音上/下 (前ノートに近い方) = 20%
 *   dominant:  5度上 (V→I モーション) = 20%
 *   arpeggio:  3度/4度コードトーン跳躍 = 10%
 *
 * Sources: Ed Friedland, Learn Jazz Standards, FiloBass (ISMIR 2023),
 *          Chris Fitzgerald (U of Louisville)
 */
function resolveApproach(
  rng: () => number,
  prevMidi: number,
  nextRootSemi: number | null,
  rootMidi: number,
  cfg: BassConfig,
): number {
  if (nextRootSemi == null) return rootMidi;
  const nextMidi = rootToBassMidi(nextRootSemi).midi;
  const clamp = (n: number) => clampMidi(n, cfg);
  const closer = (a: number, b: number) =>
    Math.abs(clamp(a) - prevMidi) <= Math.abs(clamp(b) - prevMidi) ? clamp(a) : clamp(b);

  const r = rng();
  const { chromatic, diatonic, dominant } = cfg.patterns.swing.approachWeights;

  if (r < chromatic) {
    // 半音アプローチ: 下から 70% / 上から 30% (leading tone bias)
    return rng() < 0.7 ? clamp(nextMidi - 1) : clamp(nextMidi + 1);
  } else if (r < chromatic + diatonic) {
    // ダイアトニック全音アプローチ (前ノートに近い方)
    return closer(nextMidi - 2, nextMidi + 2);
  } else if (r < chromatic + diatonic + dominant) {
    // ドミナントアプローチ: 5度上 (V→I モーション)
    return clamp(nextMidi + 7);
  } else {
    // アルペジオ跳躍: 3度上 or 4度下 (コードトーン的接続)
    return closer(nextMidi + 4, nextMidi - 5);
  }
}

/** 半音アプローチのみ (Bossa/Ballad/Latin 用、既存互換) */
function chromaticApproach(currentRootMidi: number, nextRootSemi: number, cfg: BassConfig): number {
  const nextMidi = rootToBassMidi(nextRootSemi).midi;
  const above = nextMidi + 1;
  const below = nextMidi - 1;
  const clamp = (n: number) => clampMidi(n, cfg);
  return Math.abs(clamp(below) - currentRootMidi) <= Math.abs(clamp(above) - currentRootMidi)
    ? clamp(below) : clamp(above);
}

// ---------------------------------------------------------------------------
// Bass Phrase DB (iReal Pro から抽出したパターン)
// ---------------------------------------------------------------------------

/** DB pattern note: [beatPosition, semitoneOffset] */
type DBNote = [number, number];

export interface BassPhraseDB {
  patterns: Record<string, Record<string, Record<string, DBNote[][]>>>;  // style → quality → beats → [[beat, semi], ...][]
  weights: Record<string, Record<string, Record<string, number[]>>>;     // style → quality → beats → occurrence counts
}

let cachedPhraseDB: BassPhraseDB | null = null;
let phraseDBLoadAttempted = false;

/** bass-phrases.generated.json を非同期ロード (キャッシュ)。ファイル不在時は null */
export async function loadBassPhraseDB(): Promise<BassPhraseDB | null> {
  if (cachedPhraseDB) return cachedPhraseDB;
  if (phraseDBLoadAttempted) return null;
  phraseDBLoadAttempted = true;
  try {
    const resp = await fetch('/bass-phrases.generated.json');
    if (!resp.ok) return null;
    cachedPhraseDB = await resp.json() as BassPhraseDB;
    return cachedPhraseDB;
  } catch {
    return null;
  }
}

/** ロード済み DB を同期取得 (未ロードなら null) */
export function getBassPhraseDB(): BassPhraseDB | null {
  return cachedPhraseDB;
}

/** テスト用: キャッシュクリア */
export function clearBassPhraseDBCache(): void {
  cachedPhraseDB = null;
  phraseDBLoadAttempted = false;
}

/**
 * パターンの最終音と次コードルートの距離に基づくアプローチボーナス。
 * TS 実コード (generateBassLine + mulberry32 PRNG) でグリッドサーチ最適化。
 * iReal Pro 5曲×30コーラスの approach 分布と全距離 ±0.3% で一致。
 */
const APPROACH_BONUS: Record<number, number> = {
  0: 0.776,  // unison
  1: 1.410,  // half step
  2: 0.361,  // whole step
  3: 0.744,  // minor 3rd
  4: 1.883,  // major 3rd
  5: 0.455,  // perfect 4th/5th
  6: 0.663,  // tritone
};

/** Style fallback chains: try exact style first, then progressively simpler */
const STYLE_FALLBACK: Partial<Record<BackingStyle, BackingStyle[]>> = {
  'up-tempo-swing': ['medium-up-swing', 'medium-swing'],
  'medium-up-swing': ['medium-swing'],
};

/**
 * DB パターンから重み付きランダム選択。
 * 次コードが既知の場合、最終音のアプローチ品質で重みを調整。
 * @returns [[beat, semitone], ...] 配列、または null (DB パターンなし)
 */
function selectDBPattern(
  rng: () => number,
  quality: string,
  beats: number,
  style: BackingStyle = 'medium-swing',
  rootSemi?: number,
  nextRootSemi?: number | null,
  isAlt?: boolean,
): DBNote[] | null {
  const db = cachedPhraseDB;
  if (!db) return null;
  const patKey = qualityToPatternKey(quality);
  const altKey = `${beats}_alt`;
  const defaultKey = String(beats);

  // Try style chain: exact style → fallbacks
  const stylesToTry: BackingStyle[] = [style, ...(STYLE_FALLBACK[style] ?? [])];

  let patterns: DBNote[][] | undefined;
  let weights: number[] | undefined;

  for (const s of stylesToTry) {
    const styleData = db.patterns?.[s];
    if (!styleData) continue;
    // Alt octave → try alt pool first, fallback to default
    if (isAlt) {
      patterns = styleData[patKey]?.[altKey];
      weights = db.weights?.[s]?.[patKey]?.[altKey];
      if (patterns?.length) break;
    }
    patterns = styleData[patKey]?.[defaultKey];
    weights = db.weights?.[s]?.[patKey]?.[defaultKey];
    if (patterns?.length) break;
  }

  if (!patterns || !weights || patterns.length === 0) return null;

  // Compute effective weights: base weight × approach bonus
  const effectiveWeights = weights.map((w, i) => {
    if (nextRootSemi == null || rootSemi == null) return w;
    const pat = patterns[i];
    const lastOffset = pat[pat.length - 1][1]; // signed offset from root
    // Absolute pitch class of last note (handle negative offsets)
    const lastPC = ((rootSemi + lastOffset) % 12 + 12) % 12;
    // Min distance to next root (0-6)
    let dist = Math.abs(lastPC - nextRootSemi) % 12;
    if (dist > 6) dist = 12 - dist;
    const bonus = APPROACH_BONUS[dist] ?? 1.0;
    return w * bonus;
  });

  // Weighted random selection
  const totalWeight = effectiveWeights.reduce((a, b) => a + b, 0);
  let r = rng() * totalWeight;
  for (let i = 0; i < effectiveWeights.length; i++) {
    r -= effectiveWeights[i];
    if (r <= 0) return patterns[i];
  }
  return patterns[0];
}

// ---------------------------------------------------------------------------
// Walking bass pattern templates (度数ベース, DB フォールバック用)
// ---------------------------------------------------------------------------

/**
 * 度数インデックス:
 *   0=root, 1=3rd, 2=5th, 3=7th, 4=octave
 *   -1=approach (次コードへ)
 *   -2=scale step up from root (2nd)
 *   -3=scale step down from root (7th below)
 *
 * 各パターンは 4拍分: [deg0, deg1, deg2, deg3]
 * beat 0 は常にルート (パターン適用時に強制)
 */
type DegreePattern = number[];

const SWING_4BEAT_PATTERNS: Record<string, DegreePattern[]> = {
  maj7: [
    [0, 1, 2, -1],  // R-3-5-approach
    [0, 2, 1, -1],  // R-5-3-approach
    [0, -2, 1, -1], // R-2nd-3-approach
    [0, 2, 4, -1],  // R-5-oct-approach
    [0, -3, 2, -1], // R-7th(below)-5-approach
    [0, 1, -2, -1], // R-3-2nd(passing)-approach
  ],
  m7: [
    [0, 1, 2, -1],  // R-b3-5-approach
    [0, 2, 1, -1],  // R-5-b3-approach
    [0, -2, 1, -1], // R-2nd-b3-approach
    [0, 3, 2, -1],  // R-b7-5-approach
    [0, 1, 4, -1],  // R-b3-oct-approach
  ],
  dom7: [
    [0, 1, 2, -1],  // R-3-5-approach
    [0, 2, 1, -1],  // R-5-3-approach
    [0, -2, 1, -1], // R-2nd-3-approach
    [0, 2, 3, -1],  // R-5-b7-approach
    [0, -3, 2, -1], // R-b7(below)-5-approach
    [0, 1, 2, 3],   // R-3-5-b7 (arpeggio, no approach)
  ],
  m7b5: [
    [0, 1, 2, -1],  // R-b3-b5-approach
    [0, 2, 1, -1],  // R-b5-b3-approach
    [0, -2, 1, -1], // R-2nd-b3-approach
  ],
  dim7: [
    [0, 1, 2, -1],  // R-b3-b5-approach
    [0, 2, 1, -1],  // R-b5-b3-approach
    [0, 1, 3, -1],  // R-b3-bb7-approach
  ],
};

/** 3拍用パターン */
const SWING_3BEAT_PATTERNS: Record<string, DegreePattern[]> = {
  maj7: [[0, 1, -1], [0, 2, -1], [0, -2, -1]],
  m7:   [[0, 1, -1], [0, 2, -1], [0, -2, -1]],
  dom7: [[0, 1, -1], [0, 2, -1], [0, 3, -1]],
  m7b5: [[0, 1, -1], [0, 2, -1]],
  dim7: [[0, 1, -1], [0, 2, -1]],
};

/**
 * 度数インデックス → MIDI ノート変換
 * @param degIdx 度数インデックス (0-4, -1, -2, -3)
 * @param rootMidi ルートの MIDI ノート
 * @param offsets コードトーン半音オフセット [R, 3rd, 5th, 7th]
 * @param prevMidi 前ノートの MIDI (approach 方向判定用)
 * @param nextRootSemi 次コードルート半音値
 * @param rng seeded PRNG
 * @param cfg BassConfig
 */
function degreeToMidi(
  degIdx: number,
  rootMidi: number,
  offsets: number[],
  prevMidi: number,
  nextRootSemi: number | null,
  rng: () => number,
  cfg: BassConfig,
): number {
  if (degIdx === -1) {
    // approach note
    return resolveApproach(rng, prevMidi, nextRootSemi, rootMidi, cfg);
  }
  if (degIdx === -2) {
    // scale step up from root (major 2nd = +2 semitones)
    return clampMidi(rootMidi + 2, cfg);
  }
  if (degIdx === -3) {
    // scale step down from root (7th below = root - offsets interval)
    // 7th below root: root - (12 - 7th_offset)
    const seventh = offsets[3];
    return clampMidi(rootMidi - (12 - seventh), cfg);
  }
  if (degIdx === 4) {
    // octave
    return clampMidi(rootMidi + 12, cfg);
  }
  // chord tone (0=R, 1=3rd, 2=5th, 3=7th)
  return clampMidi(rootMidi + offsets[degIdx], cfg);
}

// ---------------------------------------------------------------------------
// Style-specific config resolution
// ---------------------------------------------------------------------------

/** Apply per-swing-style overrides to base config */
function resolveStyleConfig(cfg: BassConfig, style: BackingStyle): BassConfig {
  const overrides: SwingStyleOverrides | undefined = cfg.styleOverrides?.[style];
  if (!overrides) return cfg;
  return {
    ...cfg,
    defaultDuration: overrides.defaultDuration ?? cfg.defaultDuration,
    tripletGrace: {
      ...cfg.tripletGrace,
      ...overrides.tripletGrace,
    },
    patterns: {
      ...cfg.patterns,
      swing: {
        ...cfg.patterns.swing,
        approachWeights: overrides.approachWeights
          ? { ...cfg.patterns.swing.approachWeights, ...overrides.approachWeights }
          : cfg.patterns.swing.approachWeights,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// DB pattern → BassNote[] conversion
// ---------------------------------------------------------------------------

/**
 * DB パターン [[beat, signedOffset], ...] を BassNote[] に変換。
 * 符号付きオフセット: 正=ルート上方, 負=ルート下方 (iReal Pro MIDI から直接計算)。
 * beat position と方向情報をそのまま使用し、duration は次ノートとの間隔から自動計算。
 */
function _dbPatternToNotes(
  dbPat: DBNote[],
  rootMidi: number,
  chordBeats: number,
  rng: () => number,
  cfg: BassConfig,
): BassNote[] {
  return dbPat.map(([beat, offset], i) => {
    const nextBeat = i + 1 < dbPat.length ? dbPat[i + 1][0] : chordBeats;
    const duration = Math.min(nextBeat - beat, cfg.defaultDuration);
    return mkNote(clampMidi(rootMidi + offset, cfg), beat, duration, rng, cfg);
  });
}

// ---------------------------------------------------------------------------
// Grace note helper
// ---------------------------------------------------------------------------

/** 三連符グレースノート: 最終拍前に装飾音を追加 (確率的) */
function _maybeAddGraceNote(
  notes: BassNote[],
  beats: number,
  rng: () => number,
  cfg: BassConfig,
): void {
  if (beats < 4 || rng() >= cfg.tripletGrace.probability) return;
  const lastNote = notes[notes.length - 1];
  const graceTarget = lastNote.midi;
  const graceMidi = clampMidi(graceTarget - 1, cfg);
  const gracePos = lastNote.beatStart - (1 - cfg.tripletGrace.offset);
  if (gracePos > 0) {
    const prevNote = notes[notes.length - 2];
    if (prevNote) {
      prevNote.duration = Math.min(prevNote.duration, gracePos - prevNote.beatStart);
    }
    notes.splice(notes.length - 1, 0, {
      midi: graceMidi,
      beatStart: gracePos,
      duration: 1 - cfg.tripletGrace.offset,
      velocity: cfg.tripletGrace.velocity,
    });
  }
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

/**
 * 1コード分のベースラインを生成。
 *
 * @param rootSemi        ルートの半音値 (0-11, C=0)
 * @param quality         コード品質 ('maj7', 'm7', '7', 'm7b5', 'dim7')
 * @param beats           コードの拍数
 * @param nextRootSemi    次コードのルート半音値 (null = 曲末)
 * @param style           バッキングスタイル
 * @param globalBeatOffset 累積ビートオフセット (PRNG シード用)
 */
export function generateBassLine(
  rootSemi: number,
  quality: string,
  beats: number,
  nextRootSemi: number | null,
  style: BackingStyle = 'medium-swing',
  globalBeatOffset: number = 0,
): BassNote[] {
  const baseCfg = getBassConfig();
  const cfg = resolveStyleConfig(baseCfg, style);

  // Seeded PRNG for this measure
  const measureIdx = Math.floor(globalBeatOffset / 4);
  const rng = mulberry32(measureIdx * cfg.prng.multiplier + cfg.prng.constant);

  // Root octave selection (rng consumed first for deterministic octave choice)
  const { midi: rootMidi, isAlt: rootIsAlt } = rootToBassMidi(rootSemi, rng);
  const offsets = chordToneOffsets(quality);
  const fifth = clampMidi(rootMidi + offsets[2], cfg);

  // Approach note (for non-swing styles using simple chromatic approach)
  const simpleApproach = nextRootSemi != null
    ? chromaticApproach(rootMidi, nextRootSemi, cfg)
    : rootMidi;

  // --- Short chords (1 beat): all styles ---
  if (beats <= 1) {
    return [mkNote(rootMidi, 0, beats, rng, cfg)];
  }

  // --- 2-beat chords: DB pattern or simple approach ---
  if (beats <= 2) {
    const dbPat = selectDBPattern(rng, quality, 2, style, rootSemi, nextRootSemi, rootIsAlt);
    if (dbPat && dbPat.length >= 2) {
      return _dbPatternToNotes(dbPat, rootMidi, beats, rng, cfg);
    }
    return [mkNote(rootMidi, 0, 1, rng, cfg), mkNote(simpleApproach, 1, 1, rng, cfg)];
  }

  // --- Bossa / Ballad: 2-feel (Root + 5th or approach) ---
  if ((style === 'bossa' || style === 'ballad') && beats >= 3) {
    const secondMidi = style === 'bossa' ? fifth : simpleApproach;
    return [mkNote(rootMidi, 0, 2, rng, cfg), mkNote(secondMidi, 2, beats - 2, rng, cfg)];
  }

  // --- Latin: Tumbao ---
  if (style === 'latin' && beats >= 3) {
    const oct = clampMidi(rootMidi + 12, cfg);
    return [
      mkNote(rootMidi, 0, 1, rng, cfg),
      mkNote(fifth, 1.5, 1, rng, cfg),
      mkNote(oct, 3, beats - 3 || 1, rng, cfg),
    ];
  }

  // --- Swing (all swing styles): 4-feel walking bass ---

  // Try DB pattern first ([[beat, semitone], ...] from iReal Pro)
  const dbPat = selectDBPattern(rng, quality, beats, style, rootSemi, nextRootSemi, rootIsAlt);
  if (dbPat && dbPat.length >= beats) {
    return _dbPatternToNotes(dbPat, rootMidi, beats, rng, cfg);
  }

  // --- Fallback: degree-based templates ---
  return _buildFromTemplate(quality, beats, rootMidi, offsets, nextRootSemi, measureIdx, rng, cfg);
}

/** Degree-based template fallback (DB パターンなし時) */
function _buildFromTemplate(
  quality: string, beats: number, rootMidi: number, offsets: number[],
  nextRootSemi: number | null, measureIdx: number,
  rng: () => number, cfg: BassConfig,
): BassNote[] {
  const patKey = qualityToPatternKey(quality);
  const dur = cfg.defaultDuration;

  if (beats === 3) {
    const pool = SWING_3BEAT_PATTERNS[patKey] ?? SWING_3BEAT_PATTERNS['maj7'];
    const pat = pool[Math.floor(rng() * pool.length)];
    const notes: BassNote[] = [];
    let prev = rootMidi;
    for (let i = 0; i < pat.length; i++) {
      const midi = degreeToMidi(pat[i], rootMidi, offsets, prev, nextRootSemi, rng, cfg);
      notes.push(mkNote(midi, i, dur, rng, cfg));
      prev = midi;
    }
    return notes;
  }

  // 4+ beats
  const pool = SWING_4BEAT_PATTERNS[patKey] ?? SWING_4BEAT_PATTERNS['maj7'];
  const pat = pool[Math.floor(rng() * pool.length)];

  const altEvery = cfg.patterns.swing.contourAlternateEvery;
  const descending = altEvery > 0 && Math.floor(measureIdx / altEvery) % 2 === 1;

  const notes: BassNote[] = [];
  let prev = rootMidi;

  for (let i = 0; i < Math.min(pat.length, beats); i++) {
    let midi = degreeToMidi(pat[i], rootMidi, offsets, prev, nextRootSemi, rng, cfg);
    if (descending && i >= 1 && i <= 2 && pat[i] >= 0) {
      const lowered = midi - 12;
      if (lowered >= cfg.midiRange.low) midi = lowered;
    }
    notes.push(mkNote(midi, i, dur, rng, cfg));
    prev = midi;
  }

  for (let i = pat.length; i < beats; i++) {
    const appMidi = resolveApproach(rng, prev, nextRootSemi, rootMidi, cfg);
    notes.push(mkNote(appMidi, i, dur, rng, cfg));
    prev = appMidi;
  }

  _maybeAddGraceNote(notes, beats, rng, cfg);
  return notes;
}

// ---------------------------------------------------------------------------
// Bass Pattern DB (drum-patterns.generated.json と同構造)
// ---------------------------------------------------------------------------

import type { SampleMap } from './drumPatternDB';

export interface BassPatternDB {
  patterns: Record<string, unknown[]>;  // 将来のパターン DB 用 (現在は空)
  samples: Record<string, SampleMap>;   // kitName → { pitch: velocities[] }
  kits: Record<string, string>;         // style → kit フォルダ名
}

let cachedBassDB: BassPatternDB | null = null;
let bassDBLoadAttempted = false;

/** bass-patterns.generated.json を非同期ロード (キャッシュ)。ファイル不在時は null */
export async function loadBassPatternDB(): Promise<BassPatternDB | null> {
  if (cachedBassDB) return cachedBassDB;
  if (bassDBLoadAttempted) return null;
  bassDBLoadAttempted = true;
  try {
    const resp = await fetch('/bass-patterns.generated.json');
    if (!resp.ok) return null;
    const data = await resp.json() as BassPatternDB;
    cachedBassDB = data;
    return cachedBassDB;
  } catch {
    return null;
  }
}

/** ロード済み DB を同期取得 (未ロードなら null) */
export function getBassPatternDB(): BassPatternDB | null {
  return cachedBassDB;
}

/** テスト用: キャッシュクリア */
export function clearBassPatternDBCache(): void {
  cachedBassDB = null;
  bassDBLoadAttempted = false;
}

// ---------------------------------------------------------------------------
// Bass Sampler (カスタム WAV + SoundFont フォールバック)
// ---------------------------------------------------------------------------

export interface BassSamplerSet {
  soundfont: Soundfont;
  customByStyle: Record<string, Sampler>;
  keyMapByStyle: Record<string, Map<string, string>>;
}

let cachedBassSampler: BassSamplerSet | null = null;
let bassLoadPromise: Promise<BassSamplerSet> | null = null;

/** MIDI ノート番号 → smplr 用音名 (C#表記) */
const SMPLR_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToSmplrNote(midi: number): string {
  const name = SMPLR_NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/** SampleMap からカスタム Sampler 用 buffers マップを構築 */
function buildBassBuffers(
  kitFolder: string,
  sampleMap: SampleMap,
): { buffers: Record<string, string>; keyMap: Map<string, string> } {
  const buffers: Record<string, string> = {};
  const keyMap = new Map<string, string>();
  let slotIdx = 0;

  for (const [pitchStr, velocities] of Object.entries(sampleMap)) {
    const pitch = Number(pitchStr);
    const fileName = midiToFileName(pitch);
    for (const v of velocities) {
      const smplrKey = midiToSmplrNote(slotIdx);
      buffers[smplrKey] = `/bass/${kitFolder}/${fileName}_v${v}.wav`;
      keyMap.set(`${pitch}_${v}`, smplrKey);
      slotIdx++;
    }
  }
  return { buffers, keyMap };
}

/**
 * カスタム WAV ベースサンプラーをロード (キャッシュ)。
 * bass-patterns.generated.json の samples/kits からスタイル別に Sampler を構築。
 * WAV がない場合は SoundFont フォールバック。
 */
export async function loadBassSampler(ctx: AudioContext, soundfont: Soundfont): Promise<BassSamplerSet> {
  if (cachedBassSampler) return cachedBassSampler;
  if (bassLoadPromise) return bassLoadPromise;
  bassLoadPromise = (async () => {
    const customByStyle: Record<string, Sampler> = {};
    const keyMapByStyle: Record<string, Map<string, string>> = {};

    try {
      // bass-patterns.generated.json をロード
      await loadBassPatternDB();
      const db = getBassPatternDB();
      const cfg = getBassConfig();
      if (db?.samples && Object.keys(db.samples).length > 0) {
        const samplerByKit: Record<string, Sampler> = {};
        const keyMapByKit: Record<string, Map<string, string>> = {};
        const loadTasks: Promise<void>[] = [];

        // キットごとに1つの Sampler をロード (samples はキット軸)
        for (const [kitFolder, sampleMap] of Object.entries(db.samples)) {
          if (Object.keys(sampleMap).length === 0) continue;
          const { buffers, keyMap } = buildBassBuffers(kitFolder, sampleMap);
          if (Object.keys(buffers).length === 0) continue;
          samplerByKit[kitFolder] = null!;
          keyMapByKit[kitFolder] = keyMap;
          const kitGain = cfg.kitGains[kitFolder] ?? 1.0;
          loadTasks.push(
            (async () => {
              const cwCfg = cfg.customWAV;
              const sampler = new Sampler(ctx, { buffers, detune: cwCfg.detune, decayTime: cwCfg.decayTime });
              await sampler.load;
              sampler.output.setVolume(cwCfg.volume);
              if (kitGain !== 1.0) {
                const boost = ctx.createGain();
                boost.gain.value = kitGain;
                sampler.output.addInsert(boost);
              }
              samplerByKit[kitFolder] = sampler;
            })().catch(() => { delete samplerByKit[kitFolder]; }),
          );
        }
        await Promise.all(loadTasks);

        // スタイル → キットの Sampler + keyMap をマッピング
        for (const [style, kitFolder] of Object.entries(db.kits ?? {})) {
          if (samplerByKit[kitFolder]) {
            customByStyle[style] = samplerByKit[kitFolder];
            keyMapByStyle[style] = keyMapByKit[kitFolder];
            console.log(`[bass] ${style} → custom kit "${kitFolder}"`);
          } else {
            console.warn(`[bass] ${style} → fallback (kit "${kitFolder}" WAV not found)`);
          }
        }
      }
    } catch { /* カスタム WAV なし → SoundFont フォールバック */ }

    if (Object.keys(customByStyle).length === 0) {
      console.log('[bass] No custom kits loaded, using SoundFont for all styles');
    }

    cachedBassSampler = { soundfont, customByStyle, keyMapByStyle };
    return cachedBassSampler;
  })();
  return bassLoadPromise;
}

/** ロード済みベースサンプラーを取得 (未ロードなら null) */
export function getBassSampler(): BassSamplerSet | null {
  return cachedBassSampler;
}

// ---------------------------------------------------------------------------
// smplr bass playback (voice stealing + letRing)
// ---------------------------------------------------------------------------

let bassIdCounter = 0;

// ベースは単音楽器 → 前ノートを常に停止 (voice stealing)
let lastBassHit: { stopId: string; sampler: Sampler | Soundfont; endTime: number } | null = null;

/**
 * smplr ベースでウォーキングベースライン再生。
 * カスタム WAV あり → Sampler、なし → SoundFont フォールバック。
 * voice stealing: 新ノート発音時に前ノートを停止予約。
 * DrumAudioHandle: stop() で全停止、letRing() で未来ノートのみキャンセル。
 */
export function playSmplrBassLine(
  ctx: AudioContext,
  bassSamplers: BassSamplerSet,
  rootName: string,
  quality: string,
  beats: number,
  nextRootName: string | null,
  startAt: number,
  bpm: number,
  style: BackingStyle = 'medium-swing',
  globalBeatOffset: number = 0,
): DrumAudioHandle {
  const rootSemi = ROOT_PC[rootName] ?? 0;
  const nextRootSemi = nextRootName != null ? (ROOT_PC[nextRootName] ?? null) : null;
  const bassLine = generateBassLine(rootSemi, quality, beats, nextRootSemi, style, globalBeatOffset);
  const beatSec = 60 / bpm;
  const cfg = getBassConfig();

  const customSampler = bassSamplers.customByStyle[style];
  const db = getBassPatternDB();
  const kitFolder = db?.kits?.[style] ?? style;
  const sampleMap = db?.samples?.[kitFolder];
  const keyMap = bassSamplers.keyMapByStyle[style];

  const scheduledHits: { stopId: string; sampler: Sampler | Soundfont; time: number }[] = [];

  for (const bn of bassLine) {
    const noteTime = startAt + bn.beatStart * beatSec;
    const noteVel = bn.velocity ?? cfg.velocity;
    const noteDur = bn.duration * beatSec;
    const hitStopId = `bass-${++bassIdCounter}`;

    // voice stealing: 前ノートを duration 考慮して停止
    if (lastBassHit) {
      const stopTime = Math.min(noteTime, lastBassHit.endTime);
      try { (lastBassHit.sampler as Sampler).stop({ stopId: lastBassHit.stopId, time: stopTime }); } catch { /* ignore */ }
    }

    if (customSampler && sampleMap && keyMap) {
      // カスタム WAV Sampler
      const velocities = sampleMap[String(bn.midi)];
      if (!velocities || velocities.length === 0) {
        // このピッチの WAV がない → SoundFont フォールバック
        _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, noteVel, noteDur, scheduledHits);
        continue;
      }
      const nearestVel = findNearestVelocity(velocities, noteVel);
      const smplrKey = keyMap.get(`${bn.midi}_${nearestVel}`);
      if (!smplrKey) {
        _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, noteVel, noteDur, scheduledHits);
        continue;
      }

      customSampler.start({
        note: smplrKey,
        velocity: 127, // ベロシティレイヤーに既にダイナミクスが焼き込み済み
        time: noteTime,
        stopId: hitStopId,
      });
      scheduledHits.push({ stopId: hitStopId, sampler: customSampler, time: noteTime });
      lastBassHit = { stopId: hitStopId, sampler: customSampler, endTime: noteTime + noteDur };
    } else {
      // SoundFont フォールバック
      _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, noteVel, noteDur, scheduledHits);
    }
  }

  return {
    stop: () => {
      for (const h of scheduledHits) {
        try { (h.sampler as Sampler).stop({ stopId: h.stopId }); } catch { /* ignore */ }
      }
    },
    letRing: () => {
      const now = ctx.currentTime;
      for (const h of scheduledHits) {
        if (h.time > now + 0.03) {
          try { (h.sampler as Sampler).stop({ stopId: h.stopId }); } catch { /* ignore */ }
        }
      }
    },
  };
}

/** SoundFont でベースノートを再生 (duration ベース) */
function _playSoundfontNote(
  sf: Soundfont,
  bn: BassNote,
  noteTime: number,
  hitStopId: string,
  velocity: number,
  durationSec: number,
  scheduledHits: { stopId: string; sampler: Sampler | Soundfont; time: number }[],
): void {
  sf.start({
    note: bn.midi,
    velocity,
    time: noteTime,
    duration: durationSec,
    stopId: hitStopId,
  });
  scheduledHits.push({ stopId: hitStopId, sampler: sf, time: noteTime });
  lastBassHit = { stopId: hitStopId, sampler: sf, endTime: noteTime + durationSec };
}
