import { useRef, useMemo, Fragment } from 'react';
import type { Progression, ChordNotationPrefs, ChartMeasure } from '../../types';
import type { EffectiveChord } from '../../utils/progression';
import { POS_COLORS } from '../../constants';
import { QUALITY_TO_MODES, isDiatonic, displayChordName, getChartLayout } from '../../utils';

export type SelectedBeatInfo =
  | { type: 'chord'; chordIdx: number; beat: number }
  | { type: 'empty'; sectionIdx: number; measureIdx: number; endingIdx?: number; beat: number };

interface ChordChartProps {
  progression: Progression;
  activeChordIdx: number;
  effectiveAll: EffectiveChord[];
  chordPrefs: ChordNotationPrefs;
  onChordSelect: (idx: number) => void;
  editing?: boolean;
  onRemoveChord?: (idx: number) => void;
  onInsertAtBeat?: (referenceIdx: number, beat: number) => void;
  /** Callback for clicking a beat in an empty measure. Args: (sectionIdx, measureIdx, endingIdx | undefined, beat) */
  onEmptyMeasureBeat?: (sectionIdx: number, measureIdx: number, endingIdx: number | undefined, beat: number) => void;
  onRemoveEmptyMeasure?: (sectionIdx: number, measureIdx: number, endingIdx: number | undefined) => void;
  selectedBeat?: SelectedBeatInfo | null;
}

