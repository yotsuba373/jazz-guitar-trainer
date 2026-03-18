#!/usr/bin/env python3
"""
MIDI ドラムパターン → JSON パーサー。

入力: scripts/data/midi/drums/{style}_{番号}.mid (4小節, 4/4)
出力: scripts/data/drum-patterns.json → public/drum-patterns.json にコピー

使い方:
  pip install pretty_midi
  python scripts/parse_drum_patterns.py
"""

import json
import os
import re
import shutil
import sys

import pretty_midi

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------

GRID = 120  # 1拍あたりのグリッド分解能 (parse_licks.py と同じ)
BEATS_PER_MEASURE = 4
MEASURES_PER_PATTERN = 4
TOTAL_BEATS = BEATS_PER_MEASURE * MEASURES_PER_PATTERN  # 16

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DRUMS_DIR = os.path.join(SCRIPT_DIR, 'data', 'midi', 'drums')
OUTPUT_PATH = os.path.join(SCRIPT_DIR, 'data', 'drum-patterns.json')
PUBLIC_PATH = os.path.join(SCRIPT_DIR, '..', 'public', 'drum-patterns.json')

# ファイル名パターン: {style}_{番号}.mid
FILENAME_RE = re.compile(
    r'^(?P<style>[a-z]+)_(?P<num>\d+)\.mid$',
    re.IGNORECASE,
)

NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']

# ---------------------------------------------------------------------------
# ユーティリティ
# ---------------------------------------------------------------------------


def midi_to_note_name(pitch: int) -> str:
    """MIDI ノート番号 → ファイル名用ノート名 (C3=60 convention)"""
    name = NOTE_NAMES[pitch % 12]
    octave = pitch // 12 - 2
    return f'{name}{octave}'


def snap_to_grid(value: float) -> float:
    """120グリッドに量子化"""
    return round(value * GRID) / GRID


def parse_filename(filename: str) -> str | None:
    """ファイル名からスタイルを抽出。返り値: style or None"""
    m = FILENAME_RE.match(filename)
    if not m:
        return None
    return m.group('style').lower()


def parse_midi_file(filepath: str) -> list[list[dict]] | None:
    """
    4小節 MIDI ファイルからドラムヒットを抽出し、小節ごとに分割。
    返り値: [measure0_hits, measure1_hits, measure2_hits, measure3_hits] or None
    各ヒット: { pitch, beatStart, velocity }
    beatStart は小節内相対 (0.0〜3.999)
    """
    try:
        midi = pretty_midi.PrettyMIDI(filepath)
    except Exception as e:
        print(f'[ERROR] Failed to read {filepath}: {e}')
        return None

    # テンポ取得
    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0
    sec_per_beat = 60.0 / bpm

    # 全ヒット収集
    all_hits: list[tuple[float, int, int]] = []  # (absolute_beat, pitch, velocity)
    for instrument in midi.instruments:
        if not instrument.is_drum:
            continue
        for note in instrument.notes:
            abs_beat = note.start / sec_per_beat
            abs_beat = snap_to_grid(abs_beat)
            if abs_beat < 0 or abs_beat >= TOTAL_BEATS:
                continue
            velocity = max(1, min(127, note.velocity))
            all_hits.append((abs_beat, note.pitch, velocity))

    if not all_hits:
        return None

    # 小節ごとに分割
    measures: list[list[dict]] = [[] for _ in range(MEASURES_PER_PATTERN)]
    for abs_beat, pitch, velocity in all_hits:
        measure_idx = min(int(abs_beat // BEATS_PER_MEASURE), MEASURES_PER_PATTERN - 1)
        local_beat = abs_beat - measure_idx * BEATS_PER_MEASURE
        measures[measure_idx].append({
            'pitch': pitch,
            'beatStart': round(local_beat, 4),
            'velocity': velocity,
        })

    # 各小節を beatStart でソート
    for m in measures:
        m.sort(key=lambda h: (h['beatStart'], h['pitch']))

    return measures


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main():
    if not os.path.isdir(DRUMS_DIR):
        print(f'[ERROR] Directory not found: {DRUMS_DIR}')
        sys.exit(1)

    # MIDI ファイル収集
    midi_files = sorted([
        f for f in os.listdir(DRUMS_DIR)
        if f.lower().endswith('.mid') or f.lower().endswith('.midi')
    ])

    if not midi_files:
        print(f'[INFO] No MIDI files found in {DRUMS_DIR}')
        print('[INFO] Place files named like: swing_1.mid, bossa_1.mid, etc.')
        print(f'[INFO] Each file should be 4 measures (16 beats) in 4/4')
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump({}, f, indent=2)
        print(f'Wrote empty DB to {OUTPUT_PATH}')
        return

    db: dict[str, list[dict]] = {}
    total_patterns = 0

    for filename in midi_files:
        style = parse_filename(filename)
        if style is None:
            print(f'[SKIP] {filename} — does not match naming convention (expected: {{style}}_{{num}}.mid)')
            continue

        filepath = os.path.join(DRUMS_DIR, filename)
        measures = parse_midi_file(filepath)
        if measures is None:
            print(f'[SKIP] {filename} — no valid drum hits found')
            continue

        pattern_id = os.path.splitext(filename)[0]
        entry = {
            'id': pattern_id,
            'measures': measures,
        }

        if style not in db:
            db[style] = []
        db[style].append(entry)
        total_patterns += 1

        total_hits = sum(len(m) for m in measures)
        all_pitches = sorted(set(h['pitch'] for m in measures for h in m))
        pitch_names = [midi_to_note_name(p) for p in all_pitches]
        per_measure = [len(m) for m in measures]
        print(f'  ✓ {filename} → {style} ({total_hits} hits [{"+".join(map(str, per_measure))}], pitches: {", ".join(pitch_names)})')

    # JSON 出力
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    print(f'\nWrote {total_patterns} pattern(s) across {len(db)} style(s) to {OUTPUT_PATH}')

    # public/ にコピー
    shutil.copy2(OUTPUT_PATH, PUBLIC_PATH)
    print(f'Copied to {PUBLIC_PATH}')

    # サマリー
    for key, patterns in sorted(db.items()):
        print(f'  {key}: {len(patterns)} pattern(s)')

    # スタイル別にユニークピッチから必要な WAV ファイル一覧を表示
    vel_layers = [25, 50, 80, 105, 127]
    has_any = False
    for style, patterns in sorted(db.items()):
        pitches: set[int] = set()
        for p in patterns:
            for m in p['measures']:
                for h in m:
                    pitches.add(h['pitch'])
        if not pitches:
            continue
        if not has_any:
            print(f'\n--- カスタム WAV サンプル (任意) ---')
            has_any = True
        print(f'\n  public/drums/{style}/')
        for pitch in sorted(pitches):
            name = midi_to_note_name(pitch)
            files = [f'{name}_v{v}.wav' for v in vel_layers]
            print(f'    MIDI {pitch:3d} ({name:4s}): {", ".join(files)}')


if __name__ == '__main__':
    main()
