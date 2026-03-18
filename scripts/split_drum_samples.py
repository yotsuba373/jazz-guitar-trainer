#!/usr/bin/env python3
"""
レンダリング済み WAV をドラムサンプルに分割。

generate_drum_sample_midi.py で生成したマニフェストに従い、
Cubase でレンダリングした長い WAV を個別サンプルに分割する。

使い方:
  python scripts/split_drum_samples.py scripts/data/rendered_bop-sticks-dry.wav --manifest scripts/data/drum_samples_manifest_bop-sticks-dry.json

出力: public/drums/{kit}/ に個別 WAV ファイル

依存: pip install soundfile (WAV 読み書き)
"""

import argparse
import json
import os
import sys

import soundfile as sf
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MANIFEST = os.path.join(SCRIPT_DIR, 'output', 'drum_samples_manifest.json')
PUBLIC_DRUMS = os.path.join(SCRIPT_DIR, '..', 'public', 'drums')

# 無音トリム: この振幅以下が続いたら末尾をカット
SILENCE_THRESHOLD = 0.001
# トリム後に付加する余韻 (秒)
TAIL_PADDING = 0.05


def trim_silence(audio: np.ndarray, sr: int) -> np.ndarray:
    """末尾の無音をトリム (先頭は維持)"""
    if audio.ndim == 2:
        # ステレオ → モノに変換して振幅計算
        mono = np.max(np.abs(audio), axis=1)
    else:
        mono = np.abs(audio)

    # 末尾から探索して最後の非無音サンプルを見つける
    last_nonsilent = len(mono) - 1
    while last_nonsilent > 0 and mono[last_nonsilent] < SILENCE_THRESHOLD:
        last_nonsilent -= 1

    # パディング追加
    end_sample = min(last_nonsilent + int(sr * TAIL_PADDING), len(audio))
    return audio[:end_sample]


def main():
    parser = argparse.ArgumentParser(description='Split rendered WAV into drum samples')
    parser.add_argument('wav_file', help='Rendered WAV file from Cubase')
    parser.add_argument('--manifest', default=DEFAULT_MANIFEST,
                        help=f'Manifest JSON (default: {DEFAULT_MANIFEST})')
    parser.add_argument('--no-trim', action='store_true',
                        help='Skip silence trimming')
    args = parser.parse_args()

    if not os.path.isfile(args.wav_file):
        print(f'[ERROR] WAV file not found: {args.wav_file}')
        sys.exit(1)

    if not os.path.isfile(args.manifest):
        print(f'[ERROR] Manifest not found: {args.manifest}')
        print('Run generate_drum_sample_midi.py first.')
        sys.exit(1)

    # マニフェスト読み込み
    with open(args.manifest, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    kit = manifest['kit']
    slot_duration = manifest['slotDuration']
    entries = manifest['entries']

    print(f'Kit: {kit}')
    print(f'Slot duration: {slot_duration}s')
    print(f'Entries: {len(entries)}')

    # WAV 読み込み
    audio, sr = sf.read(args.wav_file)
    total_seconds = len(audio) / sr
    print(f'WAV: {args.wav_file} ({total_seconds:.1f}s, {sr}Hz, {"stereo" if audio.ndim == 2 else "mono"})')

    # 出力ディレクトリ
    output_dir = os.path.join(PUBLIC_DRUMS, kit)
    os.makedirs(output_dir, exist_ok=True)

    # 分割
    saved = 0
    for entry in entries:
        start_sec = entry['start']
        end_sec = start_sec + slot_duration
        filename = entry['filename']

        start_sample = int(start_sec * sr)
        end_sample = min(int(end_sec * sr), len(audio))

        if start_sample >= len(audio):
            print(f'  [SKIP] {filename} - beyond WAV length')
            continue

        chunk = audio[start_sample:end_sample]

        # 末尾無音トリム
        if not args.no_trim:
            chunk = trim_silence(chunk, sr)

        # 保存
        output_path = os.path.join(output_dir, filename)
        sf.write(output_path, chunk, sr)

        duration_ms = len(chunk) / sr * 1000
        print(f'  OK {filename} ({duration_ms:.0f}ms)')
        saved += 1

    print(f'\n{saved}/{len(entries)} files saved to {output_dir}')


if __name__ == '__main__':
    main()
