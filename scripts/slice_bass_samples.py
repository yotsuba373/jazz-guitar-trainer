#!/usr/bin/env python3
"""バウンス済みベース WAV を個別サンプルにスライスし、マニフェストを生成するスクリプト.

各ノートを メインサンプル + リリースサンプル に分割:
  - メインサンプル (d0_v80.wav):      アタック〜サステイン (note-on 〜 note-off)
  - リリースサンプル (d0_v80_rel.wav): note-off 後のリリースノイズ
  - プリングオフ (d0_p80.wav):        半音上→下行レガート
  - ハンマリングオン (d0_h80.wav):    半音下→上行レガート

再生時の流れ:
  note-on  → メインサンプル再生
  note-off → メインサンプルを短いフェードで停止 + リリースサンプル再生

使い方:
  1. DAW で scripts/output/bass_samples_upright.mid を EZBass (EBX-UPRIGHT) に読み込み
  2. オーディオバウンス → scripts/output/bass_samples_rendered_upright.wav
  3. python scripts/slice_bass_samples.py [--kit upright]

出力:
  public/bass/{kit}/          — 個別 WAV ファイル (16bit 変換)
  public/bass-patterns.generated.json — samples/kits マニフェスト更新

依存: pip install soundfile numpy
"""

import argparse
import json
import os

import numpy as np
import soundfile as sf

# --- generate_bass_sample_midi.py と同じ定数 (同期必須) ---
MIDI_LOW = 38
MIDI_HIGH = 65
NOTE_DUR = 1.5         # note-on 〜 note-off (秒)
NOTE_INTERVAL = 2.5    # 音の間隔 (秒)
SECTION_GAP = 3.0      # セクション間の余白 (秒)

LEGATO_SETUP_DUR = 0.5  # レガートのセットアップ音の長さ

PIZZ_VELOCITIES = [65, 80, 95]
LEGATO_VELOCITIES = [80]
GHOST_VELOCITIES = [80]

# --- MIDI → ファイル名 (drumPatterns.ts の midiToFileName と同じ) ---
NOTE_NAMES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b']

def midi_to_filename(pitch: int) -> str:
    name = NOTE_NAMES[pitch % 12]
    octave = pitch // 12 - 2
    return f'{name}{octave}'


def extract(data: np.ndarray, sr: int, start_sec: float, end_sec: float) -> np.ndarray:
    """指定区間を抽出"""
    s = int(start_sec * sr)
    e = int(end_sec * sr)
    e = min(e, len(data))
    s = min(s, len(data))
    return data[s:e].copy()


def fade(data: np.ndarray, sr: int, ms: int, direction: str = 'out'):
    """フェードイン/アウトを適用 (in-place)"""
    n = int(sr * ms / 1000)
    n = min(n, len(data))
    if n == 0:
        return
    ramp = np.linspace(0.0, 1.0, n)
    if direction == 'out':
        data[-n:] *= ramp[::-1].reshape(-1, 1) if data.ndim == 2 else ramp[::-1]
    else:
        data[:n] *= ramp.reshape(-1, 1) if data.ndim == 2 else ramp


def trim_silence(data: np.ndarray, sr: int, threshold: float = 0.005,
                 margin_sec: float = 0.05) -> np.ndarray:
    """末尾の無音をトリミング"""
    if data.ndim == 2:
        amplitude = np.max(np.abs(data), axis=1)
    else:
        amplitude = np.abs(data)

    # 末尾から最後に閾値を超えるフレームを探す
    indices = np.where(amplitude > threshold)[0]
    if len(indices) == 0:
        return data[:int(sr * margin_sec)]

    last = indices[-1]
    end = min(last + int(sr * margin_sec), len(data))
    return data[:end].copy()


