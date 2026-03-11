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
      // Keep measure even if empty (user can delete empty measures explicitly)
      out.push(keepBw && keep.length > 0 ? { chordIndices: keep, beatWidths: keepBw } : { chordIndices: keep });
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
 * If the last section has endings, appends to the last ending's measures.
 */
export function appendChordToLayout(
  layout: ChartLayout,
  newIdx: number,
): ChartLayout {
  const sections = layout.sections.map((sec, i) => {
    if (i < layout.sections.length - 1) return sec;
    // If section has endings, append to the last ending
    if (sec.endings && sec.endings.length > 0) {
      const endings = sec.endings.map((e, ei) =>
        ei === sec.endings!.length - 1
          ? [...e, { chordIndices: [newIdx] }]
          : e,
      );
      return { ...sec, endings };
    }
    return {
      ...sec,
      measures: [...sec.measures, { chordIndices: [newIdx] }],
    };
  });
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Insert an empty measure (chordIndices: []) into the layout.
 * If afterChordIdx is given, inserts after that chord's measure.
 * Otherwise appends at the end of the last section.
 */
export function insertEmptyMeasure(
  layout: ChartLayout,
  afterChordIdx?: number,
): ChartLayout {
  if (afterChordIdx == null) {
    // Append at end of last section
    const sections = layout.sections.map((sec, i) => {
      if (i < layout.sections.length - 1) return sec;
      if (sec.endings && sec.endings.length > 0) {
        const endings = sec.endings.map((e, ei) =>
          ei === sec.endings!.length - 1
            ? [...e, { chordIndices: [] as number[] }]
            : e,
        );
        return { ...sec, endings };
      }
      return { ...sec, measures: [...sec.measures, { chordIndices: [] as number[] }] };
    });
    return { sections, barsPerRow: layout.barsPerRow };
  }

  // Insert after the measure containing afterChordIdx
  const sections = layout.sections.map(sec => {
    // Try main measures
    const mi = sec.measures.findIndex(m => m.chordIndices.includes(afterChordIdx));
    if (mi >= 0) {
      const measures = [...sec.measures];
      measures.splice(mi + 1, 0, { chordIndices: [] });
      return { ...sec, measures };
    }
    // Try endings
    if (sec.endings) {
      const endings = sec.endings.map(ending => {
        const ei = ending.findIndex(m => m.chordIndices.includes(afterChordIdx));
        if (ei >= 0) {
          const copy = [...ending];
          copy.splice(ei + 1, 0, { chordIndices: [] });
          return copy;
        }
        return ending;
      });
      return { ...sec, endings };
    }
    return sec;
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
 * Rename a section's label.
 */
export function renameSection(
  layout: ChartLayout,
  sectionIdx: number,
  newLabel: string,
): ChartLayout {
  const sections = layout.sections.map((s, i) =>
    i === sectionIdx ? { ...s, label: newLabel } : s,
  );
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Split a section at a given measure index.
 * Measures [0..measureIdx-1] stay in the original section,
 * measures [measureIdx..end] become a new section with auto-label.
 */
export function splitSection(
  layout: ChartLayout,
  sectionIdx: number,
  measureIdx: number,
): ChartLayout {
  const sec = layout.sections[sectionIdx];
  if (!sec || measureIdx <= 0 || measureIdx >= sec.measures.length) return layout;

  const before = sec.measures.slice(0, measureIdx);
  const after = sec.measures.slice(measureIdx);

  // Auto-assign label for the new section
  const usedLabels = new Set(layout.sections.map(s => s.label));
  let newLabel = '';
  for (let i = 0; i < 26; i++) {
    const candidate = String.fromCharCode(65 + i); // A-Z
    if (!usedLabels.has(candidate)) { newLabel = candidate; break; }
  }

  // Original section keeps its label, repeat, endings
  const sec1: ChartSection = { ...sec, measures: before };
  const sec2: ChartSection = { label: newLabel, measures: after };

  const sections = [
    ...layout.sections.slice(0, sectionIdx),
    sec1,
    sec2,
    ...layout.sections.slice(sectionIdx + 1),
  ];
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Split a section at a measure inside an ending.
 * Measures from endings[endingIdx][measureIdx..] onward become a new section.
 * The original ending is truncated; empty endings are cleaned up.
 */
export function splitSectionAtEnding(
  layout: ChartLayout,
  sectionIdx: number,
  endingIdx: number,
  measureIdx: number,
): ChartLayout {
  const sec = layout.sections[sectionIdx];
  if (!sec.endings || !sec.endings[endingIdx]) return layout;

  const ending = sec.endings[endingIdx];
  if (measureIdx <= 0 && endingIdx === 0) return layout; // can't split at the very start of endings

  const kept = ending.slice(0, measureIdx);
  const split = ending.slice(measureIdx);

  // Rebuild endings: keep endings before endingIdx intact, truncate current, drop later
  const newEndings: typeof sec.endings = [];
  for (let i = 0; i < sec.endings.length; i++) {
    if (i < endingIdx) {
      newEndings.push(sec.endings[i]);
    } else if (i === endingIdx && kept.length > 0) {
      newEndings.push(kept);
    }
    // endings after endingIdx are dropped — they'll go into the new section or be lost
  }

  // Collect all measures that move to the new section:
  // the split portion + any endings after endingIdx
  const newSectionMeasures = [
    ...split,
    ...sec.endings.slice(endingIdx + 1).flat(),
  ];

  // Auto-assign label
  const usedLabels = new Set(layout.sections.map(s => s.label));
  let newLabel = '';
  for (let i = 0; i < 26; i++) {
    const candidate = String.fromCharCode(65 + i);
    if (!usedLabels.has(candidate)) { newLabel = candidate; break; }
  }

  const sec1: ChartSection = {
    ...sec,
    ...(newEndings.length > 0 ? { endings: newEndings } : { endings: undefined }),
  };
  // Clean up: if no endings left, remove the property
  if (!sec1.endings || sec1.endings.length === 0) {
    delete sec1.endings;
  }

  const sec2: ChartSection = { label: newLabel, measures: newSectionMeasures };

  const sections = [
    ...layout.sections.slice(0, sectionIdx),
    sec1,
    sec2,
    ...layout.sections.slice(sectionIdx + 1),
  ];
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Merge section[sectionIdx] with section[sectionIdx + 1].
 * The merged section keeps the first section's label and repeat settings.
 */
export function mergeSections(
  layout: ChartLayout,
  sectionIdx: number,
): ChartLayout {
  if (sectionIdx < 0 || sectionIdx >= layout.sections.length - 1) return layout;

  const sec1 = layout.sections[sectionIdx];
  const sec2 = layout.sections[sectionIdx + 1];

  const merged: ChartSection = {
    label: sec1.label || sec2.label,
    measures: [...sec1.measures, ...sec2.measures],
    ...(sec1.repeats != null ? { repeats: sec1.repeats } : {}),
    ...(sec1.endings ? { endings: sec1.endings } : {}),
  };

  const sections = [
    ...layout.sections.slice(0, sectionIdx),
    merged,
    ...layout.sections.slice(sectionIdx + 2),
  ];
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Move measures [measureIdx..end] into volta ending 1 (endings[0]).
 * Does NOT auto-create ending 2 — use adjustEndingSplit() to set the 2nd bracket.
 * Also sets repeats=1 if not already set.
 */
export function splitEndings(
  layout: ChartLayout,
  sectionIdx: number,
  measureIdx: number,
): ChartLayout {
  const sec = layout.sections[sectionIdx];
  if (!sec || measureIdx <= 0 || measureIdx >= sec.measures.length) return layout;

  const mainMeasures = sec.measures.slice(0, measureIdx);
  const tailMeasures = sec.measures.slice(measureIdx);

  const updated: ChartSection = {
    ...sec,
    measures: mainMeasures,
    endings: [tailMeasures],
    repeats: sec.repeats ?? 1,
  };

  const sections = layout.sections.map((s, i) => i === sectionIdx ? updated : s);
  return { sections, barsPerRow: layout.barsPerRow };
}

/**
 * Remove volta endings from a section, merging all ending measures back into main.
 * endings[0] measures are appended first, then endings[1], etc.
 */
export function removeEndings(
  layout: ChartLayout,
  sectionIdx: number,
): ChartLayout {
  const sec = layout.sections[sectionIdx];
  if (!sec || !sec.endings || sec.endings.length === 0) return layout;

  const allEndingMeasures = sec.endings.flat();
  const updated: ChartSection = {
    label: sec.label,
    measures: [...sec.measures, ...allEndingMeasures],
    ...(sec.repeats != null ? { repeats: sec.repeats } : {}),
  };

  const sections = layout.sections.map((s, i) => i === sectionIdx ? updated : s);
  return { sections, barsPerRow: layout.barsPerRow };
}

// --- Measure position lookup ---

export interface ChordMeasureInfo {
  sectionIdx: number;
  measureIdx: number;
  endingIdx?: number; // undefined = in main measures
  /** Flat index across main + all endings within the section */
  flatIdx: number;
  /** Total measures in the section (main + all endings) */
  totalMeasures: number;
}

/**
 * Find which section/measure a chord belongs to.
 */
export function findChordMeasure(layout: ChartLayout, chordIdx: number): ChordMeasureInfo | null {
  for (let si = 0; si < layout.sections.length; si++) {
    const sec = layout.sections[si];
    let flat = 0;
    const total = sec.measures.length + (sec.endings?.flat().length ?? 0);

    for (let mi = 0; mi < sec.measures.length; mi++) {
      if (sec.measures[mi].chordIndices.includes(chordIdx)) {
        return { sectionIdx: si, measureIdx: mi, flatIdx: flat, totalMeasures: total };
      }
      flat++;
    }
    if (sec.endings) {
      for (let ei = 0; ei < sec.endings.length; ei++) {
        for (let mi = 0; mi < sec.endings[ei].length; mi++) {
          if (sec.endings[ei][mi].chordIndices.includes(chordIdx)) {
            return { sectionIdx: si, measureIdx: mi, endingIdx: ei, flatIdx: flat, totalMeasures: total };
          }
          flat++;
        }
      }
    }
  }
  return null;
}

/**
 * Adjust the split point between ending[0] and ending[1].
 * `end2FlatIdx` is the index within the flat endings array (all endings concatenated)
 * where ending[1] should start.
 */
export function adjustEndingSplit(
  layout: ChartLayout,
  sectionIdx: number,
  end2FlatIdx: number,
): ChartLayout {
  const sec = layout.sections[sectionIdx];
  if (!sec.endings || sec.endings.length === 0) return layout;

  const allEndings = sec.endings.flat();
  if (end2FlatIdx < 1 || end2FlatIdx >= allEndings.length) return layout;

  const updated: ChartSection = {
    ...sec,
    endings: [allEndings.slice(0, end2FlatIdx), allEndings.slice(end2FlatIdx)],
  };
  const sections = layout.sections.map((s, i) => i === sectionIdx ? updated : s);
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
