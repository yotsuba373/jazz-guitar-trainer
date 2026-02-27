import type { Mode } from '../../types';
import { MODE_COLORS } from '../../constants';

interface ModeSelectorProps {
  modes: Mode[];
  modeIdx: number;
  onModeChange: (index: number) => void;
}

export function ModeSelector({ modes, modeIdx, onModeChange }: ModeSelectorProps) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-1">
        {modes.map((m, i) => {
          const active = modeIdx === i;
          const c = MODE_COLORS[m.key];
          return (
            <button key={m.key} onClick={() => onModeChange(i)}
              className="rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]"
              style={{
                border: `1px solid ${c}`,
                background: active ? c : '#1a1a1a',
                color: active ? '#FFF' : c,
                fontWeight: active ? 700 : 400,
              }}
            >C {m.name}</button>
          );
        })}
      </div>
    </div>
  );
}
