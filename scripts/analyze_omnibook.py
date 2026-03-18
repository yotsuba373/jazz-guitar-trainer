"""Analyze Parker Omnibook MusicXML solos and output statistical profiles.

Extracts per-chord-quality interval distributions, chord-tone rates,
approach pattern frequencies, scalar run statistics, and more.
Outputs JSON to scripts/output/parker_profiles.json.
"""

import glob
import json
import warnings
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

warnings.filterwarnings("ignore")

import music21  # noqa: E402

DATA_DIR = Path(__file__).parent / "output" / "omnibook"
OUTPUT_DIR = Path(__file__).parent / "output"

# ---------------------------------------------------------------------------
# Chord quality classification
# ---------------------------------------------------------------------------

def classify_quality(figure: str, kind: str) -> str:
    """Map a music21 ChordSymbol to a quality group."""
    fig_lower = figure.lower()
    if "dim" in fig_lower or "o" in fig_lower:
        return "dim"
    if kind == "dominant-seventh":
        return "dom7"
    if kind == "minor":
        return "min7"   # jazz minor triads are contextually min7
    if kind == "major":
        return "maj"    # major triads / maj7
    if "half-diminished" in kind:
        return "min7b5"
    if "augmented" in kind:
        return "other"
    return "other"


# ---------------------------------------------------------------------------
# Beat position helpers
# ---------------------------------------------------------------------------

def is_strong_beat(offset: float, ts_denominator: int = 4) -> bool:
    """Return True if offset falls on beat 1 or 3 (in 4/4)."""
    beat = offset % 4.0
    return beat == 0.0 or beat == 2.0


def get_beat_position(offset: float) -> float:
    """Return beat within the measure (0-based)."""
    return offset % 4.0


# ---------------------------------------------------------------------------
# Chord tone detection
# ---------------------------------------------------------------------------

def is_chord_tone(pitch: music21.pitch.Pitch, chord_symbol) -> bool:
    """Check if a pitch (any octave) is a chord tone of the given chord symbol."""
    chord_pitches = {p.pitchClass for p in chord_symbol.pitches}
    return pitch.pitchClass in chord_pitches


def is_guide_tone(pitch: music21.pitch.Pitch, chord_symbol) -> bool:
    """Check if pitch is the 3rd or 7th of the chord."""
    root_pc = chord_symbol.root().pitchClass
    pc = pitch.pitchClass
    interval = (pc - root_pc) % 12
    # 3rd: major=4, minor=3; 7th: major=11, minor/dom=10
    return interval in (3, 4, 10, 11)


# ---------------------------------------------------------------------------
# Approach pattern detection
# ---------------------------------------------------------------------------

def detect_approach_patterns(notes_with_chords):
    """Detect approach patterns: chromatic single, enclosure, etc.

    Returns a list of (pattern_type, target_index) tuples.
    """
    patterns = []
    n = len(notes_with_chords)

    for i in range(1, n):
        note_i, chord_i = notes_with_chords[i]
        if chord_i is None or not hasattr(note_i, "pitch"):
            continue
        if not is_chord_tone(note_i.pitch, chord_i):
            continue

        # Target is a chord tone — check preceding notes for approach
        note_prev, chord_prev = notes_with_chords[i - 1]
        if not hasattr(note_prev, "pitch") or chord_prev is None:
            continue

        interval = note_i.pitch.midi - note_prev.pitch.midi
        prev_is_ct = is_chord_tone(note_prev.pitch, chord_prev)

        if not prev_is_ct and abs(interval) == 1:
            # Single chromatic approach
            if interval == 1:
                patterns.append(("single_below", i))
            else:
                patterns.append(("single_above", i))
        elif not prev_is_ct and abs(interval) == 2:
            # Single diatonic approach
            if interval > 0:
                patterns.append(("single_below", i))
            else:
                patterns.append(("single_above", i))

        # Enclosure: 2 notes before target, one above one below (or vice versa)
        if i >= 2:
            note_pp, chord_pp = notes_with_chords[i - 2]
            if hasattr(note_pp, "pitch") and chord_pp is not None:
                int1 = note_i.pitch.midi - note_pp.pitch.midi
                int2 = note_i.pitch.midi - note_prev.pitch.midi
                pp_is_ct = is_chord_tone(note_pp.pitch, chord_pp)
                if not pp_is_ct and not prev_is_ct:
                    # One above, one below (in either order)
                    if (int1 > 0 and int2 < 0) or (int1 < 0 and int2 > 0):
                        if abs(int1) <= 3 and abs(int2) <= 3:
                            patterns.append(("enclosure", i))

    return patterns


