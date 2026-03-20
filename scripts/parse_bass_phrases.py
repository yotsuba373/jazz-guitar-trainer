#!/usr/bin/env python3
"""
iReal Pro MusicXML + MIDI → ベースフレーズ DB 生成パーサー。

Usage:
    python scripts/parse_bass_phrases.py

入力:
    scripts/output/ireal/*.musicxml  — コード進行 (リピート/エンディング展開)
    scripts/output/ireal/*.mid       — MIDI ベーストラック (Track 1)

出力:
    public/bass-phrases.generated.json — 度数ベースパターン DB
"""

from __future__ import annotations

import json
import os
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pretty_midi

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

IREAL_DIR = Path("scripts/output/ireal")
OUTPUT_PATH = Path("public/bass-phrases.generated.json")

# Note name → pitch class (0=C, 11=B)
NOTE_PC = {
    "C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11,
}

# MusicXML kind → internal quality key
KIND_MAP = {
    "major-seventh": "maj7",
    "maj7": "maj7",
    "major": "maj7",
    "6": "maj7",
    "major-sixth": "maj7",
    "dominant": "dom7",
    "7": "dom7",
    "7alt": "dom7",
    "7sus4": "dom7",
    "minor-seventh": "m7",
    "m7": "m7",
    "minor": "m7",
    "minor-sixth": "m7",
    "m6": "m7",
    "half-diminished": "m7b5",
    "m7b5": "m7b5",
    "diminished-seventh": "dim7",
    "dim7": "dim7",
    "diminished": "dim7",
}

# Quality → chord tone semitone offsets [root, 3rd, 5th, 7th]
QUALITY_CT = {
    "maj7": [0, 4, 7, 11],
    "dom7": [0, 4, 7, 10],
    "m7":   [0, 3, 7, 10],
    "m7b5": [0, 3, 6, 10],
    "dim7": [0, 3, 6, 9],
}

# MusicXML lyricist → BackingStyle mapping
LYRICIST_TO_STYLE = {
    "medium swing": "medium-swing",
    "medium up swing": "medium-up-swing",
    "up tempo swing": "up-tempo-swing",
    "bossa nova": "bossa",
    "ballad": "ballad",
    "latin": "latin",
}

# Quantize grid: 120 ticks per beat (same as lick parser)
GRID = 120


# ---------------------------------------------------------------------------
# MusicXML parsing
# ---------------------------------------------------------------------------

@dataclass
class MXLChord:
    root_pc: int          # pitch class 0-11
    quality: str          # internal key (maj7/dom7/m7/m7b5/dim7)
    bass_pc: Optional[int] = None  # slash chord bass note PC
    beat_offset: float = 0.0       # beat offset within measure (0, 1, 2, 3)

@dataclass
class MXLMeasure:
    number: int
    chords: list[MXLChord] = field(default_factory=list)
    repeat_forward: bool = False
    repeat_backward: bool = False
    ending_numbers: list[int] = field(default_factory=list)  # e.g., [1] or [2] or [3]
    beats: int = 4  # beats per measure


def parse_root_pc(root_step: str, root_alter: Optional[str]) -> int:
    pc = NOTE_PC.get(root_step, 0)
    if root_alter is not None:
        pc = (pc + int(float(root_alter))) % 12
    return pc


def parse_quality(harmony_elem) -> str:
    """
    Parse chord quality from harmony element, considering both kind and degree.
    MusicXML encodes m7b5 as minor-seventh + degree(value=5, alter=-1, type=alter).
    """
    kind_elem = harmony_elem.find("kind")
    text = kind_elem.get("text", "") or kind_elem.text or ""
    base_quality = KIND_MAP.get(text, KIND_MAP.get(kind_elem.text or "", "dom7"))

    # Check degree elements for alterations (e.g., b5 → half-diminished)
    for deg in harmony_elem.findall("degree"):
        deg_value = deg.find("degree-value")
        deg_alter = deg.find("degree-alter")
        deg_type = deg.find("degree-type")
        if deg_value is None or deg_alter is None or deg_type is None:
            continue
        value = int(deg_value.text)
        alter = int(float(deg_alter.text))
        dtype = deg_type.text
        # minor-seventh + alter 5th by -1 → half-diminished (m7b5)
        if dtype == "alter" and value == 5 and alter == -1 and base_quality == "m7":
            return "m7b5"

    return base_quality


