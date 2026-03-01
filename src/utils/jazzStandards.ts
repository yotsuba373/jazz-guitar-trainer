import type { RawJazzStandard, RootName, SongKey, ChordSlot, Progression, ChartSection, ChartLayout } from '../types';
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

/** A chord within a measure, with beat duration. */
export interface MeasureChord {
  chord: string;
  beats: number;
}

/** Structured section with measure boundaries preserved. */
export interface StructuredSection {
  label: string;
  measures: MeasureChord[][];
  endings?: MeasureChord[][][];
  repeats?: number;
}

/** Extract chord symbols preserving section labels, measure boundaries, endings, and repeats. */
export function extractStructuredChords(song: RawJazzStandard): StructuredSection[] {
  // Collect used single-letter labels to avoid conflicts when auto-labeling
  const usedLabels = new Set(
    song.Sections
      .map(s => (s.Label ?? '').trim())
      .filter(l => /^[A-Z]$/i.test(l))
      .map(l => l.toUpperCase()),
  );
  let nextCode = 65; // 'A'
  function nextAutoLabel(): string {
    while (nextCode <= 90) {
      const label = String.fromCharCode(nextCode++);
      if (!usedLabels.has(label)) return label;
    }
    return '';
  }

  const sections: StructuredSection[] = [];
  let lastChord = '';

  function parseMeasures(chordStr: string): MeasureChord[][] {
    const measures: MeasureChord[][] = [];
    for (const measureStr of chordStr.split('|')) {
      const measure: MeasureChord[] = [];
      for (const raw of measureStr.split(',')) {
        const chord = raw.trim();
        if (!chord) {
          // Empty comma slot → extend previous chord's beat count
          if (measure.length > 0) {
            measure[measure.length - 1].beats++;
          }
          continue;
        }
        if (chord === '%') {
          if (lastChord) measure.push({ chord: lastChord, beats: 1 });
        } else {
          measure.push({ chord, beats: 1 });
          lastChord = chord;
        }
      }
      if (measure.length > 0) {
        measures.push(measure);
      }
    }
    return measures;
  }

  for (const section of song.Sections) {
    const rawLabel = (section.Label ?? '').trim();
    const label = rawLabel || nextAutoLabel();
    const measures = parseMeasures(section.MainSegment.Chords);

    let endings: MeasureChord[][][] | undefined;
    if (section.Endings && section.Endings.length > 0) {
      endings = section.Endings.map(e => parseMeasures(e.Chords));
    }

    const repeats = section.Repeats;

    sections.push({ label, measures, endings, repeats });
  }

  return sections;
}

/** Extract all chord symbols from a song, flattened across sections. */
export function extractChordSymbols(song: RawJazzStandard): string[] {
  const result: string[] = [];
  for (const sec of extractStructuredChords(song)) {
    result.push(...sec.measures.flat().map(mc => mc.chord));
    if (sec.endings) {
      for (const ending of sec.endings) {
        result.push(...ending.flat().map(mc => mc.chord));
      }
    }
  }
  return result;
}

// --- Conversion ---

/** Convert a JazzStandard song into the app's Progression format. */
export function songToProgression(song: RawJazzStandard): Progression {
  const songKey = parseSongKey(song.Key);
  const structured = extractStructuredChords(song);

  const chords: ChordSlot[] = [];
  const chartSections: ChartSection[] = [];

  function pushMeasureChords(items: MeasureChord[]): { indices: number[], beats: number[] } {
    const indices: number[] = [];
    const beats: number[] = [];
    for (const { chord: sym, beats: b } of items) {
      const idx = chords.length;
      const parsed = parseChordSymbol(sym);
      if (parsed) {
        const prevPosId = chords.length > 0 ? chords[chords.length - 1].posId : 1;
        chords.push(buildChordSlot(sym, parsed, prevPosId, songKey));
      } else {
        chords.push({
          symbol: sym, rootName: 'C', quality: 'unknown',
          modeIdx: 0, posId: 1, posConfirmed: false, modeConfirmed: false,
        });
      }
      indices.push(idx);
      beats.push(b);
    }
    return { indices, beats };
  }

  for (const sec of structured) {
    const chartMeasures = sec.measures.map(m => {
      const { indices, beats } = pushMeasureChords(m);
      return { chordIndices: indices, beatWidths: beats };
    });

    let chartEndings: { chordIndices: number[], beatWidths: number[] }[][] | undefined;
    if (sec.endings) {
      chartEndings = sec.endings.map(ending =>
        ending.map(m => {
          const { indices, beats } = pushMeasureChords(m);
          return { chordIndices: indices, beatWidths: beats };
        }),
      );
    }

    chartSections.push({
      label: sec.label,
      measures: chartMeasures,
      endings: chartEndings,
      repeats: sec.repeats,
    });
  }

  const chartLayout: ChartLayout = { sections: chartSections, barsPerRow: 4 };
  return { name: song.Title, songKey, chords, chartLayout };
}
