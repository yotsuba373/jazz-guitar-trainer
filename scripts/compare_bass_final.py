#!/usr/bin/env python3
"""iReal Pro vs Our System: Final Comprehensive Comparison"""

import sys, json, numpy as np
sys.path.insert(0, 'scripts')
from parse_bass_phrases import *
from pathlib import Path
from collections import Counter

with open('public/bass-phrases.generated.json') as f:
    db = json.load(f)

APPROACH_BONUS = {0:0.716, 1:0.570, 2:0.561, 3:0.544, 4:0.583, 5:0.455, 6:0.503}
BASS_ROOT_BASE = 36
MIDI_LOW, MIDI_HIGH = 28, 60

def root_to_bass_midi(root_semi):
    """iReal Pro fixed octave placement: C2(36) base, G+ wraps to G1-B1."""
    midi = BASS_ROOT_BASE + root_semi
    if midi > BASS_ROOT_BASE + 6:
        midi -= 12
    return midi

songs = ['Autumn Leaves', 'Blues For Alice', 'All The Things You Are',
         'Confirmation', "It's All Right With Me"]

# --- iReal Pro data ---
ir_intervals = []
ir_beat1_midi = []
ir_all_midi = []
ir_velocity = []
ir_duration = []
ir_notecounts = Counter()
ir_contour = Counter()
ir_approach = Counter()
ir_beat1_root = Counter()

for song in songs:
    measures = parse_musicxml(Path(f'scripts/output/ireal/{song}.musicxml'))
    expanded = expand_form(measures)
    timeline = build_chord_timeline(expanded)
    chorus_beats = sum(m.beats for m in expanded)
    midi_notes, bpm = parse_midi_bass(Path(f'scripts/output/ireal/{song}.mid'))
    beat_sec = 60 / bpm
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
                    notes.append((quantize_beat(qb - abs_start), n.pitch,
                                  n.velocity, n.duration))
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

            for _, p, v, d in notes:
                ir_all_midi.append(p)
                ir_velocity.append(v)
                ir_duration.append(d)

            if cb == 4:
                ir_notecounts[len(notes)] += 1
                if len(notes) >= 4:
                    pitches = [p for _, p, _, _ in notes[:4]]
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


