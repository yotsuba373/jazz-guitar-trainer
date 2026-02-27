import type { Position } from '../types';
import { POS_COLORS } from '../constants';

interface PositionGridProps {
  positions: Position[];
  selPosId: number | null;
  onSelectPosition: (id: number) => void;
}

export function PositionGrid({ positions, selPosId, onSelectPosition }: PositionGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-1.5 mb-[14px]">
      {positions.map((p, i) => {
        const c = POS_COLORS[i];
        return (
          <div key={p.id} onClick={() => onSelectPosition(p.id)}
            className="rounded-md px-3 py-2 cursor-pointer transition-all duration-150"
            style={{
              background: selPosId === p.id ? '#222' : '#181818',
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
