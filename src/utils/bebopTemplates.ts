import type { PhraseContour } from '../types';

export function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[0];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

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
  description: string;         // flavour text explaining the musical idea
  segments: SegmentSpec[];
  contour: PhraseContour;
  weight: number;
  qualityFilter?: string[];    // allowed chordQuality values (null = all)
}

export const PHRASE_TEMPLATES: PhraseTemplate[] = [
  {
    id: 'arp-up-scale-down',
    label: 'アルペジオ上行+スケール下降',
    description: 'コードトーンを駆け上がり、スケールで滑らかに下降。ビバップの王道アーチ型フレーズ',
    segments: [
      { type: 'arpeggio', direction: 'asc', beats: 2 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 30,
  },
  {
    id: 'scale-down',
    label: 'スケール下降',
    description: 'ビバップスケールによる一気の下降ライン。8分音符の流れで強拍にCTが自然に着地する',
    segments: [
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'descending',
    weight: 20,
  },
  {
    id: 'encl-arp',
    label: 'エンクロージャー+アルペジオ上行',
    description: 'エンクロージャーでターゲット音を挟んでから、アルペジオで上昇。緊張→解放の流れ',
    segments: [
      { type: 'enclosure', direction: 'desc', beats: 1 },
      { type: 'arpeggio', direction: 'asc', beats: 0 },
    ],
    contour: 'arch',
    weight: 15,
  },
  {
    id: '1235-scale-down',
    label: '1-2-3-5+スケール下降',
    description: 'R-2-3-5 デジタルパターンで調性を提示し、スケール下降で着地。明快なビバップ語法',
    segments: [
      { type: '1235', direction: 'asc', beats: 1 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 15,
  },
  {
    id: 'scale-up-arp-down',
    label: 'スケール上昇+アルペジオ下行',
    description: 'スケール上行で頂点まで登り、アルペジオで一気に降りる。逆アーチの推進力あるライン',
    segments: [
      { type: 'scaleRun', direction: 'asc', beats: 2 },
      { type: 'arpeggio', direction: 'desc', beats: 0 },
    ],
    contour: 'arch',
    weight: 10,
  },
  {
    id: 'approach-ct-chain',
    label: 'アプローチ→CT連鎖',
    description: 'アプローチノート→コードトーンの連鎖。半音やエンクロージャーで各CTに解決し続ける波形ライン',
    segments: [
      { type: 'approachCT', direction: 'desc', beats: 0 },
    ],
    contour: 'wave',
    weight: 10,
  },
  {
    id: 'dim7-from-3rd',
    label: '3rdからdim7',
    description: 'Dom7の3rdからdim7アルペジオ (=7♭9のアッパーストラクチャー) を上行。ドミナント上の定番テンション手法',
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
    label: 'アッパーストラクチャー',
    description: '3rdからアッパーストラクチャーのアルペジオ (m7→5th上のmaj7等) で9th/13thのカラーを引き出す',
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
    label: 'エンクロージャー+スケール下降',
    description: 'エンクロージャーで引っかけてからスケール下降。装飾的な出だしから流れるような下行ライン',
    segments: [
      { type: 'enclosure', direction: 'desc', beats: 1 },
      { type: 'scaleRun', direction: 'desc', beats: 0 },
    ],
    contour: 'descending',
    weight: 10,
  },
  {
    id: 'chromatic-arp-scale',
    label: 'クロマチック+アルペジオ上行+スケール下降',
    description: 'クロマチック経過→アルペジオ上行→スケール下降の3段構成。複合的で変化に富むライン',
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
    description: 'Root→1oct下の3rd→上行 (Honeysuckle Rose冒頭の音型)。オクターブ跳躍が印象的なイディオム',
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

/** Allocate beats per segment given total beats and template specs (beat-based) */
export function allocateBeats(
  template: PhraseTemplate,
  totalBeats: number,
): number[] {
  const specs = template.segments;
  const fixed = specs.reduce((sum, s) => sum + (s.beats > 0 ? s.beats : 0), 0);
  const remainder = Math.max(0.5, totalBeats - fixed);
  return specs.map(s => s.beats > 0 ? s.beats : remainder);
}

/** @deprecated Use allocateBeats() instead. Kept for backward compatibility with existing tests. */
export function allocateEighths(
  template: PhraseTemplate,
  totalEighths: number,
): number[] {
  const specs = template.segments;
  const fixed = specs.reduce((sum, s) => sum + (s.beats > 0 ? s.beats * 2 : 0), 0);
  const remainder = Math.max(2, totalEighths - fixed);
  return specs.map(s => s.beats > 0 ? s.beats * 2 : remainder);
}
