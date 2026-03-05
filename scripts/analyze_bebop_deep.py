"""Deep bebop analysis: scale detection, detailed approach patterns,
phrase-level statistics, and style contrast.

Uses WJD SQLite3 + Omnibook JSON for comprehensive bebop profiling.
Outputs scripts/output/bebop_deep_profiles.json.
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
# Scale templates (semitone sets, relative to root)
# ---------------------------------------------------------------------------

SCALE_TEMPLATES = {
    # --- Diatonic modes ---
    "Ionian":     {0, 2, 4, 5, 7, 9, 11},
    "Dorian":     {0, 2, 3, 5, 7, 9, 10},
    "Phrygian":   {0, 1, 3, 5, 7, 8, 10},
    "Lydian":     {0, 2, 4, 6, 7, 9, 11},
    "Mixolydian": {0, 2, 4, 5, 7, 9, 10},
    "Aeolian":    {0, 2, 3, 5, 7, 8, 10},
    "Locrian":    {0, 1, 3, 5, 6, 8, 10},
    # --- Melodic minor modes ---
    "MelodicMinor":   {0, 2, 3, 5, 7, 9, 11},
    "LydianDom":      {0, 2, 4, 6, 7, 9, 10},
    "Altered":        {0, 1, 3, 4, 6, 8, 10},
    "DorianB2":       {0, 1, 3, 5, 7, 9, 10},
    # --- Harmonic minor modes ---
    "HarmonicMinor":  {0, 2, 3, 5, 7, 8, 11},
    "PhrygianDom":    {0, 1, 4, 5, 7, 8, 10},
    # --- Symmetric ---
    "WholeTone":      {0, 2, 4, 6, 8, 10},
    "HW_Dim":         {0, 1, 3, 4, 6, 7, 9, 10},
    "WH_Dim":         {0, 2, 3, 5, 6, 8, 9, 11},
    # --- Bebop scales ---
    "BebopDom":       {0, 2, 4, 5, 7, 9, 10, 11},
    "BebopDorian":    {0, 2, 3, 4, 5, 7, 9, 10},
    "BebopMajor":     {0, 2, 4, 5, 7, 8, 9, 11},
    # --- Blues ---
    "Blues":           {0, 3, 5, 6, 7, 10},
    "MajorBlues":     {0, 2, 3, 4, 7, 9},
}

# Which scales are typical for each chord quality
QUALITY_SCALE_CANDIDATES = {
    "dom7":    ["Mixolydian", "BebopDom", "LydianDom", "Altered", "HW_Dim",
                "Blues", "PhrygianDom", "WholeTone"],
    "min7":    ["Dorian", "BebopDorian", "Aeolian", "Phrygian", "DorianB2"],
    "maj7":    ["Ionian", "Lydian", "BebopMajor", "MajorBlues"],
    "min7b5":  ["Locrian", "Altered"],
    "dim7":    ["HW_Dim", "WH_Dim"],
    "minMaj7": ["MelodicMinor", "HarmonicMinor"],
}

# ---------------------------------------------------------------------------
# Chord classification (reused from analyze_wjd.py)
# ---------------------------------------------------------------------------

def classify_chord(symbol: str) -> str | None:
    if not symbol or symbol == "NC":
        return None
    s = symbol.split("/")[0] if "/" in symbol else symbol
    root_match = re.match(r'^([A-G][b#]?)(.*)', s)
    if not root_match:
        return None
    suffix = root_match.group(2)
    if suffix in ("o7", "dim7"):
        return "dim7"
    if suffix in ("o", "dim"):
        return "dim7"  # merge into dim7 for analysis
    if "m7b5" in suffix or "ø" in suffix:
        return "min7b5"
    if suffix in ("-j7", "mj7", "-maj7", "minmaj7"):
        return "minMaj7"
    if re.match(r'^[-m](7|9|11|13|6)', suffix) or suffix in ("-7", "m7"):
        return "min7"
    if suffix in ("-", "m", "-6", "m6"):
        return "min7"
    if suffix.startswith("j7") or suffix.startswith("maj7") or suffix in ("j7", "maj7", "j79"):
        return "maj7"
    if suffix in ("6", "69", "6/9"):
        return "maj7"
    if re.match(r'^[\+]?7', suffix) or suffix.startswith("sus7") or suffix.startswith("+7"):
        return "dom7"
    if suffix in ("+", "aug"):
        return "other"
    if suffix == "":
        return "maj7"
    return "other"


def parse_root_pc(symbol: str) -> int | None:
    if not symbol or symbol == "NC":
        return None
    s = symbol.split("/")[0] if "/" in symbol else symbol
    m = re.match(r'^([A-G])([b#]?)', s)
    if not m:
        return None
    pc = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[m.group(1)]
    if m.group(2) == "#":
        pc = (pc + 1) % 12
    elif m.group(2) == "b":
        pc = (pc - 1) % 12
    return pc


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_solos_by_style(conn):
    """Load all solos grouped by style. Returns {style: [(melid, performer, title, tempo), ...]}"""
    cur = conn.cursor()
    cur.execute("SELECT melid, performer, title, style, avgtempo FROM solo_info ORDER BY style, performer")
    by_style = defaultdict(list)
    for melid, perf, title, style, tempo in cur.fetchall():
        by_style[style].append((melid, perf, title, tempo))
    return dict(by_style)


def load_notes_with_chords(conn, melid):
    """Load notes with resolved chord info. Returns list of dicts.

    Note: sections.start/end are 0-based indices into onset-sorted notes,
    NOT melody.eventid values.
    """
    cur = conn.cursor()

    # Build chord sections (start/end are 0-based note indices)
    cur.execute(
        "SELECT start, end, value FROM sections WHERE melid=? AND type='CHORD' ORDER BY start",
        (melid,),
    )
    chord_sections = []
    for start, end, value in cur.fetchall():
        quality = classify_chord(value)
        root_pc = parse_root_pc(value)
        chord_sections.append((start, end, value, quality, root_pc))

    # Build phrase sections
    cur.execute(
        "SELECT start, end, value FROM sections WHERE melid=? AND type='PHRASE' ORDER BY start",
        (melid,),
    )
    phrase_sections = [(s, e, v) for s, e, v in cur.fetchall()]

    # Load notes (ordered by onset — index matches section indices)
    cur.execute(
        "SELECT eventid, pitch, bar, beat, duration FROM melody WHERE melid=? ORDER BY onset",
        (melid,),
    )
    rows = cur.fetchall()
    notes = []
    for idx, (eid, pitch, bar, beat, dur) in enumerate(rows):
        # Find active chord using 0-based index
        chord_sym = None
        quality = None
        root_pc = None
        for cs_start, cs_end, cs_sym, cs_q, cs_root in chord_sections:
            if cs_start <= idx <= cs_end:
                chord_sym = cs_sym
                quality = cs_q
                root_pc = cs_root
                break

        # Find phrase using 0-based index
        phrase_id = None
        for ps, pe, pv in phrase_sections:
            if ps <= idx <= pe:
                phrase_id = pv
                break

        notes.append({
            "eid": eid,
            "idx": idx,
            "pitch": int(pitch),
            "bar": bar,
            "beat": beat,
            "dur": dur,
            "chord": chord_sym,
            "quality": quality,
            "root_pc": root_pc,
            "phrase_id": phrase_id,
        })

    return notes


# ---------------------------------------------------------------------------
# Scale detection
# ---------------------------------------------------------------------------

def detect_scales(notes, quality_filter=None):
    """Analyze which scales best explain the notes played over each chord quality.

    Groups notes by chord quality, computes pitch class distributions,
    and matches against scale templates.
    """
    # Group notes by quality
    by_quality = defaultdict(list)
    for n in notes:
        q = n["quality"]
        if q and (quality_filter is None or q == quality_filter):
            interval = (n["pitch"] - n["root_pc"]) % 12
            by_quality[q].append(interval)

    results = {}
    for quality, intervals in by_quality.items():
        if len(intervals) < 50:
            continue

        # Pitch class distribution
        pc_counts = Counter(intervals)
        total = len(intervals)
        pc_dist = {pc: round(pc_counts.get(pc, 0) / total * 100, 2) for pc in range(12)}

        # Scale matching
        candidates = QUALITY_SCALE_CANDIDATES.get(quality, list(SCALE_TEMPLATES.keys()))
        scale_matches = []
        for name in candidates:
            template = SCALE_TEMPLATES[name]
            # Coverage: % of played notes that are in this scale
            in_scale = sum(pc_counts.get(pc, 0) for pc in template)
            coverage = round(in_scale / total * 100, 1)
            # Completeness: % of scale tones that appear
            used_pcs = set(pc for pc, cnt in pc_counts.items() if cnt >= total * 0.01)
            completeness = round(len(used_pcs & template) / len(template) * 100, 1)
            scale_matches.append({
                "scale": name,
                "coverage": coverage,
                "completeness": completeness,
                "score": round(coverage * 0.7 + completeness * 0.3, 1),
            })

        scale_matches.sort(key=lambda x: -x["score"])

        results[quality] = {
            "sample_size": total,
            "pitch_class_dist": pc_dist,
            "scale_matches": scale_matches[:8],
        }

    return results


# ---------------------------------------------------------------------------
# Detailed approach pattern detection
# ---------------------------------------------------------------------------

def is_ct(pitch, root_pc, quality):
    interval = (pitch - root_pc) % 12
    ct_sets = {
        "dom7": {0, 4, 7, 10}, "maj7": {0, 4, 7, 11}, "min7": {0, 3, 7, 10},
        "min7b5": {0, 3, 6, 10}, "dim7": {0, 3, 6, 9}, "minMaj7": {0, 3, 7, 11},
    }
    return interval in ct_sets.get(quality, {0, 4, 7})


def detect_detailed_approaches(notes):
    """Detect 1-note, 2-note (enclosure), 3-note (Parker encl), 4-note (b9 arp) approaches."""
    results = Counter()
    n = len(notes)

    for i in range(1, n):
        ni = notes[i]
        if ni["root_pc"] is None or not is_ct(ni["pitch"], ni["root_pc"], ni["quality"]):
            continue
        target = ni["pitch"]

        # Check 1-note approach
        if i >= 1:
            p1 = notes[i - 1]
            if p1["root_pc"] is not None and not is_ct(p1["pitch"], p1["root_pc"], p1["quality"]):
                diff = target - p1["pitch"]
                if diff == 1:
                    results["chromatic_below"] += 1
                elif diff == -1:
                    results["chromatic_above"] += 1
                elif diff == 2:
                    results["diatonic_below"] += 1
                elif diff == -2:
                    results["diatonic_above"] += 1

        # Check 2-note enclosure (non-CT, non-CT, CT)
        if i >= 2:
            p2 = notes[i - 2]
            p1 = notes[i - 1]
            if (p2["root_pc"] is not None and p1["root_pc"] is not None
                    and not is_ct(p2["pitch"], p2["root_pc"], p2["quality"])
                    and not is_ct(p1["pitch"], p1["root_pc"], p1["quality"])):
                d1 = target - p2["pitch"]
                d2 = target - p1["pitch"]
                if abs(d1) <= 3 and abs(d2) <= 3:
                    if (d1 > 0 and d2 < 0):
                        results["enclosure_below_above"] += 1
                    elif (d1 < 0 and d2 > 0):
                        results["enclosure_above_below"] += 1

        # Check 3-note Parker enclosure (non-CT, non-CT, non-CT, CT)
        if i >= 3:
            p3 = notes[i - 3]
            p2 = notes[i - 2]
            p1 = notes[i - 1]
            if (all(n_["root_pc"] is not None for n_ in [p3, p2, p1])
                    and not is_ct(p3["pitch"], p3["root_pc"], p3["quality"])
                    and not is_ct(p2["pitch"], p2["root_pc"], p2["quality"])
                    and not is_ct(p1["pitch"], p1["root_pc"], p1["quality"])):
                diffs = [target - p3["pitch"], target - p2["pitch"], target - p1["pitch"]]
                if all(abs(d) <= 4 for d in diffs):
                    # Check alternating direction (classic Parker enclosure)
                    dirs = [1 if d > 0 else -1 if d < 0 else 0 for d in diffs]
                    if dirs[0] != dirs[1] or dirs[1] != dirs[2]:
                        results["parker_enclosure"] += 1

        # Check b9 arpeggio approach to root (dom7 only)
        if i >= 4 and ni["quality"] == "dom7":
            root_interval = (target - ni["root_pc"]) % 12
            if root_interval == 0:  # Target is root
                prev4 = [notes[i - j] for j in range(4, 0, -1)]
                if all(p["root_pc"] is not None for p in prev4):
                    # b9 arp: b9(1), 3(4), 5(7), b7(10) approaching root
                    prev_intervals = [(p["pitch"] - ni["root_pc"]) % 12 for p in prev4]
                    # Check if it's a diminished pattern
                    dim_set = {1, 4, 7, 10}  # vii°7 of dom chord
                    if set(prev_intervals) == dim_set:
                        results["b9_arpeggio"] += 1

    return dict(results)


# ---------------------------------------------------------------------------
# Phrase-level analysis
# ---------------------------------------------------------------------------

def analyze_phrases(notes_by_solo):
    """Analyze phrase-level characteristics from WJD phrase boundaries.

    Args:
        notes_by_solo: list of (solo_notes_list) — each solo's notes separately
    """
    # Collect phrases across all solos with unique keys
    phrases = {}
    phrase_counter = 0
    for solo_notes in notes_by_solo:
        current_phrases = defaultdict(list)
        for n in solo_notes:
            if n["phrase_id"] is not None:
                current_phrases[n["phrase_id"]].append(n)
        for pid, pnotes in current_phrases.items():
            phrases[phrase_counter] = pnotes
            phrase_counter += 1

    if not phrases:
        return None

    lengths = []
    contours = Counter()
    start_intervals = Counter()  # interval of first two notes
    end_intervals = Counter()    # interval of last two notes
    start_beat_positions = Counter()
    end_beat_positions = Counter()
    start_ct_count = 0
    end_ct_count = 0
    total_phrases = 0

    for pid, phrase_notes in sorted(phrases.items()):
        if len(phrase_notes) < 3:
            continue
        total_phrases += 1
        lengths.append(len(phrase_notes))

        # Contour: overall direction
        first_pitch = phrase_notes[0]["pitch"]
        last_pitch = phrase_notes[-1]["pitch"]
        mid_pitch = phrase_notes[len(phrase_notes) // 2]["pitch"]

        if last_pitch > first_pitch + 2:
            contours["ascending"] += 1
        elif last_pitch < first_pitch - 2:
            contours["descending"] += 1
        else:
            contours["level"] += 1

        # Arch detection
        if mid_pitch > max(first_pitch, last_pitch) + 2:
            contours["arch"] += 1
        elif mid_pitch < min(first_pitch, last_pitch) - 2:
            contours["inverse_arch"] += 1

        # Start/end characteristics
        start_beat_positions[phrase_notes[0]["beat"]] += 1
        end_beat_positions[phrase_notes[-1]["beat"]] += 1

        if len(phrase_notes) >= 2:
            start_int = phrase_notes[1]["pitch"] - phrase_notes[0]["pitch"]
            start_intervals[start_int] += 1
            end_int = phrase_notes[-1]["pitch"] - phrase_notes[-2]["pitch"]
            end_intervals[end_int] += 1

        # Start/end on chord tone?
        n0 = phrase_notes[0]
        if n0["root_pc"] is not None and is_ct(n0["pitch"], n0["root_pc"], n0["quality"]):
            start_ct_count += 1
        nl = phrase_notes[-1]
        if nl["root_pc"] is not None and is_ct(nl["pitch"], nl["root_pc"], nl["quality"]):
            end_ct_count += 1

    if total_phrases == 0:
        return None

    return {
        "total_phrases": total_phrases,
        "length": {
            "mean": round(sum(lengths) / len(lengths), 1),
            "median": sorted(lengths)[len(lengths) // 2],
            "min": min(lengths),
            "max": max(lengths),
            "distribution": {
                "short_3_8": sum(1 for l in lengths if l <= 8),
                "medium_9_16": sum(1 for l in lengths if 9 <= l <= 16),
                "long_17_plus": sum(1 for l in lengths if l >= 17),
            },
        },
        "contour": {
            k: round(v / total_phrases * 100, 1) for k, v in contours.items()
        },
        "start_beat": {
            str(k): round(v / total_phrases * 100, 1)
            for k, v in sorted(start_beat_positions.items())
        },
        "end_beat": {
            str(k): round(v / total_phrases * 100, 1)
            for k, v in sorted(end_beat_positions.items())
        },
        "start_on_ct_pct": round(start_ct_count / total_phrases * 100, 1),
        "end_on_ct_pct": round(end_ct_count / total_phrases * 100, 1),
        "start_interval_top5": [
            {"interval": k, "pct": round(v / total_phrases * 100, 1)}
            for k, v in sorted(start_intervals.items(), key=lambda x: -x[1])[:5]
        ],
    }


# ---------------------------------------------------------------------------
# Bebop-specific idiom detection
# ---------------------------------------------------------------------------

def detect_bebop_idioms(notes):
    """Detect bebop-specific idioms: bebop scale runs, guide tone targeting, ii-V patterns."""
    results = {
        "bebop_scale_passages": 0,   # nat7 passing tone on weak beat over dom7
        "guide_tone_resolutions": Counter(),  # 7th→3rd resolution types
        "chromatic_runs": 0,         # 3+ consecutive chromatic notes
        "octave_displacement": 0,    # ≥10 semitone leap followed by stepwise
    }

    for i in range(1, len(notes)):
        ni = notes[i]
        np = notes[i - 1]

        # Bebop scale passage: nat7 on weak beat over dom7
        if (ni["quality"] == "dom7" and ni["root_pc"] is not None
                and ni["beat"] in (2, 4)
                and (ni["pitch"] - ni["root_pc"]) % 12 == 11):
            results["bebop_scale_passages"] += 1

        # Octave displacement
        if i >= 2:
            diff1 = abs(ni["pitch"] - np["pitch"])
            diff2 = abs(np["pitch"] - notes[i - 2]["pitch"])
            if diff1 >= 10 and diff2 <= 2:
                results["octave_displacement"] += 1
            elif diff2 >= 10 and diff1 <= 2:
                results["octave_displacement"] += 1

    # Chromatic runs (3+ consecutive semitone movement)
    run_len = 1
    for i in range(1, len(notes)):
        diff = abs(notes[i]["pitch"] - notes[i - 1]["pitch"])
        if diff == 1:
            run_len += 1
        else:
            if run_len >= 3:
                results["chromatic_runs"] += 1
            run_len = 1
    if run_len >= 3:
        results["chromatic_runs"] += 1

    # Convert Counter
    results["guide_tone_resolutions"] = dict(results["guide_tone_resolutions"])

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(str(DB_PATH))
    solos_by_style = load_solos_by_style(conn)

    print("Styles available:", {s: len(v) for s, v in solos_by_style.items()})

    # Load all notes for each style
    all_notes = {}  # style -> flat list of note dicts
    all_solos_by_style = {}  # style -> list of solo note lists (for phrase analysis)
    performer_notes = defaultdict(list)  # performer -> flat notes (bebop only)
    performer_solos = defaultdict(list)  # performer -> list of solo note lists

    for style in ["BEBOP", "HARDBOP", "COOL", "SWING", "POSTBOP"]:
        style_solos_data = solos_by_style.get(style, [])
        style_notes = []
        style_solo_lists = []
        for melid, perf, title, tempo in style_solos_data:
            notes = load_notes_with_chords(conn, melid)
            style_notes.extend(notes)
            style_solo_lists.append(notes)
            if style == "BEBOP":
                performer_notes[perf].extend(notes)
                performer_solos[perf].append(notes)
            print(f"  [{style}] {perf}: {title} ({len(notes)} notes)")
        all_notes[style] = style_notes
        all_solos_by_style[style] = style_solo_lists

    conn.close()

    bebop_notes = all_notes.get("BEBOP", [])
    parker_notes = performer_notes.get("Charlie Parker", [])
    parker_solo_lists = performer_solos.get("Charlie Parker", [])
    non_parker_bebop = [n for perf, ns in performer_notes.items()
                        if perf != "Charlie Parker" for n in ns]

    print(f"\nBebop total: {len(bebop_notes)} notes")
    print(f"Parker: {len(parker_notes)} notes")
    print(f"Non-Parker bebop: {len(non_parker_bebop)} notes")

    # ========== Scale Detection ==========
    print("\n=== Scale Detection ===")
    bebop_scales = detect_scales(bebop_notes)
    parker_scales = detect_scales(parker_notes)

    for q in ["dom7", "min7", "maj7", "min7b5"]:
        if q in parker_scales:
            print(f"\n  Parker {q} (n={parker_scales[q]['sample_size']}):")
            for sm in parker_scales[q]["scale_matches"][:5]:
                print(f"    {sm['scale']:18s} coverage={sm['coverage']:5.1f}%  "
                      f"completeness={sm['completeness']:5.1f}%  score={sm['score']:.1f}")

    # ========== Detailed Approach Patterns ==========
    print("\n=== Detailed Approach Patterns ===")
    parker_approaches = detect_detailed_approaches(parker_notes)
    bebop_approaches = detect_detailed_approaches(bebop_notes)
    total_pa = sum(parker_approaches.values()) or 1
    total_ba = sum(bebop_approaches.values()) or 1
    print(f"\n  Parker (total={sum(parker_approaches.values())}):")
    for k, v in sorted(parker_approaches.items(), key=lambda x: -x[1]):
        print(f"    {k:25s} {v:5d} ({v / total_pa * 100:.1f}%)")
    print(f"\n  All Bebop (total={sum(bebop_approaches.values())}):")
    for k, v in sorted(bebop_approaches.items(), key=lambda x: -x[1]):
        print(f"    {k:25s} {v:5d} ({v / total_ba * 100:.1f}%)")

    # Per quality
    parker_approaches_by_q = {}
    for q in ["dom7", "min7", "maj7"]:
        q_notes = [n for n in parker_notes if n["quality"] == q]
        if len(q_notes) > 100:
            parker_approaches_by_q[q] = detect_detailed_approaches(q_notes)

    # ========== Phrase Analysis ==========
    print("\n=== Phrase Analysis ===")
    parker_phrases = analyze_phrases(parker_solo_lists)
    bebop_phrases = analyze_phrases(all_solos_by_style.get("BEBOP", []))

    for label, stats in [("Parker", parker_phrases), ("All Bebop", bebop_phrases)]:
        if not stats:
            continue
        print(f"\n  {label} ({stats['total_phrases']} phrases):")
        l = stats["length"]
        print(f"    Length: mean={l['mean']}, median={l['median']}, "
              f"min={l['min']}, max={l['max']}")
        print(f"    Short/Med/Long: {l['distribution']}")
        print(f"    Contour: {stats['contour']}")
        print(f"    Start on CT: {stats['start_on_ct_pct']}%  End on CT: {stats['end_on_ct_pct']}%")
        print(f"    Start beat: {stats['start_beat']}")

    # ========== Bebop Idioms ==========
    print("\n=== Bebop Idioms ===")
    parker_idioms = detect_bebop_idioms(parker_notes)
    bebop_idioms = detect_bebop_idioms(bebop_notes)
    print(f"  Parker: bebop_scale_passages={parker_idioms['bebop_scale_passages']}, "
          f"chromatic_runs={parker_idioms['chromatic_runs']}, "
          f"octave_displacement={parker_idioms['octave_displacement']}")
    print(f"  All Bebop: bebop_scale_passages={bebop_idioms['bebop_scale_passages']}, "
          f"chromatic_runs={bebop_idioms['chromatic_runs']}, "
          f"octave_displacement={bebop_idioms['octave_displacement']}")

    # Normalize per 100 notes
    pn = len(parker_notes) / 100
    bn = len(bebop_notes) / 100
    print(f"\n  Per 100 notes:")
    print(f"    Parker:    bebop_scale={parker_idioms['bebop_scale_passages']/pn:.1f}  "
          f"chrom_runs={parker_idioms['chromatic_runs']/pn:.1f}  "
          f"oct_disp={parker_idioms['octave_displacement']/pn:.1f}")
    print(f"    All Bebop: bebop_scale={bebop_idioms['bebop_scale_passages']/bn:.1f}  "
          f"chrom_runs={bebop_idioms['chromatic_runs']/bn:.1f}  "
          f"oct_disp={bebop_idioms['octave_displacement']/bn:.1f}")

    # ========== Style Contrast ==========
    print("\n=== Style Contrast (Scale Usage over dom7) ===")
    for style in ["BEBOP", "HARDBOP", "COOL", "SWING", "POSTBOP"]:
        sn = all_notes.get(style, [])
        if not sn:
            continue
        sc = detect_scales(sn, "dom7")
        if "dom7" in sc:
            top3 = sc["dom7"]["scale_matches"][:3]
            names = ", ".join(f"{s['scale']}({s['coverage']:.0f}%)" for s in top3)
            print(f"  {style:10s} (n={sc['dom7']['sample_size']:5d}): {names}")

    # ========== Build output ==========
    output = {
        "metadata": {
            "source": "WJazzD v2.1 deep analysis",
            "date": str(date.today()),
            "bebop_notes": len(bebop_notes),
            "parker_notes": len(parker_notes),
            "styles_analyzed": ["BEBOP", "HARDBOP", "COOL", "SWING", "POSTBOP"],
        },
        "scale_detection": {
            "parker": parker_scales,
            "bebop": bebop_scales,
            "by_style": {},
        },
        "approach_patterns_detailed": {
            "parker": parker_approaches,
            "parker_by_quality": parker_approaches_by_q,
            "bebop": bebop_approaches,
        },
        "phrase_analysis": {
            "parker": parker_phrases,
            "bebop": bebop_phrases,
        },
        "bebop_idioms": {
            "parker": parker_idioms,
            "parker_per_100": {
                k: round(v / pn, 2) if isinstance(v, (int, float)) else v
                for k, v in parker_idioms.items()
            },
            "bebop": bebop_idioms,
            "bebop_per_100": {
                k: round(v / bn, 2) if isinstance(v, (int, float)) else v
                for k, v in bebop_idioms.items()
            },
        },
        "style_contrast": {},
    }

    # Style contrast scales
    for style in ["BEBOP", "HARDBOP", "COOL", "SWING", "POSTBOP"]:
        sn = all_notes.get(style, [])
        if sn:
            output["style_contrast"][style] = {
                "total_notes": len(sn),
                "scales_dom7": detect_scales(sn, "dom7").get("dom7"),
                "scales_min7": detect_scales(sn, "min7").get("min7"),
            }

    # Bebop performer scale profiles
    output["bebop_performer_scales"] = {}
    for perf, notes in sorted(performer_notes.items()):
        if len(notes) >= 200:
            scales = detect_scales(notes)
            output["bebop_performer_scales"][perf] = {
                q: {
                    "top_scales": [s["scale"] for s in data["scale_matches"][:3]],
                    "top_scores": [s["score"] for s in data["scale_matches"][:3]],
                }
                for q, data in scales.items()
            }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "bebop_deep_profiles.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nOutput written to {out_path}")


if __name__ == "__main__":
    main()
