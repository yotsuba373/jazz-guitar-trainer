#!/usr/bin/env python3
"""
MIDI ドラムパターン → JSON パーサー。

2つの入力モード:
  A) マルチトラック MIDI (推奨):
     python scripts/parse_drum_patterns.py scripts/data/midi/drums/export_drums.mid
     → トラック名 = スタイル名、8小節ごとに自動分割

  B) 個別ファイル:
     scripts/data/midi/drums/{style}_{番号}.mid (8小節, 4/4)
     python scripts/parse_drum_patterns.py
     → ファイル名からスタイルを判定

出力: scripts/data/drum-patterns.json → public/drum-patterns.json にコピー

依存: pip install pretty_midi
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
BEATS_PER_PATTERN = BEATS_PER_MEASURE * MEASURES_PER_PATTERN  # 32

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DRUMS_DIR = os.path.join(SCRIPT_DIR, 'data', 'midi', 'drums')
KITS_PATH = os.path.join(DRUMS_DIR, 'drum-kits.json')
OUTPUT_PATH = os.path.join(SCRIPT_DIR, 'data', 'drum-patterns.json')
PUBLIC_PATH = os.path.join(SCRIPT_DIR, '..', 'public', 'drum-patterns.json')
PUBLIC_DRUMS = os.path.join(SCRIPT_DIR, '..', 'public', 'drums')

# ファイル名パターン: {style}_{番号}.mid (style にハイフン許容)
FILENAME_RE = re.compile(
    r'^(?P<style>[a-z][a-z0-9-]*)_(?P<num>\d+)\.mid$',
    re.IGNORECASE,
)

# WAV ファイル名パターン: {noteName}_v{velocity}.wav
WAV_RE = re.compile(
    r'^(?P<note>[a-g][s#]?\-?\d+)_v(?P<vel>\d+)\.wav$',
    re.IGNORECASE,
)

NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']

# ---------------------------------------------------------------------------
# ユーティリティ
# ---------------------------------------------------------------------------


def midi_to_note_name(pitch: int) -> str:
    """MIDI ノート番号 → ファイル名用ノート名 (C3=60 convention, # → s)"""
    name = NOTE_NAMES[pitch % 12].replace('#', 's')
    octave = pitch // 12 - 2
    return f'{name}{octave}'


def note_name_to_midi(name: str) -> int | None:
    """ファイル名用ノート名 → MIDI ノート番号。s → # に変換して検索"""
    m = re.match(r'^([a-g][s#]?)(-?\d+)$', name.lower())
    if not m:
        return None
    note = m.group(1).replace('s', '#')
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
    for pitch in result:
        result[pitch].sort()
    return result


WAV_VEL_STEP = 8  # 推奨 WAV のベロシティ間隔 (デフォルト)


def suggest_wav_layers(vel_min: int, vel_max: int, step: int = WAV_VEL_STEP) -> list[int]:
    """
    使用ベロシティ範囲から推奨 WAV レイヤーを算出。
    固定ステップで刻み、最大誤差 ±step/2 以内。
    常に vel_min と vel_max を含む。
    """
    if vel_min == vel_max:
        return [vel_min]

    layers = list(range(vel_min, vel_max, step))
    if layers[-1] != vel_max:
        layers.append(vel_max)
    return layers


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


# ---------------------------------------------------------------------------
# MIDI パース
# ---------------------------------------------------------------------------


def extract_hits_from_instrument(
    instrument: pretty_midi.Instrument,
    sec_per_beat: float,
) -> list[tuple[float, int, int]]:
    """instrument からドラムヒットを抽出。返り値: [(abs_beat, pitch, velocity), ...]"""
    hits: list[tuple[float, int, int]] = []
    for note in instrument.notes:
        abs_beat = snap_to_grid(note.start / sec_per_beat)
        if abs_beat < 0:
            continue
        velocity = max(1, min(127, note.velocity))
        hits.append((abs_beat, note.pitch, velocity))
    return hits


def split_hits_into_patterns(
    hits: list[tuple[float, int, int]],
) -> list[list[list[dict]]]:
    """
    ヒットリストを8小節パターンに分割。
    返り値: [pattern1_measures, pattern2_measures, ...]
    各 pattern_measures = [measure0_hits, ..., measure7_hits]
    """
    if not hits:
        return []

    # 最大拍を求めてパターン数を計算
    max_beat = max(h[0] for h in hits)
    num_patterns = int(max_beat // BEATS_PER_PATTERN) + 1

    patterns: list[list[list[dict]]] = []
    for p_idx in range(num_patterns):
        pattern_start = p_idx * BEATS_PER_PATTERN
        pattern_end = pattern_start + BEATS_PER_PATTERN

        measures: list[list[dict]] = [[] for _ in range(MEASURES_PER_PATTERN)]
        has_hits = False
        for abs_beat, pitch, velocity in hits:
            if abs_beat < pattern_start or abs_beat >= pattern_end:
                continue
            has_hits = True
            local_beat = abs_beat - pattern_start
            measure_idx = min(int(local_beat // BEATS_PER_MEASURE), MEASURES_PER_PATTERN - 1)
            measure_local = local_beat - measure_idx * BEATS_PER_MEASURE
            measures[measure_idx].append({
                'pitch': pitch,
                'beatStart': round(measure_local, 4),
                'velocity': velocity,
            })

        if not has_hits:
            continue

        # 各小節をソート
        for m in measures:
            m.sort(key=lambda h: (h['beatStart'], h['pitch']))

        patterns.append(measures)

    return patterns


def parse_single_file(filepath: str) -> list[list[list[dict]]]:
    """
    個別 MIDI ファイル (8小節) からパターンを抽出。
    返り値: [pattern_measures] (通常1つ)
    """
    try:
        midi = pretty_midi.PrettyMIDI(filepath)
    except Exception as e:
        print(f'[ERROR] Failed to read {filepath}: {e}')
        return []

    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0
    sec_per_beat = 60.0 / bpm

    all_hits: list[tuple[float, int, int]] = []
    for instrument in midi.instruments:
        if not instrument.is_drum:
            continue
        all_hits.extend(extract_hits_from_instrument(instrument, sec_per_beat))

    return split_hits_into_patterns(all_hits)


def parse_multi_track_file(filepath: str) -> dict[str, list[list[list[dict]]]]:
    """
    マルチトラック MIDI ファイルからスタイル別パターンを抽出。
    トラック名 = スタイル名、8小節ごとに自動分割。
    返り値: { style: [pattern1_measures, pattern2_measures, ...] }
    """
    try:
        midi = pretty_midi.PrettyMIDI(filepath)
    except Exception as e:
        print(f'[ERROR] Failed to read {filepath}: {e}')
        return {}

    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0
    sec_per_beat = 60.0 / bpm

    result: dict[str, list[list[list[dict]]]] = {}
    for instrument in midi.instruments:
        # ドラムフラグなしでも処理 (DAW によってはフラグが付かない)
        # トラック名 → スタイル名 (小文字、空白→ハイフン)
        style = instrument.name.strip().lower().replace(' ', '-').replace('_', '-')
        if not style:
            print(f'[SKIP] Unnamed drum track')
            continue

        hits = extract_hits_from_instrument(instrument, sec_per_beat)
        patterns = split_hits_into_patterns(hits)
        if not patterns:
            print(f'[SKIP] Track "{instrument.name}" — no valid drum hits')
            continue

        if style not in result:
            result[style] = []
        result[style].extend(patterns)

    return result


# ---------------------------------------------------------------------------
# レポート出力
# ---------------------------------------------------------------------------


def print_report(
    patterns_db: dict[str, list[dict]],
    kits_db: dict[str, str],
    wav_cache: dict[str, dict[int, list[int]]],
):
    """キット単位で pitch×velocity マッピングレポートを出力 (同一キットはマージ)"""
    # キットごとにスタイルをグループ化
    kit_styles: dict[str, list[str]] = {}
    for style in sorted(patterns_db.keys()):
        kit = kits_db[style]
        if kit not in kit_styles:
            kit_styles[kit] = []
        kit_styles[kit].append(style)

    for kit_folder, styles in sorted(kit_styles.items()):
        # キット内の全スタイルから pitch×velocity を統合 (重複込み=頻度反映)
        pitch_vels_all: dict[int, list[int]] = {}  # 重複込み (頻度反映、分位数計算用)
        pitch_vels_unique: dict[int, set[int]] = {}  # ユニーク (範囲表示用)
        for style in styles:
            for p in patterns_db[style]:
                for m in p['measures']:
                    for h in m:
                        pitch = h['pitch']
                        vel = h['velocity']
                        if pitch not in pitch_vels_all:
                            pitch_vels_all[pitch] = []
                            pitch_vels_unique[pitch] = set()
                        pitch_vels_all[pitch].append(vel)
                        pitch_vels_unique[pitch].add(vel)

        styles_str = ', '.join(styles)
        wav_map = wav_cache.get(kit_folder, {})

        print(f'\n--- kit: {kit_folder} -> public/drums/{kit_folder}/ ---')
        print(f'  styles: {styles_str}')

        for pitch in sorted(pitch_vels_unique):
            name = midi_to_note_name(pitch)
            vels_unique = sorted(pitch_vels_unique[pitch])
            vels_freq = sorted(pitch_vels_all[pitch])  # 重複込み昇順
            vel_min = vels_unique[0]
            vel_max = vels_unique[-1]
            available = wav_map.get(pitch, [])

            print(f'  MIDI {pitch:3d} ({name}): vel {vel_min}-{vel_max} ({len(vels_unique)} unique, {len(vels_freq)} hits)')

            # 推奨 WAV: 固定ステップ
            recommended = suggest_wav_layers(vel_min, vel_max)

            if not available:
                # WAV 未配置 → 推奨リスト表示
                rec_str = ', '.join(f'{name}_v{v}.wav' for v in recommended)
                print(f'    -> WAV: {rec_str}')
            else:
                # WAV あり → マッピング表示
                avail_str = ', '.join(f'{name}_v{v}.wav' for v in available)
                print(f'    WAV: {avail_str}')
                for vel in vels_unique:
                    nearest = find_nearest(available, vel)
                    wav_name = f'{name}_v{nearest}.wav'
                    if nearest == vel:
                        print(f'    vel {vel:3d} -> {wav_name}')
                    else:
                        print(f'    vel {vel:3d} -> {wav_name} (nearest, diff={abs(vel-nearest)})')

        if not wav_map:
            total_wavs = sum(
                len(suggest_wav_layers(min(pitch_vels_unique[p]), max(pitch_vels_unique[p])))
                for p in pitch_vels_unique
            )
            print(f'  * WAV 未配置: Hydrogen GM でフォールバック再生')
            print(f'  * 推奨ファイル数: {total_wavs}')


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main():
    # キットマッピング読み込み
    kit_mapping = load_kit_mapping()
    if kit_mapping:
        kits_used = sorted(set(kit_mapping.values()))
        print(f'Loaded drum-kits.json: {len(kit_mapping)} style(s) → {len(kits_used)} kit(s) ({", ".join(kits_used)})')

    patterns_db: dict[str, list[dict]] = {}
    total_patterns = 0

    # --- モード判定: 引数にファイルが指定されたらマルチトラックモード ---
    if len(sys.argv) > 1:
        midi_path = sys.argv[1]
        if not os.path.isfile(midi_path):
            print(f'[ERROR] File not found: {midi_path}')
            sys.exit(1)

        print(f'\n[Multi-track mode] {midi_path}')
        style_patterns = parse_multi_track_file(midi_path)

        for style, pat_list in sorted(style_patterns.items()):
            for i, measures in enumerate(pat_list, 1):
                pattern_id = f'{style}_{i}'
                entry = {'id': pattern_id, 'measures': measures}
                if style not in patterns_db:
                    patterns_db[style] = []
                patterns_db[style].append(entry)
                total_patterns += 1

                kit_name = kit_mapping.get(style, style)
                total_hits = sum(len(m) for m in measures)
                all_pitches = sorted(set(h['pitch'] for m in measures for h in m))
                pitch_names = [midi_to_note_name(p) for p in all_pitches]
                per_measure = [len(m) for m in measures]
                print(f'  OK{pattern_id} [kit: {kit_name}] ({total_hits} hits [{"+".join(map(str, per_measure))}], pitches: {", ".join(pitch_names)})')

    else:
        # --- 個別ファイルモード ---
        if not os.path.isdir(DRUMS_DIR):
            print(f'[ERROR] Directory not found: {DRUMS_DIR}')
            sys.exit(1)

        midi_files = sorted([
            f for f in os.listdir(DRUMS_DIR)
            if f.lower().endswith('.mid') or f.lower().endswith('.midi')
        ])

        if not midi_files:
            print(f'[INFO] No MIDI files found in {DRUMS_DIR}')
            print('[INFO] 使い方:')
            print('  A) python scripts/parse_drum_patterns.py export_drums.mid  (マルチトラック)')
            print('  B) scripts/data/midi/drums/ に {style}_{num}.mid を配置して引数なし実行')
            with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
                json.dump({'patterns': {}, 'samples': {}, 'kits': {}}, f, indent=2)
            print(f'Wrote empty DB to {OUTPUT_PATH}')
            return

        print(f'\n[Individual file mode] {DRUMS_DIR}')
        for filename in midi_files:
            style = FILENAME_RE.match(filename)
            if not style:
                print(f'[SKIP] {filename} — naming convention: {{style}}_{{num}}.mid')
                continue
            style_name = style.group('style').lower()

            filepath = os.path.join(DRUMS_DIR, filename)
            pat_list = parse_single_file(filepath)
            if not pat_list:
                print(f'[SKIP] {filename} — no valid drum hits found')
                continue

            for i, measures in enumerate(pat_list):
                if len(pat_list) == 1:
                    pattern_id = os.path.splitext(filename)[0]
                else:
                    pattern_id = f'{os.path.splitext(filename)[0]}_{chr(97+i)}'

                entry = {'id': pattern_id, 'measures': measures}
                if style_name not in patterns_db:
                    patterns_db[style_name] = []
                patterns_db[style_name].append(entry)
                total_patterns += 1

                kit_name = kit_mapping.get(style_name, style_name)
                total_hits = sum(len(m) for m in measures)
                all_pitches = sorted(set(h['pitch'] for m in measures for h in m))
                pitch_names = [midi_to_note_name(p) for p in all_pitches]
                per_measure = [len(m) for m in measures]
                print(f'  OK{pattern_id} [kit: {kit_name}] ({total_hits} hits [{"+".join(map(str, per_measure))}], pitches: {", ".join(pitch_names)})')

    if not patterns_db:
        print('[INFO] No patterns extracted')
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump({'patterns': {}, 'samples': {}, 'kits': {}}, f, indent=2)
        return

    # キットマッピング
    kits_db: dict[str, str] = {}
    for style in patterns_db:
        kits_db[style] = kit_mapping.get(style, style)

    # WAV スキャン
    wav_cache: dict[str, dict[int, list[int]]] = {}
    samples_db: dict[str, dict[str, list[int]]] = {}
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

    shutil.copy2(OUTPUT_PATH, PUBLIC_PATH)
    print(f'Copied to {PUBLIC_PATH}')

    # サマリー
    for key, patterns in sorted(patterns_db.items()):
        kit = kits_db[key]
        print(f'  {key} [kit: {kit}]: {len(patterns)} pattern(s)')

    # レポート
    print_report(patterns_db, kits_db, wav_cache)


if __name__ == '__main__':
    main()