# ---------------------------------------------------------------------------
# Scalar run detection
# ---------------------------------------------------------------------------

def detect_scalar_runs(notes_with_chords):
    """Detect runs of 3+ consecutive stepwise notes in same direction.

    Returns list of (start_idx, length, direction) tuples.
    """
    runs = []
    if len(notes_with_chords) < 3:
        return runs

    pitches = []
    for note, _ in notes_with_chords:
        if hasattr(note, "pitch"):
            pitches.append(note.pitch.midi)
        else:
            pitches.append(None)

    run_start = 0
    run_dir = 0
    run_len = 1

    for i in range(1, len(pitches)):
        if pitches[i] is None or pitches[i - 1] is None:
            if run_len >= 3:
                runs.append((run_start, run_len, run_dir))
            run_start = i
            run_len = 1
            run_dir = 0
            continue

        interval = abs(pitches[i] - pitches[i - 1])
        direction = 1 if pitches[i] > pitches[i - 1] else -1 if pitches[i] < pitches[i - 1] else 0

        if interval <= 2 and direction != 0:
            if run_dir == 0 or direction == run_dir:
                run_dir = direction
                run_len += 1
            else:
                if run_len >= 3:
                    runs.append((run_start, run_len, run_dir))
                run_start = i - 1
                run_len = 2
                run_dir = direction
        else:
            if run_len >= 3:
                runs.append((run_start, run_len, run_dir))
            run_start = i
            run_len = 1
            run_dir = 0

    if run_len >= 3:
        runs.append((run_start, run_len, run_dir))

    return runs


def detect_arpeggio_runs(notes_with_chords):
    """Detect runs of 3+ consecutive third intervals (3-4 semitones) in same direction."""
    runs = []
    if len(notes_with_chords) < 3:
        return runs

    pitches = []
    for note, _ in notes_with_chords:
        if hasattr(note, "pitch"):
            pitches.append(note.pitch.midi)
        else:
            pitches.append(None)

    run_start = 0
    run_dir = 0
    run_len = 1

    for i in range(1, len(pitches)):
        if pitches[i] is None or pitches[i - 1] is None:
            if run_len >= 3:
                runs.append((run_start, run_len, run_dir))
            run_start = i
            run_len = 1
            run_dir = 0
            continue

        interval = abs(pitches[i] - pitches[i - 1])
        direction = 1 if pitches[i] > pitches[i - 1] else -1 if pitches[i] < pitches[i - 1] else 0

        if interval in (3, 4) and direction != 0:
            if run_dir == 0 or direction == run_dir:
                run_dir = direction
                run_len += 1
            else:
                if run_len >= 3:
                    runs.append((run_start, run_len, run_dir))
                run_start = i - 1
                run_len = 2
                run_dir = direction
        else:
            if run_len >= 3:
                runs.append((run_start, run_len, run_dir))
            run_start = i
            run_len = 1
            run_dir = 0

    if run_len >= 3:
        runs.append((run_start, run_len, run_dir))

    return runs


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def get_active_chord(measure, offset):
    """Get the active chord symbol at a given offset in a measure."""
    chords = list(measure.getElementsByClass("ChordSymbol"))
    if not chords:
        return None
    active = chords[0]
    for cs in chords:
        if cs.offset <= offset:
            active = cs
        else:
            break
    return active


def analyze_solo(filepath: str):
    """Analyze a single MusicXML solo file.

    Returns a list of (note, active_chord_symbol, measure_offset) tuples.
    """
    score = music21.converter.parse(filepath)
    part = score.parts[0]
    notes_with_chords = []

    # Build a timeline of chord symbols with absolute offsets
    chord_timeline = []
    for measure in part.getElementsByClass("Measure"):
        m_offset = measure.offset
        for cs in measure.getElementsByClass("ChordSymbol"):
            chord_timeline.append((m_offset + cs.offset, cs))

    for measure in part.getElementsByClass("Measure"):
        m_offset = measure.offset
        for note in measure.notes:
            if not hasattr(note, "pitch"):
                continue  # skip rests and chords
            abs_offset = m_offset + note.offset
            # Find active chord at this offset
            active_chord = None
            for ct_offset, cs in chord_timeline:
                if ct_offset <= abs_offset:
                    active_chord = cs
                else:
                    break
            beat_in_measure = note.offset  # offset within measure
            notes_with_chords.append((note, active_chord, beat_in_measure))

    return notes_with_chords


