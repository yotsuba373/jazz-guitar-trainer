import type { RootName } from '../../types';

interface RootSelectorProps {
  roots: { name: RootName; semitone: number }[];
  selectedRoot: RootName;
  onRootChange: (root: RootName) => void;
}

export function RootSelector({ roots, selectedRoot, onRootChange }: RootSelectorProps) {
  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-1">
        {roots.map(r => {
          const active = selectedRoot === r.name;
          return (
            <button key={r.name} onClick={() => onRootChange(r.name)}
              className="rounded cursor-pointer text-[10px] font-mono px-2 py-[5px]"
              style={{
                border: `1px solid ${active ? '#FFF' : '#444'}`,
                background: active ? '#FFF' : '#1a1a1a',
                color: active ? '#000' : '#888',
                fontWeight: active ? 700 : 400,
              }}
            >{r.name}</button>
          );
        })}
      </div>
    </div>
  );
}
