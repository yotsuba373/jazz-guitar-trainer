import { useState, useRef, useEffect } from 'react';
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
  onClear: () => void;
}

export function LickControls({
  licks, selectedIdx, onSelect, onPlay, onStop, isPlaying, lickType, onClear,
}: LickControlsProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const hasSelection = selectedIdx != null;
  return (
    <div className="relative inline-flex items-center gap-1.5" ref={panelRef}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(p => !p)}
        className="rounded cursor-pointer text-[10px] font-mono px-2.5 py-[4px]"
        style={{
          border: `1px solid ${open ? '#FFF' : hasSelection ? '#8F8' : '#555'}`,
          background: open ? '#2a2a3a' : hasSelection ? '#1a2a1a' : '#1a1a1a',
          color: open ? '#FFF' : hasSelection ? '#8F8' : '#AAA',
        }}
      >
        {hasSelection
          ? `リック #${selectedIdx + 1}`
          : `リック (${licks.length})`}
      </button>

      {/* Play/Stop inline (when lick selected) */}
      {hasSelection && (
        <>
          <button
            onClick={isPlaying ? onStop : onPlay}
            className="rounded cursor-pointer text-[10px] font-mono px-2 py-[4px]"
            style={{
              border: '1px solid #555',
              background: isPlaying ? '#3a2020' : '#1a2a1a',
              color: isPlaying ? '#F88' : '#8F8',
            }}
          >
            {isPlaying ? '■' : '▶'}
          </button>
          <button
            onClick={() => { onClear(); onStop(); }}
            className="rounded cursor-pointer text-[10px] font-mono px-1.5 py-[4px]"
            style={{ border: '1px solid #444', background: '#1a1a1a', color: '#888' }}
            title="リック解除"
          >
            ✕
          </button>
        </>
      )}

      {/* Floating popup panel */}
      {open && (
        <div
          className="absolute z-50 rounded-md px-3 py-2"
          style={{
            top: '100%',
            left: 0,
            marginTop: '4px',
            background: '#1a1a1a',
            border: '1px solid #555',
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            minWidth: '280px',
            maxWidth: '360px',
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] text-text-secondary font-bold">リック練習</span>
            <span className="text-[10px] text-text-dim">[{lickType}: {licks.length}件]</span>
          </div>

          {licks.length === 0 ? (
            <p className="text-[10px] text-text-dim py-2">
              このコード品質のリックがありません
            </p>
          ) : (
            <div className="overflow-y-auto" style={{ maxHeight: '200px' }}>
              {licks.map((lick, i) => {
                const isSelected = i === selectedIdx;
                const sourceName = lick.source
                  ? (SOURCE_DISPLAY_NAMES[lick.source] ?? lick.source)
                  : '';
                return (
                  <div
                    key={i}
                    onClick={() => { onSelect(i); setOpen(false); }}
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
          )}
        </div>
      )}
    </div>
  );
}
