"""Extract high-quality melodic licks using LBDM-based phrase segmentation.

Pipeline based on computational musicology research:

Core algorithms (paper-based):
1. LBDM (Cambouropoulos 2001) — phrase boundary detection using pitch, IOI,
   and rest profiles with degree-of-change and proximity rules [high fidelity]
2. MLA (Frieler/Pfleiderer 2016) — lick vs line classification [simplified]
3. DTL (Frieler et al. 2018–) — Levenshtein distance pattern frequency
   scoring [concept + distance metric from DTL; clustering impl is custom]

Supporting components (standard MIR techniques):
4. Chord quality classification — regex parser mapping to 5 qualities
   (cf. Harte et al. MIREX chord vocabulary)
5. Chord boundary splitting — sub-phrase segmentation at chord changes
   (cf. Jazzomat melpat, Frieler 2019 "Constructing Jazz Lines")
6. Rhythm quantization — threshold-based 4-level discretization
   (cf. Adams & Bartsch 2007, Cemgil et al. 2000)
7. Normalization — chordal pitch classes (pitch - root) mod 12
   (= Frieler 2019 definition; interval sequences per DTL standard)
8. Deduplication — exact (steps, rhythm) match + DTL score ranking
   (cf. Smith & Medina 2001, Jazzomat closed/cyclic pattern filtering)

Full provenance documentation: docs/index.html#phrase-lick-library-provenance

Sources: WJD SQLite + Omnibook MusicXML
Output:  public/data/lick_library.json  (same format as v1)
Report:  scripts/output/lick_report_v2.txt
"""

import glob
import json
import re
import sqlite3
import warnings
from collections import Counter, defaultdict
from hashlib import md5
from pathlib import Path
from statistics import median

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "data"
OMNIBOOK_DIR = DATA_DIR / "omnibook"
DB_PATH = DATA_DIR / "wjazzd.db"
OUTPUT_DIR = SCRIPT_DIR / "output"
PUBLIC_DIR = SCRIPT_DIR.parent / "public" / "data"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# LBDM parameters (Cambouropoulos 2001)
# Weights for combining the three profiles (pitch, IOI, rest)
W_PITCH = 0.25
W_IOI = 0.50
W_REST = 0.25
# Boundary selection: local maxima above this fraction of max strength
LBDM_THRESHOLD_RATIO = 0.5
MIN_PHRASE_NOTES = 4
MAX_PHRASE_NOTES = 20

# MLA (Frieler/Pfleiderer 2016) classification thresholds
MLA_LICK_MAX_NOTES = 16       # licks are shorter than lines
MLA_LINE_DOMINANT_RHYTHM = 0.70  # ≥70% same rhythm = line (rhythmically uniform)
MLA_MIN_UNIQUE_RHYTHMS = 2    # licks need rhythmic variety

# DTL pattern frequency — Levenshtein distance threshold for clustering
DTL_LEVENSHTEIN_THRESHOLD = 2
DTL_MULTI_SOLO_BONUS = 15     # bonus for patterns found in multiple solos

# Structural constraints (frontend selectLick() requirements)
MIN_LICK_NOTES = 3
MAX_LICK_NOTES = 20

# ---------------------------------------------------------------------------
# Rhythm quantisation (same as v1 for compatibility)
# ---------------------------------------------------------------------------

def quantise_rhythm(quarter_length: float) -> str:
    if quarter_length >= 0.875:
        return 'q'
    if quarter_length >= 0.417:
        return 'e'
    if quarter_length >= 0.292:
        return 't'
    return 's'

def rhythm_beats(r: str) -> float:
    return {'q': 1.0, 't': 1/3, 'e': 0.5, 's': 0.25}[r]

# ---------------------------------------------------------------------------
# Chord quality classification (reused from v1)
# ---------------------------------------------------------------------------

def classify_quality_omnibook(figure: str, kind: str) -> str:
    fig_lower = figure.lower()
    if "dim" in fig_lower or "o" in fig_lower:
        return "dim7"
    if kind == "dominant-seventh":
        return "dom7"
    if kind == "minor" or "minor" in kind:
        if "half" in kind:
            return "min7b5"
        return "min7"
    if kind == "major" or "major" in kind:
        return "maj7"
    return "dom7"

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
# LBDM — Cambouropoulos (2001) faithful implementation
# ---------------------------------------------------------------------------