def compute_stats(all_notes_by_quality):
    """Compute statistics for each chord quality group."""
    results = {}

    for quality, notes_list in all_notes_by_quality.items():
        if not notes_list:
            continue

        # --- Interval distribution ---
        intervals = Counter()
        interval_directions = Counter()
        direction_changes = 0
        prev_dir = 0
        total_intervals = 0

        for i in range(1, len(notes_list)):
            note_cur, _, _ = notes_list[i]
            note_prev, _, _ = notes_list[i - 1]
            if not hasattr(note_cur, "pitch") or not hasattr(note_prev, "pitch"):
                continue

            diff = note_cur.pitch.midi - note_prev.pitch.midi
            abs_diff = abs(diff)
            total_intervals += 1

            if abs_diff == 0:
                intervals["unison"] += 1
            elif abs_diff <= 2:
                intervals["stepwise"] += 1
            elif abs_diff <= 4:
                intervals["thirds"] += 1
            elif abs_diff == 5:
                intervals["fourths"] += 1
            else:
                intervals["leaps"] += 1

            cur_dir = 1 if diff > 0 else -1 if diff < 0 else 0
            if cur_dir != 0:
                if diff > 0:
                    interval_directions["up"] += 1
                else:
                    interval_directions["down"] += 1
            if prev_dir != 0 and cur_dir != 0 and cur_dir != prev_dir:
                direction_changes += 1
            if cur_dir != 0:
                prev_dir = cur_dir

        # --- Beat position chord tone rates ---
        strong_ct = 0
        strong_total = 0
        strong_gt = 0
        weak_ct = 0
        weak_total = 0

        for note, chord, beat_offset in notes_list:
            if chord is None or not hasattr(note, "pitch"):
                continue
            strong = is_strong_beat(beat_offset)
            ct = is_chord_tone(note.pitch, chord)
            gt = is_guide_tone(note.pitch, chord)

            if strong:
                strong_total += 1
                if ct:
                    strong_ct += 1
                if gt:
                    strong_gt += 1
            else:
                weak_total += 1
                if ct:
                    weak_ct += 1

        # --- Approach patterns ---
        notes_for_approach = [(n, c) for n, c, _ in notes_list]
        approach_patterns = detect_approach_patterns(notes_for_approach)
        approach_counts = Counter(p[0] for p in approach_patterns)

        # --- Scalar runs ---
        notes_for_runs = [(n, c) for n, c, _ in notes_list]
        scalar_runs = detect_scalar_runs(notes_for_runs)
        arpeggio_runs = detect_arpeggio_runs(notes_for_runs)

        # --- Pitch class usage ---
        pitch_class_counts = Counter()
        for note, chord, _ in notes_list:
            if hasattr(note, "pitch") and chord is not None:
                root_pc = chord.root().pitchClass
                relative_pc = (note.pitch.pitchClass - root_pc) % 12
                pitch_class_counts[relative_pc] += 1

        # --- Build result ---
        sample = len(notes_list)
        total_ap = sum(approach_counts.values()) or 1

        result = {
            "sample_size": sample,
            "total_intervals": total_intervals,
            "intervals": {
                "unison_pct": round(intervals["unison"] / max(total_intervals, 1) * 100, 1),
                "stepwise_pct": round(intervals["stepwise"] / max(total_intervals, 1) * 100, 1),
                "thirds_pct": round(intervals["thirds"] / max(total_intervals, 1) * 100, 1),
                "fourths_pct": round(intervals["fourths"] / max(total_intervals, 1) * 100, 1),
                "leaps_pct": round(intervals["leaps"] / max(total_intervals, 1) * 100, 1),
            },
            "direction": {
                "up_pct": round(interval_directions["up"] / max(total_intervals, 1) * 100, 1),
                "down_pct": round(interval_directions["down"] / max(total_intervals, 1) * 100, 1),
                "direction_changes_per_8notes": round(direction_changes / max(total_intervals / 8, 1), 2),
            },
            "chord_tones": {
                "strong_beat_ct_pct": round(strong_ct / max(strong_total, 1) * 100, 1),
                "strong_beat_guide_tone_pct": round(strong_gt / max(strong_total, 1) * 100, 1),
                "weak_beat_ct_pct": round(weak_ct / max(weak_total, 1) * 100, 1),
                "strong_beat_sample": strong_total,
                "weak_beat_sample": weak_total,
            },
            "approach_patterns": {
                "total_detected": sum(approach_counts.values()),
                "single_below_pct": round(approach_counts["single_below"] / total_ap * 100, 1),
                "single_above_pct": round(approach_counts["single_above"] / total_ap * 100, 1),
                "enclosure_pct": round(approach_counts["enclosure"] / total_ap * 100, 1),
            },
            "scalar_runs": {
                "total_runs": len(scalar_runs),
                "avg_length": round(sum(l for _, l, _ in scalar_runs) / max(len(scalar_runs), 1), 1),
                "runs_per_8notes": round(len(scalar_runs) / max(sample / 8, 1), 2),
            },
            "arpeggio_runs": {
                "total_runs": len(arpeggio_runs),
                "avg_length": round(sum(l for _, l, _ in arpeggio_runs) / max(len(arpeggio_runs), 1), 1),
                "runs_per_8notes": round(len(arpeggio_runs) / max(sample / 8, 1), 2),
            },
            "pitch_class_usage": {
                str(pc): round(cnt / sample * 100, 1)
                for pc, cnt in sorted(pitch_class_counts.items())
            },
        }

        results[quality] = result

    return results


