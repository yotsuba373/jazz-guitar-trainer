import { Sampler } from 'smplr';
import type { BackingStyle } from '../types';
import type { DrumAudioHandle } from '../hooks/useAudioContext';
import { swingBeatStart, swingVolumeMult } from './swing';
import { getDrumPatternDB, getDrumConfig, findNearestVelocity } from './drumPatternDB';
import type { SampleMap } from './drumPatternDB';

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
  const layers = getDrumConfig().velocityLayers;
  if (velocity < layers[0]) return 0;   // Softest
  if (velocity < layers[1]) return 1;   // Soft
  if (velocity < layers[2]) return 2;   // Med
  if (velocity < layers[3]) return 3;   // Hard
  return 4;                              // Hardest
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
  metal: Sampler;                          // ライド/HH (Hydrogen GM)
  body: Sampler;                           // キック/スネア (Hydrogen GM)
  customByStyle: Record<string, Sampler>;  // スタイル別カスタム WAV (ピッチベース)
  keyMapByStyle: Record<string, Map<string, string>>;  // (pitch_vel) → smplr note key
}

let cached: DrumSamplerSet | null = null;
let loadPromise: Promise<DrumSamplerSet> | null = null;

// ---------------------------------------------------------------------------
// カスタム WAV サンプル: ピッチベース命名 ({noteName}_v{velocity}.wav)
// ---------------------------------------------------------------------------

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/**
 * MIDI ノート番号 → ファイル名用ノート名。
 * オクターブ表記は C3=60 (Cubase 等の標準)。
 * 例: 51 → 'ds2', 38 → 'd1', 36 → 'c1'
 * # は URL/ファイル名で問題になるため s (sharp) に置換
 */
export function midiToFileName(pitch: number): string {
  const name = NOTE_NAMES[pitch % 12].replace('#', 's');
  const octave = Math.floor(pitch / 12) - 2;
  return `${name}${octave}`;
}

/** MIDI ノート番号 → smplr 用音名 (C#表記, smplr が内部パース可能な形式) */
const SMPLR_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToSmplrNote(midi: number): string {
  const name = SMPLR_NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1; // smplr convention: C4=60 → octave = 60/12-1 = 4
  return `${name}${octave}`;
}

/**
 * SampleMap からカスタム Sampler 用 buffers マップを構築。
 * smplr は buffers キーを音名としてパースするため、
 * 各 (pitch, velocity) ペアにユニークな MIDI 番号 (0-127) を割り当てる。
 * 逆引きテーブル (pitch,vel) → smplr キー も返す。
 */
function buildBuffersFromSampleMap(
  kitFolder: string,
  sampleMap: SampleMap,
): { buffers: Record<string, string>; keyMap: Map<string, string> } {
  const buffers: Record<string, string> = {};
  const keyMap = new Map<string, string>();  // "pitch_vel" → smplr note key
  let slotIdx = 0;

  for (const [pitchStr, velocities] of Object.entries(sampleMap)) {
    const pitch = Number(pitchStr);
    const fileName = midiToFileName(pitch);
    for (const v of velocities) {
      // ユニークな MIDI 番号を割り当て (0 から連番)
      const smplrKey = midiToSmplrNote(slotIdx);
      buffers[smplrKey] = `/drums/${kitFolder}/${fileName}_v${v}.wav`;
      keyMap.set(`${pitch}_${v}`, smplrKey);
      slotIdx++;
    }
  }
  return { buffers, keyMap };
}

