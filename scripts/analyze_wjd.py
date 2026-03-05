"""Analyze Weimar Jazz Database (WJazzD) solos.

Extracts per-chord-quality and per-performer statistics from the SQLite3 database.
Focuses on bebop solos but also analyzes hardbop/cool for comparison.
Outputs JSON to scripts/output/wjd_profiles.json.
"""

import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "wjazzd.db"
OUTPUT_DIR = Path(__file__).parent / "output"

# ---------------------------------------------------------------------------
# Chord quality classification (richer than Omnibook)
# ---------------------------------------------------------------------------

def classify_chord(symbol: str) -> str | None:
    """Classify a WJD chord symbol into a quality group."""
    if not symbol or symbol == "NC":
        return None

    # Remove slash bass (e.g., Ab/C -> Ab)
    s = symbol.split("/")[0] if "/" in symbol else symbol

    # Normalize: remove root to get quality suffix
    # Roots: C, C#, Db, D, D#, Eb, E, F, F#, Gb, G, G#, Ab, A, A#, Bb, B
    root_match = re.match(r'^([A-G][b#]?)(.*)', s)
    if not root_match:
        return None
    suffix = root_match.group(2)

    # Diminished 7
    if suffix in ("o7", "dim7"):
        return "dim7"
    # Diminished triad
    if suffix in ("o", "dim"):
        return "dim"
    # Half-diminished / min7b5
    if "m7b5" in suffix or "ø" in suffix:
        return "min7b5"
    # Minor-major 7
    if suffix in ("-j7", "mj7", "-maj7", "minmaj7"):
        return "minMaj7"
    # Minor 7 (includes -7, -79, -79b, etc.)
    if re.match(r'^[-m](7|9|11|13|6)', suffix) or suffix in ("-7", "m7"):
        return "min7"
    # Minor triad
    if suffix in ("-", "m", "-6", "m6"):
        return "min7"  # contextually min7 in jazz
    # Major 7
    if suffix.startswith("j7") or suffix.startswith("maj7") or suffix in ("j7", "maj7", "j79"):
        return "maj7"
    # Major 6/69 (contextually maj)
    if suffix in ("6", "69", "6/9"):
        return "maj7"  # contextually maj in jazz
    # Dominant 7 (includes 7, 79, 79b, 79#, 7alt, 7sus, +7, etc.)
    if re.match(r'^[\+]?7', suffix) or suffix.startswith("sus7") or suffix.startswith("+7"):
        return "dom7"
    # Augmented without 7
    if suffix in ("+", "aug"):
        return "other"
    # Plain major triad
    if suffix == "":
        return "maj7"  # contextually tonic in jazz

    return "other"


def parse_root_midi(symbol: str) -> int | None:
    """Extract root pitch class (0-11) from chord symbol."""
    if not symbol or symbol == "NC":
        return None
    s = symbol.split("/")[0] if "/" in symbol else symbol
    root_match = re.match(r'^([A-G])([b#]?)', s)
    if not root_match:
        return None
    note_map = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    pc = note_map.get(root_match.group(1))
    if pc is None:
        return None
    if root_match.group(2) == "#":
        pc = (pc + 1) % 12
    elif root_match.group(2) == "b":
        pc = (pc - 1) % 12
    return pc


# ---------------------------------------------------------------------------
# Statistics computation (shared logic with Omnibook analysis)
# ---------------------------------------------------------------------------

def is_strong_beat(beat: int) -> bool:
    """Beat 1 and 3 are strong (WJD uses 1-based beats)."""
    return beat in (1, 3)


def is_chord_tone(pitch_midi: int, root_pc: int, quality: str) -> bool:
    """Check if a MIDI pitch is a chord tone for the given quality."""
    interval = (pitch_midi - root_pc) % 12
    ct_intervals = {
        "dom7":    {0, 4, 7, 10},
        "maj7":    {0, 4, 7, 11},
        "min7":    {0, 3, 7, 10},
        "min7b5":  {0, 3, 6, 10},
        "dim7":    {0, 3, 6, 9},
        "dim":     {0, 3, 6},
        "minMaj7": {0, 3, 7, 11},
        "other":   {0, 4, 7},
    }
    return interval in ct_intervals.get(quality, {0, 4, 7})


def is_guide_tone(pitch_midi: int, root_pc: int) -> bool:
    """Check if pitch is the 3rd or 7th (any quality)."""
    interval = (pitch_midi - root_pc) % 12
    return interval in (3, 4, 10, 11)