def parse_musicxml(path: Path) -> list[MXLMeasure]:
    """Parse MusicXML into a list of measures with chords and repeat info."""
    tree = ET.parse(path)
    root = tree.getroot()
    measures = []

    # divisions persists across measures (defined once in first measure)
    divisions: Optional[int] = None

    for m_elem in root.findall(".//measure"):
        m = MXLMeasure(number=int(m_elem.get("number", "0")))

        # Time signature
        time_elem = m_elem.find(".//time")
        if time_elem is not None:
            beats_elem = time_elem.find("beats")
            if beats_elem is not None:
                m.beats = int(beats_elem.text)

        # Update divisions if present in this measure's attributes
        div_elem = m_elem.find(".//divisions")
        if div_elem is not None:
            divisions = int(div_elem.text)

        # Barlines: repeat and endings
        for barline in m_elem.findall("barline"):
            rep = barline.find("repeat")
            if rep is not None:
                if rep.get("direction") == "forward":
                    m.repeat_forward = True
                elif rep.get("direction") == "backward":
                    m.repeat_backward = True
            ending = barline.find("ending")
            if ending is not None:
                # ending number can be "1", "2", "3", or "1, 2"
                nums = ending.get("number", "")
                for n in nums.replace(",", " ").split():
                    try:
                        m.ending_numbers.append(int(n))
                    except ValueError:
                        pass

        # Harmonies (chords) — track beat offset from note durations
        beat_pos = 0.0

        for child in m_elem:
            if child.tag == "harmony":
                root_step = child.find("root/root-step").text
                root_alter_elem = child.find("root/root-alter")
                root_alter = root_alter_elem.text if root_alter_elem is not None else None

                bass_pc = None
                bass_elem = child.find("bass")
                if bass_elem is not None:
                    bass_step = bass_elem.find("bass-step").text
                    bass_alter_elem = bass_elem.find("bass-alter")
                    bass_alter = bass_alter_elem.text if bass_alter_elem is not None else None
                    bass_pc = parse_root_pc(bass_step, bass_alter)

                m.chords.append(MXLChord(
                    root_pc=parse_root_pc(root_step, root_alter),
                    quality=parse_quality(child),  # harmony element全体を渡す
                    bass_pc=bass_pc,
                    beat_offset=beat_pos,
                ))

            elif child.tag == "note":
                if divisions is not None:
                    dur_elem = child.find("duration")
                    if dur_elem is not None and child.find("chord") is None:
                        dur = int(dur_elem.text)
                        beat_pos += dur / divisions

            elif child.tag == "attributes":
                d = child.find("divisions")
                if d is not None:
                    divisions = int(d.text)

        measures.append(m)

    return measures


def extract_style(path: Path) -> str:
    """Extract backing style from MusicXML lyricist field."""
    tree = ET.parse(path)
    root = tree.getroot()
    for creator in root.findall(".//identification/creator"):
        if creator.get("type") == "lyricist":
            text = (creator.text or "").strip().lower()
            return LYRICIST_TO_STYLE.get(text, text.replace(" ", "-"))
    return "medium-swing"


