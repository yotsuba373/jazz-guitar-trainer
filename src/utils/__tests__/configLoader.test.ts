import { describe, it, expect, beforeEach } from 'vitest';
import {
  deepMerge,
  getCompConfig, clearCompConfigCache, DEFAULT_COMP_CONFIG,
  getBassConfig, clearBassConfigCache, DEFAULT_BASS_CONFIG,
  getPianoConfig, clearPianoConfigCache, DEFAULT_PIANO_CONFIG,
  getAudioConfig, clearAudioConfigCache, DEFAULT_AUDIO_CONFIG,
  getDrumConfig, clearDrumConfigCache, DEFAULT_DRUM_CONFIG,
} from '../configLoader';

beforeEach(() => {
  clearCompConfigCache();
  clearBassConfigCache();
  clearPianoConfigCache();
  clearAudioConfigCache();
  clearDrumConfigCache();
});

describe('deepMerge', () => {
  it('浅いプロパティをマージ', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('ネストされたオブジェクトを再帰マージ', () => {
    const result = deepMerge(
      { outer: { a: 1, b: 2 } },
      { outer: { b: 3 } },
    );
    expect(result).toEqual({ outer: { a: 1, b: 3 } });
  });

  it('配列はソース側で上書き', () => {
    const result = deepMerge({ arr: [1, 2] }, { arr: [3] });
    expect(result).toEqual({ arr: [3] });
  });

  it('ソースに存在しないキーはターゲットを保持', () => {
    const result = deepMerge({ a: 1, b: 2 }, {});
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe('getCompConfig', () => {
  it('未ロード時にデフォルト値を返す', () => {
    expect(getCompConfig()).toEqual(DEFAULT_COMP_CONFIG);
  });

  it('swing.even に2イベントがある', () => {
    expect(getCompConfig().swing.even).toHaveLength(2);
  });
});

describe('getBassConfig', () => {
  it('未ロード時にデフォルト値を返す', () => {
    expect(getBassConfig()).toEqual(DEFAULT_BASS_CONFIG);
  });

  it('midiRange.low < midiRange.high', () => {
    const cfg = getBassConfig();
    expect(cfg.midiRange.low).toBeLessThan(cfg.midiRange.high);
  });

  it('customWAV.releaseFadeMs のデフォルト値は 20', () => {
    expect(getBassConfig().customWAV.releaseFadeMs).toBe(20);
  });
});

describe('getPianoConfig', () => {
  it('未ロード時にデフォルト値を返す', () => {
    expect(getPianoConfig()).toEqual(DEFAULT_PIANO_CONFIG);
  });

  it('rhRange.low < rhRange.high', () => {
    const cfg = getPianoConfig();
    expect(cfg.rhRange.low).toBeLessThan(cfg.rhRange.high);
  });
});

describe('getAudioConfig', () => {
  it('未ロード時にデフォルト値を返す', () => {
    expect(getAudioConfig()).toEqual(DEFAULT_AUDIO_CONFIG);
  });

  it('metronome.accentFreq > metronome.normalFreq', () => {
    const cfg = getAudioConfig();
    expect(cfg.metronome.accentFreq).toBeGreaterThan(cfg.metronome.normalFreq);
  });
});

describe('getDrumConfig', () => {
  it('未ロード時にデフォルト値を返す', () => {
    expect(getDrumConfig()).toEqual(DEFAULT_DRUM_CONFIG);
  });
});
