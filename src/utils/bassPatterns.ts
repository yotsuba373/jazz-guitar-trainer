import { Sampler } from 'smplr';
import type { Soundfont } from 'smplr';
import type { BackingStyle } from '../types';
import type { DrumAudioHandle } from '../hooks/useAudioContext';
import { getBassConfig } from './configLoader';
import { midiToFileName } from './drumPatterns';
import { findNearestVelocity } from './drumPatternDB';

export interface BassNote {
  midi: number;       // MIDI note number (E1=28 ~ G3=55)
  beatStart: number;  // beat offset within chord (0-based)
  duration: number;   // beats
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

/**
 * ルートの半音値 (0-11) からベースレジスター (E2付近) の MIDI ノートを返す。
 * ベース音域・基準はコンフィグで制御。
 */
function rootToBassMidi(rootSemi: number): number {
  const cfg = getBassConfig();
  const base = cfg.bassRootBase; // E2 = 40
  const eSemi = 4; // E の半音値
  let midi = base + ((rootSemi - eSemi + 12) % 12);
  if (midi > cfg.midiRange.high) midi -= 12;
  return midi;
}

/** 次ルートへの半音アプローチノートを返す (半音上 or 半音下、近い方) */
function approachNote(currentRootMidi: number, nextRootSemi: number): number {
  const cfg = getBassConfig();
  const nextMidi = rootToBassMidi(nextRootSemi);
  const above = nextMidi + 1;
  const below = nextMidi - 1;
  const clamp = (n: number) => Math.max(cfg.midiRange.low, Math.min(cfg.midiRange.high, n));
  return Math.abs(clamp(below) - currentRootMidi) <= Math.abs(clamp(above) - currentRootMidi)
    ? clamp(below) : clamp(above);
}

/**
 * 1コード分のベースラインを生成。
 *
 * @param rootSemi     ルートの半音値 (0-11, C=0)
 * @param quality      コード品質 ('maj7', 'm7', '7', 'm7b5', 'dim7')
 * @param beats        コードの拍数
 * @param nextRootSemi 次コードのルート半音値 (null = 曲末)
 */
export function generateBassLine(
  rootSemi: number,
  quality: string,
  beats: number,
  nextRootSemi: number | null,
  style: BackingStyle = 'medium-swing',
): BassNote[] {
  const rootMidi = rootToBassMidi(rootSemi);
  const { midiRange } = getBassConfig();
  const clamp = (n: number) => { let m = n; while (m > midiRange.high) m -= 12; while (m < midiRange.low) m += 12; return m; };
  const offsets = chordToneOffsets(quality);
  const third = clamp(rootMidi + offsets[1]);
  const fifth = clamp(rootMidi + offsets[2]);
  const approach = nextRootSemi != null ? approachNote(rootMidi, nextRootSemi) : rootMidi;

  if (beats <= 1) {
    return [{ midi: rootMidi, beatStart: 0, duration: beats }];
  }
  if (beats <= 2) {
    return [
      { midi: rootMidi, beatStart: 0, duration: 1 },
      { midi: approach, beatStart: 1, duration: 1 },
    ];
  }

  // Style-specific patterns for 3+ beats
  if (style === 'bossa' && beats >= 3) {
    // 2-feel: Root + 5th
    return [
      { midi: rootMidi, beatStart: 0, duration: 2 },
      { midi: fifth, beatStart: 2, duration: beats - 2 },
    ];
  }

  if (style === 'ballad' && beats >= 3) {
    // 2-feel: Root + approach
    return [
      { midi: rootMidi, beatStart: 0, duration: 2 },
      { midi: approach, beatStart: 2, duration: beats - 2 },
    ];
  }

  if (style === 'latin' && beats >= 3) {
    // Tumbao: Root + 5th (syncopated) + Root octave
    const oct = clamp(rootMidi + 12);
    return [
      { midi: rootMidi, beatStart: 0, duration: 1 },
      { midi: fifth, beatStart: 1.5, duration: 1 },
      { midi: oct, beatStart: 3, duration: beats - 3 || 1 },
    ];
  }

  // Swing (default): 4-feel walking bass
  const notes: BassNote[] = [
    { midi: rootMidi, beatStart: 0, duration: 1 },
  ];

  if (beats >= 3) {
    notes.push({ midi: Math.random() < 0.5 ? third : fifth, beatStart: 1, duration: 1 });
  }
  if (beats >= 4) {
    const oct = rootMidi + 12 <= midiRange.high ? rootMidi + 12 : rootMidi;
    notes.push({ midi: Math.random() < 0.5 ? fifth : oct, beatStart: 2, duration: 1 });
  }

  const lastBeat = beats - 1;
  notes.push({ midi: approach, beatStart: lastBeat, duration: 1 });

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
let lastBassHit: { stopId: string; sampler: Sampler | Soundfont } | null = null;

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
): DrumAudioHandle {
  const rootSemi = ROOT_PC[rootName] ?? 0;
  const nextRootSemi = nextRootName != null ? (ROOT_PC[nextRootName] ?? null) : null;
  const bassLine = generateBassLine(rootSemi, quality, beats, nextRootSemi, style);
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
    const hitStopId = `bass-${++bassIdCounter}`;

    if (customSampler && sampleMap && keyMap) {
      // カスタム WAV Sampler
      const velocities = sampleMap[String(bn.midi)];
      if (!velocities || velocities.length === 0) {
        // このピッチの WAV がない → SoundFont フォールバック
        _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, cfg.velocity, beatSec, scheduledHits);
        continue;
      }
      const nearestVel = findNearestVelocity(velocities, cfg.velocity);
      const smplrKey = keyMap.get(`${bn.midi}_${nearestVel}`);
      if (!smplrKey) {
        _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, cfg.velocity, beatSec, scheduledHits);
        continue;
      }

      // voice stealing: 前ノートを新ノート開始時刻で停止予約
      if (lastBassHit) {
        try { (lastBassHit.sampler as Sampler).stop({ stopId: lastBassHit.stopId, time: noteTime }); } catch { /* ignore */ }
      }

      customSampler.start({
        note: smplrKey,
        velocity: 127, // ベロシティレイヤーに既にダイナミクスが焼き込み済み
        time: noteTime,
        stopId: hitStopId,
      });
      scheduledHits.push({ stopId: hitStopId, sampler: customSampler, time: noteTime });
      lastBassHit = { stopId: hitStopId, sampler: customSampler };
    } else {
      // SoundFont フォールバック
      _playSoundfontNote(bassSamplers.soundfont, bn, noteTime, hitStopId, cfg.velocity, beatSec, scheduledHits);
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

/** SoundFont でベースノートを再生 (voice stealing 付き) */
function _playSoundfontNote(
  sf: Soundfont,
  bn: BassNote,
  noteTime: number,
  hitStopId: string,
  velocity: number,
  beatSec: number,
  scheduledHits: { stopId: string; sampler: Sampler | Soundfont; time: number }[],
): void {
  // voice stealing
  if (lastBassHit) {
    try { (lastBassHit.sampler as Soundfont).stop({ stopId: lastBassHit.stopId, time: noteTime }); } catch { /* ignore */ }
  }

  sf.start({
    note: bn.midi,
    velocity,
    time: noteTime,
    duration: bn.duration * beatSec,
    stopId: hitStopId,
  });
  scheduledHits.push({ stopId: hitStopId, sampler: sf, time: noteTime });
  lastBassHit = { stopId: hitStopId, sampler: sf };
}
