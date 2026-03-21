#!/usr/bin/env python3
"""EZBass (EBX-UPRIGHT) カスタム WAV 書き出し用 MIDI 生成スクリプト.

通常ピチカート (3ベロシティ) + レガート (1ベロシティ) + ゴーストノート (1ベロシティ)
の全音域を1本の MIDI に書き出す。DAW で EZBass に通してオーディオバウンス後、
スライススクリプト (slice_bass_samples.py) で個別 WAV に分割する。

出力: scripts/output/bass_samples.mid

音域: D1 (MIDI 38) ~ F4 (MIDI 65) = 28 音
  ※ MIDI 28~32: EZBass キースイッチ領域 (発音不可)
  ※ MIDI 33~37 (A0~C#1): 音は鳴るが A1~C#2 と同一音 (1oct上にリダイレクト)
  ※ MIDI 38 (D1) が EBX-UPRIGHT の実際の最低音

ピチカート: v65 / v80 / v95 (3 レイヤー)
レガート:   v80 (1 レイヤー, KS 32 = G#0, 前音オーバーラップ方式)
ゴースト:   v80 (1 レイヤー, KS 16 = E-1)

EZBass キースイッチ:
  MIDI 16 (E-1)  = Ghost note
  MIDI 32 (G#0)  = Legato (hammer-on/pull-off)
  MIDI 15 (D#-1) = Right-hand percussion
  MIDI 17 (F-1)  = Slide

EZBass EBX-UPRIGHT 演奏可能範囲:
  ※ MIDI 28 (E0): アタック音のみ
  ※ MIDI 29~32 (F0~G#0): 無音 (キースイッチ領域)
  ※ MIDI 33~37 (A0~C#1): A1~C#2 と同一音 (リダイレクト)
  ※ MIDI 38 (D1): 実際の最低音

レガートの仕組み (参考 MIDI 分析):
  前の音がまだ鳴っている状態で KS 32 + 新しいノートを同時発音
  → EZBass が前の音からのプルオフ/ハンマーオンとして処理

配置:
  [ピチカート v65 × 33音] [v80 × 33音] [v95 × 33音]
  [レガート v80 × 33音]   ← 半音上セットアップ音をオーバーラップ
  [ゴースト v80 × 33音]
"""

import pretty_midi
import os

# --- 設定 ---
MIDI_LOW = 38    # D1 (EZBass EBX-UPRIGHT 実際の最低音)
MIDI_HIGH = 65   # F4 (参考 MIDI の最高音)
BPM = 120
NOTE_DUR = 1.5        # 各音の長さ (秒) — サステイン部分
NOTE_INTERVAL = 2.5   # 音の間隔 (秒) — note-off 後 1.0s の余白でリリースノイズを録る
SECTION_GAP = 3.0     # セクション間の余白 (秒)

# キースイッチ
GHOST_KS_PITCH = 16   # E-1 = Ghost note
LEGATO_KS_PITCH = 32  # G#0 = Legato (hammer-on/pull-off)
KS_DUR = 0.002        # キースイッチの duration (極短)

# レガート: セットアップ音 (半音上) のパラメータ
# 参考 MIDI の実測: 前音が ~0.002s オーバーラップした状態で KS + 新音が同時発音
LEGATO_SETUP_DUR = 0.5   # セットアップ音の長さ (秒)
LEGATO_OVERLAP = 0.002   # セットアップ音と目標音のオーバーラップ (秒)

# ベロシティ
PIZZ_VELOCITIES = [65, 80, 95]
LEGATO_VELOCITIES = [80]
GHOST_VELOCITIES = [80]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')
KIT_NAME = 'upright'
OUTPUT_FILE = os.path.join(OUTPUT_DIR, f'bass_samples_{KIT_NAME}.mid')


