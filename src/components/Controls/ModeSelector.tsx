import type { ModeTemplate, RootName } from '../../types';
import { MODE_COLORS } from '../../constants';

interface ModeSelectorProps {
  templates: ModeTemplate[];
  modeIdx: number;
  rootName: RootName;
  onModeChange: (index: number) => void;
}

export function ModeSelector({ templates, modeIdx, rootName, onModeChange }: ModeSelectorProps) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-1">
        {templates.map((m, i) => {
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
            >{rootName} {m.name}</button>
          );
        })}
      </div>
    </div>
  );
}
