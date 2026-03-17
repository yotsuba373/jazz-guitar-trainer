import { Sampler } from 'smplr';
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

  // Cross-stick (side stick) — ジャズ向けゴーストスネア
  'F4':  `${BASE_URL}h2ogmsn/SideStick-Softest.ogg`,
  'Gb4': `${BASE_URL}h2ogmsn/SideStick-Soft.ogg`,
  'G4':  `${BASE_URL}h2ogmsn/SideStick-Med.ogg`,
  'Ab4': `${BASE_URL}h2ogmsn/SideStick-Hard.ogg`,
  'A4':  `${BASE_URL}h2ogmsn/SideStick-Hardest.ogg`,
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
      lpfCutoffHz: 800,    // 高域カット → 温かみ
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

/**
 * 1コード分のジャズスウィングドラムパターン生成 (純粋関数)。
 *
 * 4拍パターン:
 *   Beat:  0     1   1.5   2     3   3.5
 *   Ride:  x     x    x    x     x    x     ← 4分 + 裏拍8分 (2, 4拍目and)
 *   HH:         x               x          ← foot on 2, 4
 *   Kick:  x                               ← soft
 */
export function generateSwingDrumPattern(
  beats: number,
  globalBeatOffset: number,
  swingAmount: number,
  bpm: number,
): DrumHit[] {
  const hits: DrumHit[] = [];
  const measureIdx = Math.floor(globalBeatOffset / 4);

  // Kick on beat 0
  hits.push({ role: 'kick', beatStart: 0, velocity: 100 });

  // 4小節ごとバリエーション: beat 2 にも kick
  if (beats >= 3 && measureIdx % 4 === 3) {
    hits.push({ role: 'kick', beatStart: 2, velocity: 85 });
  }

  for (let b = 0; b < beats; b++) {
    // Ride on every quarter
    const rideVel = b === 0 ? 90 : 75;
    hits.push({ role: 'ride', beatStart: b, velocity: rideVel });

    // Ride on offbeat (and of 2 and 4 → beat 1.5 and 3.5)
    if (b === 1 || b === 3) {
      const rawBs = b + 0.5;
      const swungBs = swingBeatStart(rawBs, 'e', swingAmount, bpm);
      const volMult = swingVolumeMult(rawBs, 'e', swingAmount);
      hits.push({
        role: 'ride',
        beatStart: swungBs,
        velocity: Math.round(55 * volMult),
      });
    }

    // HH foot on 2, 4 (beat index 1, 3)
    if (b === 1 || b === 3) {
      hits.push({ role: 'hihat', beatStart: b, velocity: 65 });
    }
  }

  return hits;
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
): AudioHandle {
  const pattern = generateSwingDrumPattern(beats, globalBeatOffset, swingAmount, bpm);
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
