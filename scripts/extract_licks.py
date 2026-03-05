"""Extract melodic licks from WJD SQLite + Omnibook MusicXML.

Segments solos at chord boundaries, extracts 3-16 note sliding windows,
normalises to interval-from-root, quantises rhythm, and deduplicates.

Output: public/data/lick_library.json  (served as static asset)
Report: scripts/output/lick_report.txt (quality/count summary)
"""

import glob
import json
import re
import sqlite3
import warnings
from collections import Counter, defaultdict
from hashlib import md5
from pathlib import Path

warnings.filterwarnings("ignore")

# Paths
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "data"
OMNIBOOK_DIR = DATA_DIR / "omnibook"
DB_PATH = DATA_DIR / "wjazzd.db"
OUTPUT_DIR = SCRIPT_DIR / "output"
PUBLIC_DIR = SCRIPT_DIR.parent / "public" / "data"

# ---------------------------------------------------------------------------
# Rhythm quantisation
# ---------------------------------------------------------------------------

def quantise_rhythm(quarter_length: float) -> str:
    """Map music21 quarterLength to rhythm type."""
    if quarter_length >= 0.875:
        return 'q'  # quarter note
    if quarter_length >= 0.417:
        return 'e'  # eighth note
    if quarter_length >= 0.292:
        return 't'  # triplet
    return 's'      # sixteenth

def rhythm_beats(r: str) -> float:
    """Duration in beats for a rhythm type."""
    return {'q': 1.0, 't': 2/3, 'e': 0.5, 's': 0.25}[r]

# ---------------------------------------------------------------------------
# Chord quality classification (shared)
# ---------------------------------------------------------------------------

def classify_quality_omnibook(figure: str, kind: str) -> str:
    fig_lower = figure.lower()
    if "dim" in fig_lower or "o" in fig_lower:
        if "7" in fig_lower:
            return "dim7"
        return "dim7"
    if kind == "dominant-seventh":
        return "dom7"
    if kind == "minor" or "minor" in kind:
        if "half" in kind:
            return "min7b5"
        return "min7"
    if kind == "major" or "major" in kind:
        return "maj7"
    return "dom7"  # default for jazz

def classify_quality_wjd(symbol: str) -> str | None:
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
        return "dim7"
    if "m7b5" in suffix or "\u00f8" in suffix:
        return "min7b5"
    if re.match(r'^[-m](7|9|11|13|6)', suffix) or suffix in ("-7", "m7", "-", "m"):
        return "min7"
    if suffix.startswith("j7") or suffix.startswith("maj7") or suffix in ("6", "69"):
        return "maj7"
    if re.match(r'^[\+]?7', suffix) or suffix == "" or suffix.startswith("sus"):
        return "dom7"
    return "dom7"

def parse_root_pc(symbol: str) -> int | None:
    if not symbol or symbol == "NC":
        return None
    s = symbol.split("/")[0] if "/" in symbol else symbol
    m = re.match(r'^([A-G])([b#]?)', s)
    if not m:
        return None
    note_map = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    pc = note_map.get(m.group(1), 0)
    if m.group(2) == '#':
        pc = (pc + 1) % 12
    elif m.group(2) == 'b':
        pc = (pc - 1) % 12
    return pc

# ---------------------------------------------------------------------------
# Lick extraction from a segment
# ---------------------------------------------------------------------------

def extract_licks_from_segment(notes, root_pc, quality, source, min_len=3, max_len=16):
    """Extract lick candidates from a list of (midi_pitch, rhythm_type) tuples."""
    if len(notes) < min_len:
        return []

    licks = []
    for start in range(len(notes)):
        for end in range(start + min_len, min(start + max_len + 1, len(notes) + 1)):
            window = notes[start:end]
            pitches = [n[0] for n in window]
            rhythms = [n[1] for n in window]

            # Filter: range >= 2 semitones
            pitch_range = max(pitches) - min(pitches)
            if pitch_range < 2:
                continue

            # Filter: no more than 50% repeated notes
            pitch_counts = Counter(pitches)
            max_repeat = max(pitch_counts.values())
            if max_repeat / len(pitches) > 0.5:
                continue

            # Filter: max interval between consecutive notes <= 12 semitones
            intervals = []
            max_interval = 0
            for i in range(1, len(pitches)):
                iv = pitches[i] - pitches[i-1]
                intervals.append(iv)
                max_interval = max(max_interval, abs(iv))
            if max_interval > 12:
                continue

            # Normalise to interval-from-root (0-11)
            steps = [(p - root_pc) % 12 for p in pitches]

            # Direction
            if all(iv >= 0 for iv in intervals):
                direction = 'asc'
            elif all(iv <= 0 for iv in intervals):
                direction = 'desc'
            else:
                direction = 'mixed'

            # Duration in beats
            dur_beats = sum(rhythm_beats(r) for r in rhythms)

            # Dedup key: steps + rhythm tuple
            dedup_key = str((tuple(steps), tuple(rhythms)))
            lick_id = md5(dedup_key.encode()).hexdigest()[:12]

            licks.append({
                'id': lick_id,
                'steps': steps,
                'intervals': intervals,
                'rhythm': rhythms,
                'direction': direction,
                'length': len(pitches),
                'startStep': steps[0],
                'endStep': steps[-1],
                'durationBeats': round(dur_beats, 3),
                'source': source,
                '_dedup_key': dedup_key,
            })

    return licks

