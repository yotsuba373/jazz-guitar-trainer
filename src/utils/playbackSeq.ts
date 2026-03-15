import type { ChartLayout } from '../types';

export interface PlaybackStep {
  chordIdx: number;
  beats: number;
  measureFlatIdx: number;
}

/** Build a flat playback sequence respecting section repeats and volta endings.
 *  Each entry includes `measureFlatIdx` — the visual measure index on the chart
 *  (consistent with ChordChart's flat index computation). */
export function buildPlaybackSeq(layout: ChartLayout): PlaybackStep[] {
  const seq: PlaybackStep[] = [];
  let flatBase = 0;
  function addMeasure(m: { chordIndices: number[]; beatWidths?: number[] }, mfi: number) {
    const count = m.chordIndices.length;
    const bwSum = m.beatWidths ? m.beatWidths.reduce((a, b) => a + b, 0) : count;
    m.chordIndices.forEach((ci, i) => {
      const bw = m.beatWidths?.[i] ?? 1;
      seq.push({ chordIdx: ci, beats: (bw / bwSum) * 4, measureFlatIdx: mfi });
    });
  }
  for (const section of layout.sections) {
    const mainStart = flatBase;
    flatBase += section.measures.length;
    const endingStarts: number[] = [];
    if (section.endings) {
      for (const ending of section.endings) {
        endingStarts.push(flatBase);
        flatBase += ending.length;
      }
    }
    const passes = (section.repeats ?? 0) + 1;
    for (let pass = 0; pass < passes; pass++) {
      section.measures.forEach((m, mi) => addMeasure(m, mainStart + mi));
      if (section.endings?.[pass]) {
        section.endings[pass].forEach((m, mi) => addMeasure(m, endingStarts[pass] + mi));
      }
    }
  }
  return seq;
}

/** Cumulative beat count up to a given index in the sequence. */
export function computeCumBeats(seq: { beats: number }[], upToIdx: number): number {
  let cum = 0;
  for (let i = 0; i < upToIdx && i < seq.length; i++) cum += seq[i].beats;
  return cum;
}
