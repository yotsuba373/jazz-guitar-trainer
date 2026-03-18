"""
MIDI リックパーサー
=================
DAWからエクスポートしたMIDIファイルをリックタイプ別に分割し、
リックデータベース (JSON) を生成する。

2つの入力モード:
  A) マルチトラック MIDI (推奨):
     python scripts/parse_licks.py scripts/data/midi/export_licks.mid
     → トラック名がファイル名規約に従う (例: "cannonball_dom7_b1")

  B) 個別ファイル / ディレクトリ:
     python scripts/parse_licks.py scripts/data/midi/parker_dom7_b1.mid
     python scripts/parse_licks.py scripts/data/midi/

入力規約:
  - BPM 120, 4/4拍子, DAW側でクオンタイズ済み
  - 演奏キー: dom7=G7, min7=Dm7, maj7=Cmaj7, m7b5=Dm7b5, ii-V=Cメジャー/マイナー基準
    (パーサーが自動的にCルートに移調して保存)
  - トラック名/ファイル名: {ソース}_{タイプ}_b{小節数}[_a{アウフタクト}]
    例: parker_dom7_b1, cannonball_maj-ii-v-long_b3_a1
    ソースなしも可: dom7_b1
  - 有効なタイプ:
    dom7, min7, maj7, m7b5,
    maj-ii-v-short, maj-ii-v-long, min-ii-v-short
  - _bN サフィックス必須 (N = 1リックあたりの小節数)
  - 連続で弾く、空リックはスキップ

出力:
  scripts/data/licks.json — タイプ別統合リックDB
  → public/licks.json にコピー
"""
import os
import sys
import json
import hashlib
import shutil
import pretty_midi

# ── 定数 ──
VALID_TYPES = {
    "dom7", "min7", "maj7", "m7b5",
    "maj-ii-v-short", "maj-ii-v-long",
    "min-ii-v-short",
}
BEATS_PER_MEASURE = 4  # 4/4 拍子

# 各タイプの演奏キー (Cからの半音数)。DB保存時にCルートに移調する。
# 教本で自然なキーで弾けるように設定。
TYPE_ROOT_OFFSET = {
    "dom7": 7,           # G7 で演奏
    "min7": 2,           # Dm7 で演奏
    "maj7": 0,           # Cmaj7 で演奏
    "m7b5": 2,           # Dm7b5 で演奏
    "maj-ii-v-short": 0, # Dm7→G7 (Cメジャー基準)
    "maj-ii-v-long": 0,
    "min-ii-v-short": 0, # Dm7b5→G7 (Cマイナー基準)
}

# 量子化グリッド: 1拍を120分割
# 120 = lcm(8, 3, 5) → 8分(15), 三連(10), 16分(7.5→8), 5連符(24), 32分(3.75→4)
GRID = 120
# 休符とみなす最小ギャップ (拍単位)
REST_THRESHOLD = 1.0 / GRID


def snap_to_grid(value):
    """値を24分割グリッドにスナップ"""
    return round(value * GRID) / GRID


