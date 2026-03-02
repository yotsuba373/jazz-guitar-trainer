import type { RootName, ModeTemplate, Mode, DegreeMap } from '../types';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

const LETTER_SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const IONIAN_SEMI = [0, 2, 4, 5, 7, 9, 11];

function parseNoteName(name: string): { letter: string; accOffset: number } {
  const letter = name[0];
  const rest = name.slice(1);
  let accOffset = 0;
  for (const ch of rest) {
    if (ch === '#') accOffset += 1;
    else if (ch === '♭' || ch === 'b') accOffset -= 1;
  }
  return { letter, accOffset };
}

function accidentalToString(offset: number): string {
  if (offset === 0) return '';
  if (offset === 1) return '#';
  if (offset === -1) return '♭';
  if (offset === 2) return '##';
  if (offset === -2) return '♭♭';
  throw new Error(`Unsupported accidental offset: ${offset}`);
}

/**
 * Generate correctly-spelled scale notes for a given root and interval set.
 * For 7-note scales: each letter A-G appears exactly once.
 * For 8-note scales: one letter appears twice with different accidentals.
 *   Algorithm: try sequential letters; if a double accidental (|diff| > 1)
 *   is found, shift subsequent letters by -1 so the previous letter is reused.
 */
export function spellScale(rootName: string, semiIntervals: number[]): string[] {
  const { letter: rootLetter, accOffset: rootAcc } = parseNoteName(rootName);
  const rootLetterIdx = LETTERS.indexOf(rootLetter as typeof LETTERS[number]);
  const rootSemitone = (LETTER_SEMITONES[rootLetter] + rootAcc + 120) % 12;
  const n = semiIntervals.length;

  if (n <= 7) {
    return semiIntervals.map((interval, i) => {
      const targetSemi = (rootSemitone + interval) % 12;
      const assignedLetter = LETTERS[(rootLetterIdx + i) % 7];
      const naturalSemi = LETTER_SEMITONES[assignedLetter];
      let diff = targetSemi - naturalSemi;
      if (diff > 6) diff -= 12;
      if (diff < -6) diff += 12;
      return assignedLetter + accidentalToString(diff);
    });
  }

  // 8-note scale: find where double accidental occurs, then shift
  let shiftAt = -1; // position from which to shift letter index by -1
  for (let i = 0; i < n; i++) {
    const targetSemi = (rootSemitone + semiIntervals[i]) % 12;
    const assignedLetter = LETTERS[(rootLetterIdx + i) % 7];
    const naturalSemi = LETTER_SEMITONES[assignedLetter];
    let diff = targetSemi - naturalSemi;
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    if (Math.abs(diff) > 1) { shiftAt = i; break; }
  }

  return semiIntervals.map((interval, i) => {
    const targetSemi = (rootSemitone + interval) % 12;
    const letterOff = (shiftAt >= 0 && i >= shiftAt) ? i - 1 : i;
    const assignedLetter = LETTERS[((rootLetterIdx + letterOff) % 7 + 7) % 7];
    const naturalSemi = LETTER_SEMITONES[assignedLetter];
    let diff = targetSemi - naturalSemi;
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    return assignedLetter + accidentalToString(diff);
  });
}

/**
 * Build the degree label map for a resolved scale.
 * Compares each mode interval to the Ionian (major) reference.
 */
export function buildDegreeMap(modeSemi: number[], noteNames: string[]): DegreeMap {
  const degrees: DegreeMap = {};
  for (let i = 0; i < 7; i++) {
    const diff = modeSemi[i] - IONIAN_SEMI[i];
    const base = String(i + 1);
    let label: string;
    if (diff === 0) label = base;
    else if (diff === -1) label = '♭' + base;
    else if (diff === -2) label = '♭♭' + base;
    else if (diff === 1) label = '#' + base;
    else if (diff === 2) label = '##' + base;
    else label = base;
    degrees[noteNames[i]] = label;
  }
  return degrees;
}

/**
 * Resolve a ModeTemplate + root into a fully-populated Mode object.
 */
export function resolveMode(rootName: RootName, template: ModeTemplate): Mode {
  const notes = spellScale(rootName, template.semi);
  const degrees = template.customDegrees
    ? Object.fromEntries(notes.map((n, i) => [n, template.customDegrees![i]]))
    : buildDegreeMap(template.semi, notes);
  const displayQuality = template.chordQuality === 'maj7' ? 'M7' : template.chordQuality;
  const chord = notes[0] + displayQuality;
  const chordTones = template.chordDegreesIdx.map(i => notes[i]);

  // Compute absolute semitones for fretboard mapping
  const { letter: rootLetter, accOffset: rootAcc } = parseNoteName(rootName);
  const rootSemitone = (LETTER_SEMITONES[rootLetter] + rootAcc + 120) % 12;
  const absoluteSemi = template.semi.map(s => (rootSemitone + s) % 12);

  return {
    key: template.key,
    name: template.name,
    semi: absoluteSemi,
    notes,
    degrees,
    chord,
    chordQuality: template.chordQuality,
    chordTones,
    chordSub: template.chordSub,
  };
}
