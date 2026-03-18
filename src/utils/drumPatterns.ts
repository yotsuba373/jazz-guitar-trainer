import { Sampler } from 'smplr';
import type { BackingStyle } from '../types';
import type { AudioHandle } from '../hooks/useAudioContext';
import { swingBeatStart, swingVolumeMult } from './swing';

// ---------------------------------------------------------------------------
// Hydrogen GM acoustic drum sample mapping
// ---------------------------------------------------------------------------

const BASE_URL = 'https://smpldsnds.github.io/hydrogen-drum-samples/';

/** メタル楽器 (ライド/HH): 明るく、自然な減衰 */
const METAL_SAMPLES: Record<string, string> = {
  // 24" Ride cymbal — 5 variations
  'C3':  `${BASE_URL}h2ogmcy/24Ride-1.ogg`,
  'Db3': `${BASE_URL}h2ogmcy/24Ride-2.ogg`,
  'D3':  `${BASE_URL}h2ogmcy/24Ride-3.ogg`,
  'Eb3': `${BASE_URL}h2ogmcy/24Ride-4.ogg`,
  'E3':  `${BASE_URL}h2ogmcy/24Ride-5.ogg`,

  // Hi-hat pedal — 5 velocity layers
  'F3':  `${BASE_URL}h2ogmhh/HatPedal-Softest.ogg`,
  'Gb3': `${BASE_URL}h2ogmhh/HatPedal-Soft.ogg`,
  'G3':  `${BASE_URL}h2ogmhh/HatPedal-Med.ogg`,
  'Ab3': `${BASE_URL}h2ogmhh/HatPedal-Hard.ogg`,
  'A3':  `${BASE_URL}h2ogmhh/HatPedal-Hardest.ogg`,
};

/** キック/スネア: LPF で温かみ、長い減衰、ピッチ下げで太さ */
const BODY_SAMPLES: Record<string, string> = {
  // Kick — 5 velocity layers
  'C4':  `${BASE_URL}h2ogmbd/Kick-Softest.ogg`,
  'Db4': `${BASE_URL}h2ogmbd/Kick-Soft.ogg`,
  'D4':  `${BASE_URL}h2ogmbd/Kick-Med.ogg`,
  'Eb4': `${BASE_URL}h2ogmbd/Kick-Hard.ogg`,
  'E4':  `${BASE_URL}h2ogmbd/Kick-Hardest.ogg`,

  // Snare (通常ヒット) — 5 velocity layers
  'F4':  `${BASE_URL}h2ogmsn/Snare-Softest.ogg`,
  'Gb4': `${BASE_URL}h2ogmsn/Snare-Soft.ogg`,
  'G4':  `${BASE_URL}h2ogmsn/Snare-Med.ogg`,
  'Ab4': `${BASE_URL}h2ogmsn/Snare-Hard.ogg`,
  'A4':  `${BASE_URL}h2ogmsn/Snare-Hardest.ogg`,

  // Cross-stick (side stick) — Bossa 等で使用
  'C5':  `${BASE_URL}h2ogmsn/SideStick-Softest.ogg`,
  'Db5': `${BASE_URL}h2ogmsn/SideStick-Soft.ogg`,
  'D5':  `${BASE_URL}h2ogmsn/SideStick-Med.ogg`,
  'Eb5': `${BASE_URL}h2ogmsn/SideStick-Hard.ogg`,
  'E5':  `${BASE_URL}h2ogmsn/SideStick-Hardest.ogg`,
};

/** velocity (0-127) → 5段階レイヤーの MIDI ノートオフセット (0-4) */
function velocityToLayer(velocity: number): number {
  if (velocity < 30) return 0;   // Softest
  if (velocity < 55) return 1;   // Soft
  if (velocity < 85) return 2;   // Med
  if (velocity < 110) return 3;  // Hard
  return 4;                       // Hardest
}

/** 楽器ロール → ベースノート名 (Sampler MIDI) */
const ROLE_BASE: Record<string, string[]> = {
  ride:   ['C3', 'Db3', 'D3', 'Eb3', 'E3'],
  hihat:  ['F3', 'Gb3', 'G3', 'Ab3', 'A3'],
  kick:   ['C4', 'Db4', 'D4', 'Eb4', 'E4'],
  snare:  ['F4', 'Gb4', 'G4', 'Ab4', 'A4'],
  xstick: ['C5', 'Db5', 'D5', 'Eb5', 'E5'],
};

/** ロールがメタル Sampler のキーか判定 */
const METAL_ROLES = new Set(['ride', 'hihat']);

// ---------------------------------------------------------------------------
// Drum Sampler loading (2 Sampler 構成)
// ---------------------------------------------------------------------------

