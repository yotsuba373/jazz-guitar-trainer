#!/usr/bin/env python3
"""
iReal Pro walking bass algorithm analysis.

Goals:
  1. Beat 4 is approach note or chord tone? Correlation with next chord root?
  2. Beat 1-3 pattern: independent of next chord?
  3. Grace notes: when/where? triggered by what?
  4. Octave register: how chosen?
  5. Overall: can we identify the generation rules?

Usage:
    python scripts/analyze_ireal_bass.py
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from parse_bass_phrases import (
    IREAL_DIR,
    BassNoteEvent,
    ChordSpan,
    build_chord_timeline,
    expand_form,
    extract_style,
    parse_midi_bass,
    parse_musicxml,
    quantize_beat,
    QUALITY_CT,
)


LYRICIST_TO_STYLE = {
    "medium swing": "medium-swing",
    "medium up swing": "medium-up-swing",
    "up tempo swing": "up-tempo-swing",
}


@dataclass
class AlignedChord:
    """One chord with its aligned bass notes and context."""
    quality: str
    root_pc: int
    bass_pc: int          # effective root (slash chord aware)
    beats: int
    next_root_pc: Optional[int]
    next_quality: Optional[str]
    prev_last_pitch: Optional[int]
    notes: list[BassNoteEvent]  # sorted by beat
    style: str
    song: str
    chorus: int
    root_midi: int        # detected root MIDI
    is_alt: bool


def align_bass_to_chords(
    midi_notes: list[BassNoteEvent],
    chord_timeline: list[ChordSpan],
    chorus_beats: float,
    song: str,
    style: str,
) -> list[AlignedChord]:
    """Align MIDI bass notes to chord spans across all choruses."""
    total_beats = max(n.beat + n.duration for n in midi_notes)
    num_choruses = round(total_beats / chorus_beats)
    results = []

    prev_last_pitch = None

    for ci in range(num_choruses):
        offset = ci * chorus_beats
        for si, span in enumerate(chord_timeline):
            abs_start = offset + span.start_beat
            abs_end = offset + span.end_beat
            chord_beats = round(span.beats)
            if chord_beats < 2 or chord_beats > 4:
                prev_last_pitch = None
                continue

            ref_pc = span.bass_pc if span.bass_pc is not None else span.root_pc
            default_midi = 36 + ref_pc
            if default_midi > 42:
                default_midi -= 12
            alt_midi = default_midi + 12

            # Collect notes in span
            chord_notes = []
            for n in midi_notes:
                qb = quantize_beat(n.beat)
                if abs_start - 0.05 <= qb < abs_end - 0.05:
                    chord_notes.append(BassNoteEvent(
                        beat=quantize_beat(qb - abs_start),
                        pitch=n.pitch,
                        velocity=n.velocity,
                        duration=quantize_beat(n.duration),
                    ))

            if not chord_notes:
                prev_last_pitch = None
                continue

            chord_notes.sort(key=lambda x: x.beat)

            # Detect root octave from beat 1
            beat1 = next((n for n in chord_notes if abs(n.beat) < 0.1), None)
            is_alt = False
            if beat1 and beat1.pitch % 12 == ref_pc:
                if abs(beat1.pitch - alt_midi) < abs(beat1.pitch - default_midi):
                    is_alt = True
            root_midi = alt_midi if is_alt else default_midi

            # Next chord info
            next_span = chord_timeline[si + 1] if si + 1 < len(chord_timeline) else None
            next_root = None
            next_qual = None
            if next_span:
                next_root = next_span.bass_pc if next_span.bass_pc else next_span.root_pc
                next_qual = next_span.quality

            results.append(AlignedChord(
                quality=span.quality,
                root_pc=span.root_pc,
                bass_pc=ref_pc,
                beats=chord_beats,
                next_root_pc=next_root,
                next_quality=next_qual,
                prev_last_pitch=prev_last_pitch,
                notes=chord_notes,
                style=style,
                song=song,
                chorus=ci,
                root_midi=root_midi,
                is_alt=is_alt,
            ))

            prev_last_pitch = chord_notes[-1].pitch if chord_notes else None

    return results


def pc_distance(a: int, b: int) -> int:
    """Pitch class distance (0-6, folded)."""
    d = abs(a - b) % 12
    return d if d <= 6 else 12 - d


def analyze_beat4_approach(chords: list[AlignedChord]):
    """Analyze beat 4 (last integer beat) note behavior relative to next chord."""
    print("\n" + "=" * 70)
    print("ANALYSIS 1: Beat 4 approach note vs next chord root")
    print("=" * 70)

    by_style: dict[str, dict] = defaultdict(lambda: {
        "approach_dist": Counter(),
        "approach_type": Counter(),
        "beat4_is_ct": 0,
        "beat4_is_approach": 0,
        "total": 0,
        "beat4_to_next_root_intervals": [],
    })

    for ac in chords:
        if ac.beats != 4 or ac.next_root_pc is None:
            continue

        # Find the note on or closest to beat 3 (0-indexed, so beat 4 in music)
        integer_beat_notes = [n for n in ac.notes if n.beat % 1 < 0.05 and n.beat >= 2.5]
        if not integer_beat_notes:
            continue
        last_int_note = integer_beat_notes[-1]
        last_pc = last_int_note.pitch % 12

        s = by_style[ac.style]
        s["total"] += 1

        # Distance to next root
        d = pc_distance(last_pc, ac.next_root_pc)
        s["approach_dist"][d] += 1

        # Signed interval to next root (for direction analysis)
        next_default = 36 + ac.next_root_pc
        if next_default > 42:
            next_default -= 12
        # Find closest next root MIDI
        candidates = [next_default, next_default + 12, next_default - 12]
        closest_next = min(candidates, key=lambda x: abs(x - last_int_note.pitch))
        interval = closest_next - last_int_note.pitch
        s["beat4_to_next_root_intervals"].append(interval)

        # Is it a chord tone of current chord?
        ct_offsets = QUALITY_CT.get(ac.quality, [0, 4, 7, 10])
        note_offset = (last_pc - ac.bass_pc + 12) % 12
        if note_offset in ct_offsets:
            s["beat4_is_ct"] += 1
            ct_idx = ct_offsets.index(note_offset)
            ct_names = ["R", "3rd", "5th", "7th"]
            s["approach_type"][f"CT:{ct_names[ct_idx]}"] += 1
        else:
            s["beat4_is_approach"] += 1
            s["approach_type"][f"chromatic(d{d})"] += 1

    for style in sorted(by_style):
        s = by_style[style]
        if s["total"] == 0:
            continue
        print(f"\n--- {style} ({s['total']} chords) ---")
        print(f"  Beat 4 is chord tone: {s['beat4_is_ct']}/{s['total']} "
              f"({s['beat4_is_ct']/s['total']*100:.1f}%)")
        print(f"  Beat 4 is approach:   {s['beat4_is_approach']}/{s['total']} "
              f"({s['beat4_is_approach']/s['total']*100:.1f}%)")

        print(f"\n  Approach distance to next root:")
        total = sum(s["approach_dist"].values())
        for d in range(7):
            cnt = s["approach_dist"][d]
            print(f"    d{d}: {cnt:4d} ({cnt/total*100:5.1f}%)")

        print(f"\n  Beat 4 note type breakdown:")
        for t, cnt in s["approach_type"].most_common(20):
            print(f"    {t:20s}: {cnt:4d} ({cnt/s['total']*100:5.1f}%)")

        # Interval direction
        intervals = s["beat4_to_next_root_intervals"]
        if intervals:
            below = sum(1 for i in intervals if i < 0)  # beat4 below next root
            above = sum(1 for i in intervals if i > 0)
            unison = sum(1 for i in intervals if i == 0)
            print(f"\n  Beat 4 direction to next root: "
                  f"below={below/len(intervals)*100:.0f}% "
                  f"above={above/len(intervals)*100:.0f}% "
                  f"unison={unison/len(intervals)*100:.0f}%")
            avg_abs = sum(abs(i) for i in intervals) / len(intervals)
            print(f"  Avg absolute interval: {avg_abs:.1f} semitones")


def analyze_grace_notes(chords: list[AlignedChord]):
    """Analyze grace note patterns."""
    print("\n" + "=" * 70)
    print("ANALYSIS 2: Grace note patterns")
    print("=" * 70)

    by_style: dict[str, dict] = defaultdict(lambda: {
        "total_4beat": 0,
        "has_grace": 0,
        "grace_positions": Counter(),
        "grace_intervals": Counter(),  # interval from grace to target
        "grace_target_type": Counter(),  # what note follows the grace
    })

    for ac in chords:
        if ac.beats != 4:
            continue
        s = by_style[ac.style]
        s["total_4beat"] += 1

        fractional = [n for n in ac.notes if n.beat % 1 > 0.05]
        if fractional:
            s["has_grace"] += 1
            for fn in fractional:
                s["grace_positions"][f"{fn.beat:.3f}"] += 1
                # Find the note immediately after
                later = [n for n in ac.notes if n.beat > fn.beat + 0.05]
                if later:
                    target = later[0]
                    interval = target.pitch - fn.pitch
                    s["grace_intervals"][interval] += 1
                    # Classify target
                    target_offset = (target.pitch - ac.root_midi) % 12
                    ct = QUALITY_CT.get(ac.quality, [0, 4, 7, 10])
                    if target_offset in ct:
                        idx = ct.index(target_offset)
                        s["grace_target_type"][["R", "3rd", "5th", "7th"][idx]] += 1
                    else:
                        s["grace_target_type"]["non-CT"] += 1

    for style in sorted(by_style):
        s = by_style[style]
        if s["total_4beat"] == 0:
            continue
        print(f"\n--- {style} ---")
        print(f"  4-beat chords: {s['total_4beat']}")
        print(f"  Has grace: {s['has_grace']} ({s['has_grace']/s['total_4beat']*100:.1f}%)")
        print(f"\n  Grace beat positions:")
        for pos, cnt in s["grace_positions"].most_common(10):
            print(f"    beat {pos}: {cnt}")
        print(f"\n  Grace → target interval (semitones):")
        for iv, cnt in s["grace_intervals"].most_common(10):
            print(f"    {iv:+d}: {cnt}")
        print(f"\n  Grace target note type:")
        for t, cnt in s["grace_target_type"].most_common():
            print(f"    {t}: {cnt}")


def analyze_beat123_patterns(chords: list[AlignedChord]):
    """Analyze beats 1-3 patterns independently from beat 4."""
    print("\n" + "=" * 70)
    print("ANALYSIS 3: Beat 1-3 walking patterns (independent of beat 4)")
    print("=" * 70)

    by_style_quality: dict[str, dict[str, Counter]] = defaultdict(
        lambda: defaultdict(Counter)
    )

    for ac in chords:
        if ac.beats != 4:
            continue

        # Extract integer-beat notes for beats 0-2 only (first 3 beats)
        first3 = []
        for n in ac.notes:
            if n.beat % 1 < 0.05 and n.beat < 2.5:
                offset = (n.pitch - ac.root_midi)
                # Normalize to semitone class (keep octave info as sign)
                pc_offset = offset % 12
                first3.append(pc_offset)

        if len(first3) >= 3:
            ct = QUALITY_CT.get(ac.quality, [0, 4, 7, 10])
            labels = []
            for pc in first3:
                if pc in ct:
                    idx = ct.index(pc)
                    labels.append(["R", "3", "5", "7"][idx])
                else:
                    labels.append(f"{pc}")
            pattern = "-".join(labels)
            by_style_quality[ac.style][ac.quality][pattern] += 1

    for style in sorted(by_style_quality):
        print(f"\n--- {style} ---")
        for quality in sorted(by_style_quality[style]):
            counter = by_style_quality[style][quality]
            total = sum(counter.values())
            print(f"\n  {quality} ({total} total):")
            for pat, cnt in counter.most_common(10):
                print(f"    {pat:20s}: {cnt:4d} ({cnt/total*100:5.1f}%)")


def analyze_voice_leading(chords: list[AlignedChord]):
    """Analyze cross-chord voice leading (last note → first note of next)."""
    print("\n" + "=" * 70)
    print("ANALYSIS 4: Cross-chord voice leading")
    print("=" * 70)

    by_style: dict[str, dict] = defaultdict(lambda: {
        "intervals": [],
        "root_motion_vs_vl": defaultdict(list),  # root motion → VL intervals
    })

    for ac in chords:
        if ac.prev_last_pitch is None or not ac.notes:
            continue
        first_pitch = ac.notes[0].pitch
        vl = abs(first_pitch - ac.prev_last_pitch)
        by_style[ac.style]["intervals"].append(vl)

        # Track by root motion
        # (We don't have prev root easily, but can infer from prev_last_pitch)

    for style in sorted(by_style):
        s = by_style[style]
        if not s["intervals"]:
            continue
        intervals = s["intervals"]
        mean = sum(intervals) / len(intervals)
        step = sum(1 for i in intervals if i <= 2) / len(intervals) * 100
        print(f"\n--- {style} ---")
        print(f"  VL mean: {mean:.1f}, stepwise: {step:.0f}%")
        print(f"  Distribution:")
        counter = Counter(intervals)
        total = len(intervals)
        for i in range(13):
            cnt = counter.get(i, 0)
            bar = "#" * int(cnt / total * 100)
            print(f"    {i:2d}: {cnt:4d} ({cnt/total*100:5.1f}%) {bar}")


def analyze_beat1_register(chords: list[AlignedChord]):
    """Analyze beat 1 register choices."""
    print("\n" + "=" * 70)
    print("ANALYSIS 5: Beat 1 register (root octave) choice")
    print("=" * 70)

    by_style: dict[str, dict] = defaultdict(lambda: {
        "total": 0,
        "is_root": 0,
        "root_midi_hist": Counter(),
        "alt_by_root": defaultdict(lambda: {"alt": 0, "default": 0}),
        "alt_after_high_prev": 0,
        "default_after_high_prev": 0,
        "alt_after_low_prev": 0,
        "default_after_low_prev": 0,
    })

    for ac in chords:
        if not ac.notes or ac.beats < 4:
            continue
        s = by_style[ac.style]
        s["total"] += 1

        first = ac.notes[0]
        if first.pitch % 12 == ac.bass_pc:
            s["is_root"] += 1

        s["root_midi_hist"][first.pitch] += 1

        bucket = "alt" if ac.is_alt else "default"
        s["alt_by_root"][ac.bass_pc][bucket] += 1

        # Correlation with previous note register
        if ac.prev_last_pitch is not None:
            if ac.prev_last_pitch >= 48:  # high register
                if ac.is_alt:
                    s["alt_after_high_prev"] += 1
                else:
                    s["default_after_high_prev"] += 1
            else:
                if ac.is_alt:
                    s["alt_after_low_prev"] += 1
                else:
                    s["default_after_low_prev"] += 1

    for style in sorted(by_style):
        s = by_style[style]
        if s["total"] == 0:
            continue
        print(f"\n--- {style} ({s['total']} chords) ---")
        print(f"  Beat 1 is root: {s['is_root']}/{s['total']} "
              f"({s['is_root']/s['total']*100:.1f}%)")

        print(f"\n  Alt octave by root PC:")
        for pc in range(12):
            data = s["alt_by_root"][pc]
            total = data["alt"] + data["default"]
            if total > 0:
                pct = data["alt"] / total * 100
                names = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
                print(f"    {names[pc]:3s} (pc={pc:2d}): alt={pct:5.1f}% ({data['alt']}/{total})")

        # Prev register correlation
        total_high = s["alt_after_high_prev"] + s["default_after_high_prev"]
        total_low = s["alt_after_low_prev"] + s["default_after_low_prev"]
        if total_high > 0:
            print(f"\n  After high prev (>=48): "
                  f"alt={s['alt_after_high_prev']/total_high*100:.0f}% "
                  f"default={s['default_after_high_prev']/total_high*100:.0f}%")
        if total_low > 0:
            print(f"  After low prev (<48):  "
                  f"alt={s['alt_after_low_prev']/total_low*100:.0f}% "
                  f"default={s['default_after_low_prev']/total_low*100:.0f}%")


def analyze_same_root_variation(chords: list[AlignedChord]):
    """Check if same chord in different contexts gets different patterns."""
    print("\n" + "=" * 70)
    print("ANALYSIS 6: Same chord, different context → different pattern?")
    print("=" * 70)

    by_style: dict[str, dict] = defaultdict(lambda: {
        "same_context_same_pattern": 0,
        "same_context_diff_pattern": 0,
        "diff_context_same_pattern": 0,
        "diff_context_diff_pattern": 0,
    })

    # Group by (style, quality, root_pc, beats)
    groups: dict[tuple, list[AlignedChord]] = defaultdict(list)
    for ac in chords:
        if ac.beats != 4:
            continue
        key = (ac.style, ac.quality, ac.bass_pc, ac.beats)
        groups[key].append(ac)

    for key, acs in groups.items():
        if len(acs) < 2:
            continue
        style = key[0]
        s = by_style[style]

        for i in range(len(acs)):
            for j in range(i + 1, min(i + 5, len(acs))):  # limit comparisons
                ai, aj = acs[i], acs[j]
                # Same context = same next root
                same_ctx = ai.next_root_pc == aj.next_root_pc
                # Same pattern = same pitch class sequence
                pi = tuple(n.pitch % 12 for n in ai.notes if n.beat % 1 < 0.05)
                pj = tuple(n.pitch % 12 for n in aj.notes if n.beat % 1 < 0.05)
                same_pat = pi == pj

                if same_ctx and same_pat:
                    s["same_context_same_pattern"] += 1
                elif same_ctx and not same_pat:
                    s["same_context_diff_pattern"] += 1
                elif not same_ctx and same_pat:
                    s["diff_context_same_pattern"] += 1
                else:
                    s["diff_context_diff_pattern"] += 1

    for style in sorted(by_style):
        s = by_style[style]
        total = sum(s.values())
        if total == 0:
            continue
        print(f"\n--- {style} ---")
        print(f"  Same context, same pattern:  {s['same_context_same_pattern']:5d} "
              f"({s['same_context_same_pattern']/total*100:.1f}%)")
        print(f"  Same context, diff pattern:  {s['same_context_diff_pattern']:5d} "
              f"({s['same_context_diff_pattern']/total*100:.1f}%)")
        print(f"  Diff context, same pattern:  {s['diff_context_same_pattern']:5d} "
              f"({s['diff_context_same_pattern']/total*100:.1f}%)")
        print(f"  Diff context, diff pattern:  {s['diff_context_diff_pattern']:5d} "
              f"({s['diff_context_diff_pattern']/total*100:.1f}%)")


def main():
    print("=" * 70)
    print("iReal Pro Walking Bass Algorithm Analysis")
    print("=" * 70)

    songs = sorted(
        p.stem for p in IREAL_DIR.glob("*.musicxml")
        if (IREAL_DIR / f"{p.stem}.mid").exists()
    )

    all_chords: list[AlignedChord] = []

    for song in songs:
        mxml_path = IREAL_DIR / f"{song}.musicxml"
        midi_path = IREAL_DIR / f"{song}.mid"
        style = extract_style(mxml_path)

        measures, xml_root = parse_musicxml(mxml_path)
        expanded = expand_form(measures, xml_root)
        chord_timeline = build_chord_timeline(expanded)
        chorus_beats = sum(m.beats for m in expanded)

        midi_notes, bpm = parse_midi_bass(midi_path)

        chords = align_bass_to_chords(
            midi_notes, chord_timeline, chorus_beats, song, style
        )
        all_chords.extend(chords)
        print(f"  {song} [{style}]: {len(chords)} aligned chords")

    print(f"\nTotal aligned chords: {len(all_chords)}")

    # Run analyses
    analyze_beat4_approach(all_chords)
    analyze_grace_notes(all_chords)
    analyze_beat123_patterns(all_chords)
    analyze_voice_leading(all_chords)
    analyze_beat1_register(all_chords)
    analyze_same_root_variation(all_chords)


if __name__ == "__main__":
    main()
