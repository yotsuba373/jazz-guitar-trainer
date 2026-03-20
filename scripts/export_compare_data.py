#!/usr/bin/env python3
"""Export iReal Pro stats and timelines as JSON for TS comparison script."""

import sys, json, numpy as np
sys.path.insert(0, 'scripts')
from parse_bass_phrases import *
from pathlib import Path
from collections import Counter

songs = ['Autumn Leaves', 'Blues For Alice', 'All The Things You Are',
         'Confirmation', "It's All Right With Me"]

# --- Export timelines ---
timelines = {}
for song in songs:
    measures = parse_musicxml(Path(f'scripts/output/ireal/{song}.musicxml'))
    expanded = expand_form(measures)
    timeline = build_chord_timeline(expanded)
    spans = []
    for span in timeline:
        cb = round(span.beats)
        if cb < 2:
            continue
        spans.append({
            'rootSemi': span.root_pc,
            'quality': span.quality,
            'beats': cb,
            'bassSemi': span.bass_pc if span.bass_pc is not None and span.bass_pc != span.root_pc else None,
        })
    timelines[song] = spans

with open('scripts/compare_timelines.json', 'w') as f:
    json.dump(timelines, f)
print(f'Exported timelines: {sum(len(v) for v in timelines.values())} chords across {len(timelines)} songs')

# --- Export iReal Pro stats ---
ir_intervals = []
ir_beat1_midi = []
ir_beat1_root = Counter()
ir_approach = Counter()
ir_contour = Counter()

for song in songs:
    measures = parse_musicxml(Path(f'scripts/output/ireal/{song}.musicxml'))
    expanded = expand_form(measures)
    timeline = build_chord_timeline(expanded)
    chorus_beats = sum(m.beats for m in expanded)
    midi_notes, bpm = parse_midi_bass(Path(f'scripts/output/ireal/{song}.mid'))
    total_midi_beats = max(n.beat + n.duration for n in midi_notes)
    num_choruses = round(total_midi_beats / chorus_beats)

    for ci in range(num_choruses):
        chorus_offset = ci * chorus_beats
        prev_last_midi = None
        for si, span in enumerate(timeline):
            abs_start = chorus_offset + span.start_beat
            abs_end = chorus_offset + span.end_beat
            cb = round(span.beats)
            if cb < 2:
                continue
            ref_pc = span.bass_pc if span.bass_pc is not None else span.root_pc

            notes = []
            for n in midi_notes:
                qb = quantize_beat(n.beat)
                if abs_start - 0.05 <= qb < abs_end - 0.05:
                    notes.append((quantize_beat(qb - abs_start), n.pitch))
            if not notes:
                continue
            notes.sort()

            first_midi = notes[0][1]
            last_midi = notes[-1][1]

            if prev_last_midi is not None:
                ir_intervals.append(abs(first_midi - prev_last_midi))
            prev_last_midi = last_midi

            ir_beat1_midi.append(first_midi)
            first_semi = (first_midi - ref_pc) % 12
            ir_beat1_root['root' if first_semi == 0 else 'non-root'] += 1

            if cb == 4 and len(notes) >= 4:
                pitches = [p for _, p in notes[:4]]
                if pitches[-1] > pitches[0] + 1:
                    ir_contour['asc'] += 1
                elif pitches[-1] < pitches[0] - 1:
                    ir_contour['desc'] += 1
                else:
                    ir_contour['static'] += 1

            if cb >= 4 and si + 1 < len(timeline):
                ns = timeline[si + 1]
                nr = ns.bass_pc if ns.bass_pc is not None else ns.root_pc
                d = abs(last_midi % 12 - nr) % 12
                if d > 6:
                    d = 12 - d
                ir_approach[d] += 1

stats = {
    'intervals': ir_intervals,
    'beat1Root': {'root': ir_beat1_root['root'], 'nonRoot': ir_beat1_root['non-root']},
    'beat1Midi': ir_beat1_midi,
    'approach': {int(k): v for k, v in ir_approach.items()},
    'contour': {'asc': ir_contour['asc'], 'desc': ir_contour['desc'], 'static': ir_contour['static']},
}

with open('scripts/compare_ireal_stats.json', 'w') as f:
    json.dump(stats, f)
print(f'Exported iReal stats: {len(ir_intervals)} intervals, {len(ir_beat1_midi)} beat1 notes')
