import type { RawJazzStandard, RootName, SongKey, ChordSlot, Progression } from '../types';
import { parseChordSymbol, buildChordSlot } from './progression';

const JSON_URL =
  'https://raw.githubusercontent.com/mikeoliphant/JazzStandards/master/JazzStandards.json';

let cachedSongs: RawJazzStandard[] | null = null;

/** Fetch and cache the JazzStandards catalog (lazy, once per session). */
export async function fetchJazzStandards(): Promise<RawJazzStandard[]> {
  if (cachedSongs) return cachedSongs;
  const res = await fetch(JSON_URL);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  cachedSongs = (await res.json()) as RawJazzStandard[];
  return cachedSongs;
}

/** Search songs by title (case-insensitive substring). */
export function searchSongs(
  songs: RawJazzStandard[],
  query: string,
): RawJazzStandard[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return songs.filter(s => s.Title.toLowerCase().includes(q));
}

// --- Key parsing ---

const KEY_ROOT_LOOKUP: Record<string, RootName> = {
  C: 'C', 'C#': 'D♭', Db: 'D♭',
  D: 'D', 'D#': 'E♭', Eb: 'E♭',
  E: 'E',
  F: 'F', 'F#': 'G♭', Gb: 'G♭',
  G: 'G', 'G#': 'A♭', Ab: 'A♭',
  A: 'A', 'A#': 'B♭', Bb: 'B♭',
  B: 'B',
};

/** Parse Key field ("C", "Bb", "G minor", "Dmin") → SongKey. */
export function parseSongKey(keyStr?: string): SongKey | undefined {
  if (!keyStr || !keyStr.trim()) return undefined;
  const trimmed = keyStr.trim();
  const minor = /min(or)?$/i.test(trimmed);
  const rootStr = trimmed.replace(/\s*min(or)?\s*$/i, '').trim();
  const root = KEY_ROOT_LOOKUP[rootStr];
  if (!root) return undefined;
  return { root, minor };
}

// --- Chord extraction ---

/** Extract all chord symbols from a song, flattened across sections. */
export function extractChordSymbols(song: RawJazzStandard): string[] {
  const symbols: string[] = [];
  let lastChord = '';

  function processMeasures(chordStr: string) {
    for (const measure of chordStr.split('|')) {
      for (const raw of measure.split(',')) {
        const chord = raw.trim();
        if (!chord) continue;
        if (chord === '%') {
          if (lastChord) symbols.push(lastChord);
        } else {
          symbols.push(chord);
          lastChord = chord;
        }
      }
    }
  }

  for (const section of song.Sections) {
    processMeasures(section.MainSegment.Chords);
    // Use first ending only
    if (section.Endings && section.Endings.length > 0) {
      processMeasures(section.Endings[0].Chords);
    }
  }

  return symbols;
}

// --- Conversion ---

/** Convert a JazzStandard song into the app's Progression format. */
export function songToProgression(song: RawJazzStandard): Progression {
  const songKey = parseSongKey(song.Key);
  const symbols = extractChordSymbols(song);

  const chords: ChordSlot[] = [];
  for (const sym of symbols) {
    const parsed = parseChordSymbol(sym);
    if (parsed) {
      const prevPosId = chords.length > 0 ? chords[chords.length - 1].posId : 1;
      chords.push(buildChordSlot(sym, parsed, prevPosId, songKey));
    } else {
      // Unsupported chord → skip slot
      chords.push({
        symbol: sym,
        rootName: 'C',
        quality: 'unknown',
        modeIdx: 0,
        posId: 1,
        posConfirmed: false,
        modeConfirmed: false,
      });
    }
  }

  return { name: song.Title, songKey, chords };
}