def write_16bit(path: str, data: np.ndarray, sr: int):
    """numpy 配列を 16bit WAV で保存"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path, data, sr, subtype='PCM_16')


def slice_and_save(data: np.ndarray, sr: int, kit_name: str, output_dir: str,
                   do_normalize: bool, fade_out_ms: int,
                   rel_fade_in_ms: int, rel_fade_out_ms: int) -> dict:
    """MIDI 配置に従ってスライスし、メイン+リリース WAV を保存"""

    pitches = list(range(MIDI_LOW, MIDI_HIGH + 1))
    sample_map = {}
    main_count = 0
    rel_count = 0
    skipped = 0

    kit_dir = os.path.join(output_dir, kit_name)

    # 古いサンプルを全削除してクリーンスライス
    if os.path.isdir(kit_dir):
        stale = [f for f in os.listdir(kit_dir) if f.endswith('.wav')]
        for f in stale:
            os.remove(os.path.join(kit_dir, f))
        if stale:
            print(f'  Cleaned {len(stale)} old files from {kit_dir}')

    # セクション定義: (vel, prefix, is_legato)
    sections = []
    for vel in PIZZ_VELOCITIES:
        sections.append((vel, 'v', False))
    for vel in LEGATO_VELOCITIES:
        sections.append((vel, 'p', True))   # Pull-off (半音上→下行)
    for vel in LEGATO_VELOCITIES:
        sections.append((vel, 'h', True))   # Hammer-on (半音下→上行)
    for vel in GHOST_VELOCITIES:
        sections.append((vel, 'g', False))

    t = 0.0

    for vel, prefix, is_legato in sections:
        for pitch in pitches:
            if is_legato:
                note_on = t + LEGATO_SETUP_DUR
                note_off = note_on + NOTE_DUR
                slot_end = t + NOTE_INTERVAL + LEGATO_SETUP_DUR
            else:
                note_on = t
                note_off = t + NOTE_DUR
                slot_end = t + NOTE_INTERVAL

            start_idx = int(note_on * sr)
            if start_idx >= len(data):
                skipped += 1
                t += (NOTE_INTERVAL + LEGATO_SETUP_DUR) if is_legato else NOTE_INTERVAL
                continue

            fname = midi_to_filename(pitch)

            # === メインサンプル ===
            main = extract(data, sr, note_on, note_off)
            if len(main) > 0:
                # レガート: セットアップ音の残響によるクリックノイズ防止
                if is_legato:
                    fade(main, sr, 1, 'in')  # 1ms フェードイン
                if do_normalize:
                    peak = np.max(np.abs(main))
                    if peak > 0:
                        main = main * (1.0 / peak)
                if fade_out_ms > 0:
                    fade(main, sr, fade_out_ms, 'out')

                wav_name = f'{fname}_{prefix}{vel}.wav'
                write_16bit(os.path.join(kit_dir, wav_name), main, sr)
                main_count += 1

                # sample_map はピチカートのベロシティレイヤーのみ
                if prefix == 'v':
                    pitch_str = str(pitch)
                    if pitch_str not in sample_map:
                        sample_map[pitch_str] = []
                    if vel not in sample_map[pitch_str]:
                        sample_map[pitch_str].append(vel)

            # === リリースサンプル ===
            # ゴーストノートはリリースが無音なのでスキップ
            if prefix == 'g':
                t += (NOTE_INTERVAL + LEGATO_SETUP_DUR) if is_legato else NOTE_INTERVAL
                continue

            rel = extract(data, sr, note_off, slot_end)
            if len(rel) > 0:
                rel = trim_silence(rel, sr, threshold=0.005, margin_sec=0.02)
                # note-off 直後の波形がゼロから離れている場合のクリックノイズ防止
                fade(rel, sr, 1, 'in')  # 1ms フェードイン
                if rel_fade_out_ms > 0:
                    fade(rel, sr, rel_fade_out_ms, 'out')

                wav_name = f'{fname}_{prefix}{vel}_rel.wav'
                write_16bit(os.path.join(kit_dir, wav_name), rel, sr)
                rel_count += 1

            t += (NOTE_INTERVAL + LEGATO_SETUP_DUR) if is_legato else NOTE_INTERVAL
        t += SECTION_GAP

    print(f'  Main samples:    {main_count}')
    print(f'  Release samples: {rel_count}')
    print(f'  Output dir:      {kit_dir}')
    if skipped:
        print(f'  Skipped:         {skipped}')

    return sample_map


def update_manifest(manifest_path: str, kit_name: str,
                    sample_map: dict, styles: list[str]):
    """bass-patterns.generated.json のマニフェストを更新"""

    if os.path.exists(manifest_path):
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    else:
        manifest = {'patterns': {}, 'samples': {}, 'kits': {}}

    manifest['samples'][kit_name] = sample_map

    for style in styles:
        manifest['kits'][style] = kit_name

    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f'  Manifest: {manifest_path}')
    print(f'    samples["{kit_name}"]: {len(sample_map)} pitches')
    print(f'    kits: {", ".join(f"{s} -> {kit_name}" for s in styles)}')


def main():
    parser = argparse.ArgumentParser(description='Slice bounced bass WAV into individual samples')
    parser.add_argument('--kit', default='upright', help='Kit name (default: upright)')
    parser.add_argument('--input', default=None, help='Input WAV path')
    parser.add_argument('--normalize', action='store_true', help='Peak normalization')
    parser.add_argument('--fade-out', type=int, default=30, help='Main fade-out ms (default: 30)')
    parser.add_argument('--rel-fade-in', type=int, default=5, help='Release fade-in ms (default: 5)')
    parser.add_argument('--rel-fade-out', type=int, default=50, help='Release fade-out ms (default: 50)')
    parser.add_argument('--styles', default='medium-swing,medium-up-swing,up-tempo-swing',
                        help='Comma-separated styles')
    args = parser.parse_args()

    if args.input:
        input_path = args.input
    else:
        input_path = os.path.join(os.path.dirname(__file__), 'output',
                                  f'bass_samples_rendered_{args.kit}.wav')

    if not os.path.exists(input_path):
        print(f'ERROR: Not found: {input_path}')
        print(f'  1. Open scripts/output/bass_samples_{args.kit}.mid in DAW')
        print(f'  2. Bounce -> scripts/output/bass_samples_rendered_{args.kit}.wav')
        return 1

    print(f'Input: {input_path}')
    print(f'Kit:   {args.kit}')
    print()

    print('Reading WAV...')
    data, sr = sf.read(input_path)  # float64, shape=(frames,) or (frames, channels)
    if data.ndim == 1:
        channels = 1
    else:
        channels = data.shape[1]
    duration = len(data) / sr
    print(f'  {sr}Hz, {channels}ch, {duration:.1f}s ({duration/60:.1f}min)')

    expected = 460.0  # pull-off + hammer-on セクション追加分
    if duration < expected * 0.9:
        print(f'  WARNING: WAV shorter than expected ({duration:.1f}s < {expected:.1f}s)')
    print()

    print('Slicing...')
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_dir = os.path.join(project_root, 'public', 'bass')
    sample_map = slice_and_save(
        data, sr, args.kit, output_dir,
        do_normalize=args.normalize,
        fade_out_ms=args.fade_out,
        rel_fade_in_ms=args.rel_fade_in,
        rel_fade_out_ms=args.rel_fade_out,
    )
    print()

    print('Updating manifest...')
    manifest_path = os.path.join(project_root, 'public', 'bass-patterns.generated.json')
    styles = [s.strip() for s in args.styles.split(',')]
    update_manifest(manifest_path, args.kit, sample_map, styles)
    print()

    total = sum(len(v) for v in sample_map.values())
    print(f'Done! {total} pitches in public/bass/{args.kit}/')
    print()
    print('File naming:')
    print('  d0_v80.wav      main (pizzicato)')
    print('  d0_v80_rel.wav  release noise (pizzicato)')
    print('  d0_p80.wav      main (pull-off / legato down)')
    print('  d0_p80_rel.wav  release noise (pull-off)')
    print('  d0_h80.wav      main (hammer-on / legato up)')
    print('  d0_h80_rel.wav  release noise (hammer-on)')
    print('  d0_g80.wav      main (ghost)')

    return 0


if __name__ == '__main__':
    exit(main())
