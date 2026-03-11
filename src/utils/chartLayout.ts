import type { ChordSlot, ChartLayout, ChartSection, Progression } from '../types';

/**
 * Derive a chart layout from a flat chords array.
 * Each chord becomes its own measure, grouped into a single section.
 */
export function deriveChartLayout(
  chords: ChordSlot[],
  barsPerRow = 4,
): ChartLayout {
  const measures = chords.map((_, i) => ({ chordIndices: [i] }));
  return {
    sections: [{ label: '', measures }],
    barsPerRow,
  };
}

/**
 * Get chart layout from a progression, deriving one if not present.
 */
export function getChartLayout(prog: Progression): ChartLayout {
  if (prog.chartLayout) return prog.chartLayout;
  return deriveChartLayout(prog.chords);
}

/**
 * Remove a chord from the layout by its flat index.
 * Decrements all chordIndices > deletedIdx.
 * Removes measures that become empty; removes sections that become empty.
 */
export function removeChordFromLayout(
  layout: ChartLayout,
  deletedIdx: number,
): ChartLayout {
  function patchMeasures(measures: { chordIndices: number[]; beatWidths?: number[] }[]) {
    const out: typeof measures = [];
    for (const m of measures) {
      const keep: number[] = [];
      const keepBw: number[] | undefined = m.beatWidths ? [] : undefined;
      for (let j = 0; j < m.chordIndices.length; j++) {
        const ci = m.chordIndices[j];
        if (ci === deletedIdx) continue;
        keep.push(ci > deletedIdx ? ci - 1 : ci);
        if (keepBw && m.beatWidths) keepBw.push(m.beatWidths[j]);
      }
      if (keep.length > 0) {
        out.push(keepBw ? { chordIndices: keep, beatWidths: keepBw } : { chordIndices: keep });
      }
    }
    return out;
  }

  const sections: ChartSection[] = [];
  for (const sec of layout.sections) {
    const measures = patchMeasures(sec.measures);
    const endings = sec.endings?.map(e => patchMeasures(e)).filter(e => e.length > 0);
    if (measures.length > 0 || (endings && endings.length > 0)) {
      sections.push({
        ...sec,
        measures,
        ...(endings && endings.length > 0 ? { endings } : {}),
      });
    }
  }

  if (sections.length === 0) {
    return { sections: [{ label: '', measures: [] }], barsPerRow: layout.barsPerRow };
  }
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Append a new chord (by index) as a new measure at the end of the last section.
 */
export function appendChordToLayout(
  layout: ChartLayout,
  newIdx: number,
): ChartLayout {
  const sections = layout.sections.map((sec, i) => {
    if (i < layout.sections.length - 1) return sec;
    return {
      ...sec,
      measures: [...sec.measures, { chordIndices: [newIdx] }],
    };
  });
  return { sections, barsPerRow: layout.barsPerRow };
}

type MeasureLike = { chordIndices: number[]; beatWidths?: number[] };

const BEATS_PER_MEASURE = 4;

/** Helper: search measures for one containing chordIdx, return beat starts (0-based, normalized to 4 beats). */
function findMeasureBeats(measures: MeasureLike[], chordIdx: number) {
  for (const m of measures) {
    if (!m.chordIndices.includes(chordIdx)) continue;
    const n = m.chordIndices.length;
    const bwSum = m.beatWidths ? m.beatWidths.reduce((a, b) => a + b, 0) : n;
    const starts: number[] = [];
    let acc = 0;
    for (let j = 0; j < n; j++) {
      starts.push(Math.round(acc / bwSum * BEATS_PER_MEASURE));
      acc += m.beatWidths?.[j] ?? 1;
    }
    return { m, starts, total: BEATS_PER_MEASURE };
  }
  return null;
}

function searchSections(layout: ChartLayout, chordIdx: number) {
  for (const sec of layout.sections) {
    const r = findMeasureBeats(sec.measures, chordIdx);
    if (r) return r;
    if (sec.endings) {
      for (const ending of sec.endings) {
        const r = findMeasureBeats(ending, chordIdx);
        if (r) return r;
      }
    }
  }
  return null;
}

/**
 * Return the 1-based beat positions already occupied in the measure containing chordIdx,
 * plus the total beat count of that measure.
 */
export function getMeasureBeatInfo(
  layout: ChartLayout,
  chordIdx: number,
): { occupiedBeats: number[]; totalBeats: number } | null {
  const r = searchSections(layout, chordIdx);
  if (!r) return null;
  return { occupiedBeats: r.starts.map(s => s + 1), totalBeats: r.total };
}

/**
 * Determine the flat-array splice index for a new chord inserted at `beat`
 * in the measure containing `referenceIdx`.
 */
export function computeInsertFlatIndex(
  layout: ChartLayout,
  referenceIdx: number,
  beat: number,
): number | null {
  const r = searchSections(layout, referenceIdx);
  if (!r) return null;
  const beat0 = beat - 1;
  const { m, starts } = r;
  let insertPos = m.chordIndices.length;
  for (let j = 0; j < starts.length; j++) {
    if (beat0 < starts[j]) { insertPos = j; break; }
  }
  return insertPos < m.chordIndices.length
    ? m.chordIndices[insertPos]
    : m.chordIndices[m.chordIndices.length - 1] + 1;
}

/**
 * Insert a new chord at a specific beat position within a measure.
 * `referenceIdx` identifies the target measure (any chord already in it).
 * `beat` is 1-based (1–4 for 4/4).
 * `newFlatIdx` is where the chord was spliced into the flat chords array.
 * All existing chordIndices >= newFlatIdx are bumped +1.
 */
export function insertChordAtBeat(
  layout: ChartLayout,
  referenceIdx: number,
  beat: number,
  newFlatIdx: number,
): ChartLayout {
  const beat0 = beat - 1;
  function bump(ci: number) { return ci >= newFlatIdx ? ci + 1 : ci; }

  function patchMeasures(measures: MeasureLike[]): MeasureLike[] {
    return measures.map(m => {
      if (!m.chordIndices.includes(referenceIdx)) {
        return {
          chordIndices: m.chordIndices.map(bump),
          ...(m.beatWidths ? { beatWidths: [...m.beatWidths] } : {}),
        };
      }
      const n = m.chordIndices.length;
      const bwSum = m.beatWidths ? m.beatWidths.reduce((a, b) => a + b, 0) : n;
      const starts: number[] = [];
      let acc = 0;
      for (let j = 0; j < n; j++) {
        starts.push(Math.round(acc / bwSum * BEATS_PER_MEASURE));
        acc += m.beatWidths?.[j] ?? 1;
      }
      let insertPos = n;
      for (let j = 0; j < n; j++) {
        if (beat0 < starts[j]) { insertPos = j; break; }
      }
      const newIndices = m.chordIndices.map(bump);
      newIndices.splice(insertPos, 0, newFlatIdx);
      const allStarts = [...starts];
      allStarts.splice(insertPos, 0, beat0);
      const newBw: number[] = [];
      for (let j = 0; j < allStarts.length; j++) {
        const next = j + 1 < allStarts.length ? allStarts[j + 1] : BEATS_PER_MEASURE;
        newBw.push(Math.max(1, next - allStarts[j]));
      }
      return { chordIndices: newIndices, beatWidths: newBw };
    });
  }

  const sections: ChartSection[] = layout.sections.map(sec => ({
    ...sec,
    measures: patchMeasures(sec.measures),
    ...(sec.endings ? { endings: sec.endings.map(e => patchMeasures(e)) } : {}),
  }));
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Build an array of visual rows, where each row contains
 * the flat chord indices in left-to-right reading order.
 * Used for ↑↓ keyboard navigation.
 */
export function buildChordRows(layout: ChartLayout): number[][] {
  const rows: number[][] = [];
  const { sections, barsPerRow } = layout;

  for (const section of sections) {
    // Main measures
    for (let i = 0; i < section.measures.length; i += barsPerRow) {
      const rowMeasures = section.measures.slice(i, i + barsPerRow);
      const row: number[] = [];
      for (const m of rowMeasures) {
        row.push(...m.chordIndices);
      }
      if (row.length > 0) {
        rows.push(row);
      }
    }

    // Ending rows
    if (section.endings) {
      for (const endingMeasures of section.endings) {
        for (let i = 0; i < endingMeasures.length; i += barsPerRow) {
          const rowMeasures = endingMeasures.slice(i, i + barsPerRow);
          const row: number[] = [];
          for (const m of rowMeasures) {
            row.push(...m.chordIndices);
          }
          if (row.length > 0) {
            rows.push(row);
          }
        }
      }
    }
  }

  return rows;
}
