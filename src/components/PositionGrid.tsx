import type { Position } from '../types';
import { POS_COLORS } from '../constants';

interface PositionGridProps {
  positions: Position[];
  selPosIds: number[];
  onSelectPosition: (id: number, shiftKey: boolean) => void;
}

export function PositionGrid({ positions, selPosIds, onSelectPosition }: PositionGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-1.5 mb-[14px]">
      {positions.map((p, i) => {
        const c = POS_COLORS[i];
        return (
          <div key={p.id} onClick={(e) => onSelectPosition(p.id, e.shiftKey)}
            className="rounded-md px-3 py-2 cursor-pointer transition-all duration-150"
            style={{
              background: selPosIds.includes(p.id) ? '#222' : '#181818',
              borderLeft: `3px solid ${c}`,
            }}
          >
            <span className="font-bold text-xs" style={{ color: c }}>Pos {p.id}</span>
            <div className="text-text-dim text-[10px] mt-0.5">
              fret {p.range} ｜ B弦: {p.bPair}
            </div>
          </div>
        );
      })}
    </div>
  );
}