def build_lick_from_notes(raw_notes, total_beats, root_offset=0):
    """ノートリストからリックを構築 (休符挿入含む)

    Args:
        raw_notes: beatStart/duration が既にリック内ローカル座標のノート群
        total_beats: このリックの総拍数
        root_offset: 演奏キーのCからの半音数 (移調用)
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

    # ルート移調: 演奏キーからCルートに移調
    if root_offset != 0:
        for e in events:
            if "pitch" in e:
                e["pitch"] -= root_offset

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


def parse_notes(all_notes, sec_per_beat, measures_per_lick=1, root_offset=0):
    """
    ノートリストからリックを切り出す (共通ロジック)。

    Args:
        all_notes: pretty_midi.Note のリスト
        sec_per_beat: 1拍あたりの秒数
        measures_per_lick: 1リックあたりの小節数
        root_offset: 演奏キーのCからの半音数 (移調用)

    Returns:
        list of dict
    """
    if not all_notes:
        return []

    all_notes.sort(key=lambda n: (n.start, n.pitch))

    sec_per_measure = sec_per_beat * BEATS_PER_MEASURE
    sec_per_lick = sec_per_measure * measures_per_lick
    beats_per_lick = BEATS_PER_MEASURE * measures_per_lick

    last_end = max(n.end for n in all_notes)
    total_licks = int(last_end / sec_per_lick) + 1

    licks = []
    for i in range(total_licks):
        slot_start = i * sec_per_lick
        slot_end = slot_start + sec_per_lick

        raw_notes = []
        for note in all_notes:
            if slot_start - 0.001 <= note.start < slot_end - 0.001:
                beat_start = (note.start - slot_start) / sec_per_beat
                duration = (note.end - note.start) / sec_per_beat

                beat_start = snap_to_grid(beat_start)
                duration = snap_to_grid(duration)
                if beat_start + duration > beats_per_lick:
                    duration = snap_to_grid(beats_per_lick - beat_start)
                duration = max(duration, 1.0 / GRID)

                raw_notes.append({
                    "pitch": note.pitch,
                    "beatStart": beat_start,
                    "duration": duration,
                })

        lick = build_lick_from_notes(raw_notes, beats_per_lick, root_offset)
        if lick:
            licks.append(lick)

    return licks


def parse_midi_file(filepath, measures_per_lick=1, root_offset=0):
    """MIDIファイルを読み込み、リックとして切り出す。"""
    midi = pretty_midi.PrettyMIDI(filepath)

    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0
    sec_per_beat = 60.0 / bpm

    all_notes = []
    for instrument in midi.instruments:
        if instrument.is_drum:
            continue
        for note in instrument.notes:
            all_notes.append(note)

    return parse_notes(all_notes, sec_per_beat, measures_per_lick, root_offset)


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


# タイプ → IDプレフィックス
TYPE_PREFIX = {
    "dom7": "D",
    "min7": "m",
    "maj7": "M",
    "m7b5": "h",
    "maj-ii-v-short": "IS",
    "maj-ii-v-long": "IL",
    "min-ii-v-short": "is",
}


def lick_id(lick_type, lick):
    """署名ハッシュから安定ユニークID (例: D-3a7f, m-b2c1)"""
    sig = lick_signature(lick)
    h = hashlib.sha256(sig.encode()).hexdigest()[:4]
    prefix = TYPE_PREFIX.get(lick_type, lick_type[0].upper())
    return f"{prefix}-{h}"


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


def add_licks_to_db(db, lick_type, licks, source=None, anacrusis=0):
    """リックを DB に追加 (重複チェック付き)。追加数を返す。"""
    for lick in licks:
        if source:
            lick["source"] = source
        if anacrusis > 0:
            lick["anacrusis"] = anacrusis * BEATS_PER_MEASURE

    if lick_type not in db:
        db[lick_type] = []

    existing_sigs = set()
    for existing in db[lick_type]:
        existing_sigs.add(lick_signature(existing))

    added = 0
    for lick in licks:
        sig = lick_signature(lick)
        if sig not in existing_sigs:
            lick["id"] = lick_id(lick_type, lick)
            db[lick_type].append(lick)
            existing_sigs.add(sig)
            added += 1
            preview = format_lick_preview(lick)
            print(f"    + [{lick['noteCount']}音, {lick['beats']}拍] {preview}")

    skipped = len(licks) - added
    detected_label = f"{len(licks)} リック検出"
    print(f"    {detected_label}, {added} 追加" +
          (f" (重複 {skipped} スキップ)" if skipped else ""))
    return added


def process_multi_track(filepath):
    """マルチトラック MIDI を処理。トラック名 = ファイル名規約。"""
    midi = pretty_midi.PrettyMIDI(filepath)
    tempo_times, tempos = midi.get_tempo_changes()
    bpm = tempos[0] if len(tempos) > 0 else 120.0
    sec_per_beat = 60.0 / bpm

    db = {}
    total_new = 0

    print(f"\n[Multi-track mode] {filepath} (BPM={bpm})")

    for instrument in midi.instruments:
        if instrument.is_drum:
            continue
        if not instrument.notes:
            continue

        track_name = (instrument.name or "").strip()
        if not track_name:
            print(f"  スキップ: 名前のないトラック ({len(instrument.notes)} ノート)")
            continue

        # トラック名をファイル名規約としてパース
        source, lick_type, measures, anacrusis = parse_filename(track_name + ".mid")
        if lick_type is None:
            print(f"  スキップ: {track_name}")
            print(f"    形式: {{ソース}}_{{タイプ}}_b{{小節数}}[_a{{アウフタクト}}] (例: parker_dom7_b1)")
            print(f"    有効タイプ: {', '.join(sorted(VALID_TYPES))}")
            continue

        ana_label = f", ana={anacrusis}小節" if anacrusis > 0 else ""
        source_label = f" [{source}]" if source else ""
        print(f"  Track: {track_name} -> {lick_type}{source_label} ({measures}小節/リック{ana_label})")

        root_offset = TYPE_ROOT_OFFSET.get(lick_type, 0)
        all_notes = list(instrument.notes)
        licks = parse_notes(all_notes, sec_per_beat, measures, root_offset)

        if not licks:
            print(f"    ノートが見つかりません")
            continue

        total_new += add_licks_to_db(db, lick_type, licks, source, anacrusis)

    return db, total_new


def process_files(paths):
    """個別ファイルまたはディレクトリを処理"""
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
        return {}, 0

    db = {}
    total_new = 0

    print(f"\n[Individual file mode]")

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
        root_offset = TYPE_ROOT_OFFSET.get(lick_type, 0)
        licks = parse_midi_file(filepath, measures, root_offset)

        if not licks:
            print(f"    ノートが見つかりません")
            continue

        total_new += add_licks_to_db(db, lick_type, licks, source, anacrusis)

    return db, total_new


def save_and_report(db, total_new):
    """DB を保存してサマリーを表示"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "data", "licks.json")
    public_path = os.path.join(script_dir, "..", "public", "licks.json")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(db, f, indent=2)

    # public/ にコピー
    shutil.copy2(output_path, public_path)

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
    print(f"コピー: {public_path}")
    print(f"新規追加: {total_new}")


def is_multi_track_export(filepath):
    """マルチトラック MIDI かどうかを判定 (2トラック以上のノート付き非ドラムトラック)"""
    try:
        midi = pretty_midi.PrettyMIDI(filepath)
        note_tracks = [i for i in midi.instruments if not i.is_drum and i.notes]
        return len(note_tracks) >= 2
    except Exception:
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        print("使用例:")
        print("  python scripts/parse_licks.py scripts/data/midi/export_licks.mid              # マルチトラック (推奨)")
        print("  python scripts/parse_licks.py scripts/data/midi/parker_dom7_b1.mid            # 個別ファイル")
        print("  python scripts/parse_licks.py scripts/data/midi/                              # ディレクトリ内全ファイル")
        sys.exit(1)

    args = sys.argv[1:]

    # 単一ファイル指定でマルチトラックなら自動判定
    if len(args) == 1 and os.path.isfile(args[0]) and is_multi_track_export(args[0]):
        db, total_new = process_multi_track(args[0])
    else:
        db, total_new = process_files(args)

    save_and_report(db, total_new)