def compute_stats(notes_list):
    """Compute statistics from a list of (midi_pitch, beat, root_pc, quality) tuples."""
    if len(notes_list) < 3:
        return None

    sample = len(notes_list)

    # --- Interval distribution ---
    intervals = Counter()
    interval_dirs = Counter()
    direction_changes = 0
    prev_dir = 0
    total_intervals = 0

    for i in range(1, len(notes_list)):
        p_cur = notes_list[i][0]
        p_prev = notes_list[i - 1][0]
        diff = p_cur - p_prev
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
            interval_dirs["up" if diff > 0 else "down"] += 1
        if prev_dir != 0 and cur_dir != 0 and cur_dir != prev_dir:
            direction_changes += 1
        if cur_dir != 0:
            prev_dir = cur_dir

    # --- Chord tone rates by beat position ---
    strong_ct = strong_gt = strong_total = 0
    weak_ct = weak_total = 0

    for pitch, beat, root_pc, quality in notes_list:
        if root_pc is None:
            continue
        strong = is_strong_beat(beat)
        ct = is_chord_tone(pitch, root_pc, quality)
        gt = is_guide_tone(pitch, root_pc)

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

    # --- Approach pattern detection ---
    approach_counts = Counter()
    for i in range(1, len(notes_list)):
        pitch_i, _, root_i, q_i = notes_list[i]
        if root_i is None:
            continue
        if not is_chord_tone(pitch_i, root_i, q_i):
            continue
        pitch_prev, _, root_prev, q_prev = notes_list[i - 1]
        if root_prev is None:
            continue
        if is_chord_tone(pitch_prev, root_prev, q_prev):
            continue
        interval = pitch_i - pitch_prev
        if abs(interval) in (1, 2):
            if interval > 0:
                approach_counts["single_below"] += 1
            else:
                approach_counts["single_above"] += 1
        # Enclosure
        if i >= 2:
            pitch_pp, _, root_pp, q_pp = notes_list[i - 2]
            if root_pp is not None and not is_chord_tone(pitch_pp, root_pp, q_pp):
                int1 = pitch_i - pitch_pp
                int2 = pitch_i - pitch_prev
                if (int1 > 0 and int2 < 0) or (int1 < 0 and int2 > 0):
                    if abs(int1) <= 3 and abs(int2) <= 3:
                        approach_counts["enclosure"] += 1

    # --- Scalar runs ---
    scalar_runs = []
    run_start = 0
    run_dir = 0
    run_len = 1
    for i in range(1, len(notes_list)):
        diff = notes_list[i][0] - notes_list[i - 1][0]
        d = 1 if diff > 0 else -1 if diff < 0 else 0
        if 0 < abs(diff) <= 2 and d != 0:
            if run_dir == 0 or d == run_dir:
                run_dir = d
                run_len += 1
            else:
                if run_len >= 3:
                    scalar_runs.append(run_len)
                run_start = i - 1
                run_len = 2
                run_dir = d
        else:
            if run_len >= 3:
                scalar_runs.append(run_len)
            run_start = i
            run_len = 1
            run_dir = 0
    if run_len >= 3:
        scalar_runs.append(run_len)

    # --- Arpeggio runs (3-4 semitones) ---
    arp_runs = []
    run_len = 1
    run_dir = 0
    for i in range(1, len(notes_list)):
        diff = notes_list[i][0] - notes_list[i - 1][0]
        d = 1 if diff > 0 else -1 if diff < 0 else 0
        if abs(diff) in (3, 4) and d != 0:
            if run_dir == 0 or d == run_dir:
                run_dir = d
                run_len += 1
            else:
                if run_len >= 3:
                    arp_runs.append(run_len)
                run_len = 2
                run_dir = d
        else:
            if run_len >= 3:
                arp_runs.append(run_len)
            run_len = 1
            run_dir = 0
    if run_len >= 3:
        arp_runs.append(run_len)

    # --- Pitch class usage (relative to root) ---
    pc_counts = Counter()
    for pitch, _, root_pc, _ in notes_list:
        if root_pc is not None:
            pc_counts[(pitch - root_pc) % 12] += 1

    # --- Build result ---
    ti = max(total_intervals, 1)
    total_ap = sum(approach_counts.values()) or 1

    return {
        "sample_size": sample,
        "total_intervals": total_intervals,
        "intervals": {
            "unison_pct": round(intervals["unison"] / ti * 100, 1),
            "stepwise_pct": round(intervals["stepwise"] / ti * 100, 1),
            "thirds_pct": round(intervals["thirds"] / ti * 100, 1),
            "fourths_pct": round(intervals["fourths"] / ti * 100, 1),
            "leaps_pct": round(intervals["leaps"] / ti * 100, 1),
        },
        "direction": {
            "up_pct": round(interval_dirs["up"] / ti * 100, 1),
            "down_pct": round(interval_dirs["down"] / ti * 100, 1),
            "direction_changes_per_8notes": round(direction_changes / max(ti / 8, 1), 2),
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
            "avg_length": round(sum(scalar_runs) / max(len(scalar_runs), 1), 1),
            "runs_per_8notes": round(len(scalar_runs) / max(sample / 8, 1), 2),
        },
        "arpeggio_runs": {
            "total_runs": len(arp_runs),
            "avg_length": round(sum(arp_runs) / max(len(arp_runs), 1), 1),
            "runs_per_8notes": round(len(arp_runs) / max(sample / 8, 1), 2),
        },
        "pitch_class_usage": {
            str(pc): round(cnt / sample * 100, 1)
            for pc, cnt in sorted(pc_counts.items())
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_solo_notes(conn, melid):
    """Load all notes for a solo with active chord resolution.

    Returns list of (midi_pitch, beat, root_pc, quality) tuples.
    """
    cur = conn.cursor()

    # Build chord timeline: (bar, beat) -> chord symbol
    cur.execute(
        "SELECT bar, beat, chord FROM beats WHERE melid=? ORDER BY bar, beat",
        (melid,),
    )
    chord_at = {}
    for bar, beat, chord in cur.fetchall():
        if chord and chord != "NC":
            chord_at[(bar, beat)] = chord

    # Resolve active chord for any (bar, beat)
    sorted_positions = sorted(chord_at.keys())

    def get_active_chord(bar, beat):
        active = None
        for pos in sorted_positions:
            if pos <= (bar, beat):
                active = chord_at[pos]
            else:
                break
        return active

    # Load notes
    cur.execute(
        "SELECT pitch, bar, beat FROM melody WHERE melid=? ORDER BY onset",
        (melid,),
    )
    notes = []
    for pitch, bar, beat in cur.fetchall():
        chord_sym = get_active_chord(bar, beat)
        quality = classify_chord(chord_sym) if chord_sym else None
        root_pc = parse_root_midi(chord_sym) if chord_sym else None
        notes.append((int(pitch), beat, root_pc, quality))

    return notes


def main():
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        print("Run download_wjd.py first.")
        return

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # Get all solos with style info
    cur.execute(
        "SELECT melid, performer, title, style, avgtempo, key FROM solo_info ORDER BY style, performer"
    )
    all_solos = cur.fetchall()

    # Target styles for analysis
    target_styles = {"BEBOP", "HARDBOP", "COOL"}

    print(f"Loading solos from styles: {', '.join(sorted(target_styles))}")

    # Collect notes by grouping
    notes_by_quality = defaultdict(list)        # quality -> notes
    notes_by_performer = defaultdict(list)       # performer -> notes
    notes_by_style = defaultdict(list)           # style -> notes
    notes_by_style_quality = defaultdict(lambda: defaultdict(list))  # style -> quality -> notes
    parker_notes = []
    bebop_non_parker = []

    solo_count = 0
    for melid, performer, title, style, tempo, key in all_solos:
        if style not in target_styles:
            continue

        notes = load_solo_notes(conn, melid)
        if not notes:
            continue

        solo_count += 1
        print(f"  [{style}] {performer}: {title} ({len(notes)} notes)")

        for n in notes:
            pitch, beat, root_pc, quality = n
            if quality:
                notes_by_quality[quality].append(n)
                notes_by_style[style].append(n)
                notes_by_style_quality[style][quality].append(n)
                notes_by_performer[performer].append(n)

                if performer == "Charlie Parker":
                    parker_notes.append(n)
                elif style == "BEBOP":
                    bebop_non_parker.append(n)

    conn.close()

    print(f"\nTotal solos analyzed: {solo_count}")
    print(f"Notes by quality: {', '.join(f'{q}={len(ns)}' for q, ns in sorted(notes_by_quality.items()))}")
    print(f"Parker notes: {len(parker_notes)}")
    print(f"Bebop (non-Parker) notes: {len(bebop_non_parker)}")

    # Compute stats
    by_quality = {}
    for q, ns in notes_by_quality.items():
        stats = compute_stats(ns)
        if stats:
            by_quality[q] = stats

    by_style = {}
    for style, ns in notes_by_style.items():
        stats = compute_stats(ns)
        if stats:
            by_style[style] = stats

    by_style_quality = {}
    for style, quality_map in notes_by_style_quality.items():
        by_style_quality[style] = {}
        for q, ns in quality_map.items():
            stats = compute_stats(ns)
            if stats:
                by_style_quality[style][q] = stats

    # Parker vs other bebop
    parker_stats = compute_stats(parker_notes)
    bebop_non_parker_stats = compute_stats(bebop_non_parker)

    # Parker by quality
    parker_by_quality = defaultdict(list)
    for n in parker_notes:
        if n[3]:
            parker_by_quality[n[3]].append(n)
    parker_quality_stats = {}
    for q, ns in parker_by_quality.items():
        stats = compute_stats(ns)
        if stats:
            parker_quality_stats[q] = stats

    # Top bebop performers
    bebop_performers = {}
    for melid, performer, title, style, tempo, key in all_solos:
        if style == "BEBOP":
            bebop_performers.setdefault(performer, 0)
            bebop_performers[performer] += 1

    performer_stats = {}
    for performer in sorted(bebop_performers.keys()):
        ns = notes_by_performer.get(performer, [])
        if len(ns) >= 50:
            stats = compute_stats(ns)
            if stats:
                performer_stats[performer] = stats

    # Build output
    all_notes = []
    for ns in notes_by_quality.values():
        all_notes.extend(ns)
    overall = compute_stats(all_notes)

    output = {
        "metadata": {
            "source": "Weimar Jazz Database (WJazzD) v2.1",
            "url": "https://jazzomat.hfm-weimar.de/",
            "styles_analyzed": sorted(target_styles),
            "solos_analyzed": solo_count,
            "total_notes": len(all_notes),
            "date": str(date.today()),
        },
        "overall": overall,
        "by_quality": by_quality,
        "by_style": by_style,
        "bebop_by_quality": by_style_quality.get("BEBOP", {}),
        "parker": {
            "overall": parker_stats,
            "by_quality": parker_quality_stats,
        },
        "bebop_non_parker": bebop_non_parker_stats,
        "bebop_performers": performer_stats,
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "wjd_profiles.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nOutput written to {out_path}")

    # Print summary comparison
    print("\n" + "=" * 70)
    print("PARKER (WJD) vs BEBOP NON-PARKER vs HARDBOP vs COOL")
    print("=" * 70)

    def print_summary(label, stats):
        if not stats:
            return
        iv = stats["intervals"]
        ct = stats["chord_tones"]
        dr = stats["direction"]
        ap = stats["approach_patterns"]
        print(f"\n--- {label} (n={stats['sample_size']}) ---")
        print(f"  Step={iv['stepwise_pct']}% 3rds={iv['thirds_pct']}% "
              f"4ths={iv['fourths_pct']}% Leaps={iv['leaps_pct']}% Uni={iv['unison_pct']}%")
        print(f"  Strong CT={ct['strong_beat_ct_pct']}% GT={ct['strong_beat_guide_tone_pct']}%  "
              f"Weak CT={ct['weak_beat_ct_pct']}%")
        print(f"  Up={dr['up_pct']}% Down={dr['down_pct']}%  "
              f"DirChg/8={dr['direction_changes_per_8notes']}")
        print(f"  Approach: below={ap['single_below_pct']}% above={ap['single_above_pct']}% "
              f"encl={ap['enclosure_pct']}%")

    print_summary("Parker (WJD)", parker_stats)
    print_summary("Bebop non-Parker", bebop_non_parker_stats)
    print_summary("HARDBOP", by_style.get("HARDBOP"))
    print_summary("COOL", by_style.get("COOL"))

    # Parker quality breakdown
    print("\n" + "=" * 70)
    print("PARKER BY CHORD QUALITY (WJD)")
    print("=" * 70)
    for q in ["dom7", "min7", "maj7", "min7b5", "dim7"]:
        print_summary(f"Parker {q}", parker_quality_stats.get(q))

    # Bebop performer comparison
    print("\n" + "=" * 70)
    print("BEBOP PERFORMERS (interval summary)")
    print("=" * 70)
    for perf, stats in sorted(performer_stats.items()):
        iv = stats["intervals"]
        ct = stats["chord_tones"]
        print(f"  {perf:25s}  step={iv['stepwise_pct']:5.1f}%  3rds={iv['thirds_pct']:5.1f}%  "
              f"leaps={iv['leaps_pct']:5.1f}%  sCT={ct['strong_beat_ct_pct']:5.1f}%  "
              f"n={stats['sample_size']}")


if __name__ == "__main__":
    main()
