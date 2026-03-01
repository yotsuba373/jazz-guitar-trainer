import type { ChordNotationPrefs } from '../types';

/** Default chord notation */
export const DEFAULT_CHORD_PREFS: ChordNotationPrefs = {
  maj7: 'M7',
  m7: 'm7',
  '7': '7',
  'm7♭5': 'm7♭5',
};

/** All available notation variants per quality */
export const CHORD_NOTATION_OPTIONS: Record<keyof ChordNotationPrefs, string[]> = {
  maj7: ['M7', 'maj7', '△7'],
  m7: ['m7', 'mi7', '-7'],
  '7': ['7'],
  'm7♭5': ['m7♭5', 'ø7'],
};

const STORAGE_KEY = 'jazz-guitar-chord-notation';

/** Format a chord symbol using user preferences: root + preferred quality display */
export function formatChordSymbol(
  rootName: string,
  qualityKey: string,
  prefs: ChordNotationPrefs,
): string {
  const display = prefs[qualityKey as keyof ChordNotationPrefs] ?? qualityKey;
  return rootName + display;
}

/** Format just the quality part (no root) */
export function formatQuality(
  qualityKey: string,
  prefs: ChordNotationPrefs,
): string {
  return prefs[qualityKey as keyof ChordNotationPrefs] ?? qualityKey;
}

/** Load preferences from localStorage */
export function loadChordNotationPrefs(): ChordNotationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHORD_PREFS };
    const parsed = JSON.parse(raw);
    return {
      maj7: CHORD_NOTATION_OPTIONS.maj7.includes(parsed.maj7) ? parsed.maj7 : DEFAULT_CHORD_PREFS.maj7,
      m7: CHORD_NOTATION_OPTIONS.m7.includes(parsed.m7) ? parsed.m7 : DEFAULT_CHORD_PREFS.m7,
      '7': '7',
      'm7♭5': CHORD_NOTATION_OPTIONS['m7♭5'].includes(parsed['m7♭5']) ? parsed['m7♭5'] : DEFAULT_CHORD_PREFS['m7♭5'],
    };
  } catch {
    return { ...DEFAULT_CHORD_PREFS };
  }
}

/** Save preferences to localStorage */
export function saveChordNotationPrefs(prefs: ChordNotationPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
