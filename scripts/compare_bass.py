#!/usr/bin/env python3
"""iReal Pro vs Our System: ウォーキングベース包括比較"""

import sys, json, numpy as np
sys.path.insert(0, 'scripts')
from parse_bass_phrases import *
from pathlib import Path
from collections import Counter

with open('public/bass-phrases.generated.json') as f:
    db = json.load(f)

APPROACH_BONUS = {0:0.716, 1:0.570, 2:0.561, 3:0.544, 4:0.583, 5:0.455, 6:0.503}

BASS_ROOT_BASE = 36  # C2
MIDI_LOW = 28
MIDI_HIGH = 60

def root_to_bass_midi(root_semi, prev_last_midi=None):
    """iReal Pro style root placement with context-aware octave selection."""
    midi = BASS_ROOT_BASE + root_semi
    if midi > BASS_ROOT_BASE + 6:
        midi -= 12
    if prev_last_midi is not None:
        candidates = [midi, midi + 12, midi - 12]
        candidates = [c for c in candidates if MIDI_LOW <= c <= MIDI_HIGH]
        if candidates:
            midi = min(candidates, key=lambda c: abs(c - prev_last_midi))
    return midi

songs = ['Autumn Leaves', 'Blues For Alice', 'All The Things You Are',
         'Confirmation', "It's All Right With Me"]

# Collectors
ireal_intervals = []
ireal_beat1 = Counter()
ireal_notecounts = Counter()
ireal_approach = Counter()
ireal_contour = Counter()  # 'ascending' / 'descending' / 'static'
ireal_beat1_octave = []  # MIDI pitch of beat 1

sim_intervals = []
sim_beat1 = Counter()
sim_approach = Counter()

# -------------------------------------------------------
# iReal Pro actual data
# -------------------------------------------------------
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
            chord_beats = round(span.beats)
            if chord_beats < 2:
                continue

            ref_pc = span.bass_pc if span.bass_pc is not None else span.root_pc
            chord_notes = []
            for n in midi_notes:
                qb = quantize_beat(n.beat)
                if abs_start - 0.05 <= qb < abs_end - 0.05:
                    chord_notes.append((quantize_beat(qb - abs_start), n.pitch))

            if not chord_notes:
                continue
            sorted_notes = sorted(chord_notes)
            first_midi = sorted_notes[0][1]
            last_midi = sorted_notes[-1][1]

            # Cross-chord interval
            if prev_last_midi is not None:
                ireal_intervals.append(abs(first_midi - prev_last_midi))
            prev_last_midi = last_midi

            # Beat 1
            first_semi = (first_midi - ref_pc) % 12
            ireal_beat1['root' if first_semi == 0 else 'non-root'] += 1
            ireal_beat1_octave.append(first_midi)

            # Note count (4-beat only)
            if chord_beats == 4:
                ireal_notecounts[len(sorted_notes)] += 1

            # Contour (4-beat, 4+ notes)
            if chord_beats == 4 and len(sorted_notes) >= 4:
                pitches = [p for _, p in sorted_notes[:4]]
                if pitches[-1] > pitches[0] + 1:
                    ireal_contour['ascending'] += 1
                elif pitches[-1] < pitches[0] - 1:
                    ireal_contour['descending'] += 1
                else:
                    ireal_contour['static'] += 1

            # Approach
            if chord_beats >= 4 and si + 1 < len(timeline):
                ns = timeline[si + 1]
                next_ref = ns.bass_pc if ns.bass_pc is not None else ns.root_pc
                last_pc = last_midi % 12
                dist = abs(last_pc - next_ref) % 12
                if dist > 6:
                    dist = 12 - dist
                ireal_approach[dist] += 1

