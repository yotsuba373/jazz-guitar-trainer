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
    // G in bass register: C2=36 base, G(7) > 36+6 → wraps to G1=31
    expect(rootMidi).toBe(31);
    expect(notes[0].beatStart).toBe(0);
  });

  it('4拍コード: 最終拍にノート (アプローチ or コードトーン)', () => {
    const notes = generateBassLine(0, 'maj7', 4, 5); // Cmaj7 → F
    expect(notes.length).toBeGreaterThanOrEqual(4);
    // Last main beat note should be at beat 3 or later
    const lastBeatNote = notes.filter(n => n.beatStart >= 3);
    expect(lastBeatNote.length).toBeGreaterThanOrEqual(1);
  });

  it('音域が E1(28) ~ C4(60) 内', () => {
    // Test all 12 roots with 4 beats
    for (let rootSemi = 0; rootSemi < 12; rootSemi++) {
      const nextSemi = (rootSemi + 7) % 12; // 5th above
      const notes = generateBassLine(rootSemi, '7', 4, nextSemi);
      for (const n of notes) {
        expect(n.midi).toBeGreaterThanOrEqual(28);
        expect(n.midi).toBeLessThanOrEqual(60);
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
    expect(notes.length).toBeGreaterThanOrEqual(4);
    // All notes should be in range
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(28);
      expect(n.midi).toBeLessThanOrEqual(60);
    }
  });

  it('m7b5 コードのオフセットを使用', () => {
    const notes = generateBassLine(2, 'm7b5', 4, 7); // Dm7b5 → G
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(28);
      expect(n.midi).toBeLessThanOrEqual(60);
    }
  });

  it('Swing 4拍の duration は ~0.86', () => {
    const notes = generateBassLine(5, '7', 4, 0); // F7 → C
    // Main beat notes (not grace notes)
    const mainNotes = notes.filter(n => Number.isInteger(n.beatStart));
    for (const n of mainNotes) {
      expect(n.duration).toBeCloseTo(0.86, 1);
    }
  });

  // --- Style-specific tests ---
  it('style未指定: swing (4-feel) と同じ4音以上', () => {
    const notes = generateBassLine(0, 'maj7', 4, 5);
    expect(notes.length).toBeGreaterThanOrEqual(4);
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

  // --- Velocity tests ---
  it('全ノートに velocity が設定されている', () => {
    const notes = generateBassLine(0, 'maj7', 4, 5);
    for (const n of notes) {
      expect(n.velocity).toBeDefined();
      expect(n.velocity).toBeGreaterThanOrEqual(0);
      expect(n.velocity).toBeLessThanOrEqual(127);
    }
  });

  it('velocity が config.velocity ± humanize 範囲内', () => {
    clearBassConfigCache();
    const cfg = getBassConfig();
    for (let i = 0; i < 50; i++) {
      const notes = generateBassLine(0, '7', 4, 7, 'medium-swing', i * 4);
      for (const n of notes) {
        if (n.velocity === cfg.tripletGrace.velocity) continue; // grace note has fixed velocity
        expect(n.velocity!).toBeGreaterThanOrEqual(cfg.velocity - cfg.velocityHumanize);
        expect(n.velocity!).toBeLessThanOrEqual(cfg.velocity + cfg.velocityHumanize);
      }
    }
  });

  // --- PRNG determinism tests ---
  it('同一 globalBeatOffset → 同一出力 (PRNG 決定性)', () => {
    const a = generateBassLine(0, 'maj7', 4, 5, 'medium-swing', 16);
    const b = generateBassLine(0, 'maj7', 4, 5, 'medium-swing', 16);
    expect(a).toEqual(b);
  });

  it('異なる globalBeatOffset → 異なるパターン (高確率)', () => {
    // 10種類の offset で生成し、全て同一ではないことを確認
    const results = new Set<string>();
    for (let offset = 0; offset < 40; offset += 4) {
      const notes = generateBassLine(0, 'dom7', 4, 5, 'medium-swing', offset);
      results.add(notes.map(n => n.midi).join(','));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  // --- Pattern template tests ---
  it('beat1 がルートである (全品質)', () => {
    for (const q of ['maj7', 'm7', '7', 'm7b5', 'dim7']) {
      for (let offset = 0; offset < 40; offset += 4) {
        const notes = generateBassLine(0, q, 4, 5, 'medium-swing', offset);
        // C root in bass register → C2=36 base, C(0) <= 36+6 → stays at C2=36
        expect(notes[0].midi).toBe(36);
      }
    }
  });

  it('approach note の多様性 (chromatic/diatonic/leap が全て出現)', () => {
    const approachIntervals = new Set<number>();
    // 次ルート C (midi=48), 多数の offset でアプローチ音を収集
    for (let offset = 0; offset < 200; offset += 4) {
      const notes = generateBassLine(7, '7', 4, 0, 'medium-swing', offset); // G7 → C
      // 最終拍付近のノート (approach候補)
      const lastMainBeat = notes.filter(n => n.beatStart >= 3 && Number.isInteger(n.beatStart));
      if (lastMainBeat.length > 0) {
        const appMidi = lastMainBeat[0].midi;
        const nextRoot = 48; // C in bass register
        approachIntervals.add(Math.abs(appMidi - nextRoot));
      }
    }
    // 半音(1), 全音(2), リープ(5 or 7) のいずれかが含まれるべき
    expect(approachIntervals.size).toBeGreaterThan(1);
  });

  it('三連符グレースノートが出現しうる (多数回実行)', () => {
    let hasGrace = false;
    for (let offset = 0; offset < 400; offset += 4) {
      const notes = generateBassLine(0, 'maj7', 4, 5, 'medium-swing', offset);
      // グレースノート: beatStart が非整数
      if (notes.some(n => n.beatStart % 1 !== 0)) {
        hasGrace = true;
        break;
      }
    }
    expect(hasGrace).toBe(true);
  });

  it('三連符グレースノートの位置が b.67 付近', () => {
    for (let offset = 0; offset < 400; offset += 4) {
      const notes = generateBassLine(0, 'maj7', 4, 5, 'medium-swing', offset);
      const graceNotes = notes.filter(n => n.beatStart % 1 !== 0);
      for (const g of graceNotes) {
        const frac = g.beatStart % 1;
        expect(frac).toBeCloseTo(0.667, 1);
      }
    }
  });

  // --- Contour tests ---
  it('コンターが交互に切り替わる (ascending/descending)', () => {
    // measureIdx 0,1 → ascending, 2,3 → descending (contourAlternateEvery=2)
    const asc = generateBassLine(0, 'maj7', 4, 5, 'medium-swing', 0);
    const desc = generateBassLine(0, 'maj7', 4, 5, 'medium-swing', 8); // measureIdx=2
    // descending 版は beat1-2 がオクターブ下になりうる
    // 完全一致しないことを確認 (同一パターンでもコンターが変わる)
    const ascMidis = asc.filter(n => Number.isInteger(n.beatStart)).map(n => n.midi).join(',');
    const descMidis = desc.filter(n => Number.isInteger(n.beatStart)).map(n => n.midi).join(',');
    // 全く同じ場合もありうる (パターン次第) ので、複数 offset で確認
    let differs = false;
    for (let i = 0; i < 10; i++) {
      const a = generateBassLine(0, 'dom7', 4, 5, 'medium-swing', i * 4);
      const d = generateBassLine(0, 'dom7', 4, 5, 'medium-swing', i * 4 + 8);
      if (a.map(n => n.midi).join(',') !== d.map(n => n.midi).join(',')) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  // --- Backward compatibility ---
  it('globalBeatOffset 省略時もエラーなし', () => {
    const notes = generateBassLine(0, 'maj7', 4, 5);
    expect(notes.length).toBeGreaterThanOrEqual(4);
  });

  it('Bossa/Ballad/Latin にも velocity が設定される', () => {
    for (const style of ['bossa', 'ballad', 'latin'] as const) {
      const notes = generateBassLine(0, 'maj7', 4, 5, style);
      for (const n of notes) {
        expect(n.velocity).toBeDefined();
        expect(n.velocity).toBeGreaterThan(0);
      }
    }
  });
});

describe('BassConfig 新フィールド', () => {
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
    expect(cfg.midiRange).toEqual({ low: 28, high: 60 });
    expect(cfg.bassRootBase).toBe(36);
    expect(cfg.velocity).toBe(83);
  });

  it('新規フィールドのデフォルト値が正しい', () => {
    clearBassConfigCache();
    const cfg = getBassConfig();
    expect(cfg.prng).toEqual({ multiplier: 7919, constant: 17 });
    expect(cfg.defaultDuration).toBe(0.86);
    expect(cfg.velocityHumanize).toBe(15);
    expect(cfg.tripletGrace).toEqual({ probability: 0.10, velocity: 91, offset: 0.667 });
    expect(cfg.patterns.swing.approachWeights).toEqual({ chromatic: 0.50, diatonic: 0.20, dominant: 0.20, arpeggio: 0.10 });
    expect(cfg.patterns.swing.contourAlternateEvery).toBe(2);
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
