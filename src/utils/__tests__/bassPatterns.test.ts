import { describe, it, expect } from 'vitest';
import { generateBassLine, getBassSampler, getBassPatternDB, clearBassPatternDBCache } from '../bassPatterns';
import { getBassConfig, clearBassConfigCache } from '../configLoader';

describe('generateBassLine', () => {
  it('1拍コード: ルートのみ', () => {
    const notes = generateBassLine(0, 'maj7', 1, null); // C
    expect(notes).toHaveLength(1);
    expect(notes[0].beatStart).toBe(0);
    expect(notes[0].duration).toBe(1);
  });

  it('2拍コード: ルート + アプローチ', () => {
    const notes = generateBassLine(0, 'm7', 2, 7); // Cm7 → G
    expect(notes).toHaveLength(2);
    expect(notes[0].beatStart).toBe(0);
    expect(notes[1].beatStart).toBe(1);
  });

  it('4拍コード: beat 0 にルート', () => {
    const notes = generateBassLine(7, '7', 4, 0); // G7 → C
    expect(notes).toHaveLength(4);
    // Beat 0 is root
    const rootMidi = notes[0].midi;
    // G in bass register: E2=40, G is 3 semitones above E, so 40+3=43
    expect(rootMidi).toBe(43);
    expect(notes[0].beatStart).toBe(0);
  });

  it('4拍コード: 最終拍にアプローチノート', () => {
    const notes = generateBassLine(0, 'maj7', 4, 5); // Cmaj7 → F
    expect(notes).toHaveLength(4);
    expect(notes[3].beatStart).toBe(3);
    // Approach should be half-step from F bass (MIDI 41)
    const fBassMidi = 41; // F2 = E2+1
    expect([fBassMidi - 1, fBassMidi + 1]).toContain(notes[3].midi);
  });

  it('音域が E1(28) ~ G3(55) 内', () => {
    // Test all 12 roots with 4 beats
    for (let rootSemi = 0; rootSemi < 12; rootSemi++) {
      const nextSemi = (rootSemi + 7) % 12; // 5th above
      const notes = generateBassLine(rootSemi, '7', 4, nextSemi);
      for (const n of notes) {
        expect(n.midi).toBeGreaterThanOrEqual(28);
        expect(n.midi).toBeLessThanOrEqual(55);
      }
    }
  });

  it('次ルートがない場合はルートに戻る', () => {
    const notes = generateBassLine(2, 'm7', 2, null); // Dm7, no next
    expect(notes).toHaveLength(2);
    // Last note should be root (since nextRootSemi is null)
    expect(notes[1].midi).toBe(notes[0].midi);
  });

  it('3拍コード: 3音生成', () => {
    const notes = generateBassLine(9, 'maj7', 3, 2); // Amaj7 → D
    expect(notes).toHaveLength(3);
    expect(notes[0].beatStart).toBe(0);
    expect(notes[1].beatStart).toBe(1);
    expect(notes[2].beatStart).toBe(2);
  });

  it('dim7 コードのオフセットを使用', () => {
    const notes = generateBassLine(2, 'dim7', 4, 0); // Ddim7
    expect(notes).toHaveLength(4);
    // All notes should be in range
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(28);
      expect(n.midi).toBeLessThanOrEqual(55);
    }
  });

  it('m7b5 コードのオフセットを使用', () => {
    const notes = generateBassLine(2, 'm7b5', 4, 7); // Dm7b5 → G
    expect(notes).toHaveLength(4);
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(28);
      expect(n.midi).toBeLessThanOrEqual(55);
    }
  });

  it('全拍の duration は 1', () => {
    const notes = generateBassLine(5, '7', 4, 0); // F7 → C
    for (const n of notes) {
      expect(n.duration).toBe(1);
    }
  });

  // --- Style-specific tests ---
  it('style未指定: swing (4-feel) と同じ4音', () => {
    const notes = generateBassLine(0, 'maj7', 4, 5);
    expect(notes).toHaveLength(4);
    // All integer beatStarts
    for (const n of notes) {
      expect(n.beatStart % 1).toBe(0);
    }
  });

  it('Bossa 2-feel: 4拍→2音 (Root + 5th)', () => {
    const notes = generateBassLine(0, 'maj7', 4, 5, 'bossa');
    expect(notes).toHaveLength(2);
    expect(notes[0].beatStart).toBe(0);
    expect(notes[0].duration).toBe(2);
    expect(notes[1].beatStart).toBe(2);
    expect(notes[1].duration).toBe(2);
  });

  it('Ballad 2-feel: 4拍→2音 (Root + approach)', () => {
    const notes = generateBassLine(7, '7', 4, 0, 'ballad');
    expect(notes).toHaveLength(2);
    expect(notes[0].beatStart).toBe(0);
    expect(notes[1].beatStart).toBe(2);
  });

  it('Latin: 4拍→3音 (fractional beatStart)', () => {
    const notes = generateBassLine(0, 'm7', 4, 7, 'latin');
    expect(notes).toHaveLength(3);
    expect(notes[0].beatStart).toBe(0);
    expect(notes[1].beatStart).toBe(1.5);
    expect(notes[2].beatStart).toBe(3);
  });

  it('Bossa/Ballad/Latin beats<=2: 既存ロジック (2音)', () => {
    for (const style of ['bossa', 'ballad', 'latin'] as const) {
      const notes = generateBassLine(0, 'maj7', 2, 7, style);
      expect(notes).toHaveLength(2);
    }
  });
});

describe('BassConfig カスタム WAV フィールド', () => {
  it('デフォルト BassConfig にカスタム WAV フィールドが存在', () => {
    clearBassConfigCache();
    const cfg = getBassConfig();
    expect(cfg.kitGains).toEqual({});
    expect(cfg.customWAV).toEqual({ detune: 0, decayTime: 0.8, volume: 127 });
  });

  it('デフォルト BassConfig に samples/kits が含まれない', () => {
    const cfg = getBassConfig();
    expect(cfg).not.toHaveProperty('samples');
    expect(cfg).not.toHaveProperty('kits');
  });

  it('デフォルト BassConfig の既存フィールドが維持', () => {
    const cfg = getBassConfig();
    expect(cfg.midiRange).toEqual({ low: 28, high: 55 });
    expect(cfg.bassRootBase).toBe(40);
    expect(cfg.velocity).toBe(90);
  });
});

describe('BassPatternDB', () => {
  it('未ロード時は null', () => {
    clearBassPatternDBCache();
    expect(getBassPatternDB()).toBeNull();
  });
});

describe('BassSamplerSet', () => {
  it('未ロード時は null', () => {
    expect(getBassSampler()).toBeNull();
  });
});