# -------------------------------------------------------
# Simulate our system
# -------------------------------------------------------
def mulberry32(seed):
    s = [seed & 0xFFFFFFFF]
    def rng():
        s[0] = (s[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((s[0] ^ (s[0] >> 15)) * (1 | s[0])) & 0xFFFFFFFF
        t = ((t + ((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF) ^ t) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rng

def sim_select(rng, quality, beats, root_semi, next_root_semi):
    patKey = quality
    if patKey not in db['patterns']:
        patKey = 'dom7'
    pats = db['patterns'].get(patKey, {}).get(str(beats))
    weights = db['weights'].get(patKey, {}).get(str(beats))
    if not pats or not weights:
        return None

    eff = []
    for pat, w in zip(pats, weights):
        if next_root_semi is not None and root_semi is not None:
            last_semi = pat[-1][1]
            last_pc = (root_semi + last_semi) % 12
            d = abs(last_pc - next_root_semi) % 12
            if d > 6:
                d = 12 - d
            bonus = APPROACH_BONUS.get(d, 1.0)
            eff.append(w * bonus)
        else:
            eff.append(w)
    total = sum(eff)
    r = rng() * total
    for i, e in enumerate(eff):
        r -= e
        if r <= 0:
            return pats[i]
    return pats[0]

for song in songs:
    measures = parse_musicxml(Path(f'scripts/output/ireal/{song}.musicxml'))
    expanded = expand_form(measures)
    timeline = build_chord_timeline(expanded)

    for ci in range(30):
        sim_prev_last_midi = None

        for si, span in enumerate(timeline):
            chord_beats = round(span.beats)
            if chord_beats < 2:
                continue
            ref_pc = span.bass_pc if span.bass_pc is not None else span.root_pc
            next_ref = None
            if si + 1 < len(timeline):
                ns = timeline[si + 1]
                next_ref = ns.bass_pc if ns.bass_pc is not None else ns.root_pc

            rng = mulberry32((ci * len(timeline) + si) * 7919 + 17)
            pat = sim_select(rng, span.quality, chord_beats, ref_pc, next_ref)
            if not pat:
                continue

            first_semi = pat[0][1]
            last_semi = pat[-1][1]
            root_midi = root_to_bass_midi(ref_pc, sim_prev_last_midi)
            first_midi_approx = root_midi + first_semi
            last_midi_approx = root_midi + last_semi

            if sim_prev_last_midi is not None:
                sim_intervals.append(abs(first_midi_approx - sim_prev_last_midi))

            sim_beat1['root' if first_semi == 0 else 'non-root'] += 1

            if chord_beats >= 4 and next_ref is not None:
                last_pc = (ref_pc + last_semi) % 12
                d = abs(last_pc - next_ref) % 12
                if d > 6:
                    d = 12 - d
                sim_approach[d] += 1

            sim_prev_last_midi = last_midi_approx

# -------------------------------------------------------
# Report
# -------------------------------------------------------
print('=' * 60)
print('iReal Pro vs Our System: Walking Bass Comparison')
print('=' * 60)

print('\n--- 1. Cross-chord voice leading (beat4 -> next beat1) ---')
ireal_arr = np.array(ireal_intervals)
sim_arr = np.array(sim_intervals)
for label, arr in [('iReal', ireal_arr), ('Ours ', sim_arr)]:
    print(f'  {label}: mean={arr.mean():.1f}  median={np.median(arr):.0f}  '
          f'step(<=2)={(arr <= 2).sum() / len(arr) * 100:.0f}%  '
          f'<=5th={(arr <= 7).sum() / len(arr) * 100:.0f}%  '
          f'leap(>7)={(arr > 7).sum() / len(arr) * 100:.0f}%')

print('\n--- 2. Beat 1 start note ---')
ir_t = sum(ireal_beat1.values())
si_t = sum(sim_beat1.values())
for k in ['root', 'non-root']:
    ir = ireal_beat1[k] / ir_t * 100
    si = sim_beat1[k] / si_t * 100
    print(f'  {k:10s}: iReal={ir:5.1f}%  Ours={si:5.1f}%  delta={si - ir:+5.1f}%')

print('\n--- 3. Notes per 4-beat chord (iReal Pro only) ---')
nc_t = sum(ireal_notecounts.values())
for nc in sorted(ireal_notecounts):
    print(f'  {nc} notes: {ireal_notecounts[nc]:5d} ({ireal_notecounts[nc] / nc_t * 100:5.1f}%)')

print('\n--- 4. Beat 4 approach distance ---')
ir_t = sum(ireal_approach.values())
si_t = sum(sim_approach.values())
print(f'{"Dist":>5s} {"iReal":>8s} {"Ours":>8s} {"Delta":>8s}')
for d in range(7):
    ir = ireal_approach.get(d, 0) / ir_t * 100
    si = sim_approach.get(d, 0) / si_t * 100
    print(f'{d:>5d} {ir:>7.1f}% {si:>7.1f}% {si - ir:>+7.1f}%')

print('\n--- 5. Contour direction (iReal Pro, 4-beat) ---')
ct_t = sum(ireal_contour.values())
for k in ['ascending', 'descending', 'static']:
    print(f'  {k:12s}: {ireal_contour[k] / ct_t * 100:5.1f}%')

print('\n--- 6. Beat 1 register (iReal Pro) ---')
oct_arr = np.array(ireal_beat1_octave)
print(f'  MIDI range: {oct_arr.min()}-{oct_arr.max()}  mean={oct_arr.mean():.1f}  median={np.median(oct_arr):.0f}')
