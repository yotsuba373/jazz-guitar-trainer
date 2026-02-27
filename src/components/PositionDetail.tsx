import type { FretNote, Mode, Position } from '../types';
import { STR_LABELS, POS_COLORS } from '../constants';

interface PositionDetailProps {
  position: Position;
  mode: Mode;
  showCT: boolean;
  ctSet: Set<string>;
  getLabel: (nn: string) => string;
  rootNote: string;
}

export function PositionDetail({ position, mode, showCT, ctSet, getLabel, rootNote }: PositionDetailProps) {
  const posColor = POS_COLORS[position.id - 1];
  const deg = mode.degrees;

  return (
    <div className="bg-bg-panel rounded-lg p-[14px] mb-[14px]"
      style={{ borderLeft: `4px solid ${posColor}` }}>
      <div className="text-[15px] font-bold mb-1.5" style={{ color: posColor }}>
        {rootNote} {mode.name} — Position {position.id}
      </div>
      <div className="text-[10px] text-text-dim mb-2">
        fret {position.range} ｜ B弦: {position.bPair}
      </div>
      {position.instances.map((inst, iIdx) => (
        <div key={iIdx} className="font-mono text-[11px] leading-[1.7] text-text-muted bg-bg-code px-2.5 py-2 rounded mb-1">
          <div className="text-[9px] text-text-dim mb-0.5">fret {inst.fretMin}–{inst.fretMax}</div>
          {STR_LABELS.map((sl, sIdx) => {
            const notes: FretNote[] | null = inst.strings[sIdx];
            if (!notes) return null;
            const is2 = sIdx === 1;
            return (
              <div key={sIdx} style={{ color: is2 ? posColor : '#777' }}>
                <span className="inline-block w-4" style={{ fontWeight: is2 ? 700 : 400 }}>{sl}</span>
                |{notes.map(([n, f]) => {
                  const lbl = getLabel(n);
                  const isRoot = n === rootNote;
                  const isCT = showCT && ctSet.has(n);
                  const m = isRoot ? '●' : (isCT ? '◆' : ' ');
                  return `--${String(f).padStart(2)}(${lbl.padEnd(2)})${m}`;
                }).join('')}--|{is2 ? ' ★' : ''}
              </div>
            );
          })}
        </div>
      ))}
      {showCT && (
        <div className="text-[10px] text-text-muted mt-1.5">
          {mode.chord}: {mode.chordTones.map(n => `${n}(${deg[n]})`).join(' ')}
        </div>
      )}
    </div>
  );
}