def _lbdm_profile(intervals):
    """Compute LBDM boundary strength for a single parametric profile.

    Implements the exact formulas from Cambouropoulos (2001):
    - Degree of change: r(k, k+1) = |x_k - x_{k+1}| / max(|x_k|, |x_{k+1}|)
    - Boundary strength: S_i = x_i * (r(i-1, i) + r(i, i+1))
    """
    n = len(intervals)
    if n == 0:
        return []
    strengths = [0.0] * n
    for i in range(n):
        # Change rule: degree of change on both sides
        r_left = 0.0
        if i > 0:
            denom = max(abs(intervals[i - 1]), abs(intervals[i]))
            if denom > 0:
                r_left = abs(intervals[i] - intervals[i - 1]) / denom
        r_right = 0.0
        if i < n - 1:
            denom = max(abs(intervals[i]), abs(intervals[i + 1]))
            if denom > 0:
                r_right = abs(intervals[i + 1] - intervals[i]) / denom
        # Proximity rule × Change rule
        strengths[i] = abs(intervals[i]) * (r_left + r_right)
    return strengths


def _lbdm_combined(notes):
    """Compute combined LBDM boundary strength profile over 3 parameters.

    Returns list of boundary strengths, one per transition (len = n-1).
    """
    n = len(notes)
    if n < 2:
        return []

    # Compute the 3 interval sequences (one value per consecutive note pair)
    pitch_intervals = [abs(notes[i + 1]['pitch'] - notes[i]['pitch'])
                       for i in range(n - 1)]
    ioi_intervals = [max(notes[i + 1]['onset'] - notes[i]['onset'], 0.001)
                     for i in range(n - 1)]
    rest_intervals = [max(0.0, notes[i + 1]['onset'] -
                          (notes[i]['onset'] + notes[i]['duration']))
                      for i in range(n - 1)]

    # Compute LBDM profiles for each parameter
    s_pitch = _lbdm_profile(pitch_intervals)
    s_ioi = _lbdm_profile(ioi_intervals)
    s_rest = _lbdm_profile(rest_intervals)

    # Weighted combination (Cambouropoulos 2001 default weights)
    combined = [W_PITCH * sp + W_IOI * si + W_REST * sr
                for sp, si, sr in zip(s_pitch, s_ioi, s_rest)]
    return combined


def _pick_boundary_peaks(strengths, threshold_ratio=LBDM_THRESHOLD_RATIO):
    """Select local maxima above threshold as phrase boundaries.

    A point is a local maximum if it is strictly greater than both neighbours.
    Only peaks above threshold_ratio * max(strengths) are selected.
    """
    if not strengths:
        return []
    max_strength = max(strengths)
    if max_strength <= 0:
        return []
    threshold = max_strength * threshold_ratio
    boundaries = []
    for i in range(len(strengths)):
        # Edge handling: first/last can be peaks if higher than their one neighbour
        left_ok = (i == 0) or (strengths[i] > strengths[i - 1])
        right_ok = (i == len(strengths) - 1) or (strengths[i] > strengths[i + 1])
        if left_ok and right_ok and strengths[i] >= threshold:
            boundaries.append(i)
    return boundaries


def detect_phrase_boundaries(notes, beat_dur=0.3):
    """Detect phrase boundaries using LBDM (Cambouropoulos 2001).

    Computes boundary strength from pitch, IOI, and rest profiles,
    then selects local maxima (peaks) above a threshold.

    Args:
        notes: list of dicts with keys: pitch, onset, duration, bar, beat
        beat_dur: average beat duration in seconds (unused — kept for API compat)

    Returns:
        list of (start_idx, end_idx) tuples defining phrase spans
    """
    if len(notes) < MIN_PHRASE_NOTES:
        return []

    n = len(notes)

    # Compute LBDM combined boundary strengths
    strengths = _lbdm_combined(notes)

    # Pick peaks as boundaries
    boundary_indices = _pick_boundary_peaks(strengths)

    # Convert boundary indices to phrase spans
    # boundary at index i means the boundary falls between note i and note i+1
    phrases = []
    start = 0
    for b in boundary_indices:
        end = b + 1  # phrase ends at note b (inclusive), next starts at b+1
        if end - start >= MIN_PHRASE_NOTES:
            phrases.append((start, end))
        start = end
    # Last phrase
    if n - start >= MIN_PHRASE_NOTES:
        phrases.append((start, n))

    return phrases