def expand_form(measures: list[MXLMeasure]) -> list[MXLMeasure]:
    """
    Expand repeats and endings into a flat measure sequence (one chorus).

    Handles iReal Pro conventions:
    - Simple repeats (no endings): play region twice
    - Endings 1,2: ending 1 extends to backward repeat, ending 2 same length after
    - Ending 3 (AABA): A1+ending1, A2+ending2, B section, A3+ending3
    """
    result = []
    i = 0

    while i < len(measures):
        if not measures[i].repeat_forward:
            result.append(measures[i])
            i += 1
            continue

        # --- Repeat region ---
        repeat_start = i
        repeat_end = next(
            j for j in range(i, len(measures)) if measures[j].repeat_backward
        )

        # Scan ALL endings (may extend past backward repeat)
        ending_starts: dict[int, int] = {}
        for j in range(repeat_start, len(measures)):
            if measures[j].ending_numbers:
                en = measures[j].ending_numbers[0]
                if en not in ending_starts:
                    ending_starts[en] = j

        if not ending_starts:
            # Simple repeat: play twice
            for _ in range(2):
                result.extend(measures[repeat_start:repeat_end + 1])
            i = repeat_end + 1
            continue

        # Main body: before first ending
        first_ending = min(ending_starts.values())
        main_body = measures[repeat_start:first_ending]

        # Ending 1: from its start to backward repeat (inclusive)
        e1_start = ending_starts[1]
        e1_end = repeat_end
        e1_len = e1_end - e1_start + 1
        e1_measures = measures[e1_start:e1_end + 1]

        # Ending 2: same length as ending 1
        e2_start = ending_starts.get(2, e1_end + 1)
        e2_measures = measures[e2_start:e2_start + e1_len]

        # Pass 1: main body + ending 1
        result.extend(main_body)
        result.extend(e1_measures)

        # Pass 2: main body + ending 2
        result.extend(main_body)
        result.extend(e2_measures)

        after_e2 = e2_start + e1_len

        if 3 in ending_starts:
            # AABA form: B section between ending 2 and ending 3
            e3_start = ending_starts[3]
            b_section = measures[after_e2:e3_start]
            result.extend(b_section)

            # Pass 3: main body + ending 3 (to end of song)
            e3_measures = measures[e3_start:]
            result.extend(main_body)
            result.extend(e3_measures)

            i = len(measures)  # consumed everything
        else:
            # No ending 3: continue from after ending 2
            i = after_e2

    return result


# ---------------------------------------------------------------------------
# MIDI parsing
# ---------------------------------------------------------------------------

@dataclass
class BassNoteEvent:
    beat: float      # beat position (0-based from music start)
    pitch: int       # MIDI pitch
    velocity: int    # MIDI velocity
    duration: float  # duration in beats


def parse_midi_bass(path: Path) -> tuple[list[BassNoteEvent], float]:
    """Parse MIDI file, extract bass track notes, return (notes, bpm)."""
    midi = pretty_midi.PrettyMIDI(str(path))
    tempos = midi.get_tempo_changes()
    bpm = tempos[1][0]
    beat_sec = 60.0 / bpm
    music_start = 4 * beat_sec  # 4-beat count-in

    bass_track = None
    for inst in midi.instruments:
        if inst.name == "Bass":
            bass_track = inst
            break

    if bass_track is None:
        raise ValueError(f"No Bass track found in {path}")

    notes = []
    for n in sorted(bass_track.notes, key=lambda x: x.start):
        beat = (n.start - music_start) / beat_sec
        dur = (n.end - n.start) / beat_sec
        if beat >= -0.1:  # allow tiny negative for quantization
            notes.append(BassNoteEvent(
                beat=beat,
                pitch=n.pitch,
                velocity=n.velocity,
                duration=dur,
            ))

    return notes, bpm


def quantize_beat(beat: float, grid: int = GRID) -> float:
    """Quantize beat position to grid."""
    ticks = round(beat * grid)
    return ticks / grid


# ---------------------------------------------------------------------------
# Pattern extraction
# ---------------------------------------------------------------------------

@dataclass
class ChordSpan:
    """One chord's span in the expanded progression."""
    root_pc: int
    quality: str
    bass_pc: Optional[int]
    start_beat: float  # absolute beat
    end_beat: float    # absolute beat (exclusive)
    beats: float       # duration in beats


def build_chord_timeline(expanded: list[MXLMeasure]) -> list[ChordSpan]:
    """Convert expanded measures into a flat timeline of chord spans."""
    spans: list[ChordSpan] = []
    beat_cursor = 0.0

    for m in expanded:
        measure_beats = m.beats
        if not m.chords:
            # No chord in this measure — extend previous
            if spans:
                spans[-1].end_beat = beat_cursor + measure_beats
                spans[-1].beats = spans[-1].end_beat - spans[-1].start_beat
            beat_cursor += measure_beats
            continue

        for ci, chord in enumerate(m.chords):
            chord_start = beat_cursor + chord.beat_offset
            # End beat: next chord's offset or measure end
            if ci + 1 < len(m.chords):
                chord_end = beat_cursor + m.chords[ci + 1].beat_offset
            else:
                chord_end = beat_cursor + measure_beats

            spans.append(ChordSpan(
                root_pc=chord.root_pc,
                quality=chord.quality,
                bass_pc=chord.bass_pc,
                start_beat=chord_start,
                end_beat=chord_end,
                beats=chord_end - chord_start,
            ))

        beat_cursor += measure_beats

    return spans


