import { useMemo } from 'react';
import type { ModeTemplate, RootName } from '../../types';
import { MODE_COLORS } from '../../constants';

interface ModeSelectorProps {
  templates: ModeTemplate[];
  modeIdx: number;
  rootName: RootName;
  onModeChange: (index: number) => void;
}

const MODE_FAMILIES = [
  { label: 'Diatonic', end: 7 },
  { label: 'Melodic Minor', end: 14 },
  { label: 'Harmonic Minor', end: Infinity },
] as const;

export function ModeSelector({ templates, modeIdx, rootName, onModeChange }: ModeSelectorProps) {
  const groups = useMemo(() =>
    MODE_FAMILIES
      .map(({ label, end }, gi) => {
        const start = gi === 0 ? 0 : MODE_FAMILIES[gi - 1].end;
        return { label, modes: templates.slice(start, Math.min(end, templates.length)), startIdx: start };
      })
      .filter(g => g.modes.length > 0),
    [templates],
  );

  return (
    <div className="mb-3 flex flex-col gap-1">
      {groups.map(g => (
        <div key={g.label} className="flex flex-wrap gap-1 items-center">
          <span className="text-[8px] text-text-dim w-[80px] shrink-0">{g.label}</span>
          {g.modes.map((m, i) => {
            const idx = g.startIdx + i;
            const active = modeIdx === idx;
            const c = MODE_COLORS[m.key];
            return (
              <button key={m.key} onClick={() => onModeChange(idx)}
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
      ))}
    </div>
  );
}
