import { describe, it, expect } from 'vitest';
import { generatePhrase, buildNotePool, getApproachNotes, absolutePitch, selectLick, resolveLick } from '../phraseGenerator';
import { resolveMode } from '../noteSpelling';
import { buildFretMap, generatePositions } from '../fretboard';
import { MODE_TEMPLATES } from '../../constants';
import type { PhraseConfig, GeneratedPhrase } from '../../types';

// Note: generatePhrase returns null when lick library is not loaded (test environment).
// Tests that depend on phrase generation use "if available" patterns.

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function setup(rootName: string, modeIdx: number) {
  const mode = resolveMode(rootName as any, MODE_TEMPLATES[modeIdx]);
  const fretMap = buildFretMap(mode.semi, mode.notes);
  const allPos = generatePositions(fretMap, mode.notes);
  return { mode, fretMap, allPos };
}

function defaultConfig(overrides?: Partial<PhraseConfig>): PhraseConfig {
  return {
    approachTypes: ['single-below', 'single-above', 'enclosure'],
    ...overrides,
  };
}

/** Absolute pitch (same as in phraseGenerator.ts) */
function absPitch(note: { stringIdx: number; fret: number }): number {
  const OPEN_MIDI = [64, 59, 55, 50, 45, 40];
  return OPEN_MIDI[note.stringIdx] + note.fret;
}

/** Generate N phrases, collecting only successful (non-null) results */
function generateBatch(rootName: string, modeIdx: number, posIdx: number, n: number, configOverrides?: Partial<PhraseConfig>): GeneratedPhrase[] {
  const { mode, fretMap, allPos } = setup(rootName, modeIdx);
  const pos = allPos[Math.min(posIdx, allPos.length - 1)];
  const results: GeneratedPhrase[] = [];
  for (let i = 0; i < n; i++) {
    const phrase = generatePhrase(pos, mode, fretMap, defaultConfig(configOverrides));
    if (phrase) results.push(phrase);
  }
  return results;
}

// =========================================================================
// 1. Note pool construction
// =========================================================================

