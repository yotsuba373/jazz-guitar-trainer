/**
 * 汎用 JSON コンフィグローダー factory。
 *
 * public/ 配下の JSON を fetch → デフォルト値と deep merge → キャッシュ。
 * ファイル不在・パース失敗時はデフォルト値にフォールバック。
 */

/** JSON の部分オブジェクトをデフォルトに deep merge */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepMerge<T>(target: T, source: Record<string, any>): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = { ...target } as any;
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = result[key];
    if (
      sv != null && typeof sv === 'object' && !Array.isArray(sv) &&
      tv != null && typeof tv === 'object' && !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv, sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

export interface ConfigHandle<T> {
  load: () => Promise<T>;
  get: () => T;
  clear: () => void;
}

/**
 * コンフィグローダー factory。
 *
 * @param url      fetch する URL (例: '/comp-config.json')
 * @param defaults デフォルト値 (fetch 失敗時やフィールド欠落時のフォールバック)
 */
export function createConfigLoader<T>(url: string, defaults: T): ConfigHandle<T> {
  let cached: T | null = null;
  let loadAttempted = false;

  return {
    async load(): Promise<T> {
      if (cached) return cached;
      if (loadAttempted) return defaults;
      loadAttempted = true;
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          cached = defaults;
          return cached;
        }
        const data = await resp.json();
        cached = deepMerge(defaults, data as Record<string, unknown>);
        return cached!;
      } catch {
        cached = defaults;
        return cached;
      }
    },
    get(): T {
      return cached ?? defaults;
    },
    clear(): void {
      cached = null;
      loadAttempted = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Comp config
// ---------------------------------------------------------------------------

export interface CompConfigSwing {
  even: { beatStart: number; duration: number; velocity: number }[];
  odd: { beatStart: number; duration: number; velocity: number }[];
}

export interface CompConfig {
  swing: CompConfigSwing;
  bossa: { beatStart: number; duration: number; velocity: number }[];
  ballad: { beatStart: number; duration: number; velocity: number }[];
  latin: { beatStart: number; duration: number; velocity: number }[];
  defaultVelocity: number;
  shortChordVelocity: number;
}

export const DEFAULT_COMP_CONFIG: CompConfig = {
  swing: {
    even: [
      { beatStart: 0, duration: 1.5, velocity: 80 },
      { beatStart: 2.5, duration: 0.5, velocity: 65 },
    ],
    odd: [
      { beatStart: 0, duration: 2, velocity: 75 },
    ],
  },
  bossa: [
    { beatStart: 0, duration: 1, velocity: 75 },
    { beatStart: 1.5, duration: 1, velocity: 65 },
    { beatStart: 3, duration: 0.5, velocity: 60 },
  ],
  ballad: [
    { beatStart: 0, duration: 4, velocity: 70 },
  ],
  latin: [
    { beatStart: 0, duration: 0.5, velocity: 75 },
    { beatStart: 0.5, duration: 0.5, velocity: 65 },
    { beatStart: 1.5, duration: 0.5, velocity: 70 },
    { beatStart: 2, duration: 0.5, velocity: 65 },
    { beatStart: 3, duration: 0.5, velocity: 70 },
    { beatStart: 3.5, duration: 0.5, velocity: 65 },
  ],
  defaultVelocity: 80,
  shortChordVelocity: 80,
};

const compConfig = createConfigLoader<CompConfig>('/comp-config.json', DEFAULT_COMP_CONFIG);
export const loadCompConfig = compConfig.load;
export const getCompConfig = compConfig.get;
export const clearCompConfigCache = compConfig.clear;

// ---------------------------------------------------------------------------
// Bass config
// ---------------------------------------------------------------------------

export interface SwingBassParams {
  approachWeights: { chromatic: number; diatonic: number; dominant: number; arpeggio: number };
  contourAlternateEvery: number;
}

/** Per-swing-style overrides for bass generation parameters */
export interface SwingStyleOverrides {
  defaultDuration?: number;
  tripletGrace?: { probability?: number; velocity?: number; offset?: number };
  approachWeights?: { chromatic?: number; diatonic?: number; dominant?: number; arpeggio?: number };
  altOctaveProb?: Record<string, number>;
}

export interface BassConfig {
  midiRange: { low: number; high: number };
  bassRootBase: number;
  velocity: number;
  prng: { multiplier: number; constant: number };
  defaultDuration: number;
  velocityHumanize: number;
  tripletGrace: { probability: number; velocity: number; offset: number };
  patterns: { swing: SwingBassParams };
  /** ルートごとの上オクターブ使用確率 (デフォルト、スタイル別で上書き可) */
  altOctaveProb: Record<string, number>;
  /** Per-swing-style overrides (merged on top of base config at runtime) */
  styleOverrides?: Partial<Record<string, SwingStyleOverrides>>;
  kitGains: Record<string, number>;
  customWAV: { detune: number; decayTime: number; volume: number; releaseFadeMs: number; legatoMaxInterval: number; legatoProbability: number; octaveShift: number };
}

export const DEFAULT_BASS_CONFIG: BassConfig = {
  midiRange: { low: 28, high: 60 },
  bassRootBase: 36,
  velocity: 83,
  prng: { multiplier: 7919, constant: 17 },
  defaultDuration: 0.86,
  velocityHumanize: 15,
  tripletGrace: { probability: 0.10, velocity: 91, offset: 0.667 },
  patterns: {
    swing: {
      approachWeights: { chromatic: 0.50, diatonic: 0.20, dominant: 0.20, arpeggio: 0.10 },
      contourAlternateEvery: 2,
    },
  },
  altOctaveProb: {},
  kitGains: {},
  customWAV: { detune: 0, decayTime: 0.8, volume: 127, releaseFadeMs: 20, legatoMaxInterval: 2, legatoProbability: 0.11, octaveShift: 0 },
};

const bassConfig = createConfigLoader<BassConfig>('/bass-config.json', DEFAULT_BASS_CONFIG);
export const loadBassConfig = bassConfig.load;
export const getBassConfig = bassConfig.get;
export const clearBassConfigCache = bassConfig.clear;

// ---------------------------------------------------------------------------
// Piano config
// ---------------------------------------------------------------------------

export interface PianoConfig {
  lhBase: number;
  rhBase: number;
  rhRange: { low: number; high: number };
  duration: number;
  velocity: number;
  stagger: number;
}

export const DEFAULT_PIANO_CONFIG: PianoConfig = {
  lhBase: 36,
  rhBase: 60,
  rhRange: { low: 55, high: 75 },
  duration: 2.0,
  velocity: 80,
  stagger: 0.012,
};

const pianoConfig = createConfigLoader<PianoConfig>('/piano-config.json', DEFAULT_PIANO_CONFIG);
export const loadPianoConfig = pianoConfig.load;
export const getPianoConfig = pianoConfig.get;
export const clearPianoConfigCache = pianoConfig.clear;

// ---------------------------------------------------------------------------
// Audio config (metronome, guitar, sax, EP, strum, phrase)
// ---------------------------------------------------------------------------

export interface AudioConfig {
  metronome: {
    accentFreq: number;
    normalFreq: number;
    accentGainMult: number;
    normalGainMult: number;
    fadeOut: number;
  };
  guitar: {
    defaultDuration: number;
    lpFilterPasses: number;
    maCoeff: number;
    decay: number;
    loopLpCoeffs: [number, number];
    softAttack: number;
    attackGainMult: number;
    lpFreqMax: number;
    lpQ: number;
    peakFreq: number;
    peakQ: number;
    peakGain: number;
    hsFreq: number;
    hsGain: number;
  };
  saxophone: {
    defaultDuration: number;
    vibratoFreq: number;
    vibratoDelay: number;
    vibratoOnset: number;
    vibratoDepth: number;
    formant1: { freq: number; q: number; gain: number };
    formant2: { freq: number; q: number; gain: number };
    warmthLpFreqMax: number;
    warmthLpQ: number;
    attackGainMult: number;
    attackDuration: number;
  };
  electricPiano: {
    defaultDuration: number;
    harmonic2GainMult: number;
    harmonic2DecayRatio: number;
    harmonic3GainMult: number;
    harmonic3Decay: number;
    attackGainMult: number;
    attackDuration: number;
    decayGainMult: number;
    decayDuration: number;
    releaseGainMult: number;
    warmthLpFreqMax: number;
    warmthLpQ: number;
  };
  chordStrum: {
    strumDelay: number;
    defaultDuration: number;
  };
  phrase: {
    lastNoteSustainMult: number;
    legatoMult: number;
  };
  swing: {
    eighthThreshold: number;
    sixteenthThreshold: number;
    tempoCompThreshold: number;
    tempoCompRange: number;
    timing: {
      offbeatEighthShift: number;
      sixteenth2ndShift: number;
      sixteenth4thShift: number;
    };
    dynamics: {
      offbeatEighthCut: number;
      onbeatEighthBoost: number;
      sixteenthCut: number;
    };
    articulation: {
      offbeatEighthShorten: number;
      onbeatEighthLengthen: number;
      sixteenthShorten: number;
    };
  };
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  metronome: {
    accentFreq: 1200,
    normalFreq: 800,
    accentGainMult: 1.5,
    normalGainMult: 1.0,
    fadeOut: 0.04,
  },
  guitar: {
    defaultDuration: 2.0,
    lpFilterPasses: 10,
    maCoeff: 0.5,
    decay: 0.9975,
    loopLpCoeffs: [0.3, 0.7],
    softAttack: 0.005,
    attackGainMult: 1.2,
    lpFreqMax: 1800,
    lpQ: 0.6,
    peakFreq: 300,
    peakQ: 0.8,
    peakGain: 4,
    hsFreq: 1200,
    hsGain: -9,
  },
  saxophone: {
    defaultDuration: 2.0,
    vibratoFreq: 5.5,
    vibratoDelay: 0.15,
    vibratoOnset: 0.4,
    vibratoDepth: 3,
    formant1: { freq: 500, q: 2, gain: 0.6 },
    formant2: { freq: 1400, q: 3, gain: 0.4 },
    warmthLpFreqMax: 4000,
    warmthLpQ: 0.7,
    attackGainMult: 0.55,
    attackDuration: 0.02,
  },
  electricPiano: {
    defaultDuration: 2.0,
    harmonic2GainMult: 0.18,
    harmonic2DecayRatio: 0.6,
    harmonic3GainMult: 0.06,
    harmonic3Decay: 0.15,
    attackGainMult: 0.4,
    attackDuration: 0.01,
    decayGainMult: 0.2,
    decayDuration: 0.2,
    releaseGainMult: 0.01,
    warmthLpFreqMax: 4500,
    warmthLpQ: 0.5,
  },
  chordStrum: {
    strumDelay: 0.018,
    defaultDuration: 2.0,
  },
  phrase: {
    lastNoteSustainMult: 2,
    legatoMult: 1.2,
  },
  swing: {
    eighthThreshold: 0.08,
    sixteenthThreshold: 0.06,
    tempoCompThreshold: 200,
    tempoCompRange: 80,
    timing: {
      offbeatEighthShift: 0.17,
      sixteenth2ndShift: 0.04,
      sixteenth4thShift: 0.08,
    },
    dynamics: {
      offbeatEighthCut: 0.20,
      onbeatEighthBoost: 0.15,
      sixteenthCut: 0.15,
    },
    articulation: {
      offbeatEighthShorten: 0.30,
      onbeatEighthLengthen: 0.25,
      sixteenthShorten: 0.20,
    },
  },
};

const audioConfig = createConfigLoader<AudioConfig>('/audio-config.json', DEFAULT_AUDIO_CONFIG);
export const loadAudioConfig = audioConfig.load;
export const getAudioConfig = audioConfig.get;
export const clearAudioConfigCache = audioConfig.clear;

// ---------------------------------------------------------------------------
// DrumConfig (factory 移行 — 循環依存回避のため型・デフォルト値もここで定義)
// ---------------------------------------------------------------------------

export interface SamplerOpts {
  detune: number;
  decayTime: number;
  lpfCutoffHz?: number;
}

export interface SwingDrumParams {
  kick: { base: number[]; humanize: number; velRange: [number, number] };
  ride: { base: number[]; humanize: number; skipBase: number };
  hihat: { velocity: number; humanize: number };
  ghost: { probability: number; base: number; humanize: number; velRange: [number, number]; tripletGrid: number[] };
  comping: { probability: number; base: number; humanize: number; velRange: [number, number]; slots: number[] };
}

export interface BossaDrumParams {
  hihat: { velocity: number };
  xstick: { velocity: number };
  kick: { vels: number[] };
}

export interface BalladDrumParams {
  ride: { velocity: number };
  hihat: { velocity: number };
  kick: { velocity: number };
}

export interface LatinDrumParams {
  ride: { onBeat: number; offBeat: number };
  kick: { velocity: number };
  hihat: { velocity: number };
}

export interface DrumConfig {
  kitGains: Record<string, number>;
  hydrogenGM: { metal: SamplerOpts; body: SamplerOpts };
  customWAV: { detune: number; decayTime: number; volume: number };
  velocityLayers: number[];
  prng: { multiplier: number; constant: number };
  drumSwingAmount: number;
  patterns: {
    swing: SwingDrumParams;
    bossa: BossaDrumParams;
    ballad: BalladDrumParams;
    latin: LatinDrumParams;
  };
}

export const DEFAULT_DRUM_CONFIG: DrumConfig = {
  kitGains: {},
  hydrogenGM: {
    metal: { detune: 0, decayTime: 0.5 },
    body: { detune: -200, decayTime: 0.8, lpfCutoffHz: 2000 },
  },
  customWAV: { detune: 0, decayTime: 0.5, volume: 127 },
  velocityLayers: [30, 55, 85, 110],
  prng: { multiplier: 7919, constant: 42 },
  drumSwingAmount: 0.65,
  patterns: {
    swing: {
      kick: { base: [60, 50, 50, 50], humanize: 6, velRange: [35, 70] },
      ride: { base: [75, 88, 70, 85], humanize: 8, skipBase: 50 },
      hihat: { velocity: 80, humanize: 8 },
      ghost: { probability: 0.25, base: 35, humanize: 8, velRange: [20, 50], tripletGrid: [0.333, 0.667] },
      comping: { probability: 0.30, base: 80, humanize: 10, velRange: [60, 100], slots: [2.5, 3.0, 3.5] },
    },
    bossa: {
      hihat: { velocity: 40 },
      xstick: { velocity: 55 },
      kick: { vels: [70, 60, 65] },
    },
    ballad: {
      ride: { velocity: 50 },
      hihat: { velocity: 45 },
      kick: { velocity: 60 },
    },
    latin: {
      ride: { onBeat: 65, offBeat: 55 },
      kick: { velocity: 65 },
      hihat: { velocity: 55 },
    },
  },
};

const drumConfig = createConfigLoader<DrumConfig>('/drum-config.json', DEFAULT_DRUM_CONFIG);
export const loadDrumConfig = drumConfig.load;
export const getDrumConfig = drumConfig.get;
export const clearDrumConfigCache = drumConfig.clear;