# --- Simulate our system ---
def mulberry32(seed):
    s = [seed & 0xFFFFFFFF]
    def rng():
        s[0] = (s[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((s[0] ^ (s[0] >> 15)) * (1 | s[0])) & 0xFFFFFFFF
        t = ((t + ((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF) ^ t) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rng

def sim_select(rng, quality, beats, root_semi, next_root_semi):
    patKey = quality if quality in db['patterns'] else 'dom7'
    pats = db['patterns'].get(patKey, {}).get(str(beats))
    weights = db['weights'].get(patKey, {}).get(str(beats))
    if not pats or not weights:
        return None
    eff = []
    for pat, w in zip(pats, weights):
        if next_root_semi is not None:
            lpc = (root_semi + pat[-1][1]) % 12
            d = abs(lpc - next_root_semi) % 12
            if d > 6:
                d = 12 - d
            eff.append(w * APPROACH_BONUS.get(d, 1.0))
        else:
            eff.append(w)
    total = sum(eff)
    r = rng() * total
    for i, e in enumerate(eff):
        r -= e
        if r <= 0:
            return pats[i]
    return pats[0]

sim_intervals = []
sim_beat1_root = Counter()
sim_approach = Counter()
sim_beat1_midi = []
sim_contour = Counter()

for song in songs:
    measures = parse_musicxml(Path(f'scripts/output/ireal/{song}.musicxml'))
    expanded = expand_form(measures)
    timeline = build_chord_timeline(expanded)
    for ci in range(30):
        sim_prev_last = None
        for si, span in enumerate(timeline):
            cb = round(span.beats)
            if cb < 2:
                continue
            ref_pc = span.bass_pc if span.bass_pc is not None else span.root_pc
            nref = None
            if si + 1 < len(timeline):
                ns = timeline[si + 1]
                nref = ns.bass_pc if ns.bass_pc is not None else ns.root_pc
            rng = mulberry32((ci * len(timeline) + si) * 7919 + 17)
            pat = sim_select(rng, span.quality, cb, ref_pc, nref)
            if not pat:
                continue
            rm = root_to_bass_midi(ref_pc)
            first_m = rm + pat[0][1]
            last_m = rm + pat[-1][1]
            sim_beat1_midi.append(first_m)
            sim_beat1_root['root' if pat[0][1] == 0 else 'non-root'] += 1
            if sim_prev_last is not None:
                sim_intervals.append(abs(first_m - sim_prev_last))
            if cb >= 4 and nref is not None:
                lpc = (ref_pc + pat[-1][1]) % 12
                d = abs(lpc - nref) % 12
                if d > 6:
                    d = 12 - d
                sim_approach[d] += 1
            if cb == 4 and len(pat) >= 4:
                ps = [rm + p[1] for p in pat[:4]]
                if ps[-1] > ps[0] + 1:
                    sim_contour['asc'] += 1
                elif ps[-1] < ps[0] - 1:
                    sim_contour['desc'] += 1
                else:
                    sim_contour['static'] += 1
            sim_prev_last = last_m


# --- Report ---
print('=' * 65)
print('iReal Pro vs Our System: Final Comprehensive Comparison')
print('=' * 65)

print('\n--- 1. Cross-chord voice leading ---')
ia, sa = np.array(ir_intervals), np.array(sim_intervals)
for l, a in [('iReal', ia), ('Ours ', sa)]:
    print(f'  {l}: mean={a.mean():.1f}  med={np.median(a):.0f}  '
          f'step={(a <= 2).sum() / len(a) * 100:.0f}%  '
          f'<=5th={(a <= 7).sum() / len(a) * 100:.0f}%  '
          f'leap={(a > 7).sum() / len(a) * 100:.0f}%')

print('\n--- 2. Beat 1 start note ---')
for k in ['root', 'non-root']:
    ir = ir_beat1_root[k] / sum(ir_beat1_root.values()) * 100
    si = sim_beat1_root[k] / sum(sim_beat1_root.values()) * 100
    print(f'  {k:10s}: iReal={ir:5.1f}%  Ours={si:5.1f}%  d={si - ir:+.1f}%')

print('\n--- 3. Beat 1 register ---')
ia2, sa2 = np.array(ir_beat1_midi), np.array(sim_beat1_midi)
print(f'  iReal: mean={ia2.mean():.1f}  med={np.median(ia2):.0f}  range={ia2.min()}-{ia2.max()}')
print(f'  Ours : mean={sa2.mean():.1f}  med={np.median(sa2):.0f}  range={sa2.min()}-{sa2.max()}')

print('\n--- 4. Beat 4 approach distance ---')
it = sum(ir_approach.values())
st = sum(sim_approach.values())
print(f'{"D":>3s} {"iReal":>7s} {"Ours":>7s} {"Delta":>7s}')
for d in range(7):
    ir = ir_approach.get(d, 0) / it * 100
    si = sim_approach.get(d, 0) / st * 100
    print(f'{d:>3d} {ir:>6.1f}% {si:>6.1f}% {si - ir:>+6.1f}%')

print('\n--- 5. Contour direction (4-beat) ---')
for label, ctr in [('iReal', ir_contour), ('Ours ', sim_contour)]:
    t = sum(ctr.values())
    if t == 0:
        continue
    parts = '  '.join(f'{k}={ctr.get(k, 0) / t * 100:.0f}%' for k in ['asc', 'desc', 'static'])
    print(f'  {label}: {parts}')

print('\n--- 6. Notes per 4-beat chord (iReal) ---')
t = sum(ir_notecounts.values())
for nc in sorted(ir_notecounts):
    print(f'  {nc} notes: {ir_notecounts[nc]:5d} ({ir_notecounts[nc] / t * 100:.1f}%)')

print('\n--- 7. Velocity & Duration (iReal) ---')
va, da = np.array(ir_velocity), np.array(ir_duration)
print(f'  Velocity: mean={va.mean():.0f}  range={va.min()}-{va.max()}')
print(f'  Duration: mean={da.mean():.2f} beats  range={da.min():.2f}-{da.max():.2f}')

print('\n--- 8. Overall MIDI range ---')
am = np.array(ir_all_midi)
print(f'  iReal all notes: range={am.min()}-{am.max()}  mean={am.mean():.1f}')