export function ChordChart({
  progression, activeChordIdx, effectiveAll, chordPrefs, onChordSelect,
  editing, onRemoveChord, onInsertAtBeat, onEmptyMeasureBeat, onRemoveEmptyMeasure, selectedBeat,
}: ChordChartProps) {
  const layout = useMemo(() => getChartLayout(progression), [progression]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { sections, barsPerRow } = layout;
  const chords = progression.chords;
  // When editing, always show label column for section visibility
  const hasLabels = editing
    ? true
    : sections.some(s => s.label || (s.endings && s.endings.length > 0));

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
      <span key={ci} className="relative inline-flex items-center">
        <button
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
        {editing && onRemoveChord && (
          <button
            onClick={e => { e.stopPropagation(); onRemoveChord(ci); }}
            className="absolute -top-1.5 -right-2 w-[14px] h-[14px] rounded-full text-[12px] font-black leading-none flex items-center justify-center cursor-pointer"
            style={{ background: '#444', color: '#aaa' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#E74C3C'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#444'; e.currentTarget.style.color = '#aaa'; }}
            title="削除"
          >
            ×
          </button>
        )}
      </span>
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
      sectionIdx?: number;
      endingIdx?: number;
      measureOffset?: number; // offset within section for measure index
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
          const borderStyles: React.CSSProperties = {
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
          };

          // --- Editing mode: beat grid (always 4 columns for 4/4) ---
          if (editing && onInsertAtBeat) {
            const BEATS = 4;
            const n = measure.chordIndices.length;
            const repeatStart = isFirstCell && opts.repeatStart;
            const repeatEnd = isLastCell && opts.repeatEnd;

            // Empty measure — "+" on beat 1, dashed lines on beats 2-4
            if (n === 0) {
              const absMi = (opts.measureOffset ?? 0) + mi;
              const emptySelected = selectedBeat?.type === 'empty'
                && selectedBeat.sectionIdx === (opts.sectionIdx ?? 0)
                && selectedBeat.measureIdx === absMi
                && selectedBeat.endingIdx === opts.endingIdx;
              return (
                <div
                  key={mi}
                  className="relative grid items-center min-h-[36px]"
                  style={{
                    gridTemplateColumns: `repeat(${BEATS}, 1fr)`,
                    borderRight: '1px solid #333',
                    borderBottom: borderStyles.borderBottom,
                    borderTop: borderStyles.borderTop,
                  }}
                >
                  {repeatStart && (
                    <span className="absolute left-0.5 top-1/2 -translate-y-1/2 flex flex-col text-[8px] leading-[6px] text-[#888] z-10 pointer-events-none">
                      <span>•</span><span>•</span>
                    </span>
                  )}
                  {repeatEnd && (
                    <span className="absolute right-0.5 top-1/2 -translate-y-1/2 flex flex-col text-[8px] leading-[6px] text-[#888] z-10 pointer-events-none">
                      <span>•</span><span>•</span>
                    </span>
                  )}
                  <div
                    className="flex items-center justify-center cursor-pointer py-1.5"
                    style={{ background: emptySelected ? '#27AE6020' : undefined }}
                    onClick={() => onEmptyMeasureBeat?.(opts.sectionIdx ?? 0, absMi, opts.endingIdx, 1)}
                    title="1拍目に挿入"
                  >
                    <span className="text-[13px] font-bold select-none"
                      style={{ color: emptySelected ? '#27AE60' : '#555' }}>+</span>
                  </div>
                  {Array.from({ length: BEATS - 1 }, (_, i) => (
                    <div key={i + 1} className="relative py-1.5">
                      <div className="absolute left-0 top-[6px] bottom-[6px]"
                        style={{ borderLeft: '1px dashed #2a2a2a' }} />
                      <span className="invisible text-[13px]">+</span>
                    </div>
                  ))}
                  {onRemoveEmptyMeasure && (
                    <button
                      onClick={e => { e.stopPropagation(); onRemoveEmptyMeasure(opts.sectionIdx ?? 0, absMi, opts.endingIdx); }}
                      className="absolute right-[4px] top-1/2 -translate-y-1/2 w-[14px] h-[22px] rounded-sm text-[14px] font-black leading-none flex items-center justify-center cursor-pointer z-10"
                      style={{ background: '#444', color: '#aaa', border: '1px solid #555' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#E74C3C'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#E74C3C'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#444'; e.currentTarget.style.color = '#aaa'; e.currentTarget.style.borderColor = '#555'; }}
                      title="小節を削除"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            }

            const bwSum = measure.beatWidths
              ? measure.beatWidths.reduce((a, b) => a + b, 0)
              : n;
            type BeatCell = { ci: number; isStart: boolean };
            const cells: BeatCell[] = [];
            let acc = 0;
            for (let i = 0; i < n; i++) {
              const ci = measure.chordIndices[i];
              const bw = measure.beatWidths?.[i] ?? 1;
              const start = Math.round(acc / bwSum * BEATS);
              acc += bw;
              const end = Math.round(acc / bwSum * BEATS);
              for (let b = start; b < end; b++) {
                cells[b] = { ci, isStart: b === start };
              }
            }
            return (
              <div
                key={mi}
                className="relative grid items-center min-h-[36px]"
                style={{
                  gridTemplateColumns: `repeat(${BEATS}, 1fr)`,
                  borderRight: '1px solid #333',
                  borderBottom: borderStyles.borderBottom,
                  borderTop: borderStyles.borderTop,
                }}
              >
                {repeatStart && (
                  <span className="absolute left-0.5 top-1/2 -translate-y-1/2 flex flex-col text-[8px] leading-[6px] text-[#888] z-10 pointer-events-none">
                    <span>•</span><span>•</span>
                  </span>
                )}
                {repeatEnd && (
                  <span className="absolute right-0.5 top-1/2 -translate-y-1/2 flex flex-col text-[8px] leading-[6px] text-[#888] z-10 pointer-events-none">
                    <span>•</span><span>•</span>
                  </span>
                )}
                {cells.map((cell, b) => {
                  const dashLine = b > 0 && (
                    <div className="absolute left-0 top-[6px] bottom-[6px]"
                      style={{ borderLeft: '1px dashed #2a2a2a' }} />
                  );
                  if (cell.isStart) {
                    const chordSel = selectedBeat?.type === 'chord'
                      && selectedBeat.chordIdx === cell.ci && selectedBeat.beat === 0;
                    return (
                      <div key={b} className="relative flex items-center justify-center min-w-0 py-1.5 px-0.5"
                        style={{ background: chordSel ? '#F1C40F18' : undefined }}
                        onClick={() => { onChordSelect(cell.ci); onInsertAtBeat(cell.ci, 0); }}>
                        {dashLine}
                        {renderChord(cell.ci)}
                      </div>
                    );
                  }
                  const plusSel = selectedBeat?.type === 'chord'
                    && selectedBeat.chordIdx === cell.ci && selectedBeat.beat === b + 1;
                  return (
                    <div key={b}
                      className="relative flex items-center justify-center cursor-pointer py-1.5"
                      style={{ background: plusSel ? '#27AE6020' : undefined }}
                      onClick={() => onInsertAtBeat(cell.ci, b + 1)}
                      title={`${b + 1}拍目に挿入`}>
                      {dashLine}
                      <span className="text-[13px] font-bold select-none"
                        style={{ color: plusSel ? '#27AE60' : '#555' }}>+</span>
                    </div>
                  );
                })}
              </div>
            );
          }

          // --- Normal mode: flex layout ---
          return (
            <div
              key={mi}
              className="flex items-center gap-1 px-2 py-1.5 min-h-[36px]"
              style={borderStyles}
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
                  sectionIdx: si,
                  measureOffset: ri * barsPerRow,
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
                const labelContent = isFirstEndingRow ? `${ei + 1}.` : '';

                return renderMeasureRow(
                  rowMeasures,
                  `${si}-e${ei}-${ri}`,
                  labelContent,
                  {
                    endingBracket: isFirstEndingRow,
                    repeatEnd: hasRepeat && isLastEndingRow && ei === 0,
                    sectionIdx: si,
                    endingIdx: ei,
                    measureOffset: ri * barsPerRow,
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
