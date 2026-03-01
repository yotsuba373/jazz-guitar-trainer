import type { ChordSlot, ChartLayout, Progression } from '../types';

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
