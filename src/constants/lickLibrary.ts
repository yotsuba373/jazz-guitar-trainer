import type { Lick, RhythmType } from '../types';

// ---------------------------------------------------------------------------
// Lick library loader — fetches from public/data/lick_library.json
// ---------------------------------------------------------------------------

type RawLickData = Record<string, Array<{
  id: string;
  steps: number[];
  intervals: number[];
  rhythm: RhythmType[];
  direction: 'asc' | 'desc' | 'mixed';
  length: number;
  startStep: number;
  endStep: number;
  durationBeats: number;
  source: 'omnibook' | 'wjd';
}>>;

let cache: Record<string, Lick[]> | null = null;
let loading: Promise<Record<string, Lick[]>> | null = null;

/** Quality mapping from internal chordQuality to lick library keys */
const QUALITY_MAP: Record<string, string> = {
  'maj7': 'maj7',
  '7': 'dom7',
  '7b9': 'dom7',
  '7#11': 'dom7',
  '7b13': 'dom7',
  '7alt': 'dom7',
  'm7': 'min7',
  'm7♭5': 'min7b5',
  'dim7': 'dim7',
  'mMaj7': 'min7',
};

export function toLickQuality(chordQuality: string): string {
  return QUALITY_MAP[chordQuality] ?? 'dom7';
}

export async function loadLickLibrary(): Promise<Record<string, Lick[]>> {
  if (cache) return cache;
  if (loading) return loading;

  loading = fetch('/data/lick_library.json')
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load lick library: ${res.status}`);
      return res.json() as Promise<RawLickData>;
    })
    .then(raw => {
      const result: Record<string, Lick[]> = {};
      for (const [quality, licks] of Object.entries(raw)) {
        result[quality] = licks.map(l => ({
          id: l.id,
          steps: l.steps,
          intervals: l.intervals,
          rhythm: l.rhythm,
          direction: l.direction,
          length: l.length,
          startStep: l.startStep,
          endStep: l.endStep,
          durationBeats: l.durationBeats,
          source: l.source,
        }));
      }
      cache = result;
      loading = null;
      return result;
    })
    .catch(err => {
      console.warn('Lick library load failed:', err);
      loading = null;
      cache = {};
      return {} as Record<string, Lick[]>;
    });

  return loading;
}

/** Get licks for a quality (sync — returns empty if not yet loaded) */
export function getLicksForQuality(chordQuality: string): Lick[] {
  if (!cache) return [];
  const key = toLickQuality(chordQuality);
  return cache[key] ?? [];
}

/** Check if lick library is loaded */
export function isLickLibraryLoaded(): boolean {
  return cache !== null;
}