# ---------------------------------------------------------------------------
# WJD extraction
# ---------------------------------------------------------------------------

def extract_wjd_licks():
    """Extract licks from WJD SQLite database."""
    if not DB_PATH.exists():
        print(f"  WJD database not found at {DB_PATH}, skipping.")
        return {}

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # Get bebop solos
    solos = conn.execute("""
        SELECT s.melid, s.title, s.performer, s.style
        FROM solo_info s
        WHERE s.style IN ('BEBOP', 'HARDBOP', 'COOL')
        ORDER BY s.melid
    """).fetchall()

    print(f"  WJD: {len(solos)} solos to process")

    quality_licks = defaultdict(list)
    total_notes = 0

    for solo in solos:
        melid = solo['melid']

        # Get melody notes
        melody = conn.execute("""
            SELECT pitch, onset, duration, bar, beat
            FROM melody
            WHERE melid = ?
            ORDER BY onset
        """, (melid,)).fetchall()

        if not melody:
            continue

        # Get chord changes
        chords = conn.execute("""
            SELECT onset, chord
            FROM beats
            WHERE melid = ? AND chord IS NOT NULL AND chord != ''
            ORDER BY onset
        """, (melid,)).fetchall()

        if not chords:
            continue

        # Build chord timeline: [(onset, symbol, quality, root_pc), ...]
        chord_timeline = []
        for c in chords:
            symbol = c['chord']
            quality = classify_quality_wjd(symbol)
            root_pc = parse_root_pc(symbol)
            if quality and root_pc is not None:
                chord_timeline.append((c['onset'], symbol, quality, root_pc))

        if not chord_timeline:
            continue

        # Segment melody by chord boundaries
        chord_idx = 0
        segments = defaultdict(list)  # (quality, root_pc) -> [(midi, rhythm), ...]

        for note in melody:
            pitch = note['pitch']
            dur = note['duration']
            onset = note['onset']

            # Advance chord index
            while (chord_idx + 1 < len(chord_timeline) and
                   chord_timeline[chord_idx + 1][0] <= onset):
                chord_idx += 1

            _, _, quality, root_pc = chord_timeline[chord_idx]

            # Quantise rhythm from duration in beats
            rhythm = quantise_rhythm(dur)

            # Key for this chord segment
            seg_key = (quality, root_pc, chord_idx)
            segments[seg_key].append((pitch, rhythm))
            total_notes += 1

        # Extract licks from each segment
        for (quality, root_pc, _), seg_notes in segments.items():
            licks = extract_licks_from_segment(seg_notes, root_pc, quality, 'wjd')
            quality_licks[quality].extend(licks)

    conn.close()
    print(f"  WJD: {total_notes} notes processed")
    return dict(quality_licks)

# ---------------------------------------------------------------------------
# Omnibook extraction
# ---------------------------------------------------------------------------

def extract_omnibook_licks():
    """Extract licks from Parker Omnibook MusicXML files."""
    xml_files = sorted(glob.glob(str(OMNIBOOK_DIR / "*.xml"))) + \
                sorted(glob.glob(str(OMNIBOOK_DIR / "*.mxl")))

    if not xml_files:
        print(f"  No Omnibook files found in {OMNIBOOK_DIR}, skipping.")
        return {}

    import music21

    print(f"  Omnibook: {len(xml_files)} files to process")

    quality_licks = defaultdict(list)
    total_notes = 0

    for xml_path in xml_files:
        try:
            score = music21.converter.parse(xml_path)
        except Exception as e:
            print(f"    Error parsing {Path(xml_path).name}: {e}")
            continue

        parts = score.parts
        if not parts:
            continue
        melody_part = parts[0]

        # Get chord symbols
        chord_symbols = list(score.recurse().getElementsByClass('ChordSymbol'))
        if not chord_symbols:
            # Try harmony elements
            chord_symbols = list(score.recurse().getElementsByClass('Harmony'))

        # Build chord timeline
        chord_timeline = []
        for cs in chord_symbols:
            try:
                figure = cs.figure if hasattr(cs, 'figure') else str(cs)
                kind = cs.chordKind if hasattr(cs, 'chordKind') else ''
                root_pc = cs.root().pitchClass if hasattr(cs, 'root') else None
                if root_pc is None:
                    continue
                quality = classify_quality_omnibook(figure, kind)
                chord_timeline.append((cs.offset, figure, quality, root_pc))
            except Exception:
                continue

        if not chord_timeline:
            continue

        # Get melody notes
        notes_iter = melody_part.recurse().notes

        chord_idx = 0
        segments = defaultdict(list)

        for note in notes_iter:
            if note.isRest:
                continue
            if hasattr(note, 'isChord') and note.isChord:
                # Use highest pitch of chord
                pitch = max(note.pitches, key=lambda p: p.midi)
            else:
                pitch = note.pitch

            onset = note.offset
            dur = note.quarterLength

            # Advance chord index
            while (chord_idx + 1 < len(chord_timeline) and
                   chord_timeline[chord_idx + 1][0] <= onset):
                chord_idx += 1

            _, _, quality, root_pc = chord_timeline[chord_idx]
            rhythm = quantise_rhythm(dur)

            seg_key = (quality, root_pc, chord_idx)
            segments[seg_key].append((pitch.midi, rhythm))
            total_notes += 1

        for (quality, root_pc, _), seg_notes in segments.items():
            licks = extract_licks_from_segment(seg_notes, root_pc, quality, 'omnibook')
            quality_licks[quality].extend(licks)

    print(f"  Omnibook: {total_notes} notes processed")
    return dict(quality_licks)

