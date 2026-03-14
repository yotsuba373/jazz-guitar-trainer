import { useState, useEffect, useRef, useCallback } from 'react';
import type { InstrumentType } from '../../types';

interface GlobalAudioControlsProps {
  bpm: number;
  onBpmChange: (bpm: number) => void;
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
  swingEnabled: boolean;
  onToggleSwing: () => void;
  swingAmount: number;
  onSwingAmountChange: (v: number) => void;
  countInEnabled: boolean;
  onToggleCountIn: () => void;
  countInVolume: number;
  onCountInVolumeChange: (v: number) => void;
  countInBars: number;
  isCountingIn?: boolean;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  showPlayButton?: boolean;
  loopLabel?: string;
  onClearLoop?: () => void;
  loopSelecting?: boolean;
  onToggleLoopSelecting?: () => void;
  /** Slot for leading elements (e.g. chord edit button) before play/audio controls */
  leadingSlot?: React.ReactNode;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2 h-[24px] inline-flex items-center';

function MuteBtn({ muted, onToggle, color, label }: { muted: boolean; onToggle: () => void; color: string; label?: string }) {
  const text = label ?? (muted ? 'OFF' : 'ON');
  const active = !muted;
  return (
    <button
      onClick={onToggle}
      className="rounded cursor-pointer min-w-[34px] h-[18px] inline-flex items-center justify-center text-[8px] font-mono font-bold px-1"
      style={{
        border: `1px solid ${active ? color : '#555'}40`,
        background: active ? `${color}10` : '#1a1a1a',
        color: active ? color : '#555',
      }}
    >
      {text}
    </button>
  );
}

export function GlobalAudioControls({
  bpm, onBpmChange,
  chordAudioOn, onToggleChordAudio,
  metVolume, onMetVolumeChange,
  chordVolume, onChordVolumeChange,
  noteVolume, onNoteVolumeChange,
  instrument, onInstrumentChange,
  swingEnabled, onToggleSwing, swingAmount, onSwingAmountChange,
  countInEnabled, onToggleCountIn, countInVolume, onCountInVolumeChange, countInBars, isCountingIn,
  isPlaying, onTogglePlay, showPlayButton,
  loopLabel, onClearLoop, loopSelecting, onToggleLoopSelecting,
  leadingSlot,
}: GlobalAudioControlsProps) {
  const [bpmStr, setBpmStr] = useState(String(bpm));
  useEffect(() => setBpmStr(String(bpm)), [bpm]);
  function commitBpm() {
    const v = parseInt(bpmStr, 10);
    const clamped = isNaN(v) ? bpm : Math.max(40, Math.min(240, v));
    onBpmChange(clamped);
    setBpmStr(String(clamped));
  }

  // Tap tempo state
  const tapTimesRef = useRef<number[]>([]);
  const TAP_RESET_MS = 2000;

  function handleTapTempo() {
    const now = performance.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_MS) {
      taps.length = 0;
    }
    taps.push(now);
    if (taps.length >= 2) {
      const recent = taps.slice(-8);
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) intervals.push(recent[i] - recent[i - 1]);
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const clamped = Math.max(40, Math.min(240, Math.round(60000 / avgMs)));
      onBpmChange(clamped);
    }
  }

  // Mute: store pre-mute volume to restore
  const prevMetVol = useRef(metVolume || 0.5);
  const prevNoteVol = useRef(noteVolume || 0.4);
  const metMuted = metVolume === 0;
  const noteMuted = noteVolume === 0;

  function toggleMetMute() {
    if (metMuted) {
      onMetVolumeChange(prevMetVol.current || 0.5);
    } else {
      prevMetVol.current = metVolume;
      onMetVolumeChange(0);
    }
  }
  function toggleNoteMute() {
    if (noteMuted) {
      onNoteVolumeChange(prevNoteVol.current || 0.4);
    } else {
      prevNoteVol.current = noteVolume;
      onNoteVolumeChange(0);
    }
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
      {leadingSlot}
      {showPlayButton && onTogglePlay && (
        <button
          onClick={onTogglePlay}
          className="rounded cursor-pointer px-3 h-[24px] inline-flex items-center gap-1"
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
          {isCountingIn && (
            <span className="text-[9px] font-mono animate-pulse" style={{ color: '#BB86FC' }}>Count...</span>
          )}
        </button>
      )}
      {/* Loop toggle button + label */}
      {onToggleLoopSelecting && (
        <span className="inline-flex items-center h-[24px] rounded"
          style={{
            border: `1px solid ${loopSelecting ? '#7B68EE' : loopLabel ? '#7B68EE' : '#444'}`,
            background: loopSelecting ? '#7B68EE' : loopLabel ? '#1a1a2a' : '#1a1a1a',
            color: loopSelecting ? '#FFF' : loopLabel ? '#7B68EE' : '#888',
          }}>
          <button
            onClick={onToggleLoopSelecting}
            className="cursor-pointer px-1.5 h-full inline-flex items-center"
            title={loopSelecting ? 'ループ選択を終了' : 'ループ範囲を選択'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
          </button>
          {loopSelecting && (
            <span className="text-[10px] font-mono leading-[24px] cursor-pointer pr-1" onClick={onToggleLoopSelecting}>選択中</span>
          )}
          {!loopSelecting && loopLabel && onClearLoop && (<>
            <span className="text-[10px] font-mono leading-[24px] cursor-pointer" onClick={onToggleLoopSelecting}>{loopLabel}</span>
            <button onClick={onClearLoop} className="cursor-pointer px-1 h-full inline-flex items-center text-[#888] hover:text-[#FFF]" title="ループ解除">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
              </svg>
            </button>
          </>)}
        </span>
      )}
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
          <div className="absolute left-0 top-[28px] z-50 rounded-md p-2.5 flex flex-col gap-2 min-w-[220px]"
            style={{ background: '#222', border: '1px solid #555', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <div className="grid gap-y-1.5 gap-x-1.5 items-center" style={{ gridTemplateColumns: 'auto 68px 1fr 28px' }}>
              <MuteBtn
                muted={!countInEnabled}
                onToggle={onToggleCountIn}
                color="#BB86FC"
                label={countInEnabled ? `${countInBars}小節` : 'OFF'} />
              <span className="text-[10px] text-text-dim">カウントイン</span>
              <input type="range" min={0} max={1} step={0.05}
                value={countInVolume}
                onChange={e => onCountInVolumeChange(Number(e.target.value))}
                style={{ accentColor: '#BB86FC', opacity: !countInEnabled ? 0.3 : 1 }}
                disabled={!countInEnabled} />
              <span className="text-[10px] text-text-dim text-right">{Math.round(countInVolume * 100)}%</span>

              <MuteBtn muted={metMuted} onToggle={toggleMetMute} color="#F1C40F" />
              <span className="text-[10px] text-text-dim">メトロノーム</span>
              <input type="range" min={0} max={1} step={0.05}
                value={metVolume}
                onChange={e => onMetVolumeChange(Number(e.target.value))}
                style={{ accentColor: '#F1C40F', opacity: metMuted ? 0.3 : 1 }} />
              <span className="text-[10px] text-text-dim text-right">{Math.round(metVolume * 100)}%</span>

              <MuteBtn muted={!chordAudioOn} onToggle={onToggleChordAudio} color="#27AE60" />
              <span className="text-[10px] text-text-dim">コード</span>
              <input type="range" min={0} max={1} step={0.05}
                value={chordVolume}
                onChange={e => onChordVolumeChange(Number(e.target.value))}
                style={{ accentColor: '#27AE60', opacity: !chordAudioOn ? 0.3 : 1 }} />
              <span className="text-[10px] text-text-dim text-right">{Math.round(chordVolume * 100)}%</span>

              <MuteBtn muted={noteMuted} onToggle={toggleNoteMute} color="#FF6B9D" />
              <span className="text-[10px] text-text-dim">単音</span>
              <input type="range" min={0} max={1} step={0.05}
                value={noteVolume}
                onChange={e => onNoteVolumeChange(Number(e.target.value))}
                style={{ accentColor: '#FF6B9D', opacity: noteMuted ? 0.3 : 1 }} />
              <span className="text-[10px] text-text-dim text-right">{Math.round(noteVolume * 100)}%</span>

            </div>
            <div className="flex gap-1 mt-1">
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
            {/* Swing controls */}
            <div className="flex items-center gap-1.5 mt-1 pt-1" style={{ borderTop: '1px solid #333' }}>
              <button
                onClick={onToggleSwing}
                className="rounded cursor-pointer text-[9px] font-mono px-1.5 h-[18px] inline-flex items-center"
                style={{
                  border: `1px solid ${swingEnabled ? '#E67E22' : '#555'}`,
                  background: swingEnabled ? '#2a1a0a' : '#1a1a1a',
                  color: swingEnabled ? '#E67E22' : '#888',
                }}
              >
                Swing
              </button>
              <input type="range" min={0} max={100} step={5}
                value={Math.round(swingAmount * 100)}
                onChange={e => onSwingAmountChange(Number(e.target.value) / 100)}
                className="flex-1"
                style={{ accentColor: '#E67E22', opacity: swingEnabled ? 1 : 0.3 }}
                disabled={!swingEnabled}
              />
              <span className="text-[10px] text-text-dim w-[28px] text-right">{Math.round(swingAmount * 100)}%</span>
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
      <button
        onClick={handleTapTempo}
        title="タップテンポ（連続タップでBPM設定）"
        className={btnBase}
        style={{ border: '1px solid #444', background: '#1a1a1a', color: '#AAA', fontSize: 9, letterSpacing: 1 }}
      >TAP</button>
    </div>
  );
}
