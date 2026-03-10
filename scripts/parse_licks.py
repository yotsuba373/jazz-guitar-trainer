"""
MIDI リックパーサー
=================
DAWからエクスポートしたMIDIファイルをリックタイプ別に分割し、
リックデータベース (JSON) を生成する。

使い方:
  python scripts/parse_licks.py scripts/data/midi/parker_dom7_1.mid
  python scripts/parse_licks.py scripts/data/midi/    # ディレクトリ内の全MIDIを処理

入力規約:
  - BPM 120, 4/4拍子, Cルート, DAW側でクオンタイズ済み
  - ファイル名: {ソース}_{タイプ}_b{小節数}[_a{アウフタクト}].mid
    例: parker_dom7_b1.mid, cannonball_maj-ii-v-long_b3_a1.mid
    ソースなしも可: dom7_b1.mid
  - 有効なタイプ:
    dom7, min7, maj7, m7b5,
    maj-ii-v-short, maj-ii-v-long, min-ii-v-short
  - _N サフィックス必須 (N = 1リックあたりの小節数)
  - 連続で弾く、空リックはスキップ

出力:
  scripts/data/licks.json — タイプ別統合リックDB
"""
import os
import sys
import json
import pretty_midi

# ── 定数 ──
VALID_TYPES = {
    "dom7", "min7", "maj7", "m7b5",
    "maj-ii-v-short", "maj-ii-v-long",
    "min-ii-v-short",
}
BEATS_PER_MEASURE = 4  # 4/4 拍子

# 量子化グリッド: 1拍を120分割
# 120 = lcm(8, 3, 5) → 8分(15), 三連(10), 16分(7.5→8), 5連符(24), 32分(3.75→4)
GRID = 120
# 休符とみなす最小ギャップ (拍単位)
REST_THRESHOLD = 1.0 / GRID


def snap_to_grid(value):
    """値を24分割グリッドにスナップ"""
    return round(value * GRID) / GRID


def build_lick_from_notes(raw_notes, total_beats):
    """ノートリストからリックを構築 (休符挿入含む)

    Args:
        raw_notes: beatStart/duration が既にリック内ローカル座標のノート群
        total_beats: このリックの総拍数
    Returns:
        dict or None: リックデータ (ノートが空ならNone)
    """
    if not raw_notes:
        return None

    raw_notes.sort(key=lambda n: (n["beatStart"], n["pitch"]))

    events = []
    cursor = 0.0

    for note in raw_notes:
        gap = note["beatStart"] - cursor
        if gap >= REST_THRESHOLD:
            rest_dur = snap_to_grid(gap)
            if rest_dur > 0:
                events.append({
                    "rest": True,
                    "beatStart": round(cursor, 6),
                    "duration": rest_dur,
                })
        events.append(note)
        cursor = note["beatStart"] + note["duration"]

    # リック末尾の休符
    end_gap = total_beats - cursor
    if end_gap >= REST_THRESHOLD:
        rest_dur = snap_to_grid(end_gap)
        if rest_dur > 0:
            events.append({
                "rest": True,
                "beatStart": round(cursor, 6),
                "duration": rest_dur,
            })

    note_count = sum(1 for e in events if "pitch" in e)

    # 音域正規化: 最低音を C4 (MIDI 60) 付近に揃える
    pitches = [e["pitch"] for e in events if "pitch" in e]
    if pitches:
        min_pitch = min(pitches)
        octave_shift = round((60 - min_pitch) / 12) * 12
        if octave_shift != 0:
            for e in events:
                if "pitch" in e:
                    e["pitch"] += octave_shift

    return {
        "notes": events,
        "noteCount": note_count,
        "beats": total_beats,
    }


