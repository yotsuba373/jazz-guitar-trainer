"""
マルチトラックMIDI分割
=====================
Cubaseから書き出した全トラック入りMIDIを、
トラック名ごとに個別MIDIファイルに分割する。

使い方:
  python scripts/split_midi.py scripts/data/export_licks.mid scripts/output/midi/

トラック名がそのままファイル名になる:
  トラック "parker_dom7_b1" → parker_dom7_b1.mid
"""
import os
import sys
import pretty_midi


def split_midi(input_path, output_dir):
    midi = pretty_midi.PrettyMIDI(input_path)

    # テンポ情報
    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0

    os.makedirs(output_dir, exist_ok=True)

    count = 0
    for instrument in midi.instruments:
        if instrument.is_drum:
            continue
        if not instrument.notes:
            continue

        name = instrument.name.strip() if instrument.name else None
        if not name:
            print(f"  スキップ: 名前のないトラック ({len(instrument.notes)} ノート)")
            continue

        # トラック名をファイル名に使う (スペース→アンダースコア、小文字化)
        filename = name.replace(" ", "_").lower() + ".mid"
        out_path = os.path.join(output_dir, filename)

        # 個別MIDIを作成
        new_midi = pretty_midi.PrettyMIDI(initial_tempo=bpm)
        new_inst = pretty_midi.Instrument(program=instrument.program, name=name)
        for note in instrument.notes:
            new_inst.notes.append(pretty_midi.Note(
                velocity=note.velocity,
                pitch=note.pitch,
                start=note.start,
                end=note.end,
            ))
        new_midi.instruments.append(new_inst)
        new_midi.write(out_path)

        print(f"  {name} → {filename} ({len(instrument.notes)} ノート)")
        count += 1

    print(f"\n{count} ファイル出力 → {output_dir}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        print("使用例:")
        print("  python scripts/split_midi.py scripts/data/export_licks.mid scripts/output/midi/")
        sys.exit(1)

    split_midi(sys.argv[1], sys.argv[2])
