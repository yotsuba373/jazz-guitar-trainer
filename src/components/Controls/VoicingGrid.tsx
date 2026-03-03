import type { FoundVoicing } from '../../types';

interface VoicingGridProps {
  availableVoicings: FoundVoicing[];
  selectedVoicingIdx: number;
  onSelectVoicing: (idx: number) => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-1.5 py-[3px]';

export function VoicingGrid({ availableVoicings, selectedVoicingIdx, onSelectVoicing }: VoicingGridProps) {
  const count = availableVoicings.length;
  if (count === 0) return null;

  const selected = availableVoicings[selectedVoicingIdx];
  if (!selected) return null;

  const typeName = selected.template.type === 'drop2' ? 'Drop2' : 'Drop3';
  const invName = selected.template.inversionName;

  function prev() {
    onSelectVoicing((selectedVoicingIdx - 1 + count) % count);
  }
  function next() {
    onSelectVoicing((selectedVoicingIdx + 1) % count);
  }

  return (
    <div>
      <div className="text-[9px] text-text-dim mb-0.5">コードフォーム</div>
      <div className="flex items-center gap-1">
        <button onClick={prev} className={btnBase}
          style={{ border: '1px solid #00E5FF', background: '#1a1a1a', color: '#00E5FF' }}>
          ◀
        </button>
        <span className="text-[10px] font-mono text-[#00E5FF] min-w-[90px] text-center">
          {typeName} {invName}
        </span>
        <button onClick={next} className={btnBase}
          style={{ border: '1px solid #00E5FF', background: '#1a1a1a', color: '#00E5FF' }}>
          ▶
        </button>
        <span className="text-[9px] text-text-dim ml-1">
          ({selectedVoicingIdx + 1}/{count})
        </span>
      </div>
    </div>
  );
}