def find_chord_at_beat(spans: list[ChordSpan], beat: float) -> Optional[ChordSpan]:
    """Find the chord span containing the given beat."""
    for s in spans:
        if s.start_beat <= beat + 0.01 < s.end_beat:
            return s
    return None


def pitch_to_degree(pitch: int, root_pc: int, quality: str) -> Optional[int]:
    """
    Convert MIDI pitch to scale degree index relative to chord root.
    Returns semitone offset from root (0-11), or None if can't determine.
    """
    return (pitch - root_pc) % 12


def classify_degree(semitone_offset: int, quality: str) -> str:
    """Classify a semitone offset as chord tone type."""
    ct_offsets = QUALITY_CT.get(quality, QUALITY_CT["dom7"])
    if semitone_offset in ct_offsets:
        idx = ct_offsets.index(semitone_offset)
        return ["R", "3", "5", "7"][idx]

    # Scale degrees
    degree_names = {
        1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4", 6: "b5",
        7: "5", 8: "b6", 9: "6", 10: "b7", 11: "7",
    }
    return degree_names.get(semitone_offset, f"?{semitone_offset}")


@dataclass
class BeatNote:
    """One note within a chord's beat grid."""
    beat_offset: float   # offset from chord start (0-based)
    semitone: int        # semitone offset from root (0-11)
    velocity: int
    duration: float      # in beats


@dataclass
class ChordPattern:
    """A bass pattern for one chord."""
    quality: str
    beats: int           # chord duration in beats (2, 3, or 4)
    notes: list[BeatNote]
    source: str          # song name
    chorus: int          # chorus number
    is_alt: bool = False # True if root was at alt (upper) octave
    style: str = "medium-swing"  # backing style from MusicXML


def extract_patterns(
    midi_notes: list[BassNoteEvent],
    chord_timeline: list[ChordSpan],
    chorus_beats: float,
    song_name: str,
    style: str = "medium-swing",
) -> list[ChordPattern]:
    """Extract bass patterns by aligning MIDI notes to chord spans."""
    patterns = []
    total_midi_beats = max(n.beat + n.duration for n in midi_notes)
    num_choruses = round(total_midi_beats / chorus_beats)

    for chorus_idx in range(num_choruses):
        chorus_offset = chorus_idx * chorus_beats

        for span in chord_timeline:
            abs_start = chorus_offset + span.start_beat
            abs_end = chorus_offset + span.end_beat
            chord_beats = round(span.beats)

            if chord_beats < 2 or chord_beats > 4:
                continue

            # Find notes within this chord span
            # 分数コード: bass_pc がある場合はベース音を基準に度数計算
            ref_pc = span.bass_pc if span.bass_pc is not None else span.root_pc
            # iReal Pro 固定オクターブ配置: C2(36) base, G+ wraps to G1-B1
            default_root_midi = 36 + ref_pc
            if default_root_midi > 42:
                default_root_midi -= 12
            alt_root_midi = default_root_midi + 12

            # Detect actual root octave from beat 1 pitch
            beat1_pitch = None
            for n in midi_notes:
                qb = quantize_beat(n.beat)
                if abs_start - 0.05 <= qb < abs_start + 0.05:
                    beat1_pitch = n.pitch
                    break

            # Determine if alt octave: beat 1 is root at upper octave
            is_alt = False
            if beat1_pitch is not None:
                beat1_pc = beat1_pitch % 12
                if beat1_pc == ref_pc and abs(beat1_pitch - alt_root_midi) < abs(beat1_pitch - default_root_midi):
                    is_alt = True

            root_midi = alt_root_midi if is_alt else default_root_midi

            chord_notes = []
            for n in midi_notes:
                q_beat = quantize_beat(n.beat)
                if abs_start - 0.05 <= q_beat < abs_end - 0.05:
                    beat_offset = quantize_beat(q_beat - abs_start)
                    # 符号付きオフセット: 方向情報を保存 (正=上, 負=下)
                    signed_offset = n.pitch - root_midi
                    chord_notes.append(BeatNote(
                        beat_offset=beat_offset,
                        semitone=signed_offset,
                        velocity=n.velocity,
                        duration=quantize_beat(n.duration),
                    ))

            if not chord_notes:
                continue

            # Verify beat 0 has a note (walking bass always starts on beat 1)
            has_downbeat = any(abs(bn.beat_offset) < 0.1 for bn in chord_notes)
            if not has_downbeat:
                continue

            # Reject clearly broken extractions (too few or too many notes)
            if len(chord_notes) < chord_beats or len(chord_notes) > chord_beats + 2:
                continue

            patterns.append(ChordPattern(
                quality=span.quality,
                beats=chord_beats,
                notes=chord_notes,
                source=song_name,
                chorus=chorus_idx,
                is_alt=is_alt,
                style=style,
            ))

    return patterns


