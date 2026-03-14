"""
リックID → MIDIソースファイル & 小節番号 逆引きスクリプト
========================================================
リックIDを渡すと、元のMIDIファイル名と何番目のリック(小節)かを表示する。

使い方:
  python scripts/find_lick_source.py D-e67f
  python scripts/find_lick_source.py D-e67f m-b2c1   # 複数ID同時検索
"""
import os
import sys

# parse_licks.py のロジックを再利用
from parse_licks import (
    parse_filename, parse_midi_file, lick_id, lick_signature,
    TYPE_ROOT_OFFSET, BEATS_PER_MEASURE,
)

MIDI_DIR = os.path.join(os.path.dirname(__file__), "data", "midi")
NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]


def format_notes_short(lick):
    """ノート列の短縮表示"""
    parts = []
    for e in lick["notes"]:
        if "pitch" in e:
            name = NOTE_NAMES[e["pitch"] % 12]
            octave = e["pitch"] // 12 - 1
            parts.append(f"{name}{octave}")
        else:
            parts.append("r")
    return " ".join(parts)


def find_sources(target_ids):
    """全MIDIファイルを再パースしてIDを照合"""
    if not os.path.isdir(MIDI_DIR):
        print(f"MIDIディレクトリが見つかりません: {MIDI_DIR}")
        sys.exit(1)

    midi_files = sorted(
        f for f in os.listdir(MIDI_DIR)
        if f.lower().endswith((".mid", ".midi"))
    )

    if not midi_files:
        print("MIDIファイルが見つかりません")
        sys.exit(1)

    target_set = set(target_ids)
    found = {}  # id → list of { file, slot, measures_per_lick, lick }

    for fname in midi_files:
        filepath = os.path.join(MIDI_DIR, fname)
        source, lick_type, measures, anacrusis = parse_filename(filepath)
        if lick_type is None:
            continue

        root_offset = TYPE_ROOT_OFFSET.get(lick_type, 0)
        licks = parse_midi_file(filepath, measures, root_offset)

        for slot_idx, lick in enumerate(licks):
            lid = lick_id(lick_type, lick)
            if lid in target_set:
                if lid not in found:
                    found[lid] = []
                # 小節番号 (1-based, アウフタクトなし基準)
                measure_start = slot_idx * measures + 1
                if measures == 1:
                    measure_label = f"小節 {measure_start}"
                else:
                    measure_end = measure_start + measures - 1
                    measure_label = f"小節 {measure_start}-{measure_end}"
                found[lid].append({
                    "file": fname,
                    "slot": slot_idx + 1,  # 1-based
                    "measure_label": measure_label,
                    "lick_type": lick_type,
                    "source": source,
                    "notes": format_notes_short(lick),
                    "note_count": lick["noteCount"],
                    "beats": lick["beats"],
                })

    return found


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    target_ids = sys.argv[1:]
    print(f"検索ID: {', '.join(target_ids)}")
    print(f"MIDIディレクトリ: {MIDI_DIR}")
    print()

    found = find_sources(target_ids)

    for tid in target_ids:
        if tid in found:
            for hit in found[tid]:
                print(f"  [OK] {tid}")
                print(f"    ファイル:  {hit['file']}")
                print(f"    位置:      スロット {hit['slot']} ({hit['measure_label']})")
                print(f"    タイプ:    {hit['lick_type']}" +
                      (f" [{hit['source']}]" if hit['source'] else ""))
                print(f"    内容:      {hit['note_count']}音, {hit['beats']}拍")
                print(f"    ノート:    {hit['notes']}")
                print()
        else:
            print(f"  [NG] {tid} -- not found in MIDI files")
            print()


if __name__ == "__main__":
    main()
