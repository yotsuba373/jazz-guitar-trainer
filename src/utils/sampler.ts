import { Soundfont } from 'smplr';
import type { AudioHandle } from '../hooks/useAudioContext';

export type SamplerStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 楽器サンプラーの集合 (Phase 3 で drums を追加予定) */
export interface SamplerSet {
  piano: Soundfont;
  bass: Soundfont;
}

let status: SamplerStatus = 'idle';
let cached: SamplerSet | null = null;
let statusCallback: ((s: SamplerStatus) => void) | null = null;

function setStatus(s: SamplerStatus) {
  status = s;
  statusCallback?.(s);
}

/** 非同期でサンプラーをロード。重複呼び出しは無視 */
export async function loadSamplers(
  ctx: AudioContext,
  onStatusChange?: (status: SamplerStatus) => void,
): Promise<void> {
  if (status !== 'idle') return;
  if (onStatusChange) statusCallback = onStatusChange;
  setStatus('loading');
  try {
    const piano = new Soundfont(ctx, { instrument: 'acoustic_grand_piano' });
    const bass = new Soundfont(ctx, { instrument: 'acoustic_bass' });
    await Promise.all([piano.load, bass.load]);
    cached = { piano, bass };
    setStatus('ready');
  } catch {
    setStatus('error');
  }
}

export function getSamplers(): SamplerSet | null {
  return status === 'ready' ? cached : null;
}

export function getSamplerStatus(): SamplerStatus {
  return status;
}

// ---------------------------------------------------------------------------
// Jazz piano voicing
// ---------------------------------------------------------------------------

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
 * Jazz piano voicing templates — semitone intervals from root.
 *
 * LH: Root (+ 5th for fuller sound)
 * RH: Shell voicing (3rd + 7th) — the essential guide tones.
 * Voicing placed in piano-appropriate registers:
 *   LH root in octave 2 (C2–B2, MIDI 36–47)
 *   RH voices in octave 3–4 (MIDI 55–67)
 */
interface VoicingTemplate { lh: number[]; rh: number[] }

const VOICING_TEMPLATES: Record<string, VoicingTemplate> = {
  'maj7':  { lh: [0, 7],  rh: [4, 11] },     // R-5 | 3-7
  '7':     { lh: [0, 7],  rh: [4, 10] },     // R-5 | 3-♭7
  'm7':    { lh: [0, 7],  rh: [3, 10] },     // R-5 | ♭3-♭7
  'm7♭5':  { lh: [0, 6],  rh: [3, 10] },     // R-♭5 | ♭3-♭7
  'm7b5':  { lh: [0, 6],  rh: [3, 10] },     // R-♭5 | ♭3-♭7
  'dim':   { lh: [0, 6],  rh: [3, 9] },      // R-♭5 | ♭3-♭♭7
  'mMaj7': { lh: [0, 7],  rh: [3, 11] },     // R-5 | ♭3-7
  'aug':   { lh: [0, 8],  rh: [4, 11] },     // R-#5 | 3-7
  '7alt':  { lh: [0],     rh: [4, 10, 14] }, // R | 3-♭7-♭9(=♯8)
  '7b9':   { lh: [0],     rh: [4, 10, 13] }, // R | 3-♭7-♭9
  '7#11':  { lh: [0],     rh: [4, 6, 10] },  // R | 3-#11-♭7
  '7b13':  { lh: [0, 7],  rh: [4, 8, 10] },  // R-5 | 3-♭13-♭7
};

/** Fallback: dom7 shell */
const DEFAULT_TEMPLATE: VoicingTemplate = VOICING_TEMPLATES['7'];

/**
 * Build jazz piano voicing as MIDI note numbers.
 *
 * LH: root in octave 2 (MIDI 36-47), 5th in octave 2-3
 * RH: guide tones in octave 3-4 (MIDI 55-67), close position
 */
export function buildJazzPianoVoicing(rootName: string, quality: string): number[] {
  const pc = ROOT_PC[rootName] ?? 0;
  const tmpl = VOICING_TEMPLATES[quality] ?? DEFAULT_TEMPLATE;

  // LH: root in octave 2, other intervals relative to bass root
  const bassRoot = 36 + pc; // C2=36 .. B2=47
  const lh = tmpl.lh.map(interval => bassRoot + interval);

  // RH: place voices in octave 4 area (around MIDI 60), close position
  const rhBase = 60 + pc; // C4=60 reference
  const rh = tmpl.rh.map(interval => {
    let midi = rhBase + interval;
    // Keep in comfortable piano comping range (MIDI 55-75, roughly G3-D#5)
    while (midi > 75) midi -= 12;
    while (midi < 55) midi += 12;
    return midi;
  });
  rh.sort((a, b) => a - b);

  return [...lh, ...rh];
}

let compIdCounter = 0;

/**
 * smplr ピアノでジャズコンピング再生。
 * rootName + quality からピアノ用ボイシングを生成し、LH→RH 順に微小遅延で発音。
 * stopId でコードごとに voice を分離し、同一 MIDI ノートの連続でも音欠けしない。
 * 個別 stop 関数も保持し、未再生の事前スケジュール済みノートも確実にキャンセル。
 */
export function playSmplrPianoComp(
  piano: Soundfont,
  rootName: string,
  quality: string,
  volume: number,
  startAt: number,
  duration?: number,
): AudioHandle {
  const dur = duration ?? 2.0;
  const midiNotes = buildJazzPianoVoicing(rootName, quality);
  const velocity = Math.round(volume * 100);
  const stagger = 0.012; // 12ms between notes (subtle spread, LH→RH)
  const stopId = `comp-${++compIdCounter}`;

  const stopFns: (() => void)[] = [];
  for (let i = 0; i < midiNotes.length; i++) {
    const stop = piano.start({
      note: midiNotes[i],
      velocity,
      time: startAt + i * stagger,
      duration: dur,
      stopId,
    });
    stopFns.push(stop);
  }

  return {
    stop: () => {
      stopFns.forEach(fn => fn());
      piano.stop({ stopId });
    },
  };
}