# ---------------------------------------------------------------------------
# MLA classification (Frieler/Pfleiderer 2016)
# ---------------------------------------------------------------------------

def classify_mla(pitches, rhythms):
    """Classify a phrase as 'lick', 'line', or 'other' per MLA criteria.

    Lick: short, rhythmically varied (the useful category for our library).
    Line: long, rhythmically uniform (scalar runs — less useful as standalone licks).
    """
    n = len(pitches)
    unique_rhythms = len(set(rhythms))
    rhythm_counts = Counter(rhythms)
    dominant_ratio = max(rhythm_counts.values()) / n if n > 0 else 1.0

    if n > MLA_LICK_MAX_NOTES and dominant_ratio >= MLA_LINE_DOMINANT_RHYTHM:
        return 'line'
    if unique_rhythms >= MLA_MIN_UNIQUE_RHYTHMS and n <= MLA_LICK_MAX_NOTES:
        return 'lick'
    if n <= MLA_LICK_MAX_NOTES:
        return 'lick'  # short enough even if rhythmically uniform
    return 'other'


# ---------------------------------------------------------------------------
# DTL-inspired pattern frequency scoring
# ---------------------------------------------------------------------------

def _levenshtein(a, b):
    """Compute Levenshtein distance between two sequences (tuples/lists)."""
    na, nb = len(a), len(b)
    if na > nb:
        a, b = b, a
        na, nb = nb, na
    prev = list(range(na + 1))
    for j in range(1, nb + 1):
        curr = [j] + [0] * na
        for i in range(1, na + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[i] = min(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost)
        prev = curr
    return prev[na]


def compute_pattern_frequency(all_licks):
    """Score licks by how frequently similar interval patterns appear.

    Groups licks into clusters using Levenshtein distance on interval sequences.
    Licks from patterns appearing in multiple solos get a bonus.

    Returns dict: lick_id -> frequency_bonus_score
    """
    # Build (interval_tuple, source, id) for each lick
    entries = []
    for lick in all_licks:
        iv_tuple = tuple(lick['intervals'])
        entries.append((iv_tuple, lick.get('source', ''), lick['id']))

    # For large datasets, use bucketing by length to avoid O(n^2) full comparison
    # Group by interval sequence length (±1)
    by_length = defaultdict(list)
    for idx, (iv, src, lid) in enumerate(entries):
        by_length[len(iv)].append(idx)

    # Build clusters: union-find style via shared membership
    cluster_id = list(range(len(entries)))

    def find(x):
        while cluster_id[x] != x:
            cluster_id[x] = cluster_id[cluster_id[x]]
            x = cluster_id[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            cluster_id[ry] = rx

    # Compare within same-length and adjacent-length buckets
    lengths = sorted(by_length.keys())
    for l_idx, length in enumerate(lengths):
        indices = by_length[length]
        # Same length comparisons
        for i in range(len(indices)):
            for j in range(i + 1, len(indices)):
                a_idx, b_idx = indices[i], indices[j]
                if find(a_idx) == find(b_idx):
                    continue
                dist = _levenshtein(entries[a_idx][0], entries[b_idx][0])
                if dist <= DTL_LEVENSHTEIN_THRESHOLD:
                    union(a_idx, b_idx)
        # Adjacent length comparisons
        if l_idx + 1 < len(lengths) and lengths[l_idx + 1] - length <= DTL_LEVENSHTEIN_THRESHOLD:
            next_indices = by_length[lengths[l_idx + 1]]
            for a_idx in indices:
                for b_idx in next_indices:
                    if find(a_idx) == find(b_idx):
                        continue
                    dist = _levenshtein(entries[a_idx][0], entries[b_idx][0])
                    if dist <= DTL_LEVENSHTEIN_THRESHOLD:
                        union(a_idx, b_idx)

    # Count unique sources per cluster
    cluster_sources = defaultdict(set)
    cluster_members = defaultdict(list)
    for idx in range(len(entries)):
        root = find(idx)
        cluster_sources[root].add(entries[idx][1])  # source
        cluster_members[root].append(idx)

    # Assign frequency bonus
    freq_bonus = {}
    for root, members in cluster_members.items():
        n_sources = len(cluster_sources[root])
        n_members = len(members)
        bonus = 0
        if n_members >= 3:
            bonus += min(n_members, 10)  # up to +10 for frequently occurring
        if n_sources >= 2:
            bonus += DTL_MULTI_SOLO_BONUS  # found across sources
        for idx in members:
            freq_bonus[entries[idx][2]] = bonus  # lick id -> bonus

    return freq_bonus


# ---------------------------------------------------------------------------
# Convert phrase to lick format
# ---------------------------------------------------------------------------

def phrase_to_lick(pitches, rhythms, root_pc, quality, source, solo_id=None):
    """Convert a validated phrase into lick format compatible with frontend."""
    intervals = [pitches[i + 1] - pitches[i] for i in range(len(pitches) - 1)]
    steps = [(p - root_pc) % 12 for p in pitches]
    dur_beats = sum(rhythm_beats(r) for r in rhythms)

    if all(iv >= 0 for iv in intervals):
        direction = 'asc'
    elif all(iv <= 0 for iv in intervals):
        direction = 'desc'
    else:
        direction = 'mixed'

    dedup_key = str((tuple(steps), tuple(rhythms)))
    lick_id = md5(dedup_key.encode()).hexdigest()[:12]

    return {
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
        '_solo_id': solo_id,  # for DTL pattern frequency analysis
    }


# ---------------------------------------------------------------------------
# Split phrases at chord boundaries
# ---------------------------------------------------------------------------

def split_at_chord_boundaries(phrase_notes, chord_timeline):
    """Split a phrase into sub-phrases at chord changes.

    Returns list of (notes_subset, quality, root_pc) tuples.
    """
    if not chord_timeline:
        return []

    segments = []
    current_notes = []
    current_chord_idx = 0

    # Find initial chord for first note
    for i, (onset, _, _, _) in enumerate(chord_timeline):
        if onset <= phrase_notes[0]['onset']:
            current_chord_idx = i

    _, _, current_quality, current_root = chord_timeline[current_chord_idx]

    for note in phrase_notes:
        # Check if chord changed
        new_chord_idx = current_chord_idx
        while (new_chord_idx + 1 < len(chord_timeline) and
               chord_timeline[new_chord_idx + 1][0] <= note['onset']):
            new_chord_idx += 1

        if new_chord_idx != current_chord_idx and current_notes:
            # Chord changed — save current segment
            segments.append((current_notes, current_quality, current_root))
            current_notes = []
            current_chord_idx = new_chord_idx
            _, _, current_quality, current_root = chord_timeline[current_chord_idx]

        current_notes.append(note)

    if current_notes:
        segments.append((current_notes, current_quality, current_root))

    return segments


# ---------------------------------------------------------------------------
# Structural validation (minimal — trust LBDM boundaries)
# ---------------------------------------------------------------------------

def validate_phrase(pitches, rhythms):
    """Check if a phrase meets minimal structural requirements for frontend.

    Only enforces note count and duration constraints needed by selectLick().
    No musical quality filtering — LBDM boundaries produce valid licks.
    """
    n = len(pitches)

    if n < MIN_LICK_NOTES or n > MAX_LICK_NOTES:
        return False, 'length'

    dur_beats = sum(rhythm_beats(r) for r in rhythms)
    if dur_beats < 0.5 or dur_beats > 8.5:
        return False, 'duration'

    return True, None


# ---------------------------------------------------------------------------
# WJD extraction
# ---------------------------------------------------------------------------

def extract_wjd_licks():
    if not DB_PATH.exists():
        print(f"  WJD database not found at {DB_PATH}, skipping.")
        return {}, {}

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    solos = conn.execute("""
        SELECT s.melid, s.title, s.performer, s.style
        FROM solo_info s
        WHERE s.style IN ('BEBOP', 'HARDBOP', 'COOL')
        ORDER BY s.melid
    """).fetchall()

    print(f"  WJD: {len(solos)} solos to process")

    quality_licks = defaultdict(list)
    stats = {
        'solos': len(solos), 'total_notes': 0,
        'phrases_detected': 0, 'phrases_accepted': 0,
        'reject_reasons': Counter(),
    }

    for solo in solos:
        melid = solo['melid']

        melody = conn.execute("""
            SELECT pitch, onset, duration, bar, beat, beatdur
            FROM melody
            WHERE melid = ?
            ORDER BY onset
        """, (melid,)).fetchall()

        if not melody:
            continue

        chords = conn.execute("""
            SELECT onset, chord
            FROM beats
            WHERE melid = ? AND chord IS NOT NULL AND chord != ''
            ORDER BY onset
        """, (melid,)).fetchall()

        if not chords:
            continue

        # Build chord timeline
        chord_timeline = []
        for c in chords:
            symbol = c['chord']
            quality = classify_quality_wjd(symbol)
            root_pc = parse_root_pc(symbol)
            if quality and root_pc is not None:
                chord_timeline.append((c['onset'], symbol, quality, root_pc))

        if not chord_timeline:
            continue

        # Build note list
        notes = []
        for note in melody:
            avg_beatdur = note['beatdur'] if note['beatdur'] and note['beatdur'] > 0 else 0.3
            notes.append({
                'pitch': int(note['pitch']),
                'onset': note['onset'],
                'duration': note['duration'],
                'bar': note['bar'],
                'beat': note['beat'],
                'beatdur': avg_beatdur,
            })
            stats['total_notes'] += 1

        # Compute average beat duration for this solo
        beatdurs = [n['beatdur'] for n in notes if n['beatdur'] > 0]
        avg_beat_dur = median(beatdurs) if beatdurs else 0.3

        # Phase 1: Detect phrase boundaries (LBDM)
        phrase_spans = detect_phrase_boundaries(notes, avg_beat_dur)
        stats['phrases_detected'] += len(phrase_spans)

        # Phase 2: Split at chord boundaries, apply minimal structural filter + MLA
        for start, end in phrase_spans:
            phrase_notes = notes[start:end]
            chord_segments = split_at_chord_boundaries(phrase_notes, chord_timeline)

            for seg_notes, seg_quality, seg_root in chord_segments:
                pitches = [n['pitch'] for n in seg_notes]
                rhythms = [quantise_rhythm(n['duration'] / n['beatdur']) for n in seg_notes]

                valid, reject = validate_phrase(pitches, rhythms)
                if not valid:
                    stats['reject_reasons'][reject] += 1
                    continue

                # MLA filter: skip 'line' (rhythmically uniform scalar runs)
                if classify_mla(pitches, rhythms) == 'line':
                    stats['reject_reasons']['mla_line'] += 1
                    continue

                stats['phrases_accepted'] += 1
                lick = phrase_to_lick(pitches, rhythms, seg_root, seg_quality,
                                     'wjd', solo_id=f'wjd_{melid}')
                quality_licks[seg_quality].append(lick)

    conn.close()
    return dict(quality_licks), stats


# ---------------------------------------------------------------------------
# Omnibook extraction
# ---------------------------------------------------------------------------

def extract_omnibook_licks():
    xml_files = sorted(glob.glob(str(OMNIBOOK_DIR / "*.xml"))) + \
                sorted(glob.glob(str(OMNIBOOK_DIR / "*.mxl")))

    if not xml_files:
        print(f"  No Omnibook files found in {OMNIBOOK_DIR}, skipping.")
        return {}, {}

    import music21

    print(f"  Omnibook: {len(xml_files)} files to process")

    quality_licks = defaultdict(list)
    stats = {
        'solos': len(xml_files), 'total_notes': 0,
        'phrases_detected': 0, 'phrases_accepted': 0,
        'reject_reasons': Counter(),
    }

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

        # Get tempo for beat duration estimation
        tempos = list(score.recurse().getElementsByClass('MetronomeMark'))
        bpm = tempos[0].number if tempos else 160  # default bebop tempo
        beat_dur_sec = 60.0 / bpm

        # Build note list
        notes = []
        for note in melody_part.recurse().notes:
            if note.isRest:
                continue
            if hasattr(note, 'isChord') and note.isChord:
                pitch = max(note.pitches, key=lambda p: p.midi)
            else:
                pitch = note.pitch

            # Estimate beat position (1-based, within bar)
            beat_in_bar = (note.beat if hasattr(note, 'beat') else 1)

            notes.append({
                'pitch': pitch.midi,
                'onset': note.offset * beat_dur_sec,  # convert to seconds
                'duration': note.quarterLength * beat_dur_sec,
                'bar': getattr(note, 'measureNumber', 0) or 0,
                'beat': int(beat_in_bar),
                'beatdur': beat_dur_sec,
                'quarterLength': note.quarterLength,
            })
            stats['total_notes'] += 1

        if not notes:
            continue

        # Phase 1: Detect phrase boundaries (LBDM)
        phrase_spans = detect_phrase_boundaries(notes, beat_dur_sec)
        stats['phrases_detected'] += len(phrase_spans)

        # Phase 2: Split at chord boundaries, apply minimal structural filter + MLA
        for start, end in phrase_spans:
            phrase_notes = notes[start:end]
            chord_segments = split_at_chord_boundaries(phrase_notes, chord_timeline)

            for seg_notes, seg_quality, seg_root in chord_segments:
                pitches = [n['pitch'] for n in seg_notes]
                rhythms = [quantise_rhythm(n.get('quarterLength', n['duration'] / n['beatdur']))
                           for n in seg_notes]

                valid, reject = validate_phrase(pitches, rhythms)
                if not valid:
                    stats['reject_reasons'][reject] += 1
                    continue

                # MLA filter: skip 'line' (rhythmically uniform scalar runs)
                if classify_mla(pitches, rhythms) == 'line':
                    stats['reject_reasons']['mla_line'] += 1
                    continue

                stats['phrases_accepted'] += 1
                ob_solo_id = f'ob_{Path(xml_path).stem}'
                lick = phrase_to_lick(pitches, rhythms, seg_root, seg_quality,
                                     'omnibook', solo_id=ob_solo_id)
                quality_licks[seg_quality].append(lick)

    return dict(quality_licks), stats


# ---------------------------------------------------------------------------
# Deduplication — keep highest-scoring licks
# ---------------------------------------------------------------------------

def deduplicate(lick_list, freq_bonus=None, max_per_quality=8000):
    """Deduplicate by (steps, rhythm). Rank by DTL frequency, omnibook priority.

    No quality scoring — trust LBDM boundaries.
    """
    best = {}  # dedup_key -> (lick, score)
    for lick in lick_list:
        key = lick.pop('_dedup_key', str((tuple(lick['steps']), tuple(lick['rhythm']))))
        lick.pop('_solo_id', None)
        # Score = DTL frequency bonus + omnibook source priority
        score = 0
        if freq_bonus:
            score += freq_bonus.get(lick['id'], 0)
        if lick['source'] == 'omnibook':
            score += 5  # prefer Parker originals on ties
        if key not in best or score > best[key][1]:
            best[key] = (lick, score)

    unique = [lick for lick, _ in best.values()]

    if len(unique) <= max_per_quality:
        return unique

    # Sort by DTL+source score and take top N
    score_map = {id(lick): sc for lick, sc in best.values()}
    unique.sort(key=lambda l: score_map.get(id(l), 0), reverse=True)
    return unique[:max_per_quality]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Lick Extraction v2 — LBDM Phrase Boundary Detection")
    print("=" * 60)
    print()

    # Extract from both sources
    print("[WJD Extraction]")
    wjd_licks, wjd_stats = extract_wjd_licks()
    print(f"  Notes: {wjd_stats.get('total_notes', 0)}")
    print(f"  Phrases detected: {wjd_stats.get('phrases_detected', 0)}")
    print(f"  Phrases accepted: {wjd_stats.get('phrases_accepted', 0)}")
    if wjd_stats.get('reject_reasons'):
        print(f"  Rejections: {dict(wjd_stats['reject_reasons'])}")
    print()

    print("[Omnibook Extraction]")
    omnibook_licks, ob_stats = extract_omnibook_licks()
    print(f"  Notes: {ob_stats.get('total_notes', 0)}")
    print(f"  Phrases detected: {ob_stats.get('phrases_detected', 0)}")
    print(f"  Phrases accepted: {ob_stats.get('phrases_accepted', 0)}")
    if ob_stats.get('reject_reasons'):
        print(f"  Rejections: {dict(ob_stats['reject_reasons'])}")
    print()

    # Merge, DTL frequency scoring, and deduplicate
    print("[DTL Pattern Frequency Analysis]")
    all_qualities = set(list(wjd_licks.keys()) + list(omnibook_licks.keys()))

    # Compute DTL frequency bonus per quality
    freq_bonuses = {}
    for quality in sorted(all_qualities):
        combined = wjd_licks.get(quality, []) + omnibook_licks.get(quality, [])
        if combined:
            fb = compute_pattern_frequency(combined)
            freq_bonuses[quality] = fb
            multi_solo = sum(1 for v in fb.values() if v >= DTL_MULTI_SOLO_BONUS)
            print(f"  {quality}: {len(fb)} patterns scored, {multi_solo} multi-solo clusters")

    print()
    print("[Merge & Deduplicate]")
    merged = {}
    report_lines = [
        "Lick Library v2 — LBDM + MLA + DTL Extraction Report",
        "=" * 50, "",
        "Algorithms:",
        "  LBDM (Cambouropoulos 2001): pitch/IOI/rest boundary detection",
        f"    Weights: pitch={W_PITCH}, IOI={W_IOI}, rest={W_REST}",
        f"    Threshold ratio: {LBDM_THRESHOLD_RATIO}",
        "  MLA (Frieler/Pfleiderer 2016): lick vs line classification",
        "  DTL: Levenshtein-based pattern frequency scoring",
        "",
        f"WJD: {wjd_stats.get('solos', 0)} solos, {wjd_stats.get('total_notes', 0)} notes",
        f"  Phrases detected: {wjd_stats.get('phrases_detected', 0)}",
        f"  Phrases accepted: {wjd_stats.get('phrases_accepted', 0)}",
        f"  Rejections: {dict(wjd_stats.get('reject_reasons', {}))}",
        "",
        f"Omnibook: {ob_stats.get('solos', 0)} solos, {ob_stats.get('total_notes', 0)} notes",
        f"  Phrases detected: {ob_stats.get('phrases_detected', 0)}",
        f"  Phrases accepted: {ob_stats.get('phrases_accepted', 0)}",
        f"  Rejections: {dict(ob_stats.get('reject_reasons', {}))}",
        "", "--- Per Quality ---", "",
    ]

    total_before = 0
    total_after = 0

    for quality in sorted(all_qualities):
        combined = wjd_licks.get(quality, []) + omnibook_licks.get(quality, [])
        total_before += len(combined)
        unique = deduplicate(combined, freq_bonus=freq_bonuses.get(quality))
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

        # Duration distribution
        dur_buckets = Counter()
        for l in unique:
            db = l['durationBeats']
            if db <= 1.5:
                dur_buckets['≤1.5'] += 1
            elif db <= 2.5:
                dur_buckets['1.5-2.5'] += 1
            elif db <= 4.0:
                dur_buckets['2.5-4'] += 1
            else:
                dur_buckets['>4'] += 1
        dur_str = ", ".join(f"{k}:{v}" for k, v in sorted(dur_buckets.items()))
        report_lines.append(f"    durations: {dur_str}")

        # Direction distribution
        dirs = Counter(l['direction'] for l in unique)
        dir_str = ", ".join(f"{k}:{v}" for k, v in sorted(dirs.items()))
        report_lines.append(f"    directions: {dir_str}")

        report_lines.append("")

    print()
    print(f"Total before dedup: {total_before}")
    print(f"Total after dedup:  {total_after}")
    report_lines.extend([
        f"Total before dedup: {total_before}",
        f"Total after dedup:  {total_after}",
    ])

    # Compare with v1
    v1_path = PUBLIC_DIR / "lick_library.json"
    if v1_path.exists():
        with open(v1_path) as f:
            v1_data = json.load(f)
        v1_total = sum(len(v) for v in v1_data.values())
        print(f"\nv1 library had: {v1_total} licks")
        report_lines.append(f"\nv1 library had: {v1_total} licks")

    # Output
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_path = PUBLIC_DIR / "lick_library.json"
    # Backup v1
    if output_path.exists():
        backup_path = PUBLIC_DIR / "lick_library_v1_backup.json"
        if not backup_path.exists():
            import shutil
            shutil.copy2(output_path, backup_path)
            print(f"\nBacked up v1 to {backup_path}")

    with open(output_path, 'w') as f:
        json.dump(merged, f, separators=(',', ':'))
    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"\nWrote {output_path} ({size_mb:.1f} MB)")

    report_path = OUTPUT_DIR / "lick_report_v2.txt"
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(report_lines))
    print(f"Wrote {report_path}")


if __name__ == '__main__':
    main()