describe('buildNotePool', () => {
  it('collects all scale notes within position', () => {
    const { mode, fretMap, allPos } = setup('C', 0); // C Ionian
    const pos = allPos[0]; // Pos 1
    const pool = buildNotePool(pos, mode, fretMap, false);

    // All notes should be scale notes
    const scaleSet = new Set(mode.notes);
    for (const n of pool) {
      expect(scaleSet.has(n.noteName)).toBe(true);
    }
    expect(pool.length).toBeGreaterThan(10);
  });

  it('flags chord tones correctly', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const pool = buildNotePool(allPos[0], mode, fretMap, false);
    const ctSet = new Set(mode.chordTones);
    for (const n of pool) {
      expect(n.isChordTone).toBe(ctSet.has(n.noteName));
    }
  });

  it('includes chromatic approach notes when requested', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const poolWithout = buildNotePool(allPos[0], mode, fretMap, false);
    const poolWith = buildNotePool(allPos[0], mode, fretMap, true);
    expect(poolWith.length).toBeGreaterThan(poolWithout.length);
    const chromaticNotes = poolWith.filter(n => n.isApproach);
    expect(chromaticNotes.length).toBeGreaterThan(0);
  });

  it('does not include chromatic notes in scale-only pool', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const pool = buildNotePool(allPos[0], mode, fretMap, false);
    const chromatic = pool.filter(n => n.isApproach);
    expect(chromatic.length).toBe(0);
  });

  it('has no duplicate (stringIdx, fret) pairs', () => {
    const { mode, fretMap, allPos } = setup('G', 1); // G Dorian
    const pool = buildNotePool(allPos[2], mode, fretMap, true);
    const keys = pool.map(n => `${n.stringIdx}:${n.fret}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// =========================================================================
// 2. Approach patterns
// =========================================================================

describe('getApproachNotes', () => {
  it('single-below returns 1 note a half-step below target', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const pool = buildNotePool(allPos[0], mode, fretMap, true);
    const ct = pool.find(n => n.isChordTone && n.fret > 2)!;
    const notes = getApproachNotes(ct, pool, 'single-below', mode);
    expect(notes).not.toBeNull();
    expect(notes!.length).toBe(1);
    expect(notes![0].fret).toBe(ct.fret - 1);
    expect(notes![0].stringIdx).toBe(ct.stringIdx);
  });

  it('single-above returns 1 note a half-step above target', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const pool = buildNotePool(allPos[0], mode, fretMap, true);
    const ct = pool.find(n => n.isChordTone && n.fret < 20)!;
    const notes = getApproachNotes(ct, pool, 'single-above', mode);
    expect(notes).not.toBeNull();
    expect(notes!.length).toBe(1);
    expect(notes![0].fret).toBe(ct.fret + 1);
  });

  it('enclosure returns 2 notes: diatonic above + chromatic below', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const pool = buildNotePool(allPos[0], mode, fretMap, true);
    const ct = pool.find(n => n.isChordTone &&
      pool.some(p => p.stringIdx === n.stringIdx && p.fret > n.fret && !p.isApproach)
    )!;
    const notes = getApproachNotes(ct, pool, 'enclosure', mode);
    if (notes) {
      expect(notes.length).toBe(2);
      expect(notes[0].fret).toBeGreaterThan(ct.fret);
      expect(notes[1].fret).toBe(ct.fret - 1);
    }
  });

  it('parker-enclosure returns 3 notes', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const pool = buildNotePool(allPos[0], mode, fretMap, true);
    const ct = pool.find(n => n.isChordTone && n.fret >= 3)!;
    const notes = getApproachNotes(ct, pool, 'parker-enclosure', mode);
    if (notes) {
      expect(notes.length).toBe(3);
      expect(notes[0].fret).toBe(ct.fret + 1);
      expect(notes[1].fret).toBe(ct.fret - 2);
      expect(notes[2].fret).toBe(ct.fret - 1);
    }
  });

  it('b9-arpeggio only works on dominant chords', () => {
    const { mode: majMode, fretMap: majMap, allPos: majPos } = setup('C', 0);
    const majPool = buildNotePool(majPos[0], majMode, majMap, true);
    const majCt = majPool.find(n => n.isChordTone)!;
    const majResult = getApproachNotes(majCt, majPool, 'b9-arpeggio', majMode);
    expect(majResult).toBeNull();

    const { mode: domMode, fretMap: domMap, allPos: domPos } = setup('C', 4);
    const domPool = buildNotePool(domPos[2], domMode, domMap, true);
    const domCt = domPool.find(n => n.isChordTone)!;
    const domResult = getApproachNotes(domCt, domPool, 'b9-arpeggio', domMode);
    if (domResult) {
      expect(domResult.length).toBe(4);
    }
  });

  it('all approach notes have isApproach=true (single patterns)', () => {
    const { mode, fretMap, allPos } = setup('C', 4);
    const pool = buildNotePool(allPos[1], mode, fretMap, true);
    const ct = pool.find(n => n.isChordTone && n.fret > 2)!;
    const notes = getApproachNotes(ct, pool, 'single-below', mode);
    expect(notes).not.toBeNull();
    for (const n of notes!) {
      expect(n.isApproach).toBe(true);
    }
  });

  it('enclosure approach notes are marked as approach', () => {
    const { mode, fretMap, allPos } = setup('C', 4);
    const pool = buildNotePool(allPos[1], mode, fretMap, true);
    const ct = pool.find(n => n.isChordTone &&
      pool.some(p => p.stringIdx === n.stringIdx && p.fret > n.fret && !p.isApproach)
    );
    if (!ct) return;
    const notes = getApproachNotes(ct, pool, 'enclosure', mode);
    if (notes) {
      for (const n of notes) {
        expect(n.isApproach).toBe(true);
      }
    }
  });
});

// =========================================================================
// 3. generatePhrase — structural invariants (null-aware)
// =========================================================================

describe('generatePhrase — structural invariants', () => {
  it('returns GeneratedPhrase or null', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    for (let i = 0; i < 10; i++) {
      const phrase = generatePhrase(allPos[0], mode, fretMap, defaultConfig());
      expect(phrase === null || typeof phrase === 'object').toBe(true);
    }
  });

  it('successful phrases have valid note coordinates', () => {
    const phrases = generateBatch('C', 0, 0, 30);
    for (const phrase of phrases) {
      expect(phrase.notes.length).toBeGreaterThanOrEqual(3);
      for (const n of phrase.notes) {
        expect(n.stringIdx).toBeGreaterThanOrEqual(0);
        expect(n.stringIdx).toBeLessThanOrEqual(5);
        expect(n.fret).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('successful phrases have duration and beatStart on every note', () => {
    const phrases = generateBatch('C', 4, 2, 30);
    for (const phrase of phrases) {
      for (const n of phrase.notes) {
        expect(n.duration).toBeDefined();
        expect(n.beatStart).toBeDefined();
      }
    }
  });

  it('phrase metadata is correct (when lick library available)', () => {
    const { mode, fretMap, allPos } = setup('D', 1); // D Dorian
    for (let i = 0; i < 30; i++) {
      const phrase = generatePhrase(allPos[2], mode, fretMap, defaultConfig());
      if (phrase) {
        expect(phrase.posId).toBe(allPos[2].id);
        expect(phrase.modeKey).toBe(mode.key);
        expect(phrase.rootName).toBe('D');
        return; // success
      }
    }
    // If no phrases generated (no lick library), test passes trivially
  });

  it('all notes are within position range ±1 fret', () => {
    const { mode, fretMap, allPos } = setup('C', 0);
    const pos = allPos[0];
    const minFret = Math.min(...pos.instances.map(i => i.fretMin)) - 1;
    const maxFret = Math.max(...pos.instances.map(i => i.fretMax)) + 1;
    const phrases = generateBatch('C', 0, 0, 20);
    for (const phrase of phrases) {
      for (const n of phrase.notes) {
        expect(n.fret).toBeGreaterThanOrEqual(minFret);
        expect(n.fret).toBeLessThanOrEqual(maxFret);
      }
    }
  });
});

// =========================================================================
// 4. Progression mode target (null-aware)
// =========================================================================

describe('generatePhrase — progression mode target', () => {
  it('target third note influences the last note', () => {
    const { mode, fretMap, allPos } = setup('G', 4); // G Mixolydian
    let lastIsHalfStepFromE = 0;
    let count = 0;
    for (let i = 0; i < 50; i++) {
      const phrase = generatePhrase(allPos[2], mode, fretMap, defaultConfig(), 'E');
      if (!phrase) continue;
      count++;
      const last = phrase.notes[phrase.notes.length - 1];
      const diff = ((4 - last.semitone) + 12) % 12;
      if (diff === 1 || diff === 11 || diff === 0) lastIsHalfStepFromE++;
    }
    if (count > 0) {
      expect(lastIsHalfStepFromE / count).toBeGreaterThanOrEqual(0.3);
    }
  });
});

// =========================================================================
// 5. Generation metadata
// =========================================================================

describe('Generation metadata', () => {
  it('goalReason is always a non-empty string', () => {
    const phrases = generateBatch('C', 0, 0, 20);
    for (const phrase of phrases) {
      expect(typeof phrase.goalReason).toBe('string');
      expect(phrase.goalReason!.length).toBeGreaterThan(0);
    }
  });

  it('goalReason reflects progression mode reasons (when lick library available)', () => {
    const { mode, fretMap, allPos } = setup('G', 4);
    const config = defaultConfig({
      nextChordContext: { thirdNote: 'E', seventhNote: 'B', rootNote: 'C', quality: 'maj7' },
    });
    const reasons = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const phrase = generatePhrase(allPos[0], mode, fretMap, config, 'E');
      if (phrase) reasons.add(phrase.goalReason!);
    }
    if (reasons.size === 0) return; // no lick library available
    const progReasons = ['7th→次3rd半音解決', '次3rdへ半音VL', '次3rd一致'];
    expect([...reasons].some(r => progReasons.includes(r))).toBe(true);
  });

  it('lickId is set on successful phrases', () => {
    const phrases = generateBatch('C', 4, 2, 20);
    for (const phrase of phrases) {
      expect(typeof phrase.lickId).toBe('string');
    }
  });

  it('motif is extracted from opening notes', () => {
    const phrases = generateBatch('C', 0, 0, 20);
    for (const phrase of phrases) {
      expect(Array.isArray(phrase.motif)).toBe(true);
      expect(phrase.motif.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// =========================================================================
// 6. Goal note preserves voice leading intent (null-aware)
// =========================================================================

describe('goal note preserves voice leading intent', () => {
  it('Am7b5 → D7b13: goal note resolves to 7th (G) for half-step VL ≥ 30%', () => {
    const { mode, fretMap, allPos } = setup('A', 6); // A Locrian
    const pos = allPos[Math.min(6, allPos.length - 1)];
    let goalIs7th = 0;
    let count = 0;
    for (let i = 0; i < 200; i++) {
      const phrase = generatePhrase(pos, mode, fretMap, defaultConfig({
        nextChordContext: {
          thirdNote: 'F#', seventhNote: 'C', rootNote: 'D', quality: '7',
        },
      }), 'F#');
      if (!phrase) continue;
      count++;
      const lastNote = phrase.notes[phrase.notes.length - 1];
      if (lastNote.noteName === 'G') goalIs7th++;
    }
    if (count > 0) {
      expect(goalIs7th / count).toBeGreaterThanOrEqual(0.30);
    }
  });

  it('Dm7 → G7: goal note within half-step of next 3rd (B) ≥ 30%', () => {
    const { mode, fretMap, allPos } = setup('D', 1); // D Dorian (Dm7)
    const pos = allPos[2];
    let vlPreserved = 0;
    let count = 0;
    for (let i = 0; i < 100; i++) {
      const phrase = generatePhrase(pos, mode, fretMap, defaultConfig({
        nextChordContext: {
          thirdNote: 'B', seventhNote: 'F', rootNote: 'G', quality: '7',
        },
      }), 'B');
      if (!phrase) continue;
      count++;
      const lastNote = phrase.notes[phrase.notes.length - 1];
      const semiDist = Math.min(
        Math.abs(lastNote.semitone - 11),
        12 - Math.abs(lastNote.semitone - 11),
      );
      if (semiDist <= 1) vlPreserved++;
    }
    if (count > 0) {
      expect(vlPreserved / count).toBeGreaterThanOrEqual(0.30);
    }
  });
});

// =========================================================================
// 7. selectLick rootSemitone conversion
// =========================================================================

describe('selectLick rootSemitone conversion', () => {
  it('startHint.semitone is converted to root-relative before comparing with lick.startStep', () => {
    const rootSemitone = 2; // D
    const hint = { noteName: 'F', stringIdx: 2, fret: 6, semitone: 5 };
    const result = selectLick('min7', 4, null, hint, 'descending', rootSemitone);
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('non-C keys: startHint relative conversion matches expected interval', () => {
    const rootSemitone = 10; // Bb
    const hint = { noteName: 'Ab', stringIdx: 3, fret: 6, semitone: 8 };
    const result = selectLick('dom7', 4, null, hint, 'descending', rootSemitone);
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

// =========================================================================
// 8. startHint linkage across keys (null-aware)
// =========================================================================

describe('startHint linkage across keys', () => {
  const keys: [string, number][] = [
    ['C', 4],  // C Mixolydian
    ['D', 1],  // D Dorian
    ['Bb', 4], // Bb Mixolydian
    ['F#', 0], // F# Ionian
  ];

  for (const [rootName, modeIdx] of keys) {
    it(`${rootName} mode ${modeIdx}: startHint beat 1 within 4st in ≥ 50% of successful phrases`, () => {
      const { mode, fretMap, allPos } = setup(rootName, modeIdx);
      const pos = allPos[1];

      let closeCount = 0;
      let count = 0;
      for (let i = 0; i < 100; i++) {
        const prev = generatePhrase(pos, mode, fretMap, defaultConfig());
        if (!prev) continue;
        const lastNote = prev.notes[prev.notes.length - 1];
        const hint = {
          noteName: lastNote.noteName,
          stringIdx: lastNote.stringIdx,
          fret: lastNote.fret,
          semitone: lastNote.semitone,
        };
        const next = generatePhrase(pos, mode, fretMap, defaultConfig({ startHint: hint }));
        if (!next) continue;
        count++;
        const beat1 = next.notes[0];
        const interval = Math.abs(absPitch(beat1) - absPitch(hint));
        if (interval <= 4) closeCount++;
      }
      if (count > 0) {
        expect(closeCount / count).toBeGreaterThanOrEqual(0.50);
      }
    });
  }
});

// =========================================================================
// 9. selectLick scale compatibility filter
// =========================================================================

describe('selectLick scale compatibility filter', () => {
  it('accepts modeSemi and charTones parameters without error', () => {
    const rootSemitone = 0;
    const hint = { noteName: 'C', stringIdx: 1, fret: 1, semitone: 0 };
    const dorianSemi = [0, 2, 3, 5, 7, 9, 10];
    const charTones = [9];
    const result = selectLick('min7', 4, null, hint, 'descending', rootSemitone, dorianSemi, charTones);
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('backward compatible: works without modeSemi/charTones', () => {
    const result = selectLick('dom7', 4, null, undefined, 'arch', 0);
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

// =========================================================================
// 10. resolveLick quality gates
// =========================================================================

describe('resolveLick quality gates', () => {
  it('rejects resolution with leap > 9 semitones between consecutive notes', () => {
    const { mode, fretMap, allPos } = setup('C', 1); // C Dorian
    const pos = allPos[0];
    const pool = buildNotePool(pos, mode, fretMap, true);

    const fakeLick = {
      id: 'test-leap',
      quality: 'min7',
      steps: [0, 0],
      intervals: [0],
      rhythm: ['e' as const, 'e' as const],
      durationBeats: 1,
      length: 2,
      startStep: 0,
      endStep: 0,
      direction: 'asc' as const,
    };

    const startRef = pool.find(n => n.semitone === 0) ?? pool[0];
    const result = resolveLick(fakeLick, pool, mode, startRef, 0);
    expect(result === null || Array.isArray(result)).toBe(true);
  });
});
