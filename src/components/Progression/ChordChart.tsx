import { useRef, useMemo, Fragment } from 'react';
import type { Progression, ChordNotationPrefs, ChartMeasure } from '../../types';
import type { EffectiveChord } from '../../utils/progression';
import { POS_COLORS } from '../../constants';
import { QUALITY_TO_MODES, isDiatonic, displayChordName, getChartLayout } from '../../utils';

interface ChordChartProps {
  progression: Progression;
  activeChordIdx: number;
  effectiveAll: EffectiveChord[];
  chordPrefs: ChordNotationPrefs;
  onChordSelect: (idx: number) => void;
}

export function ChordChart({
  progression, activeChordIdx, effectiveAll, chordPrefs, onChordSelect,
}: ChordChartProps) {
  const layout = useMemo(() => getChartLayout(progression), [progression]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { sections, barsPerRow } = layout;
  const chords = progression.chords;
  const hasLabels = sections.some(s => s.label || (s.endings && s.endings.length > 0));

  /** Render a single chord button */
  function renderChord(ci: number) {
    const c = chords[ci];
    if (!c) return null;
    const active = ci === activeChordIdx;
    const supported = QUALITY_TO_MODES[c.quality] != null;
    const diatonic = !progression.songKey || !supported
      || isDiatonic(c.rootName, c.quality, progression.songKey);
    const eff = effectiveAll[ci];
    const posColor = eff ? POS_COLORS[eff.posId - 1] : '#555';

    return (
      <button
        key={ci}
        onClick={() => onChordSelect(ci)}
        className="cursor-pointer font-mono text-[12px] font-bold px-1 py-0.5 rounded"
        style={{
          background: active ? posColor + '40' : 'transparent',
          color: !supported ? '#555'
            : !diatonic ? '#E67E22'
            : active ? '#FFF'
            : '#AAA',
          outline: active ? `2px solid ${posColor}` : 'none',
          outlineOffset: '1px',
        }}
      >
        {displayChordName(c, chordPrefs)}
      </button>
    );
  }

  /** Render a grid row of measures */
  function renderMeasureRow(
    measures: ChartMeasure[],
    key: string,
    labelContent: string,
    opts: {
      repeatStart?: boolean;
      repeatEnd?: boolean;
      endingBracket?: boolean;
    } = {},
  ) {
    return (
      <div
        key={key}
        className="grid"
        style={{
          gridTemplateColumns: hasLabels
            ? `28px repeat(${barsPerRow}, 1fr)`
            : `repeat(${barsPerRow}, 1fr)`,
        }}
      >
        {/* Label column */}
        {hasLabels && (
          <div
            className="text-[11px] font-bold self-center text-center"
            style={{
              color: labelContent ? (opts.endingBracket ? '#666' : '#888') : 'transparent',
              borderRight: '2px solid #333',
              fontSize: opts.endingBracket ? '10px' : undefined,
            }}
          >
            {labelContent || '\u00A0'}
          </div>
        )}

        {/* Measure cells */}
        {measures.map((measure, mi) => {
          const isFirstCell = mi === 0;
          const isLastCell = mi === measures.length - 1;

          return (
            <div
              key={mi}
              className="flex items-center gap-1 px-2 py-1.5 min-h-[36px]"
              style={{
                borderRight: isLastCell && opts.repeatEnd
                  ? '4px double #888'
                  : '1px solid #333',
                borderLeft: isFirstCell && opts.repeatStart
                  ? '4px double #888'
                  : undefined,
                borderBottom: '1px solid #222',
                borderTop: isFirstCell && opts.endingBracket
                  ? '1px solid #666'
                  : undefined,
              }}
            >
              {isFirstCell && opts.repeatStart && (
                <span className="flex flex-col text-[8px] leading-[6px] text-[#888] -ml-1 mr-0.5">
                  <span>•</span><span>•</span>
                </span>
              )}
              {measure.chordIndices.map((ci, i) => {
                const beats = measure.beatWidths?.[i] ?? 1;
                return (
                  <div key={ci} style={{ flex: beats }}>
                    {renderChord(ci)}
                  </div>
                );
              })}
              {isLastCell && opts.repeatEnd && (
                <span className="flex flex-col text-[8px] leading-[6px] text-[#888] ml-auto -mr-1">
                  <span>•</span><span>•</span>
                </span>
              )}
            </div>
          );
        })}

        {/* Pad empty cells */}
        {Array.from(
          { length: barsPerRow - measures.length },
          (_, i) => (
            <div
              key={`pad-${i}`}
              className="min-h-[36px]"
              style={{
                borderRight: '1px solid #333',
                borderBottom: '1px solid #222',
              }}
            />
          ),
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mb-2 rounded border border-[#333] bg-[#111]"
    >
      {sections.map((section, si) => {
        const hasRepeat = section.repeats != null && section.repeats >= 1;
        const hasEndings = section.endings && section.endings.length > 0;

        // Break main measures into rows of barsPerRow
        const measureRows: ChartMeasure[][] = [];
        for (let i = 0; i < section.measures.length; i += barsPerRow) {
          measureRows.push(section.measures.slice(i, i + barsPerRow));
        }

        return (
          <Fragment key={si}>
            {/* Main section rows */}
            {measureRows.map((rowMeasures, ri) => {
              const isFirstRow = ri === 0;
              const isLastRow = ri === measureRows.length - 1;
              const labelContent = isFirstRow ? section.label : '';

              return renderMeasureRow(
                rowMeasures,
                `${si}-${ri}`,
                labelContent,
                {
                  repeatStart: hasRepeat && isFirstRow,
                  repeatEnd: hasRepeat && isLastRow && !hasEndings,
                },
              );
            })}

            {/* Ending rows */}
            {hasEndings && section.endings!.map((endingMeasures, ei) => {
              const endingRows: ChartMeasure[][] = [];
              for (let i = 0; i < endingMeasures.length; i += barsPerRow) {
                endingRows.push(endingMeasures.slice(i, i + barsPerRow));
              }

              return endingRows.map((rowMeasures, ri) => {
                const isFirstEndingRow = ri === 0;
                const isLastEndingRow = ri === endingRows.length - 1;
                const isLastEnding = ei === section.endings!.length - 1;
                const labelContent = isFirstEndingRow ? `${ei + 1}.` : '';

                return renderMeasureRow(
                  rowMeasures,
                  `${si}-e${ei}-${ri}`,
                  labelContent,
                  {
                    endingBracket: isFirstEndingRow,
                    repeatEnd: hasRepeat && isLastEndingRow && isLastEnding,
                  },
                );
              });
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