export interface DrumSamplerSet {
  metal: Sampler;  // ライド/HH
  body: Sampler;   // キック/スネア
}

let cached: DrumSamplerSet | null = null;
let loadPromise: Promise<DrumSamplerSet> | null = null;

/** Hydrogen GM アコースティックドラム Sampler を非同期ロード (キャッシュ) */
export async function loadDrumSampler(ctx: AudioContext): Promise<DrumSamplerSet> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const metal = new Sampler(ctx, {
      buffers: METAL_SAMPLES,
      detune: 0,
      decayTime: 0.5,
    });
    const body = new Sampler(ctx, {
      buffers: BODY_SAMPLES,
      detune: -200,        // 1全音下げで太く温かい音
      decayTime: 0.8,      // 長めの減衰でジャズバスドラムの響き
      lpfCutoffHz: 2000,   // キック/スネアの存在感を残しつつ温かみ
    });
    await Promise.all([metal.load, body.load]);
    cached = { metal, body };
    return cached;
  })();
  return loadPromise;
}

/** ロード済みドラムサンプラーを取得 (未ロードなら null) */
export function getDrumSampler(): DrumSamplerSet | null {
  return cached;
}

// ---------------------------------------------------------------------------
// Pattern types
// ---------------------------------------------------------------------------

export interface DrumHit {
  role: string;       // 'ride' | 'hihat' | 'kick' | 'snare'
  beatStart: number;  // コード内ビートオフセット (0-based)
  velocity: number;   // 0-127
}

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

/**
 * 1コード分のジャズスウィングドラムパターン生成。
 *
 * iReal Pro 風の有機的な 4 ビート:
 * - ライド: "Spang-a-lang" (2,4拍バックビートアクセント + skip note)
 * - HH foot: 2,4拍
 * - キック: 全拍フェザリング (vel 25-45, 聞こえるか聞こえないかの境界)
 * - スネア: ゴーストノート (確率的, vel 10-35) + コンピング (vel 45-85)
 * - 全ヒットにベロシティヒューマナイゼーション (±ランダム揺れ)
 *
 * globalBeatOffset から measureIdx を導出しシードに使用 →
 * 同じ小節は常に同じパターン、異なる小節は異なるバリエーション。
 */
export function generateSwingDrumPattern(
  beats: number,
  globalBeatOffset: number,
  swingAmount: number,
  bpm: number,
): DrumHit[] {
  const hits: DrumHit[] = [];
  const measureIdx = Math.floor(globalBeatOffset / 4);
  const rng = mulberry32(measureIdx * 7919 + 42);

  // --- Kick: 全拍フェザリング ---
  for (let b = 0; b < beats; b++) {
    const kickBase = b === 0 ? 60 : 50;
    hits.push({ role: 'kick', beatStart: b, velocity: humanize(rng, kickBase, 6, 35, 70) });
  }

  // --- Ride + HH ---
  const rideBaseVels: Record<number, number> = { 0: 75, 1: 88, 2: 70, 3: 85 };
  for (let b = 0; b < beats; b++) {
    // Ride on every quarter (2,4拍にバックビートアクセント)
    const rideVel = rideBaseVels[b] ?? 75;
    hits.push({ role: 'ride', beatStart: b, velocity: humanize(rng, rideVel, 8) });

    // Ride skip note on "and" of 2 and 4
    if (b === 1 || b === 3) {
      const rawBs = b + 0.5;
      const swungBs = swingBeatStart(rawBs, 'e', swingAmount, bpm);
      const volMult = swingVolumeMult(rawBs, 'e', swingAmount);
      hits.push({
        role: 'ride',
        beatStart: swungBs,
        velocity: Math.max(1, Math.round(humanize(rng, 50, 8) * volMult)),
      });
    }

    // HH foot on 2, 4
    if (b === 1 || b === 3) {
      hits.push({ role: 'hihat', beatStart: b, velocity: humanize(rng, 80, 8) });
    }
  }

  // --- Snare ghost notes (三連符グリッド上, 確率的) ---
  for (let b = 0; b < beats; b++) {
    for (const tripletPos of [1 / 3, 2 / 3]) {
      const pos = b + tripletPos;
      if (pos >= beats) continue;
      if (rng() < 0.25) {
        hits.push({
          role: 'snare',
          beatStart: pos,
          velocity: humanize(rng, 35, 8, 20, 50),
        });
      }
    }
  }

  // --- Snare comping accents (0-2 per measure, 即興的) ---
  if (beats >= 4) {
    for (const slot of [2.5, 3.0, 3.5]) {
      if (slot >= beats) continue;
      if (rng() < 0.30) {
        // 裏拍位置 (0.5) は swing 適用
        const bs = slot % 1 !== 0
          ? swingBeatStart(slot, 'e', swingAmount, bpm)
          : slot;
        hits.push({
          role: 'snare',
          beatStart: bs,
          velocity: humanize(rng, 80, 10, 60, 100),
        });
      }
    }
  }

  return hits;
}