def parse_midi_file(filepath, measures_per_lick=1):
    """
    MIDIファイルを読み込み、リックとして切り出す。

    Args:
        filepath: MIDIファイルパス
        measures_per_lick: 1リックあたりの小節数

    Returns:
        list of dict
    """
    midi = pretty_midi.PrettyMIDI(filepath)

    # テンポ取得 (最初のテンポを使用)
    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0
    sec_per_beat = 60.0 / bpm
    sec_per_measure = sec_per_beat * BEATS_PER_MEASURE

    # 1リックあたりの秒数・拍数
    sec_per_lick = sec_per_measure * measures_per_lick
    beats_per_lick = BEATS_PER_MEASURE * measures_per_lick

    # 全ノートを収集 (全トラック統合)
    all_notes = []
    for instrument in midi.instruments:
        if instrument.is_drum:
            continue
        for note in instrument.notes:
            all_notes.append(note)

    if not all_notes:
        return []

    # 開始時刻でソート
    all_notes.sort(key=lambda n: (n.start, n.pitch))

    # 全体の長さからリック数を推定
    last_end = max(n.end for n in all_notes)
    total_licks = int(last_end / sec_per_lick) + 1

    # リックスロットごとにノートを分類
    licks = []
    for i in range(total_licks):
        slot_start = i * sec_per_lick
        slot_end = slot_start + sec_per_lick

        # このスロット内に開始するノートを収集
        raw_notes = []
        for note in all_notes:
            if slot_start - 0.001 <= note.start < slot_end - 0.001:
                beat_start = (note.start - slot_start) / sec_per_beat
                duration = (note.end - note.start) / sec_per_beat

                beat_start = snap_to_grid(beat_start)
                duration = snap_to_grid(duration)
                # リック境界を超えないようクリップ
                if beat_start + duration > beats_per_lick:
                    duration = snap_to_grid(beats_per_lick - beat_start)
                duration = max(duration, 1.0 / GRID)

                raw_notes.append({
                    "pitch": note.pitch,
                    "beatStart": beat_start,
                    "duration": duration,
                })

        lick = build_lick_from_notes(raw_notes, beats_per_lick)
        if lick:
            licks.append(lick)

    return licks


def parse_filename(filepath):
    """ファイル名からソース、リックタイプ、小節数、アウフタクト小節数を判定

    形式: {ソース}_{タイプ}_b{小節数}[_a{アウフタクト}].mid
    例: parker_dom7_b1.mid → ("parker", "dom7", 1, 0)
        cannonball_maj-ii-v-long_b3_a1.mid → ("cannonball", "maj-ii-v-long", 3, 1)

    ソースなしの場合も対応: dom7_b1.mid → (None, "dom7", 1, 0)
    _bN がない場合は (None, None, None, None) を返す。
    """
    basename = os.path.splitext(os.path.basename(filepath))[0].lower()

    # 末尾から _a{N} を探す (省略可)
    anacrusis = 0
    if "_a" in basename:
        main, a_part = basename.rsplit("_a", 1)
        if a_part.isdigit():
            anacrusis = int(a_part)
            basename = main
        else:
            return None, None, None, None

    # 末尾から _b{N} を探す (必須)
    if "_b" not in basename:
        return None, None, None, None

    main, b_part = basename.rsplit("_b", 1)
    if not b_part.isdigit():
        return None, None, None, None
    measures = int(b_part)

    # main がそのまま有効タイプか？ (ソースなし)
    if main in VALID_TYPES:
        return None, main, measures, anacrusis

    # {source}_{type} の形式で分離
    for vt in sorted(VALID_TYPES, key=len, reverse=True):
        suffix = "_" + vt
        if main.endswith(suffix):
            source = main[: -len(suffix)]
            if source:
                return source, vt, measures, anacrusis

    return None, None, None, None


def lick_signature(lick):
    """リックのユニーク識別子 (ピッチ列 + リズム)"""
    parts = []
    for e in lick["notes"]:
        if "pitch" in e:
            parts.append(f"n{e['pitch']}@{e['beatStart']}")
        else:
            parts.append(f"r@{e['beatStart']}")
    return "|".join(parts)