def generate():
    midi = pretty_midi.PrettyMIDI(initial_tempo=BPM)
    inst = pretty_midi.Instrument(program=32, name='EZBass Samples')

    pitches = list(range(MIDI_LOW, MIDI_HIGH + 1))
    t = 0.0

    # --- 通常ピチカート (3 velocity layers) ---
    for vel in PIZZ_VELOCITIES:
        for pitch in pitches:
            inst.notes.append(pretty_midi.Note(
                velocity=vel, pitch=pitch,
                start=t, end=t + NOTE_DUR,
            ))
            t += NOTE_INTERVAL
        t += SECTION_GAP

    # --- レガート (KS 32, 前音オーバーラップ方式) ---
    # 参考 MIDI のパターン:
    #   前の音が鳴っている → KS 32 + 新ノート同時発音
    #   前の音は新ノート発音直後 (0.002s後) に note-off
    for vel in LEGATO_VELOCITIES:
        for pitch in pitches:
            setup_pitch = pitch + 1  # 半音上 (プルオフ元)
            if setup_pitch > 127:
                setup_pitch = pitch - 1

            # セットアップ音 (半音上、目標音発音後まで微小オーバーラップ)
            setup_start = t
            target_start = t + LEGATO_SETUP_DUR
            setup_end = target_start + LEGATO_OVERLAP  # 目標音と 0.002s オーバーラップ

            inst.notes.append(pretty_midi.Note(
                velocity=vel, pitch=setup_pitch,
                start=setup_start, end=setup_end,
            ))

            # レガート KS (目標音と同時)
            inst.notes.append(pretty_midi.Note(
                velocity=vel, pitch=LEGATO_KS_PITCH,
                start=target_start, end=target_start + KS_DUR,
            ))

            # 目標音 (プルオフで鳴る音 = 録りたいサンプル)
            inst.notes.append(pretty_midi.Note(
                velocity=vel, pitch=pitch,
                start=target_start, end=target_start + NOTE_DUR,
            ))

            t += NOTE_INTERVAL + LEGATO_SETUP_DUR
        t += SECTION_GAP

    # --- ゴーストノート (KS 16 = E-1) ---
    for vel in GHOST_VELOCITIES:
        for pitch in pitches:
            inst.notes.append(pretty_midi.Note(
                velocity=vel, pitch=GHOST_KS_PITCH,
                start=t, end=t + KS_DUR,
            ))
            inst.notes.append(pretty_midi.Note(
                velocity=vel, pitch=pitch,
                start=t, end=t + NOTE_DUR,
            ))
            t += NOTE_INTERVAL
        t += SECTION_GAP

    midi.instruments.append(inst)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    midi.write(OUTPUT_FILE)

    # --- レポート ---
    n_pitches = len(pitches)
    n_pizz = n_pitches * len(PIZZ_VELOCITIES)
    n_legato = n_pitches * len(LEGATO_VELOCITIES)
    n_ghost = n_pitches * len(GHOST_VELOCITIES)
    total = n_pizz + n_legato + n_ghost

    print(f'Generated: {OUTPUT_FILE}')
    print(f'  Pitches:    {n_pitches} (MIDI {MIDI_LOW}~{MIDI_HIGH})')
    print(f'  Pizzicato:  {n_pitches} x {len(PIZZ_VELOCITIES)} vel = {n_pizz} samples')
    print(f'  Legato:     {n_pitches} x {len(LEGATO_VELOCITIES)} vel = {n_legato} samples')
    print(f'  Ghost:      {n_pitches} x {len(GHOST_VELOCITIES)} vel = {n_ghost} samples')
    print(f'  Total:      {total} samples')
    print(f'  Duration:   {t:.1f}s ({t/60:.1f}min)')
    print(f'  BPM:        {BPM}')
    print()
    print('Sections:')
    sec_t = 0.0
    for vel in PIZZ_VELOCITIES:
        sec_end = sec_t + n_pitches * NOTE_INTERVAL
        print(f'  Pizz   v{vel:3d}: {sec_t:6.1f}s ~ {sec_end:6.1f}s')
        sec_t = sec_end + SECTION_GAP
    for vel in LEGATO_VELOCITIES:
        sec_end = sec_t + n_pitches * (NOTE_INTERVAL + LEGATO_SETUP_DUR)
        print(f'  Legato v{vel:3d}: {sec_t:6.1f}s ~ {sec_end:6.1f}s  (setup+overlap)')
        sec_t = sec_end + SECTION_GAP
    for vel in GHOST_VELOCITIES:
        sec_end = sec_t + n_pitches * NOTE_INTERVAL
        print(f'  Ghost  v{vel:3d}: {sec_t:6.1f}s ~ {sec_end:6.1f}s')
        sec_t = sec_end + SECTION_GAP

    print()
    print('Note: MIDI 28~37 excluded (EZBass EBX-UPRIGHT: KS zone + redirected)')
    print('      SoundFont fallback will cover MIDI 28~37 at runtime')


if __name__ == '__main__':
    generate()