/** Bossa nova: cross-stick + HH + kick */
function generateBossaDrumPattern(beats: number): DrumHit[] {
  const hits: DrumHit[] = [];
  for (let b = 0; b < beats; b++) {
    // HH on every quarter
    hits.push({ role: 'hihat', beatStart: b, velocity: 40 });
    // Cross-stick on 2, 4
    if (b === 1 || b === 3) {
      hits.push({ role: 'xstick', beatStart: b, velocity: 55 });
    }
    // Kick on 0, and syncopated
    if (b === 0) hits.push({ role: 'kick', beatStart: b, velocity: 70 });
    if (b === 2 && beats >= 4) hits.push({ role: 'kick', beatStart: 2.5, velocity: 60 });
    if (b === 3 && beats >= 4) hits.push({ role: 'kick', beatStart: 3, velocity: 65 });
  }
  return hits;
}

/** Ballad: light ride + HH + soft kick */
function generateBalladDrumPattern(beats: number): DrumHit[] {
  const hits: DrumHit[] = [];
  for (let b = 0; b < beats; b++) {
    // Ride on every quarter (soft)
    hits.push({ role: 'ride', beatStart: b, velocity: 50 });
    // HH on 2, 4
    if (b === 1 || b === 3) {
      hits.push({ role: 'hihat', beatStart: b, velocity: 45 });
    }
    // Kick on beat 0
    if (b === 0) hits.push({ role: 'kick', beatStart: 0, velocity: 60 });
  }
  return hits;
}

/** Latin: straight 8th ride + kick on 1,3 + HH on 0,2 */
function generateLatinDrumPattern(beats: number): DrumHit[] {
  const hits: DrumHit[] = [];
  for (let b = 0; b < beats; b++) {
    // Ride straight 8ths (on beat + and)
    hits.push({ role: 'ride', beatStart: b, velocity: 65 });
    if (b + 0.5 < beats) {
      hits.push({ role: 'ride', beatStart: b + 0.5, velocity: 55 });
    }
    // Kick on 1, 3
    if (b === 1 || b === 3) {
      hits.push({ role: 'kick', beatStart: b, velocity: 65 });
    }
    // HH on 0, 2
    if (b === 0 || b === 2) {
      hits.push({ role: 'hihat', beatStart: b, velocity: 55 });
    }
  }
  return hits;
}

/**
 * スタイル別ドラムパターン生成 (ディスパッチ関数)。
 */
export function generateDrumPattern(
  beats: number,
  globalBeatOffset: number,
  swingAmount: number,
  bpm: number,
  style: BackingStyle = 'swing',
): DrumHit[] {
  switch (style) {
    case 'bossa':  return generateBossaDrumPattern(beats);
    case 'ballad': return generateBalladDrumPattern(beats);
    case 'latin':  return generateLatinDrumPattern(beats);
    case 'swing':
    default:       return generateSwingDrumPattern(beats, globalBeatOffset, swingAmount, bpm);
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

let drumIdCounter = 0;

/**
 * 2つの Sampler でアコースティックドラムパターン再生。
 * メタル楽器とボディ楽器を別チャンネルで最適化。
 */
export function playDrumPattern(
  samplers: DrumSamplerSet,
  beats: number,
  globalBeatOffset: number,
  startAt: number,
  bpm: number,
  swingAmount: number,
  style: BackingStyle = 'swing',
): AudioHandle {
  const pattern = generateDrumPattern(beats, globalBeatOffset, swingAmount, bpm, style);
  const beatSec = 60 / bpm;
  const stopId = `drums-${++drumIdCounter}`;

  const stopFns: (() => void)[] = [];
  for (const hit of pattern) {
    const layerIdx = velocityToLayer(hit.velocity);
    const noteNames = ROLE_BASE[hit.role];
    if (!noteNames) continue;
    const noteName = noteNames[layerIdx];
    const sampler = METAL_ROLES.has(hit.role) ? samplers.metal : samplers.body;

    const stop = sampler.start({
      note: noteName,
      velocity: hit.velocity, // 音量は output.setVolume() で制御
      time: startAt + hit.beatStart * beatSec,
      stopId,
    });
    stopFns.push(stop);
  }

  return {
    stop: () => {
      stopFns.forEach(fn => fn());
      samplers.metal.stop({ stopId });
      samplers.body.stop({ stopId });
    },
  };
}