# ---------------------------------------------------------------------------
# Deduplication and output
# ---------------------------------------------------------------------------

def deduplicate(lick_list, max_per_quality=5000):
    """Deduplicate licks by (steps, rhythm) tuple, then sample top licks.

    Prioritises shorter licks (3-6 notes) and mixed rhythm variety.
    """
    seen = set()
    unique = []
    for lick in lick_list:
        key = lick.pop('_dedup_key', str((tuple(lick['steps']), tuple(lick['rhythm']))))
        if key not in seen:
            seen.add(key)
            unique.append(lick)

    if len(unique) <= max_per_quality:
        return unique

    # Score licks for selection: prefer shorter, varied rhythm, moderate range
    import random
    random.seed(42)

    def lick_score(l):
        score = 0
        # Prefer 3-8 note licks (most useful for phrase generation)
        if 3 <= l['length'] <= 6:
            score += 10
        elif l['length'] <= 8:
            score += 5
        # Prefer mixed rhythm
        rhythm_set = set(l['rhythm'])
        score += len(rhythm_set) * 3
        # Slight preference for omnibook (Parker)
        if l['source'] == 'omnibook':
            score += 2
        return score + random.random()  # tie-breaking

    unique.sort(key=lick_score, reverse=True)
    return unique[:max_per_quality]

def main():
    print("Extracting licks from transcription data...")
    print()

    # Extract from both sources
    wjd_licks = extract_wjd_licks()
    print()
    omnibook_licks = extract_omnibook_licks()
    print()

    # Merge by quality
    all_qualities = set(list(wjd_licks.keys()) + list(omnibook_licks.keys()))
    merged = {}
    report_lines = ["Lick Library Extraction Report", "=" * 40, ""]

    total_before = 0
    total_after = 0

    for quality in sorted(all_qualities):
        combined = wjd_licks.get(quality, []) + omnibook_licks.get(quality, [])
        total_before += len(combined)
        unique = deduplicate(combined)
        total_after += len(unique)
        merged[quality] = unique

        wjd_count = sum(1 for l in unique if l['source'] == 'wjd')
        ob_count = sum(1 for l in unique if l['source'] == 'omnibook')
        line = f"  {quality:10s}: {len(unique):6d} licks (WJD: {wjd_count}, Omnibook: {ob_count})"
        print(line)
        report_lines.append(line)

        # Length distribution
        lengths = Counter(l['length'] for l in unique)
        len_str = ", ".join(f"{k}n:{v}" for k, v in sorted(lengths.items()))
        report_lines.append(f"    lengths: {len_str}")

        # Rhythm distribution
        all_rhythms = Counter()
        for l in unique:
            all_rhythms.update(l['rhythm'])
        rhy_str = ", ".join(f"{k}:{v}" for k, v in sorted(all_rhythms.items()))
        report_lines.append(f"    rhythms: {rhy_str}")

    print()
    print(f"Total before dedup: {total_before}")
    print(f"Total after dedup:  {total_after}")
    report_lines.extend(["", f"Total before dedup: {total_before}", f"Total after dedup:  {total_after}"])

    # Output
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_path = PUBLIC_DIR / "lick_library.json"
    with open(output_path, 'w') as f:
        json.dump(merged, f, separators=(',', ':'))
    print(f"\nWrote {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")

    report_path = OUTPUT_DIR / "lick_report.txt"
    with open(report_path, 'w') as f:
        f.write("\n".join(report_lines))
    print(f"Wrote {report_path}")

if __name__ == '__main__':
    main()
