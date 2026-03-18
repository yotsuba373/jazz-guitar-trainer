#!/usr/bin/env python3
"""
MIDI ドラムパターン → JSON パーサー。

入力: scripts/data/midi/drums/{style}_{番号}.mid (8小節, 4/4)
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
MEASURES_PER_PATTERN = 8
TOTAL_BEATS = BEATS_PER_MEASURE * MEASURES_PER_PATTERN  # 32

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DRUMS_DIR = os.path.join(SCRIPT_DIR, 'data', 'midi', 'drums')
KITS_PATH = os.path.join(DRUMS_DIR, 'drum-kits.json')
OUTPUT_PATH = os.path.join(SCRIPT_DIR, 'data', 'drum-patterns.json')
PUBLIC_PATH = os.path.join(SCRIPT_DIR, '..', 'public', 'drum-patterns.json')
PUBLIC_DRUMS = os.path.join(SCRIPT_DIR, '..', 'public', 'drums')

# ファイル名パターン: {style}_{番号}.mid (style にハイフン許容: medium-swing_1.mid)
FILENAME_RE = re.compile(
    r'^(?P<style>[a-z][a-z0-9-]*)_(?P<num>\d+)\.mid$',
    re.IGNORECASE,
)

# WAV ファイル名パターン: {noteName}_v{velocity}.wav
WAV_RE = re.compile(
    r'^(?P<note>[a-g]#?\d+)_v(?P<vel>\d+)\.wav$',
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


def note_name_to_midi(name: str) -> int | None:
    """ファイル名用ノート名 → MIDI ノート番号。不正なら None"""
    m = re.match(r'^([a-g]#?)(-?\d+)$', name.lower())
    if not m:
        return None
    note = m.group(1)
    octave = int(m.group(2))
    try:
        idx = NOTE_NAMES.index(note)
    except ValueError:
        return None
    return (octave + 2) * 12 + idx


def snap_to_grid(value: float) -> float:
    """120グリッドに量子化"""
    return round(value * GRID) / GRID


def load_kit_mapping() -> dict[str, str]:
    """drum-kits.json を読み込み、style → kit フォルダ名の辞書を返す"""
    if not os.path.exists(KITS_PATH):
        print(f'[WARN] drum-kits.json not found at {KITS_PATH}')
        print(f'[WARN] スタイル名をそのままキットフォルダ名として使用します')
        return {}
    with open(KITS_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    mapping = {}
    for k, v in raw.items():
        if k.startswith('_'):
            continue
        mapping[k.lower()] = v
    return mapping


def parse_filename(filename: str) -> str | None:
    """ファイル名からスタイルを抽出。返り値: style or None"""
    m = FILENAME_RE.match(filename)
    if not m:
        return None
    return m.group('style').lower()


def scan_wav_files(kit_folder: str) -> dict[int, list[int]]:
    """
    public/drums/{kit_folder}/ をスキャンし、ピッチごとの利用可能ベロシティを返す。
    返り値: { midi_pitch: [vel1, vel2, ...] } (昇順ソート)
    """
    style_dir = os.path.join(PUBLIC_DRUMS, kit_folder)
    result: dict[int, list[int]] = {}
    if not os.path.isdir(style_dir):
        return result
    for fname in os.listdir(style_dir):
        m = WAV_RE.match(fname)
        if not m:
            continue
        note_name = m.group('note').lower()
        vel = int(m.group('vel'))
        pitch = note_name_to_midi(note_name)
        if pitch is None:
            continue
        if pitch not in result:
            result[pitch] = []
        result[pitch].append(vel)
    # 昇順ソート
    for pitch in result:
        result[pitch].sort()
    return result


def find_nearest(velocities: list[int], target: int) -> int:
    """ベロシティリストから最寄りの値を返す"""
    best = velocities[0]
    best_dist = abs(target - best)
    for v in velocities[1:]:
        d = abs(target - v)
        if d < best_dist:
            best = v
            best_dist = d
    return best


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
    all_hits: list[tuple[float, int, int]] = []
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

    # キットマッピング読み込み
    kit_mapping = load_kit_mapping()
    if kit_mapping:
        kits_used = sorted(set(kit_mapping.values()))
        print(f'Loaded drum-kits.json: {len(kit_mapping)} style(s) → {len(kits_used)} kit(s) ({", ".join(kits_used)})')

    # MIDI ファイル収集
    midi_files = sorted([
        f for f in os.listdir(DRUMS_DIR)
        if f.lower().endswith('.mid') or f.lower().endswith('.midi')
    ])

    if not midi_files:
        print(f'[INFO] No MIDI files found in {DRUMS_DIR}')
        print('[INFO] Place files named like: medium-swing_1.mid, bossa-nova_1.mid, etc.')
        print(f'[INFO] Each file should be 8 measures (32 beats) in 4/4')
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump({'patterns': {}, 'samples': {}, 'kits': {}}, f, indent=2)
        print(f'Wrote empty DB to {OUTPUT_PATH}')
        return

    patterns_db: dict[str, list[dict]] = {}
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

        if style not in patterns_db:
            patterns_db[style] = []
        patterns_db[style].append(entry)
        total_patterns += 1

        kit_name = kit_mapping.get(style, style)
        total_hits = sum(len(m) for m in measures)
        all_pitches = sorted(set(h['pitch'] for m in measures for h in m))
        pitch_names = [midi_to_note_name(p) for p in all_pitches]
        per_measure = [len(m) for m in measures]
        print(f'  ✓ {filename} → {style} [kit: {kit_name}] ({total_hits} hits [{"+".join(map(str, per_measure))}], pitches: {", ".join(pitch_names)})')

    # キットマッピングを JSON に含める (スタイル → キットフォルダ名)
    # パターンが存在するスタイルのみ
    kits_db: dict[str, str] = {}
    for style in patterns_db:
        kits_db[style] = kit_mapping.get(style, style)

    # WAV スキャン: キットフォルダごとにサンプルマップ構築 (重複スキャン回避)
    wav_cache: dict[str, dict[int, list[int]]] = {}  # kit_folder → wav_map
    samples_db: dict[str, dict[str, list[int]]] = {}  # style → { pitch_str: [vels] }
    for style in patterns_db:
        kit_folder = kits_db[style]
        if kit_folder not in wav_cache:
            wav_cache[kit_folder] = scan_wav_files(kit_folder)
        wav_map = wav_cache[kit_folder]
        if wav_map:
            samples_db[style] = {str(p): vels for p, vels in sorted(wav_map.items())}

    # JSON 出力
    db = {
        'patterns': patterns_db,
        'samples': samples_db,
        'kits': kits_db,
    }
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    print(f'\nWrote {total_patterns} pattern(s) across {len(patterns_db)} style(s) to {OUTPUT_PATH}')

    # public/ にコピー
    shutil.copy2(OUTPUT_PATH, PUBLIC_PATH)
    print(f'Copied to {PUBLIC_PATH}')

    # サマリー
    for key, patterns in sorted(patterns_db.items()):
        kit = kits_db[key]
        print(f'  {key} [kit: {kit}]: {len(patterns)} pattern(s)')

    # --- スタイル別 pitch×velocity マッピングレポート ---
    for style, patterns in sorted(patterns_db.items()):
        kit_folder = kits_db[style]

        # MIDI パターン内の全 pitch×velocity ペアを収集
        pitch_vels: dict[int, set[int]] = {}
        for p in patterns:
            for m in p['measures']:
                for h in m:
                    pitch = h['pitch']
                    if pitch not in pitch_vels:
                        pitch_vels[pitch] = set()
                    pitch_vels[pitch].add(h['velocity'])

        wav_map = wav_cache.get(kit_folder, {})

        print(f'\n--- {style} [kit: {kit_folder}] → public/drums/{kit_folder}/ ---')
        if not wav_map:
            print(f'  WAV なし → Hydrogen GM サンプルでフォールバック再生')
            for pitch in sorted(pitch_vels):
                name = midi_to_note_name(pitch)
                vels = sorted(pitch_vels[pitch])
                print(f'  MIDI {pitch:3d} ({name:4s}): 使用 vel = {", ".join(map(str, vels))}')
            continue

        for pitch in sorted(pitch_vels):
            name = midi_to_note_name(pitch)
            vels_used = sorted(pitch_vels[pitch])
            available = wav_map.get(pitch, [])

            print(f'  MIDI {pitch:3d} ({name}):')
            if not available:
                print(f'    WAV なし → このピッチは無音になります')
                continue

            avail_str = ', '.join(f'{name}_v{v}.wav' for v in available)
            print(f'    配置済み WAV: {avail_str}')
            for vel in vels_used:
                nearest = find_nearest(available, vel)
                wav_name = f'{name}_v{nearest}.wav'
                if nearest == vel:
                    print(f'    vel {vel:3d} → {wav_name}')
                else:
                    print(f'    vel {vel:3d} → {wav_name} (nearest, diff={abs(vel-nearest)})')


if __name__ == '__main__':
    main()
