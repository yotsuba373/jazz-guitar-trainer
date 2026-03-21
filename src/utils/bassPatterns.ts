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

// ALT_OCTAVE_PROB は bass-config.json の altOctaveProb / styleOverrides.*.altOctaveProb から読み込み。
// iReal Pro 17曲 beat-1 MIDI 分析に基づくスタイル別確率。

/**
 * ルートの半音値 (0-11) からベースレジスター内の MIDI ノートを返す。
 * rng が渡された場合、altOctaveProb に基づく確率でオクターブを切替。
 * altOctaveProb はスタイル別に bass-config.json から読み込み。
 */
function rootToBassMidi(
  rootSemi: number,
  rng?: () => number,
  altOctaveProb?: Record<string, number>,
): { midi: number; isAlt: boolean } {
  const cfg = getBassConfig();
  const base = cfg.bassRootBase;
  const basePc = base % 12;
  let midi = base + ((rootSemi - basePc + 12) % 12);
  if (midi > base + 6) midi -= 12;

  const prob = altOctaveProb?.[String(rootSemi)] ?? 0;
  if (prob > 0 && rng && rng() < prob) {
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

/** DB pattern note: [beatPosition, semitoneOffset, duration] */
type DBNote = [number, number, number];

export interface BassPhraseDB {
  patterns: Record<string, Record<string, Record<string, DBNote[][]>>>;  // style → quality → beats → [[beat, semi, dur], ...][]
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

/** Style fallback chains: try exact style first, then progressively simpler */
const STYLE_FALLBACK: Partial<Record<BackingStyle, BackingStyle[]>> = {
  'up-tempo-swing': ['medium-up-swing', 'medium-swing'],
  'medium-up-swing': ['medium-swing'],
};

/**
 * DB パターンから重み付きランダム選択。
 * iReal Pro の出現頻度 (weights) をそのまま選択確率として使用。
 * ジャズの和声構造 (4度進行が支配的) により、コードトーン (特に5th/3rd) で
 * 終わるパターンは次コードルートから自然に全音以内に着地するため、
 * アプローチボーナスによる重み調整は不要。
 * @returns [[beat, semitone, duration], ...] 配列、または null (DB パターンなし)
 */
function selectDBPattern(
  rng: () => number,
  quality: string,
  beats: number,
  style: BackingStyle = 'medium-swing',
  _rootSemi?: number,
  _nextRootSemi?: number | null,
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

  // Weighted random selection using raw iReal Pro frequency weights
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = rng() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return patterns[i];
  }
  return patterns[0];
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
    altOctaveProb: overrides.altOctaveProb
      ? { ...cfg.altOctaveProb, ...overrides.altOctaveProb }
      : cfg.altOctaveProb,
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
 * DB パターン [[beat, signedOffset, duration], ...] を BassNote[] に変換。
 * 符号付きオフセット: 正=ルート上方, 負=ルート下方 (iReal Pro MIDI から直接計算)。
 * duration は iReal Pro MIDI の実測値を使用 (note-on → note-off)。
 * duration が DB に含まれない旧フォーマット (2要素) の場合は従来の計算にフォールバック。
 *
 * rootMidi をオクターブ単位でシフトしてパターン全体を音域内に収める。
 * 個別ノートの clampMidi による wrap は旋律線 (コンター) を破壊するため、
 * パターン丸ごとのシフトで対処する。
 */
function _dbPatternToNotes(
  dbPat: DBNote[],
  rootMidi: number,
  chordBeats: number,
  rng: () => number,
  cfg: BassConfig,
): BassNote[] {
  // パターン全体のオフセット範囲を事前計算
  let minOff = 0, maxOff = 0;
  for (const [, offset] of dbPat) {
    if (offset < minOff) minOff = offset;
    if (offset > maxOff) maxOff = offset;
  }

  // rootMidi をオクターブ単位でシフトして全ノートが音域内に収まるようにする
  let root = rootMidi;
  if (root + minOff < cfg.midiRange.low && root + 12 + maxOff <= cfg.midiRange.high) {
    root += 12;
  } else if (root + maxOff > cfg.midiRange.high && root - 12 + minOff >= cfg.midiRange.low) {
    root -= 12;
  }

  return dbPat.map(([beat, offset, dbDur], i) => {
    const duration = dbDur != null
      ? dbDur
      : Math.min((i + 1 < dbPat.length ? dbPat[i + 1][0] : chordBeats) - beat, cfg.defaultDuration);
    return mkNote(clampMidi(root + offset, cfg), beat, duration, rng, cfg);
  });
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
 * @param _prevLastMidi   (未使用: iReal Pro 分析で前音非依存と証明済み)
 */
export function generateBassLine(
  rootSemi: number,
  quality: string,
  beats: number,
  nextRootSemi: number | null,
  style: BackingStyle = 'medium-swing',
  globalBeatOffset: number = 0,
  _prevLastMidi: number | null = null,
): BassNote[] {
  const baseCfg = getBassConfig();
  const cfg = resolveStyleConfig(baseCfg, style);

  // Seeded PRNG for this measure
  const measureIdx = Math.floor(globalBeatOffset / 4);
  const rng = mulberry32(measureIdx * cfg.prng.multiplier + cfg.prng.constant);

  // Root octave selection (rng consumed first for deterministic octave choice)
  let { midi: rootMidi, isAlt: rootIsAlt } = rootToBassMidi(rootSemi, rng, cfg.altOctaveProb);

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

  // DB pattern from iReal Pro (100% coverage expected)
  const dbPat = selectDBPattern(rng, quality, beats, style, rootSemi, nextRootSemi, rootIsAlt);
  if (dbPat && dbPat.length >= beats) {
    return _dbPatternToNotes(dbPat, rootMidi, beats, rng, cfg);
  }

  // Failsafe: root repeat (DB should always have patterns for swing)
  const dur = cfg.defaultDuration;
  return Array.from({ length: beats }, (_, i) => mkNote(rootMidi, i, dur, rng, cfg));
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
  releaseByStyle: Record<string, Sampler>;
  releaseKeyMapByStyle: Record<string, Map<string, string>>;
  legatoByStyle: Record<string, Sampler>;
  legatoKeyMapByStyle: Record<string, Map<string, string>>;
  legatoRelByStyle: Record<string, Sampler>;
  legatoRelKeyMapByStyle: Record<string, Map<string, string>>;
  hammerOnByStyle: Record<string, Sampler>;
  hammerOnKeyMapByStyle: Record<string, Map<string, string>>;
  hammerOnRelByStyle: Record<string, Sampler>;
  hammerOnRelKeyMapByStyle: Record<string, Map<string, string>>;
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
  suffix: string = '',
): { buffers: Record<string, string>; keyMap: Map<string, string> } {
  const buffers: Record<string, string> = {};
  const keyMap = new Map<string, string>();
  let slotIdx = 0;

  for (const [pitchStr, velocities] of Object.entries(sampleMap)) {
    const pitch = Number(pitchStr);
    const fileName = midiToFileName(pitch);
    for (const v of velocities) {
      const smplrKey = midiToSmplrNote(slotIdx);
      buffers[smplrKey] = `/bass/${kitFolder}/${fileName}_v${v}${suffix}.wav`;
      keyMap.set(`${pitch}_${v}`, smplrKey);
      slotIdx++;
    }
  }
  return { buffers, keyMap };
}

/** レガートサンプル用 buffers マップを構築 (固定ベロシティ80) */
function buildLegatoBuffers(
  kitFolder: string,
  pitches: number[],
  prefix: string = 'p80',
  suffix: string = '',
): { buffers: Record<string, string>; keyMap: Map<string, string> } {
  const buffers: Record<string, string> = {};
  const keyMap = new Map<string, string>();
  let slotIdx = 0;

  for (const pitch of pitches) {
    const fileName = midiToFileName(pitch);
    const smplrKey = midiToSmplrNote(slotIdx);
    buffers[smplrKey] = `/bass/${kitFolder}/${fileName}_${prefix}${suffix}.wav`;
    keyMap.set(`${pitch}_80`, smplrKey);
    slotIdx++;
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
    const releaseByStyle: Record<string, Sampler> = {};
    const releaseKeyMapByStyle: Record<string, Map<string, string>> = {};
    const legatoByStyle: Record<string, Sampler> = {};
    const legatoKeyMapByStyle: Record<string, Map<string, string>> = {};
    const legatoRelByStyle: Record<string, Sampler> = {};
    const legatoRelKeyMapByStyle: Record<string, Map<string, string>> = {};
    const hammerOnByStyle: Record<string, Sampler> = {};
    const hammerOnKeyMapByStyle: Record<string, Map<string, string>> = {};
    const hammerOnRelByStyle: Record<string, Sampler> = {};
    const hammerOnRelKeyMapByStyle: Record<string, Map<string, string>> = {};

    try {
      // bass-patterns.generated.json をロード
      await loadBassPatternDB();
      const db = getBassPatternDB();
      const cfg = getBassConfig();
      if (db?.samples && Object.keys(db.samples).length > 0) {
        const samplerByKit: Record<string, Sampler> = {};
        const keyMapByKit: Record<string, Map<string, string>> = {};
        const relSamplerByKit: Record<string, Sampler> = {};
        const relKeyMapByKit: Record<string, Map<string, string>> = {};
        const legSamplerByKit: Record<string, Sampler> = {};
        const legKeyMapByKit: Record<string, Map<string, string>> = {};
        const legRelSamplerByKit: Record<string, Sampler> = {};
        const legRelKeyMapByKit: Record<string, Map<string, string>> = {};
        const hoSamplerByKit: Record<string, Sampler> = {};
        const hoKeyMapByKit: Record<string, Map<string, string>> = {};
        const hoRelSamplerByKit: Record<string, Sampler> = {};
        const hoRelKeyMapByKit: Record<string, Map<string, string>> = {};
        const loadTasks: Promise<void>[] = [];

        // キットごとに1つの Sampler をロード (samples はキット軸)
        for (const [kitFolder, sampleMap] of Object.entries(db.samples)) {
          if (Object.keys(sampleMap).length === 0) continue;
          const { buffers, keyMap } = buildBassBuffers(kitFolder, sampleMap);
          if (Object.keys(buffers).length === 0) continue;
          samplerByKit[kitFolder] = null!;
          keyMapByKit[kitFolder] = keyMap;
          const kitGain = cfg.kitGains[kitFolder] ?? 1.0;
          const cwCfg = cfg.customWAV;

          // メイン Sampler ロード
          loadTasks.push(
            (async () => {
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

          // リリース Sampler ロード (失敗は無視)
          const { buffers: relBuffers, keyMap: relKeyMap } = buildBassBuffers(kitFolder, sampleMap, '_rel');
          relKeyMapByKit[kitFolder] = relKeyMap;
          loadTasks.push(
            (async () => {
              const relSampler = new Sampler(ctx, { buffers: relBuffers, detune: cwCfg.detune, decayTime: cwCfg.decayTime });
              await relSampler.load;
              relSampler.output.setVolume(cwCfg.volume);
              if (kitGain !== 1.0) {
                const boost = ctx.createGain();
                boost.gain.value = kitGain;
                relSampler.output.addInsert(boost);
              }
              relSamplerByKit[kitFolder] = relSampler;
            })().catch(() => { /* リリース WAV なし → リリースなし */ }),
          );

          // レガート Sampler ロード (失敗は無視 → ピチカートにフォールバック)
          const pitches = Object.keys(sampleMap).map(Number);
          const { buffers: legBuffers, keyMap: legKeyMap } = buildLegatoBuffers(kitFolder, pitches);
          legKeyMapByKit[kitFolder] = legKeyMap;
          loadTasks.push(
            (async () => {
              const legSampler = new Sampler(ctx, { buffers: legBuffers, detune: cwCfg.detune, decayTime: cwCfg.decayTime });
              await legSampler.load;
              legSampler.output.setVolume(cwCfg.volume);
              if (kitGain !== 1.0) {
                const boost = ctx.createGain();
                boost.gain.value = kitGain;
                legSampler.output.addInsert(boost);
              }
              legSamplerByKit[kitFolder] = legSampler;
            })().catch(() => { /* レガート WAV なし → ピチカートにフォールバック */ }),
          );

          // レガートリリース Sampler ロード (失敗は無視)
          const { buffers: legRelBuffers, keyMap: legRelKeyMap } = buildLegatoBuffers(kitFolder, pitches, 'p80', '_rel');
          legRelKeyMapByKit[kitFolder] = legRelKeyMap;
          loadTasks.push(
            (async () => {
              const legRelSampler = new Sampler(ctx, { buffers: legRelBuffers, detune: cwCfg.detune, decayTime: cwCfg.decayTime });
              await legRelSampler.load;
              legRelSampler.output.setVolume(cwCfg.volume);
              if (kitGain !== 1.0) {
                const boost = ctx.createGain();
                boost.gain.value = kitGain;
                legRelSampler.output.addInsert(boost);
              }
              legRelSamplerByKit[kitFolder] = legRelSampler;
            })().catch(() => { /* レガートリリース WAV なし */ }),
          );

          // ハンマリングオン Sampler ロード (失敗は無視 → ピチカートにフォールバック)
          const { buffers: hoBuffers, keyMap: hoKeyMap } = buildLegatoBuffers(kitFolder, pitches, 'h80');
          hoKeyMapByKit[kitFolder] = hoKeyMap;
          loadTasks.push(
            (async () => {
              const hoSampler = new Sampler(ctx, { buffers: hoBuffers, detune: cwCfg.detune, decayTime: cwCfg.decayTime });
              await hoSampler.load;
              hoSampler.output.setVolume(cwCfg.volume);
              if (kitGain !== 1.0) {
                const boost = ctx.createGain();
                boost.gain.value = kitGain;
                hoSampler.output.addInsert(boost);
              }
              hoSamplerByKit[kitFolder] = hoSampler;
            })().catch(() => { /* ハンマリングオン WAV なし → ピチカートにフォールバック */ }),
          );

          // ハンマリングオンリリース Sampler ロード (失敗は無視)
          const { buffers: hoRelBuffers, keyMap: hoRelKeyMap } = buildLegatoBuffers(kitFolder, pitches, 'h80', '_rel');
          hoRelKeyMapByKit[kitFolder] = hoRelKeyMap;
          loadTasks.push(
            (async () => {
              const hoRelSampler = new Sampler(ctx, { buffers: hoRelBuffers, detune: cwCfg.detune, decayTime: cwCfg.decayTime });
              await hoRelSampler.load;
              hoRelSampler.output.setVolume(cwCfg.volume);
              if (kitGain !== 1.0) {
                const boost = ctx.createGain();
                boost.gain.value = kitGain;
                hoRelSampler.output.addInsert(boost);
              }
              hoRelSamplerByKit[kitFolder] = hoRelSampler;
            })().catch(() => { /* ハンマリングオンリリース WAV なし */ }),
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
          if (relSamplerByKit[kitFolder]) {
            releaseByStyle[style] = relSamplerByKit[kitFolder];
            releaseKeyMapByStyle[style] = relKeyMapByKit[kitFolder];
            console.log(`[bass] ${style} → release samples loaded`);
          }
          if (legSamplerByKit[kitFolder]) {
            legatoByStyle[style] = legSamplerByKit[kitFolder];
            legatoKeyMapByStyle[style] = legKeyMapByKit[kitFolder];
            console.log(`[bass] ${style} → legato samples loaded`);
          }
          if (legRelSamplerByKit[kitFolder]) {
            legatoRelByStyle[style] = legRelSamplerByKit[kitFolder];
            legatoRelKeyMapByStyle[style] = legRelKeyMapByKit[kitFolder];
          }
          if (hoSamplerByKit[kitFolder]) {
            hammerOnByStyle[style] = hoSamplerByKit[kitFolder];
            hammerOnKeyMapByStyle[style] = hoKeyMapByKit[kitFolder];
            console.log(`[bass] ${style} → hammer-on samples loaded`);
          }
          if (hoRelSamplerByKit[kitFolder]) {
            hammerOnRelByStyle[style] = hoRelSamplerByKit[kitFolder];
            hammerOnRelKeyMapByStyle[style] = hoRelKeyMapByKit[kitFolder];
          }
        }
      }
    } catch { /* カスタム WAV なし → SoundFont フォールバック */ }

    if (Object.keys(customByStyle).length === 0) {
      console.log('[bass] No custom kits loaded, using SoundFont for all styles');
    }

    cachedBassSampler = {
      soundfont, customByStyle, keyMapByStyle,
      releaseByStyle, releaseKeyMapByStyle,
      legatoByStyle, legatoKeyMapByStyle,
      legatoRelByStyle, legatoRelKeyMapByStyle,
      hammerOnByStyle, hammerOnKeyMapByStyle,
      hammerOnRelByStyle, hammerOnRelKeyMapByStyle,
    };
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
let lastBassHit: {
  stopId: string; sampler: Sampler | Soundfont; endTime: number;
  midi: number; velocity: number; style: string;
} | null = null;

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
  prevLastMidi: number | null = null,
): DrumAudioHandle & { lastMidi: number | null } {
  const rootSemi = ROOT_PC[rootName] ?? 0;
  const nextRootSemi = nextRootName != null ? (ROOT_PC[nextRootName] ?? null) : null;
  const bassLine = generateBassLine(rootSemi, quality, beats, nextRootSemi, style, globalBeatOffset, prevLastMidi);
  const beatSec = 60 / bpm;
  const cfg = getBassConfig();

  const customSampler = bassSamplers.customByStyle[style];
  const db = getBassPatternDB();
  const kitFolder = db?.kits?.[style] ?? style;
  const sampleMap = db?.samples?.[kitFolder];
  const keyMap = bassSamplers.keyMapByStyle[style];

  const scheduledHits: { stopId: string; sampler: Sampler | Soundfont; time: number }[] = [];
  const octShift = cfg.customWAV.octaveShift;

  for (const bn of bassLine) {
    const noteTime = startAt + bn.beatStart * beatSec;
    const noteVel = bn.velocity ?? cfg.velocity;
    const noteDur = bn.duration * beatSec;
    const hitStopId = `bass-${++bassIdCounter}`;
    const wavMidi = bn.midi + octShift; // WAV ルックアップ用 MIDI (EZBass はオクターブ高い表記)

    // レガート判定: 音程差が閾値以下 & 確率判定 & interval≠0 → レガート
    // direction: interval > 0 → hammerOn (h80), interval < 0 → pulloff (p80)
    const interval = lastBassHit != null ? bn.midi - lastBassHit.midi : 0;
    const absInterval = Math.abs(interval);
    const isLegato = lastBassHit != null && absInterval > 0 &&
      absInterval <= cfg.customWAV.legatoMaxInterval &&
      Math.random() < cfg.customWAV.legatoProbability;
    const isHammerOn = isLegato && interval > 0;

    // voice stealing: 次ノート発音時に前ノートを停止 + リリースサンプル再生
    if (lastBassHit) {
      const stopTime = noteTime;
      try { (lastBassHit.sampler as Sampler).stop({ stopId: lastBassHit.stopId, time: stopTime }); } catch { /* ignore */ }

      // リリースサンプル再生: レガートなら方向別リリース、通常ならピチカートリリース
      let relSampler: Sampler | undefined;
      let relKeyMap: Map<string, string> | undefined;
      if (isLegato) {
        if (isHammerOn) {
          relSampler = bassSamplers.hammerOnRelByStyle[lastBassHit.style] ?? bassSamplers.releaseByStyle[lastBassHit.style];
          relKeyMap = bassSamplers.hammerOnRelKeyMapByStyle[lastBassHit.style] ?? bassSamplers.releaseKeyMapByStyle[lastBassHit.style];
        } else {
          relSampler = bassSamplers.legatoRelByStyle[lastBassHit.style] ?? bassSamplers.releaseByStyle[lastBassHit.style];
          relKeyMap = bassSamplers.legatoRelKeyMapByStyle[lastBassHit.style] ?? bassSamplers.releaseKeyMapByStyle[lastBassHit.style];
        }
      } else {
        relSampler = bassSamplers.releaseByStyle[lastBassHit.style];
        relKeyMap = bassSamplers.releaseKeyMapByStyle[lastBassHit.style];
      }
      if (relSampler && relKeyMap) {
        let relSmplrKey: string | undefined;
        if (isLegato) {
          // 方向別リリース WAV を試行
          const dirRelSampler = isHammerOn
            ? bassSamplers.hammerOnRelByStyle[lastBassHit.style]
            : bassSamplers.legatoRelByStyle[lastBassHit.style];
          if (dirRelSampler) {
            relSmplrKey = relKeyMap.get(`${lastBassHit.midi + octShift}_80`);
          }
        }
        if (!relSmplrKey) {
          // ピチカートリリースにフォールバック
          const prevKitFolder = db?.kits?.[lastBassHit.style] ?? lastBassHit.style;
          const prevSampleMap = db?.samples?.[prevKitFolder];
          const prevVelocities = prevSampleMap?.[String(lastBassHit.midi + octShift)];
          if (prevVelocities) {
            const prevNearestVel = findNearestVelocity(prevVelocities, lastBassHit.velocity);
            relSmplrKey = bassSamplers.releaseKeyMapByStyle[lastBassHit.style]?.get(`${lastBassHit.midi + octShift}_${prevNearestVel}`);
            relSampler = bassSamplers.releaseByStyle[lastBassHit.style];
          }
        }
        if (relSmplrKey && relSampler) {
          const relStopId = `bass-rel-${++bassIdCounter}`;
          relSampler.start({
            note: relSmplrKey,
            velocity: 127,
            time: stopTime,
            stopId: relStopId,
          });
          scheduledHits.push({ stopId: relStopId, sampler: relSampler, time: stopTime });
        }
      }
    }

    if (customSampler && sampleMap && keyMap) {
      // レガート判定: 方向に応じて hammerOn / pulloff Sampler を選択
      let legSampler: Sampler | undefined;
      let legKeyMap: Map<string, string> | undefined;
      if (isLegato) {
        if (isHammerOn) {
          legSampler = bassSamplers.hammerOnByStyle[style];
          legKeyMap = bassSamplers.hammerOnKeyMapByStyle[style];
        } else {
          legSampler = bassSamplers.legatoByStyle[style];
          legKeyMap = bassSamplers.legatoKeyMapByStyle[style];
        }
      }
      if (legSampler && legKeyMap) {
        const legSmplrKey = legKeyMap.get(`${wavMidi}_80`);
        if (legSmplrKey) {
          legSampler.start({
            note: legSmplrKey,
            velocity: 127,
            time: noteTime,
            duration: noteDur,
            ampRelease: 0.01,
            stopId: hitStopId,
          });
          scheduledHits.push({ stopId: hitStopId, sampler: legSampler, time: noteTime });
          lastBassHit = { stopId: hitStopId, sampler: legSampler, endTime: noteTime + noteDur, midi: bn.midi, velocity: noteVel, style };
          continue;
        }
        // レガート WAV がこのピッチにない → ピチカートにフォールバック
      }

      // ピチカート (通常)
      const velocities = sampleMap[String(wavMidi)];
      if (!velocities || velocities.length === 0) {
        _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, noteVel, noteDur, scheduledHits, style);
        continue;
      }
      const nearestVel = findNearestVelocity(velocities, noteVel);
      const smplrKey = keyMap.get(`${wavMidi}_${nearestVel}`);
      if (!smplrKey) {
        _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, noteVel, noteDur, scheduledHits, style);
        continue;
      }

      customSampler.start({
        note: smplrKey,
        velocity: 127,
        time: noteTime,
        duration: noteDur,
        ampRelease: 0.01,
        stopId: hitStopId,
      });
      scheduledHits.push({ stopId: hitStopId, sampler: customSampler, time: noteTime });
      lastBassHit = { stopId: hitStopId, sampler: customSampler, endTime: noteTime + noteDur, midi: bn.midi, velocity: noteVel, style };
    } else {
      // SoundFont フォールバック
      _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, noteVel, noteDur, scheduledHits, style);
    }
  }

  const lastMidi = bassLine.length > 0 ? bassLine[bassLine.length - 1].midi : null;

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
    lastMidi,
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
  style: string = '',
): void {
  sf.start({
    note: bn.midi,
    velocity,
    time: noteTime,
    duration: durationSec,
    stopId: hitStopId,
  });
  scheduledHits.push({ stopId: hitStopId, sampler: sf, time: noteTime });
  lastBassHit = { stopId: hitStopId, sampler: sf, endTime: noteTime + durationSec, midi: bn.midi, velocity, style };
}
