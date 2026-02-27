import type { Position } from '../../types';
import { POS_COLORS } from '../../constants';

interface PositionSelectorProps {
  positions: Position[];
  selPosId: number | null;
  overlay: boolean;
  onSelectAll: () => void;
  onSelectPosition: (id: number) => void;
  onToggleOverlay: () => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]';

export function PositionSelector({
  positions, selPosId, overlay,
  onSelectAll, onSelectPosition, onToggleOverlay,
}: PositionSelectorProps) {
  return (
    <div className="flex flex-wrap gap-[5px] mb-2.5">
      <button onClick={onSelectAll}
        className={btnBase}
        style={{
          border: '1px solid #444',
          background: !selPosId && !overlay ? '#3a3a3a' : '#1a1a1a',
          color: '#CCC',
        }}
      >全表示</button>

      {positions.map((p, i) => {
        const c = POS_COLORS[i];
        const active = selPosId === p.id;
        return (
          <button key={p.id} onClick={() => onSelectPosition(p.id)}
            className={btnBase}
            style={{
              border: `1px solid ${c}`,
              background: active ? c : '#1a1a1a',
              color: active ? '#FFF' : c,
              fontWeight: active ? 700 : 400,
            }}
          >Pos {p.id}</button>
        );
      })}

      <button onClick={onToggleOverlay}
        className={btnBase}
        style={{
          border: '1px solid #666',
          background: overlay ? '#3a3a3a' : '#1a1a1a',
          color: '#CCC',
        }}
      >重ねる</button>
    </div>
  );
}