def main():
    xml_files = sorted(glob.glob(str(DATA_DIR / "*.xml")))
    if not xml_files:
        print(f"No XML files found in {DATA_DIR}")
        print("Run download_omnibook.py first.")
        return

    print(f"Analyzing {len(xml_files)} solos...")

    # Collect notes grouped by chord quality
    all_notes_by_quality = defaultdict(list)
    all_notes_overall = []
    total_notes = 0
    per_solo_stats = []

    for filepath in xml_files:
        name = Path(filepath).stem
        notes_with_chords = analyze_solo(filepath)
        total_notes += len(notes_with_chords)
        per_solo_stats.append({"name": name, "notes": len(notes_with_chords)})

        for note, chord, beat_offset in notes_with_chords:
            if chord is None:
                continue
            quality = classify_quality(chord.figure, chord.chordKind)
            all_notes_by_quality[quality].append((note, chord, beat_offset))
            all_notes_overall.append((note, chord, beat_offset))

        print(f"  {name}: {len(notes_with_chords)} notes")

    print(f"\nTotal notes: {total_notes}")
    print(f"Notes by quality: {', '.join(f'{q}={len(ns)}' for q, ns in sorted(all_notes_by_quality.items()))}")

    # Compute stats per quality
    by_quality = compute_stats(all_notes_by_quality)

    # Compute overall stats
    overall = compute_stats({"overall": all_notes_overall})["overall"]

    # Build output
    output = {
        "metadata": {
            "source": "Parker Omnibook MusicXML (LORIA)",
            "url": "https://homepages.loria.fr/evincent/omnibook/",
            "solos_analyzed": len(xml_files),
            "total_notes": total_notes,
            "date": str(date.today()),
        },
        "by_quality": by_quality,
        "overall": overall,
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "parker_profiles.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nOutput written to {out_path}")

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for q in ["dom7", "min7", "maj", "dim", "other"]:
        if q not in by_quality:
            continue
        s = by_quality[q]
        iv = s["intervals"]
        ct = s["chord_tones"]
        print(f"\n--- {q} (n={s['sample_size']}) ---")
        print(f"  Intervals: step={iv['stepwise_pct']}% thirds={iv['thirds_pct']}% "
              f"fourths={iv['fourths_pct']}% leaps={iv['leaps_pct']}% unison={iv['unison_pct']}%")
        print(f"  Strong-beat CT: {ct['strong_beat_ct_pct']}%  GT: {ct['strong_beat_guide_tone_pct']}%")
        print(f"  Weak-beat CT: {ct['weak_beat_ct_pct']}%")
        ap = s["approach_patterns"]
        print(f"  Approach: below={ap['single_below_pct']}% above={ap['single_above_pct']}% "
              f"encl={ap['enclosure_pct']}% (total={ap['total_detected']})")
        sr = s["scalar_runs"]
        print(f"  Scalar runs: {sr['total_runs']} (avg len={sr['avg_length']}, per 8notes={sr['runs_per_8notes']})")

    print(f"\n--- Overall (n={overall['sample_size']}) ---")
    iv = overall["intervals"]
    ct = overall["chord_tones"]
    print(f"  Intervals: step={iv['stepwise_pct']}% thirds={iv['thirds_pct']}% "
          f"fourths={iv['fourths_pct']}% leaps={iv['leaps_pct']}% unison={iv['unison_pct']}%")
    print(f"  Strong-beat CT: {ct['strong_beat_ct_pct']}%  GT: {ct['strong_beat_guide_tone_pct']}%")
    print(f"  Weak-beat CT: {ct['weak_beat_ct_pct']}%")


if __name__ == "__main__":
    main()
