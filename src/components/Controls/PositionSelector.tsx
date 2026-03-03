import type { Position, FoundVoicing } from '../../types';
import { POS_COLORS } from '../../constants';
import { VoicingGrid } from './VoicingGrid';

interface PositionSelectorProps {
  positions: Position[];
  selPosIds: number[];
  overlay: boolean;
  onSelectAll: () => void;
  onSelectPosition: (id: number, shiftKey: boolean) => void;
  onToggleOverlay: () => void;
  availableVoicings?: FoundVoicing[];
  selectedVoicingIdx?: number;
  onSelectVoicing?: (idx: number) => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]';

export function PositionSelector({
  positions, selPosIds, overlay,
  onSelectAll, onSelectPosition, onToggleOverlay,
  availableVoicings, selectedVoicingIdx, onSelectVoicing,
}: PositionSelectorProps) {
  const hasVoicings = availableVoicings && availableVoicings.length > 0 && onSelectVoicing;

  return (
    <div className="flex items-start gap-3 mb-2.5">
      <div>
        <div className="text-[9px] text-text-dim mb-0.5">ポジション</div>
        <div className="flex flex-wrap gap-[5px] items-center">
        <button onClick={onSelectAll}
          className={btnBase}
          style={{
            border: '1px solid #444',
            background: selPosIds.length === 0 && !overlay ? '#3a3a3a' : '#1a1a1a',
            color: '#CCC',
          }}
        >全表示</button>

        {positions.map((p, i) => {
          const c = POS_COLORS[i];
          const active = selPosIds.includes(p.id);
          return (
            <button key={p.id} onClick={(e) => onSelectPosition(p.id, e.shiftKey)}
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
      </div>

      {hasVoicings && (
        <VoicingGrid
          availableVoicings={availableVoicings!}
          selectedVoicingIdx={selectedVoicingIdx ?? 0}
          onSelectVoicing={onSelectVoicing!}
        />
      )}
    </div>
  );
}
