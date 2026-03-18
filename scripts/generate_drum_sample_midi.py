#!/usr/bin/env python3
"""
ドラムサンプル書き出し用 MIDI 生成。

parse_drum_patterns.py の出力 (drum-patterns.json) から推奨 WAV リストを読み取り、
各ピッチ×ベロシティを一定間隔で並べた MIDI ファイルを生成する。

使い方:
  python scripts/generate_drum_sample_midi.py

出力:
  scripts/data/drum_samples.mid  — Cubase にインポートして一括レンダリング用
  scripts/data/drum_samples_manifest.json — 分割スクリプト用マニフェスト

ワークフロー:
  1. python scripts/parse_drum_patterns.py scripts/data/export_drums.mid
  2. python scripts/generate_drum_sample_midi.py
  3. Cubase: drum_samples.mid をドラム VSTi トラックにインポート → ソロ → オーディオミックスダウン
  4. python scripts/split_drum_samples.py scripts/data/drum_samples_rendered.wav

依存: pip install pretty_midi
"""

import json
import os
import sys

import pretty_midi

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PATTERNS_PATH = os.path.join(SCRIPT_DIR, 'data', 'drum-patterns.json')
KITS_PATH = os.path.join(SCRIPT_DIR, 'data', 'midi', 'drums', 'drum-kits.json')
OUTPUT_MIDI = os.path.join(SCRIPT_DIR, 'data', 'drum_samples.mid')
OUTPUT_MANIFEST = os.path.join(SCRIPT_DIR, 'data', 'drum_samples_manifest.json')

NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']

# 各ノート間の間隔 (秒)。シンバル残響を含むのに十分な長さ
SLOT_DURATION = 15.0

# ノートの発音長 (秒)。短めに。実際の音は VSTi の減衰で決まる
NOTE_DURATION = 0.1

# 推奨 WAV のベロシティ間隔 (parse_drum_patterns.py と同じ)
WAV_VEL_STEP = 8

BPM = 120


def midi_to_note_name(pitch: int) -> str:
    name = NOTE_NAMES[pitch % 12]
    octave = pitch // 12 - 2
    return f'{name}{octave}'


def suggest_wav_layers(vel_min: int, vel_max: int, step: int = WAV_VEL_STEP) -> list[int]:
    if vel_min == vel_max:
        return [vel_min]
    layers = list(range(vel_min, vel_max, step))
    if layers[-1] != vel_max:
        layers.append(vel_max)
    return layers


def main():
    # drum-patterns.json 読み込み
    if not os.path.isfile(PATTERNS_PATH):
        print(f'[ERROR] {PATTERNS_PATH} not found')
        print('Run parse_drum_patterns.py first.')
        sys.exit(1)

    with open(PATTERNS_PATH, 'r', encoding='utf-8') as f:
        db = json.load(f)

    patterns = db.get('patterns', {})
    kits_map = db.get('kits', {})

    if not patterns:
        print('[ERROR] No patterns in drum-patterns.json')
        sys.exit(1)

    # drum-kits.json 読み込み (フォールバック: スタイル名をキット名に)
    kit_mapping: dict[str, str] = {}
    if os.path.isfile(KITS_PATH):
        with open(KITS_PATH, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        for k, v in raw.items():
            if not k.startswith('_'):
                kit_mapping[k.lower()] = v
    # DB の kits を優先
    for style, kit in kits_map.items():
        kit_mapping[style] = kit

    # キットごとにピッチ×ベロシティ範囲を統合
    kit_pitches: dict[str, dict[int, tuple[int, int]]] = {}  # kit → { pitch: (min, max) }
    for style, pats in patterns.items():
        kit = kit_mapping.get(style, style)
        if kit not in kit_pitches:
            kit_pitches[kit] = {}
        for pat in pats:
            for measure in pat['measures']:
                for h in measure:
                    pitch = h['pitch']
                    vel = h['velocity']
                    if pitch not in kit_pitches[kit]:
                        kit_pitches[kit][pitch] = (vel, vel)
                    else:
                        old_min, old_max = kit_pitches[kit][pitch]
                        kit_pitches[kit][pitch] = (min(old_min, vel), max(old_max, vel))

    # キットごとに MIDI + マニフェスト生成
    for kit, pitches in sorted(kit_pitches.items()):
        print(f'\n--- kit: {kit} ---')

        midi = pretty_midi.PrettyMIDI(initial_tempo=BPM)
        # ドラムトラック (is_drum=True, channel=9)
        inst = pretty_midi.Instrument(program=0, is_drum=True, name=kit)

        manifest_entries: list[dict] = []
        slot_idx = 0

        for pitch in sorted(pitches):
            vel_min, vel_max = pitches[pitch]
            layers = suggest_wav_layers(vel_min, vel_max)
            name = midi_to_note_name(pitch)

            for vel in layers:
                start_time = slot_idx * SLOT_DURATION
                end_time = start_time + NOTE_DURATION

                note = pretty_midi.Note(
                    velocity=vel,
                    pitch=pitch,
                    start=start_time,
                    end=end_time,
                )
                inst.notes.append(note)

                filename = f'{name}_v{vel}.wav'
                manifest_entries.append({
                    'slot': slot_idx,
                    'start': start_time,
                    'pitch': pitch,
                    'velocity': vel,
                    'filename': filename,
                })

                print(f'  [{slot_idx:3d}] {start_time:7.1f}s  MIDI {pitch:3d} vel {vel:3d} -> {filename}')
                slot_idx += 1

        midi.instruments.append(inst)

        total_duration = slot_idx * SLOT_DURATION
        print(f'\n  Total: {slot_idx} notes, {total_duration:.0f}s ({total_duration/60:.1f}min)')

        # MIDI 書き出し (常にキット名を含める)
        midi_path = OUTPUT_MIDI.replace('.mid', f'_{kit}.mid')
        midi.write(midi_path)
        print(f'  MIDI: {midi_path}')

        # マニフェスト書き出し
        manifest = {
            'kit': kit,
            'slotDuration': SLOT_DURATION,
            'bpm': BPM,
            'entries': manifest_entries,
        }
        manifest_path = OUTPUT_MANIFEST.replace('.json', f'_{kit}.json')
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print(f'  Manifest: {manifest_path}')


if __name__ == '__main__':
    main()
