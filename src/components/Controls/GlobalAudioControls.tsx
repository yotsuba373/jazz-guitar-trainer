import { useState, useEffect, useRef, useCallback } from 'react';
import type { InstrumentType } from '../../types';

interface GlobalAudioControlsProps {
  bpm: number;
  onBpmChange: (bpm: number) => void;
  isMetronomeOn: boolean;
  onToggleMetronome: () => void;
  chordAudioOn: boolean;
  onToggleChordAudio: () => void;
  metVolume: number;
  onMetVolumeChange: (v: number) => void;
  chordVolume: number;
  onChordVolumeChange: (v: number) => void;
  noteVolume: number;
  onNoteVolumeChange: (v: number) => void;
  instrument: InstrumentType;
  onInstrumentChange: (inst: InstrumentType) => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  showPlayButton?: boolean;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2 h-[24px] inline-flex items-center';

export function GlobalAudioControls({
  bpm, onBpmChange,
  isMetronomeOn, onToggleMetronome,
  chordAudioOn, onToggleChordAudio,
  metVolume, onMetVolumeChange,
  chordVolume, onChordVolumeChange,
  noteVolume, onNoteVolumeChange,
  instrument, onInstrumentChange,
  isPlaying, onTogglePlay, showPlayButton,
}: GlobalAudioControlsProps) {
  const [bpmStr, setBpmStr] = useState(String(bpm));
  useEffect(() => setBpmStr(String(bpm)), [bpm]);
  function commitBpm() {
    const v = parseInt(bpmStr, 10);
    const clamped = isNaN(v) ? bpm : Math.max(40, Math.min(240, v));
    onBpmChange(clamped);
    setBpmStr(String(clamped));
  }

  const [volOpen, setVolOpen] = useState(false);
  const volRef = useRef<HTMLDivElement>(null);
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (volRef.current && !volRef.current.contains(e.target as Node)) setVolOpen(false);
  }, []);
  useEffect(() => {
    if (volOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [volOpen, handleClickOutside]);

  return (
    <div className="flex items-center gap-2 mb-3">
      {showPlayButton && onTogglePlay && (
        <button
          onClick={onTogglePlay}
          className="rounded cursor-pointer px-3 h-[24px] inline-flex items-center"
          style={{
            border: `1px solid ${isPlaying ? '#E74C3C' : '#27AE60'}`,
            background: isPlaying ? '#2a1010' : '#102a10',
            color: isPlaying ? '#E74C3C' : '#27AE60',
          }}
        >
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="1" y="1" width="3.5" height="10" rx="1"/>
              <rect x="7.5" y="1" width="3.5" height="10" rx="1"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <polygon points="2,1 11,6 2,11"/>
            </svg>
          )}
        </button>
      )}
      <button
        onClick={onToggleMetronome}
        title="メトロノーム"
        className={btnBase}
        style={{
          border: `1px solid ${isMetronomeOn ? '#F1C40F' : '#444'}`,
          background: isMetronomeOn ? '#2a2a1a' : '#1a1a1a',
          color: isMetronomeOn ? '#F1C40F' : '#888',
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M14.153 8.188l-.72 -3.236a2.493 2.493 0 0 0 -4.867 0l-3.025 13.614a2 2 0 0 0 1.952 2.434h7.014a2 2 0 0 0 1.952 -2.434l-.524 -2.357m-4.935 1.791l9 -13" />
          <path d="M19 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
        </svg>
      </button>
      <button
        onClick={onToggleChordAudio}
        title="コード音"
        className={btnBase}
        style={{
          border: `1px solid ${chordAudioOn ? '#27AE60' : '#444'}`,
          background: chordAudioOn ? '#102a10' : '#1a1a1a',
          color: chordAudioOn ? '#27AE60' : '#888',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
      </button>
      {/* Volume mixer dropdown */}
      <div className="relative inline-flex items-center" ref={volRef}>
        <button
          onClick={() => setVolOpen(v => !v)}
          title="音量設定"
          className={btnBase}
          style={{
            border: `1px solid ${volOpen ? '#CCC' : '#444'}`,
            background: volOpen ? '#2a2a2a' : '#1a1a1a',
            color: volOpen ? '#FFF' : '#888',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        </button>
        {volOpen && (
          <div className="absolute left-0 top-[28px] z-50 rounded-md p-2.5 flex flex-col gap-2 min-w-[200px]"
            style={{ background: '#222', border: '1px solid #555', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <div className="grid gap-2" style={{ gridTemplateColumns: '60px 1fr 28px auto' }}>
              <span className="text-[10px] text-text-dim self-center">メトロノーム</span>
              <input type="range" min={0} max={1} step={0.05}
                value={metVolume}
                onChange={e => onMetVolumeChange(Number(e.target.value))}
                style={{ accentColor: '#F1C40F' }} />
              <span className="text-[10px] text-text-dim text-right self-center">{Math.round(metVolume * 100)}%</span>
              <span />

              <span className="text-[10px] text-text-dim self-center">コード</span>
              <input type="range" min={0} max={1} step={0.05}
                value={chordVolume}
                onChange={e => onChordVolumeChange(Number(e.target.value))}
                style={{ accentColor: '#27AE60' }} />
              <span className="text-[10px] text-text-dim text-right self-center">{Math.round(chordVolume * 100)}%</span>
              <span />

              <span className="text-[10px] text-text-dim self-center">単音</span>
              <input type="range" min={0} max={1} step={0.05}
                value={noteVolume}
                onChange={e => onNoteVolumeChange(Number(e.target.value))}
                style={{ accentColor: '#FF6B9D' }} />
              <span className="text-[10px] text-text-dim text-right self-center">{Math.round(noteVolume * 100)}%</span>
              <div className="flex gap-1">
                {([
                  { key: 'guitar' as InstrumentType, label: '\uD83C\uDFB8', title: 'ギター' },
                  { key: 'saxophone' as InstrumentType, label: '\uD83C\uDFB7', title: 'サクソフォン' },
                ]).map(({ key, label, title }) => (
                  <button key={key}
                    onClick={() => onInstrumentChange(key)}
                    title={title}
                    className="rounded cursor-pointer text-[13px] px-1.5 py-[1px]"
                    style={{
                      border: `1px solid ${instrument === key ? '#FF6B9D' : '#555'}`,
                      background: instrument === key ? '#2a1020' : '#1a1a1a',
                      color: instrument === key ? '#FF6B9D' : '#888',
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => onBpmChange(Math.max(40, bpm - 1))}
        className={btnBase}
        style={{ border: '1px solid #444', background: '#1a1a1a', color: '#AAA' }}
      >−</button>
      <input
        type="number"
        value={bpmStr}
        onChange={e => setBpmStr(e.target.value)}
        onBlur={commitBpm}
        onKeyDown={e => e.key === 'Enter' && commitBpm()}
        className="w-10 text-center bg-transparent font-mono text-[12px] rounded border border-[#444] h-[24px] text-white"
        min={40} max={240}
      />
      <span className="text-[10px] text-text-dim">BPM</span>
      <button
        onClick={() => onBpmChange(Math.min(240, bpm + 1))}
        className={btnBase}
        style={{ border: '1px solid #444', background: '#1a1a1a', color: '#AAA' }}
      >+</button>
    </div>
  );
}
