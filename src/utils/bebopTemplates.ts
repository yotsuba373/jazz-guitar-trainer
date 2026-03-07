import type { PhraseContour } from '../types';
import { pickWeighted } from './phraseGenerator';

// ---------------------------------------------------------------------------
// Phrase structure templates for rule-based bebop generation
// ---------------------------------------------------------------------------

export interface SegmentSpec {
  type: string;                // key into SEGMENT_FNS
  direction: 'asc' | 'desc';
  beats: number;               // beats for this segment (0 = remainder)
}

export interface PhraseTemplate {
  id: string;
  label: string;
  segments: SegmentSpec[];
  contour: PhraseContour;
  weight: number;
  qualityFilter?: string[];    // allowed chordQuality values (null = all)
}

export const PHRASE_TEMPLATES: PhraseTemplate[] = [
  {
    id: 'arp-up-scale-down',
    label: 'Arp↑+Scale↓',
    segments: [
      { type: 'arpeggio', direction: 'asc', beats: 2 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 30,
  },
  {
    id: 'scale-down',
    label: 'Scale↓',
    segments: [
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'descending',
    weight: 20,
  },
  {
    id: 'encl-arp',
    label: 'Encl.+Arp↑',
    segments: [
      { type: 'enclosure', direction: 'desc', beats: 1 },
      { type: 'arpeggio', direction: 'asc', beats: 0 },
    ],
    contour: 'arch',
    weight: 15,
  },
  {
    id: '1235-scale-down',
    label: '1235+Scale↓',
    segments: [
      { type: '1235', direction: 'asc', beats: 1 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 15,
  },
  {
    id: 'scale-up-arp-down',
    label: 'Scale↑+Arp↓',
    segments: [
      { type: 'scaleRun', direction: 'asc', beats: 2 },
      { type: 'arpeggio', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 10,
  },
  {
    id: 'approach-ct-chain',
    label: 'Approach→CT',
    segments: [
      { type: 'approachCT', direction: 'desc', beats: 0 },
    ],
    contour: 'wave',
    weight: 10,
  },
  {
    id: 'dim7-from-3rd',
    label: 'dim7 from 3rd',
    segments: [
      { type: 'dim7From3rd', direction: 'asc', beats: 2 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 15,
    qualityFilter: ['7', '7b9', '7#11', '7b13'],
  },
  {
    id: 'upper-structure',
    label: 'Upper Structure',
    segments: [
      { type: 'upperStructure', direction: 'asc', beats: 2 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 10,
    qualityFilter: ['m7', 'maj7', 'mMaj7'],
  },
  {
    id: 'encl-scale-down',
    label: 'Encl.+Scale↓',
    segments: [
      { type: 'enclosure', direction: 'desc', beats: 1 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'descending',
    weight: 10,
  },
  {
    id: 'chromatic-arp-scale',
    label: 'Chr.+Arp↑+Scale↓',
    segments: [
      { type: 'chromatic', direction: 'asc', beats: 1 },
      { type: 'arpeggio', direction: 'asc', beats: 1 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 8,
  },
  {
    id: 'honeysuckle',
    label: 'Honeysuckle',
    segments: [
      { type: 'octaveDisp', direction: 'asc', beats: 1 },
      { type: 'scaleRun', direction: 'asc', beats: 0 },
    ],
    contour: 'ascending',
    weight: 8,
  },
];

// ---------------------------------------------------------------------------
// Template selection
// ---------------------------------------------------------------------------

export function selectTemplate(
  quality: string,
  beatCount: number,
  contour?: PhraseContour,
): PhraseTemplate {
  // Filter by quality
  let eligible = PHRASE_TEMPLATES.filter(t =>
    !t.qualityFilter || t.qualityFilter.includes(quality)
  );

  // For 2-beat phrases, prefer single-segment templates or short ones
  if (beatCount <= 2) {
    const short = eligible.filter(t => t.segments.length <= 2);
    if (short.length > 0) eligible = short;
  }

  if (eligible.length === 0) eligible = [PHRASE_TEMPLATES[0]]; // fallback

  // Compute weights with contour affinity bonus
  const weights = eligible.map(t => {
    let w = t.weight;
    if (contour && t.contour === contour) w += 8;
    return Math.max(1, w);
  });

  return pickWeighted(eligible, weights);
}

/** Allocate eighths per segment given total eighths and template specs */
export function allocateEighths(
  template: PhraseTemplate,
  totalEighths: number,
): number[] {
  const specs = template.segments;
  const fixed = specs.reduce((sum, s) => sum + (s.beats > 0 ? s.beats * 2 : 0), 0);
  const remainder = Math.max(2, totalEighths - fixed);
  return specs.map(s => s.beats > 0 ? s.beats * 2 : remainder);
}
