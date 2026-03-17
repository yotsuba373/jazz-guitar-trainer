import type { Soundfont } from 'smplr';
import type { BackingStyle } from '../types';
import type { AudioHandle } from '../hooks/useAudioContext';

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
 * ベース音域: E1 (28) ~ G3 (55)。基準は E2 (40)。
 */
function rootToBassMidi(rootSemi: number): number {
  const base = 40; // E2
  const eSemi = 4; // E の半音値
  let midi = base + ((rootSemi - eSemi + 12) % 12);
  if (midi > 55) midi -= 12;
  return midi;
}

/** 次ルートへの半音アプローチノートを返す (半音上 or 半音下、近い方) */
function approachNote(currentRootMidi: number, nextRootSemi: number): number {
  const nextMidi = rootToBassMidi(nextRootSemi);
  const above = nextMidi + 1;
  const below = nextMidi - 1;
  const clamp = (n: number) => Math.max(28, Math.min(55, n));
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
  style: BackingStyle = 'swing',
): BassNote[] {
  const rootMidi = rootToBassMidi(rootSemi);
  const clamp = (n: number) => { let m = n; while (m > 55) m -= 12; while (m < 28) m += 12; return m; };
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
    const oct = rootMidi + 12 <= 55 ? rootMidi + 12 : rootMidi;
    notes.push({ midi: Math.random() < 0.5 ? fifth : oct, beatStart: 2, duration: 1 });
  }

  const lastBeat = beats - 1;
  notes.push({ midi: approach, beatStart: lastBeat, duration: 1 });

  return notes;
}

// ---------------------------------------------------------------------------
// smplr bass playback
// ---------------------------------------------------------------------------

let bassIdCounter = 0;

/**
 * smplr ベースでウォーキングベースライン再生。
 * ピアノコンピング (playSmplrPianoComp) と同じ AudioHandle パターンで管理。
 */
export function playSmplrBassLine(
  bass: Soundfont,
  rootName: string,
  quality: string,
  beats: number,
  nextRootName: string | null,
  startAt: number,
  bpm: number,
  style: BackingStyle = 'swing',
): AudioHandle {
  const rootSemi = ROOT_PC[rootName] ?? 0;
  const nextRootSemi = nextRootName != null ? (ROOT_PC[nextRootName] ?? null) : null;
  const bassLine = generateBassLine(rootSemi, quality, beats, nextRootSemi, style);
  const beatSec = 60 / bpm;
  const velocity = 90; // 音量は output.setVolume() で制御
  const stopId = `bass-${++bassIdCounter}`;

  const stopFns: (() => void)[] = [];
  for (const bn of bassLine) {
    const stop = bass.start({
      note: bn.midi,
      velocity,
      time: startAt + bn.beatStart * beatSec,
      duration: bn.duration * beatSec,
      stopId,
    });
    stopFns.push(stop);
  }

  return {
    stop: () => {
      stopFns.forEach(fn => fn());
      bass.stop({ stopId });
    },
  };
}
