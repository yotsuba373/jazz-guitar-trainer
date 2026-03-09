"""
MIDI リックパーサー
=================
DAWからエクスポートしたMIDIファイルを1小節ずつ分割し、
コード品質別のリックデータベース (JSON) を生成する。

使い方:
  python scripts/parse_licks.py scripts/data/midi/dom7.mid
  python scripts/parse_licks.py scripts/data/midi/    # ディレクトリ内の全MIDIを処理

入力規約:
  - ファイル名がコード品質: dom7.mid, maj7.mid, min7.mid, m7b5.mid, dim7.mid
  - BPM 120, 4/4拍子, DAW側でクオンタイズ済み
  - 1小節 = 1リック、連続で弾く
  - 空小節があればスキップ
  - サブビート分割: ファイル名末尾に _N で1小節をN拍ずつに分割
    例: dom7_2.mid → 2拍リック, min7_3.mid → 3拍リック

出力:
  scripts/data/licks.json — 全品質統合リックDB
"""
import os
import sys
import json
import pretty_midi

# ── 定数 ──
VALID_QUALITIES = {"dom7", "maj7", "min7", "m7b5", "dim7"}
BEATS_PER_MEASURE = 4  # 4/4 拍子

# 量子化グリッド: 1拍を24分割
# 24 = lcm(8, 3) → 8分音符(3/24), 三連符(2/24), 16分音符(1.5→2/24), 32分音符(0.75→1/24)
GRID = 24
# 休符とみなす最小ギャップ (拍単位)
REST_THRESHOLD = 1.0 / GRID  # グリッド1つ分以上のギャップで休符


def snap_to_grid(value):
    """値を24分割グリッドにスナップ"""
    return round(value * GRID) / GRID


def build_lick_from_notes(raw_notes, beats_per_lick):
    """ノートリストからリックを構築 (休符挿入含む)

    Args:
        raw_notes: beatStart/duration が既にリック内ローカル座標のノート群
        beats_per_lick: このリックの拍数
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
    end_gap = beats_per_lick - cursor
    if end_gap >= REST_THRESHOLD:
        rest_dur = snap_to_grid(end_gap)
        if rest_dur > 0:
            events.append({
                "rest": True,
                "beatStart": round(cursor, 6),
                "duration": rest_dur,
            })

    note_count = sum(1 for e in events if "pitch" in e)
    return {
        "notes": events,
        "noteCount": note_count,
        "beats": beats_per_lick,
    }


def parse_midi_file(filepath, beats_per_lick=BEATS_PER_MEASURE):
    """
    MIDIファイルを読み込み、リックとして切り出す。
    beats_per_lick が BEATS_PER_MEASURE 未満の場合、1小節を複数リックに分割する。

    Args:
        filepath: MIDIファイルパス
        beats_per_lick: 1リックの拍数 (デフォルト4、2や3も可)

    Returns:
        list of dict: [{
            "notes": [
                {"pitch": 60, "beatStart": 0.0, "duration": 0.5},
                {"rest": true, "beatStart": 2.0, "duration": 0.5},
                ...
            ],
            "noteCount": 8,
            "beats": 4,  # or 2, 3
        }, ...]
    """
    midi = pretty_midi.PrettyMIDI(filepath)

    # テンポ取得 (最初のテンポを使用)
    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0
    sec_per_beat = 60.0 / bpm
    sec_per_measure = sec_per_beat * BEATS_PER_MEASURE

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

    # 全体の長さから小節数を推定
    last_end = max(n.end for n in all_notes)
    total_measures = int(last_end / sec_per_measure) + 1

    # 1小節あたりのリック数
    licks_per_measure = BEATS_PER_MEASURE // beats_per_lick
    sec_per_lick = sec_per_beat * beats_per_lick

    # 小節ごと → リックスロットごとにノートを分類
    licks = []
    for m in range(total_measures):
        measure_start = m * sec_per_measure

        for s in range(licks_per_measure):
            slot_start = measure_start + s * sec_per_lick
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


def quality_from_filename(filepath):
    """ファイル名からコード品質とサブビート数を判定

    例: dom7.mid → ("dom7", 4), dom7_2.mid → ("dom7", 2), min7_3.mid → ("min7", 3)
    """
    basename = os.path.splitext(os.path.basename(filepath))[0].lower()
    for q in VALID_QUALITIES:
        if basename.startswith(q):
            suffix = basename[len(q):]
            if suffix.startswith("_") and suffix[1:].isdigit():
                return q, int(suffix[1:])
            return q, BEATS_PER_MEASURE
    return None, None


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
        quality, beats_per_lick = quality_from_filename(filepath)
        if quality is None:
            print(f"  スキップ (品質不明): {filepath}")
            print(f"    ファイル名を {', '.join(sorted(VALID_QUALITIES))} のいずれかで始めてください")
            continue

        beats_label = f"{beats_per_lick}拍" if beats_per_lick != BEATS_PER_MEASURE else "4拍"
        print(f"  処理中: {os.path.basename(filepath)} -> {quality} ({beats_label}リック)")
        licks = parse_midi_file(filepath, beats_per_lick)

        if not licks:
            print(f"    ノートが見つかりません")
            continue

        if quality not in db:
            db[quality] = []

        # 重複チェック (ピッチ列+リズムが一致するものは追加しない)
        existing_sigs = set()
        for existing in db[quality]:
            existing_sigs.add(lick_signature(existing))

        added = 0
        for lick in licks:
            sig = lick_signature(lick)
            if sig not in existing_sigs:
                db[quality].append(lick)
                existing_sigs.add(sig)
                added += 1
                # プレビュー表示
                preview = format_lick_preview(lick)
                print(f"    + [{lick['noteCount']}音] {preview}")

        skipped = len(licks) - added
        print(f"    {len(licks)} 小節検出, {added} 追加" +
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
    for q in sorted(db.keys()):
        count = len(db[q])
        total += count
        print(f"  {q:6s}: {count:4d} リック")
    print(f"  {'合計':6s}: {total:4d} リック")
    print(f"\n保存先: {output_path}")
    print(f"新規追加: {total_new}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        print("使用例:")
        print("  python scripts/parse_licks.py scripts/data/midi/dom7.mid     # 4拍リック")
        print("  python scripts/parse_licks.py scripts/data/midi/dom7_2.mid   # 2拍リック")
        print("  python scripts/parse_licks.py scripts/data/midi/min7_3.mid   # 3拍リック")
        print("  python scripts/parse_licks.py scripts/data/midi/             # 全ファイル")
        sys.exit(1)

    process_files(sys.argv[1:])