# ---------------------------------------------------------------------------
# Degree pattern encoding
# ---------------------------------------------------------------------------

def encode_pattern(pattern: ChordPattern) -> tuple[str, ...]:
    """
    Encode a ChordPattern into a hashable degree tuple for deduplication.
    Format: (quality, beats, "beat:semitone", ...)
    """
    parts = [pattern.quality, str(pattern.beats)]
    for n in sorted(pattern.notes, key=lambda x: x.beat_offset):
        parts.append(f"{n.beat_offset:.3f}:{n.semitone}:{n.duration:.3f}")
    return tuple(parts)


def pattern_to_degree_list(pattern: ChordPattern) -> list[int]:
    """Convert pattern notes to a list of semitone offsets sorted by beat."""
    return [n.semitone for n in sorted(pattern.notes, key=lambda x: x.beat_offset)]


def pattern_to_note_list(pattern: ChordPattern) -> list[list[float]]:
    """Convert pattern notes to [[beat, semitone, duration], ...] sorted by beat."""
    return [[round(n.beat_offset, 3), n.semitone, round(n.duration, 3)]
            for n in sorted(pattern.notes, key=lambda x: x.beat_offset)]


# ---------------------------------------------------------------------------
# Output format
# ---------------------------------------------------------------------------

def build_output(all_patterns: list[ChordPattern]) -> dict:
    """
    Build output JSON structure for generateBassLine() consumption.

    Format:
    {
      "meta": { "totalRaw": N, "totalUnique": N, "qualities": [...], "styles": [...] },
      "patterns": {
        "medium-swing": {
          "maj7": {
            "4": [[[0, 0], [1, 11], [2, 7], [3, 4]], ...],
            "4_alt": [...],
            "2": [...]
          }, ...
        }, ...
      },
      "weights": {
        "medium-swing": {
          "maj7": { "4": [165, 133, ...], ... }
        }, ...
      }
    }

    Patterns include beat positions for triplet grace notes (beat 0.667, 3.667 etc).
    Patterns sorted by weight (most common first).
    Beat 1 is NOT forced to root — iReal Pro bass sometimes starts on 3rd/5th.
    """
    # Group by style → quality → beats → octave_pool → note list
    grouped: dict[str, dict[str, dict[int, dict[str, dict[tuple, int]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(int))))
    )

    for p in all_patterns:
        note_list = pattern_to_note_list(p)
        key = tuple(tuple(n) for n in note_list)
        pool = "alt" if p.is_alt else "default"
        grouped[p.style][p.quality][p.beats][pool][key] += 1

    # Build output: nested by style → quality → beat_key
    output_patterns: dict[str, dict[str, dict[str, list]]] = {}
    output_weights: dict[str, dict[str, dict[str, list]]] = {}
    total_unique = 0
    total_raw = len(all_patterns)
    all_qualities: set[str] = set()
    all_styles: set[str] = set()

    for style in sorted(grouped.keys()):
        all_styles.add(style)
        s_patterns: dict[str, dict[str, list]] = {}
        s_weights: dict[str, dict[str, list]] = {}
        for quality in sorted(grouped[style].keys()):
            all_qualities.add(quality)
            q_patterns: dict[str, list] = {}
            q_weights: dict[str, list] = {}
            for beats in sorted(grouped[style][quality].keys()):
                for pool in ["default", "alt"]:
                    pool_data = grouped[style][quality][beats].get(pool, {})
                    if not pool_data:
                        continue
                    sorted_items = sorted(pool_data.items(), key=lambda x: -x[1])
                    db_key = str(beats) if pool == "default" else f"{beats}_alt"
                    q_patterns[db_key] = [list(list(n) for n in note_seq) for note_seq, _ in sorted_items]
                    q_weights[db_key] = [count for _, count in sorted_items]
                    total_unique += len(sorted_items)
            s_patterns[quality] = q_patterns
            s_weights[quality] = q_weights
        output_patterns[style] = s_patterns
        output_weights[style] = s_weights

    return {
        "meta": {
            "totalRaw": total_raw,
            "totalUnique": total_unique,
            "qualities": sorted(all_qualities),
            "styles": sorted(all_styles),
        },
        "patterns": output_patterns,
        "weights": output_weights,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_song(name: str) -> list[ChordPattern]:
    """Process one song (MusicXML + MIDI pair)."""
    mxml_path = IREAL_DIR / f"{name}.musicxml"
    midi_path = IREAL_DIR / f"{name}.mid"

    if not mxml_path.exists() or not midi_path.exists():
        print(f"  SKIP: {name} (files not found)")
        return []

    # 0. Extract style from MusicXML
    style = extract_style(mxml_path)

    # 1. Parse MusicXML → expanded chord progression
    measures = parse_musicxml(mxml_path)
    expanded = expand_form(measures)
    chord_timeline = build_chord_timeline(expanded)

    chorus_beats = sum(m.beats for m in expanded)
    print(f"  {name} [{style}]: {len(measures)} measures → {len(expanded)} expanded "
          f"({chorus_beats} beats/chorus), {len(chord_timeline)} chord spans")

    # 2. Parse MIDI bass
    midi_notes, bpm = parse_midi_bass(midi_path)
    total_midi_beats = max(n.beat + n.duration for n in midi_notes)
    num_choruses = round(total_midi_beats / chorus_beats)
    print(f"    MIDI: {len(midi_notes)} notes, BPM={bpm:.0f}, "
          f"~{num_choruses} choruses ({total_midi_beats:.0f} beats)")

    # 3. Extract patterns
    patterns = extract_patterns(midi_notes, chord_timeline, chorus_beats, name, style)
    print(f"    Extracted: {len(patterns)} raw patterns")

    # Report quality distribution
    by_quality = defaultdict(int)
    for p in patterns:
        by_quality[p.quality] += 1
    for q in sorted(by_quality):
        print(f"      {q}: {by_quality[q]}")

    return patterns


def main():
    print("=== iReal Pro Bass Phrase Parser ===\n")

    # Auto-detect songs from MusicXML files in IREAL_DIR
    songs = sorted(
        p.stem for p in IREAL_DIR.glob("*.musicxml")
        if (IREAL_DIR / f"{p.stem}.mid").exists()
    )

    all_patterns: list[ChordPattern] = []

    for song in songs:
        patterns = process_song(song)
        all_patterns.extend(patterns)

    print(f"\nTotal raw patterns: {len(all_patterns)}")

    # Build output
    output = build_output(all_patterns)

    # Report
    print(f"\n=== Summary ===")
    print(f"Total raw: {output['meta']['totalRaw']}")
    print(f"Total unique: {output['meta']['totalUnique']}")
    print(f"Qualities: {output['meta']['qualities']}")
    print(f"Styles: {output['meta']['styles']}")

    for style in output["patterns"]:
        print(f"\n--- {style} ---")
        for quality in output["patterns"][style]:
            for beats in output["patterns"][style][quality]:
                pats = output["patterns"][style][quality][beats]
                weights = output["weights"][style][quality][beats]
                # Group by note count
                by_nc: dict[int, int] = {}
                for p, w in zip(pats, weights):
                    nc = len(p)
                    by_nc[nc] = by_nc.get(nc, 0) + 1
                nc_info = ", ".join(f"{nc}notes:{cnt}" for nc, cnt in sorted(by_nc.items()))
                total_w = sum(weights)
                print(f"\n  {quality} ({beats}-beat): {len(pats)} unique ({nc_info}), {total_w} raw")
                for p, w in list(zip(pats, weights))[:5]:
                    degs = [f"{b:.2f}:{classify_degree(s, quality)}({d:.2f})" for b, s, d in p]
                    print(f"    {degs} (x{w})")

    # Write output
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone. Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