/** Hydrogen GM アコースティックドラム Sampler を非同期ロード (キャッシュ) */
export async function loadDrumSampler(ctx: AudioContext): Promise<DrumSamplerSet> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    // Hydrogen GM (常にロード — フォールバック用)
    const cfg = getDrumConfig();
    const metal = new Sampler(ctx, {
      buffers: METAL_SAMPLES,
      detune: cfg.hydrogenGM.metal.detune,
      decayTime: cfg.hydrogenGM.metal.decayTime,
    });
    const body = new Sampler(ctx, {
      buffers: BODY_SAMPLES,
      detune: cfg.hydrogenGM.body.detune,
      decayTime: cfg.hydrogenGM.body.decayTime,
      lpfCutoffHz: cfg.hydrogenGM.body.lpfCutoffHz,
    });
    await Promise.all([metal.load, body.load]);

    // キット別カスタム WAV を試行
    const customByStyle: Record<string, Sampler> = {};
    const keyMapByStyle: Record<string, Map<string, string>> = {};
    try {
      const db = getDrumPatternDB();
      if (db?.samples && db?.kits) {
        const samplerByKit: Record<string, Sampler> = {};
        const keyMapByKit: Record<string, Map<string, string>> = {};
        const loadTasks: Promise<void>[] = [];

        // キットごとのゲイン倍率を drum-config.json から取得
        const kitGains = getDrumConfig().kitGains;

        // キットごとに1つの Sampler をロード (samples はキット軸)
        for (const [kitFolder, sampleMap] of Object.entries(db.samples)) {
          if (Object.keys(sampleMap).length === 0) continue;
          const { buffers, keyMap } = buildBuffersFromSampleMap(kitFolder, sampleMap);
          if (Object.keys(buffers).length === 0) continue;
          samplerByKit[kitFolder] = null!;
          keyMapByKit[kitFolder] = keyMap;
          const kitGain = kitGains[kitFolder] ?? 1.0;
          loadTasks.push(
            (async () => {
              const cwCfg = getDrumConfig().customWAV;
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
        for (const [style] of Object.entries(db.kits)) {
          const kitFolder = db.kits[style];
          if (samplerByKit[kitFolder]) {
            customByStyle[style] = samplerByKit[kitFolder];
            keyMapByStyle[style] = keyMapByKit[kitFolder];
            console.log(`[drums] ${style} → custom kit "${kitFolder}"`);
          } else {
            console.warn(`[drums] ${style} → fallback (kit "${kitFolder}" WAV not found)`);
          }
        }
      }

      // パターンはあるがキットマッピングがないスタイルをログ
      if (db?.patterns) {
        for (const style of Object.keys(db.patterns)) {
          if (!db.kits?.[style]) {
            console.warn(`[drums] ${style} → fallback (no kit mapping configured)`);
          }
        }
      }
    } catch { /* カスタム WAV なし → Hydrogen GM フォールバック */ }

    if (Object.keys(customByStyle).length === 0) {
      console.log('[drums] No custom kits loaded, using Hydrogen GM for all styles');
    }

    cached = { metal, body, customByStyle, keyMapByStyle };
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
  role?: string;      // アルゴリズム生成: 'ride' | 'hihat' | 'kick' | 'snare' | 'xstick'
  pitch?: number;     // DB パターン: MIDI ノート番号 (例: 51=ride, 38=snare)
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
  const prng = getDrumConfig().prng;
  const rng = mulberry32(measureIdx * prng.multiplier + prng.constant);
  const sw = getDrumConfig().patterns.swing;

  // --- Kick: 全拍フェザリング ---
  for (let b = 0; b < beats; b++) {
    const kickBase = sw.kick.base[b] ?? sw.kick.base[0];
    hits.push({ role: 'kick', beatStart: b, velocity: humanize(rng, kickBase, sw.kick.humanize, sw.kick.velRange[0], sw.kick.velRange[1]) });
  }

  // --- Ride + HH ---
  for (let b = 0; b < beats; b++) {
    // Ride on every quarter (2,4拍にバックビートアクセント)
    const rideVel = sw.ride.base[b] ?? sw.ride.base[0];
    hits.push({ role: 'ride', beatStart: b, velocity: humanize(rng, rideVel, sw.ride.humanize) });

    // Ride skip note on "and" of 2 and 4
    if (b === 1 || b === 3) {
      const rawBs = b + 0.5;
      const swungBs = swingBeatStart(rawBs, 'e', swingAmount, bpm);
      const volMult = swingVolumeMult(rawBs, 'e', swingAmount);
      hits.push({
        role: 'ride',
        beatStart: swungBs,
        velocity: Math.max(1, Math.round(humanize(rng, sw.ride.skipBase, sw.ride.humanize) * volMult)),
      });
    }

    // HH foot on 2, 4
    if (b === 1 || b === 3) {
      hits.push({ role: 'hihat', beatStart: b, velocity: humanize(rng, sw.hihat.velocity, sw.hihat.humanize) });
    }
  }

  // --- Snare ghost notes (三連符グリッド上, 確率的) ---
  for (let b = 0; b < beats; b++) {
    for (const tripletPos of sw.ghost.tripletGrid) {
      const pos = b + tripletPos;
      if (pos >= beats) continue;
      if (rng() < sw.ghost.probability) {
        hits.push({
          role: 'snare',
          beatStart: pos,
          velocity: humanize(rng, sw.ghost.base, sw.ghost.humanize, sw.ghost.velRange[0], sw.ghost.velRange[1]),
        });
      }
    }
  }

  // --- Snare comping accents (0-2 per measure, 即興的) ---
  if (beats >= 4) {
    for (const slot of sw.comping.slots) {
      if (slot >= beats) continue;
      if (rng() < sw.comping.probability) {
        // 裏拍位置 (0.5) は swing 適用
        const bs = slot % 1 !== 0
          ? swingBeatStart(slot, 'e', swingAmount, bpm)
          : slot;
        hits.push({
          role: 'snare',
          beatStart: bs,
          velocity: humanize(rng, sw.comping.base, sw.comping.humanize, sw.comping.velRange[0], sw.comping.velRange[1]),
        });
      }
    }
  }

  return hits;
}

/** Bossa nova: cross-stick + HH + kick */
function generateBossaDrumPattern(beats: number): DrumHit[] {
  const hits: DrumHit[] = [];
  const bc = getDrumConfig().patterns.bossa;
  for (let b = 0; b < beats; b++) {
    // HH on every quarter
    hits.push({ role: 'hihat', beatStart: b, velocity: bc.hihat.velocity });
    // Cross-stick on 2, 4
    if (b === 1 || b === 3) {
      hits.push({ role: 'xstick', beatStart: b, velocity: bc.xstick.velocity });
    }
    // Kick on 0, and syncopated
    if (b === 0) hits.push({ role: 'kick', beatStart: b, velocity: bc.kick.vels[0] });
    if (b === 2 && beats >= 4) hits.push({ role: 'kick', beatStart: 2.5, velocity: bc.kick.vels[1] });
    if (b === 3 && beats >= 4) hits.push({ role: 'kick', beatStart: 3, velocity: bc.kick.vels[2] });
  }
  return hits;
}

/** Ballad: light ride + HH + soft kick */
function generateBalladDrumPattern(beats: number): DrumHit[] {
  const hits: DrumHit[] = [];
  const bl = getDrumConfig().patterns.ballad;
  for (let b = 0; b < beats; b++) {
    // Ride on every quarter (soft)
    hits.push({ role: 'ride', beatStart: b, velocity: bl.ride.velocity });
    // HH on 2, 4
    if (b === 1 || b === 3) {
      hits.push({ role: 'hihat', beatStart: b, velocity: bl.hihat.velocity });
    }
    // Kick on beat 0
    if (b === 0) hits.push({ role: 'kick', beatStart: 0, velocity: bl.kick.velocity });
  }
  return hits;
}

/** Latin: straight 8th ride + kick on 1,3 + HH on 0,2 */
function generateLatinDrumPattern(beats: number): DrumHit[] {
  const hits: DrumHit[] = [];
  const lt = getDrumConfig().patterns.latin;
  for (let b = 0; b < beats; b++) {
    // Ride straight 8ths (on beat + and)
    hits.push({ role: 'ride', beatStart: b, velocity: lt.ride.onBeat });
    if (b + 0.5 < beats) {
      hits.push({ role: 'ride', beatStart: b + 0.5, velocity: lt.ride.offBeat });
    }
    // Kick on 1, 3
    if (b === 1 || b === 3) {
      hits.push({ role: 'kick', beatStart: b, velocity: lt.kick.velocity });
    }
    // HH on 0, 2
    if (b === 0 || b === 2) {
      hits.push({ role: 'hihat', beatStart: b, velocity: lt.hihat.velocity });
    }
  }
  return hits;
}

/**
 * スタイル別ドラムパターン生成 (ディスパッチ関数)。
 * DB にパターンがあれば優先、なければアルゴリズム生成にフォールバック。
 */
export function generateDrumPattern(
  beats: number,
  globalBeatOffset: number,
  swingAmount: number,
  bpm: number,
  style: BackingStyle = 'medium-swing',
): DrumHit[] {
  // --- DB パターン優先 ---
  {
    const db = getDrumPatternDB();
    const patterns = db?.patterns?.[style];
    if (patterns && patterns.length > 0) {
      const measureIdx = Math.floor(globalBeatOffset / 4);
      const patternGroupIdx = Math.floor(measureIdx / 8);
      const measureInPattern = measureIdx % 8;
      const prngCfg = getDrumConfig().prng;
      const rng = mulberry32(patternGroupIdx * prngCfg.multiplier + prngCfg.constant);
      const idx = Math.floor(rng() * patterns.length);
      const measure = patterns[idx].measures[measureInPattern];
      if (measure && measure.length > 0) {
        if (beats === 4) {
          return measure;
        }
        // beats < 4: 小節内のオフセットに応じてスライス
        const beatOffset = globalBeatOffset % 4;
        return measure.filter(h =>
          h.beatStart >= beatOffset && h.beatStart < beatOffset + beats
        ).map(h => ({ ...h, beatStart: h.beatStart - beatOffset }));
      }
    }
  }

  // --- フォールバック: アルゴリズム生成 ---
  switch (style) {
    case 'bossa':  return generateBossaDrumPattern(beats);
    case 'ballad': return generateBalladDrumPattern(beats);
    case 'latin':  return generateLatinDrumPattern(beats);
    case 'medium-swing':
    case 'medium-up-swing':
    case 'medium-up-swing-2':
    case 'up-tempo-swing':
    default:       return generateSwingDrumPattern(beats, globalBeatOffset, swingAmount, bpm);
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

let drumHitCounter = 0;

// ピッチごとに最新の stopId を追跡 (cross-pattern voice stealing)
// 新ヒット発音時に同ピッチの旧ボイスを停止 → 重複蓄積を防止
const lastHitByPitch = new Map<string, { stopId: string; sampler: Sampler }>();

/**
 * 2つの Sampler でアコースティックドラムパターン再生。
 *
 * - 各ヒットにユニーク stopId を付与 → 個別に停止/残響可能
 * - voice stealing: 同ピッチの旧ボイスを新ヒット開始時刻に停止予約
 * - stop(): 全ヒット即停止 (停止ボタン/モード切替)
 * - letRing(): 未来のヒットのみキャンセル、再生中の音は自然減衰 (コード遷移)
 */
export function playDrumPattern(
  ctx: AudioContext,
  samplers: DrumSamplerSet,
  beats: number,
  globalBeatOffset: number,
  startAt: number,
  bpm: number,
  swingAmount: number,
  style: BackingStyle = 'medium-swing',
): DrumAudioHandle {
  const pattern = generateDrumPattern(beats, globalBeatOffset, swingAmount, bpm, style);
  const beatSec = 60 / bpm;

  const customSampler = samplers.customByStyle[style];
  const db = getDrumPatternDB();
  const kitFolder = db?.kits?.[style] ?? style;
  const sampleMap = db?.samples?.[kitFolder];
  const keyMap = samplers.keyMapByStyle[style];
  // 各ヒットの stopId + 時刻を記録 (letRing/stop 用)
  const scheduledHits: { stopId: string; sampler: Sampler; time: number }[] = [];
  for (const hit of pattern) {
    let sampler: Sampler;
    let noteName: string;
    let pitchKey: string;  // voice stealing 用キー

    if (hit.pitch != null && customSampler && sampleMap && keyMap) {
      // ピッチベース: スタイル別カスタム WAV Sampler (最寄りベロシティ)
      const velocities = sampleMap[String(hit.pitch)];
      if (!velocities || velocities.length === 0) continue;
      const nearestVel = findNearestVelocity(velocities, hit.velocity);
      const smplrKey = keyMap.get(`${hit.pitch}_${nearestVel}`);
      if (!smplrKey) continue;
      sampler = customSampler;
      noteName = smplrKey;
      pitchKey = `custom_${hit.pitch}`;
    } else if (hit.role) {
      const layerIdx = velocityToLayer(hit.velocity);
      // ロールベース: Hydrogen GM
      const noteNames = ROLE_BASE[hit.role];
      if (!noteNames) continue;
      noteName = noteNames[layerIdx];
      sampler = METAL_ROLES.has(hit.role) ? samplers.metal : samplers.body;
      pitchKey = `gm_${hit.role}`;
    } else {
      continue;
    }

    // カスタム WAV: ベロシティレイヤーに既にダイナミクスが焼き込まれているので
    // smplr に velocity を渡すと二重適用になる → 127 固定でサンプル本来の音量を使う
    const noteVel = (hit.pitch != null && customSampler) ? 127 : hit.velocity;
    const noteTime = startAt + hit.beatStart * beatSec;
    if (!isFinite(noteVel) || !isFinite(noteTime)) {
      console.warn(`[drums] skip non-finite: note=${noteName} vel=${noteVel} time=${noteTime}`);
      continue;
    }
    try {
      // ヒットごとにユニーク stopId → 個別停止が可能
      const hitStopId = `dh-${++drumHitCounter}`;

      // 同ピッチの旧ボイスを新ヒット開始時刻で停止予約 (voice stealing)
      const prev = lastHitByPitch.get(pitchKey);
      if (prev) {
        try { prev.sampler.stop({ stopId: prev.stopId, time: noteTime }); } catch { /* ignore */ }
      }

      sampler.start({
        note: noteName,
        velocity: noteVel,
        time: noteTime,
        stopId: hitStopId,
      });
      scheduledHits.push({ stopId: hitStopId, sampler, time: noteTime });

      // 自身を最新ボイスとして登録
      lastHitByPitch.set(pitchKey, { stopId: hitStopId, sampler });
    } catch (e) {
      console.warn(`[drums] start failed: note=${noteName} vel=${noteVel} time=${noteTime}`, e);
    }
  }

  return {
    stop: () => {
      for (const h of scheduledHits) {
        try { h.sampler.stop({ stopId: h.stopId }); } catch { /* ignore */ }
      }
    },
    letRing: () => {
      // 未来のヒットのみキャンセル (再生中の音は自然減衰)
      const now = ctx.currentTime;
      for (const h of scheduledHits) {
        if (h.time > now + 0.03) {
          try { h.sampler.stop({ stopId: h.stopId }); } catch { /* ignore */ }
        }
      }
    },
  };
}
