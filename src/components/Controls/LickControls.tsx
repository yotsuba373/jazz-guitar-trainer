import type { LickEntry } from '../../types';
import { SOURCE_DISPLAY_NAMES } from '../../utils';

interface LickControlsProps {
  licks: LickEntry[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onPlay: () => void;
  onStop: () => void;
  isPlaying: boolean;
  lickType: string;
}

export function LickControls({
  licks, selectedIdx, onSelect, onPlay, onStop, isPlaying, lickType,
}: LickControlsProps) {
  if (licks.length === 0) {
    return (
      <div className="mb-3 rounded-md px-3 py-2" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
        <p className="text-[10px] text-text-dim">
          このコード品質 ({lickType}) のリックがありません
        </p>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md px-3 py-2" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] text-text-secondary font-bold">リック練習</span>
        <span className="text-[10px] text-text-dim">[{lickType}: {licks.length}件]</span>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: '160px' }}>
        {licks.map((lick, i) => {
          const isSelected = i === selectedIdx;
          const sourceName = lick.source
            ? (SOURCE_DISPLAY_NAMES[lick.source] ?? lick.source)
            : '';
          return (
            <div
              key={i}
              onClick={() => onSelect(i)}
              className="cursor-pointer rounded px-2 py-[3px] flex items-center gap-2 text-[10px]"
              style={{
                background: isSelected ? '#2a2a3a' : 'transparent',
                border: isSelected ? '1px solid #555' : '1px solid transparent',
                color: isSelected ? '#FFF' : '#AAA',
              }}
            >
              <span className="text-text-dim w-[28px]">#{i + 1}</span>
              <span className="w-[50px]">{lick.noteCount}音 {lick.beats}拍</span>
              {lick.anacrusis != null && lick.anacrusis > 0 && (
                <span className="text-text-dim text-[9px]">+{lick.anacrusis}拍</span>
              )}
              <span className="text-text-dim flex-1 truncate">{sourceName || '(不明)'}</span>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-1.5">
        <button
          onClick={isPlaying ? onStop : onPlay}
          disabled={selectedIdx == null}
          className="rounded cursor-pointer text-[10px] font-mono px-3 py-[4px]"
          style={{
            border: '1px solid #555',
            background: isPlaying ? '#3a2020' : '#1a2a1a',
            color: selectedIdx == null ? '#555' : isPlaying ? '#F88' : '#8F8',
            opacity: selectedIdx == null ? 0.5 : 1,
          }}
        >
          {isPlaying ? '■ Stop' : '▶ Play'}
        </button>
      </div>
    </div>
  );
}