def format_lick_preview(lick):
    """リックの簡易表示"""
    parts = []
    for e in lick["notes"]:
        if "pitch" in e:
            name = pretty_midi.note_number_to_name(e["pitch"])
            parts.append(f"{name}")
        else:
            parts.append("rest")
    return " ".join(parts)


def process_files(paths):
    """ファイルまたはディレクトリを処理"""
    midi_files = []
    for p in paths:
        if os.path.isdir(p):
            for f in sorted(os.listdir(p)):
                if f.lower().endswith((".mid", ".midi")):
                    midi_files.append(os.path.join(p, f))
        elif os.path.isfile(p):
            midi_files.append(p)

    if not midi_files:
        print("MIDIファイルが見つかりません")
        return

    # 毎回ゼロから構築 (MIDIファイルがマスターデータ)
    output_path = os.path.join(os.path.dirname(__file__), "data", "licks.json")
    db = {}

    total_new = 0

    for filepath in midi_files:
        source, lick_type, measures, anacrusis = parse_filename(filepath)
        if lick_type is None:
            basename = os.path.basename(filepath)
            print(f"  スキップ: {basename}")
            print(f"    形式: {{ソース}}_{{タイプ}}_b{{小節数}}[_a{{アウフタクト}}].mid (例: parker_dom7_b1.mid)")
            print(f"    有効タイプ: {', '.join(sorted(VALID_TYPES))}")
            continue

        ana_label = f", ana={anacrusis}小節" if anacrusis > 0 else ""
        source_label = f" [{source}]" if source else ""
        print(f"  処理中: {os.path.basename(filepath)} -> {lick_type}{source_label} ({measures}小節/リック{ana_label})")
        licks = parse_midi_file(filepath, measures)

        # メタ情報を各リックに付与
        for lick in licks:
            if source:
                lick["source"] = source
            if anacrusis > 0:
                lick["anacrusis"] = anacrusis * BEATS_PER_MEASURE  # 拍数で記録

        if not licks:
            print(f"    ノートが見つかりません")
            continue

        if lick_type not in db:
            db[lick_type] = []

        # 重複チェック (ピッチ列+リズムが一致するものは追加しない)
        existing_sigs = set()
        for existing in db[lick_type]:
            existing_sigs.add(lick_signature(existing))

        added = 0
        for lick in licks:
            sig = lick_signature(lick)
            if sig not in existing_sigs:
                db[lick_type].append(lick)
                existing_sigs.add(sig)
                added += 1
                # プレビュー表示
                preview = format_lick_preview(lick)
                print(f"    + [{lick['noteCount']}音, {lick['beats']}拍] {preview}")

        skipped = len(licks) - added
        detected_label = f"{len(licks)} リック検出"
        print(f"    {detected_label}, {added} 追加" +
              (f" (重複 {skipped} スキップ)" if skipped else ""))
        total_new += added

    # 保存
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(db, f, indent=2)

    # サマリー
    print()
    print("=" * 50)
    print("リックDB サマリー")
    print("=" * 50)
    total = 0
    for t in sorted(db.keys()):
        count = len(db[t])
        total += count
        print(f"  {t:20s}: {count:4d} リック")
    print(f"  {'合計':20s}: {total:4d} リック")
    print(f"\n保存先: {output_path}")
    print(f"新規追加: {total_new}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        print("使用例:")
        print("  python scripts/parse_licks.py scripts/data/midi/parker_dom7_b1.mid              # 1小節リック")
        print("  python scripts/parse_licks.py scripts/data/midi/cannonball_maj-ii-v-long_b3_a1.mid  # 3小節, アウフタクト1小節")
        print("  python scripts/parse_licks.py scripts/data/midi/                                # 全ファイル")
        sys.exit(1)

    process_files(sys.argv[1:])
