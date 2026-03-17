import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { InstrumentType, RhythmMode, BackingStyle } from '../../types';
import { BACKING_STYLES } from '../../utils';

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
  noteAudioOn: boolean;
  onToggleNoteAudio: () => void;
  bassVolume: number;
  onBassVolumeChange: (v: number) => void;
  bassAudioOn: boolean;
  onToggleBassAudio: () => void;
  rhythmOn: boolean;
  onToggleRhythm: () => void;
  instrument: InstrumentType;
  onInstrumentChange: (inst: InstrumentType) => void;
  rhythmMode: RhythmMode;
  onRhythmModeChange: (mode: RhythmMode) => void;
  backingStyle: BackingStyle;
  onBackingStyleChange: (style: BackingStyle) => void;
  swingEnabled: boolean;
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
  samplerLoading?: boolean;
  loopLabel?: string;
  onClearLoop?: () => void;
  loopSelecting?: boolean;
  onToggleLoopSelecting?: () => void;
  /** Slot for leading elements (e.g. chord edit button) before play/audio controls */
  leadingSlot?: ReactNode;
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

/** ミキサーの1チャンネル行 (MuteBtn + ラベル + スライダー + %) */
function ChannelRow({ color, label, muted, onToggle, volume, onVolumeChange, muteLabel }: {
  color: string; label: string; muted: boolean; onToggle: () => void;
  volume: number; onVolumeChange: (v: number) => void; muteLabel?: string;
}) {
  const dim = muted ? 0.3 : 1;
  return (<>
    <MuteBtn muted={muted} onToggle={onToggle} color={color} label={muteLabel} />
    <span className="text-[10px]" style={{ color, opacity: dim }}>{label}</span>
    <input type="range" min={0} max={1} step={0.05} value={volume}
      onChange={e => onVolumeChange(Number(e.target.value))}
      style={{ accentColor: color, opacity: dim }} />
    <span className="text-[10px] text-text-dim text-right" style={{ opacity: dim }}>{Math.round(volume * 100)}%</span>
  </>);
}

/** チャンネル間の gap スペーサー */
function Gap() {
  return <span style={{ gridColumn: '1 / -1', height: 2 }} />;
}

/** チャンネル下のサブ設定セクション (左ボーダーライン付き) */
function SubSection({ color, dimmed, children }: { color: string; dimmed: boolean; children: ReactNode }) {
  return (
    <span style={{
      gridColumn: '1 / -1', borderLeft: `2px solid ${color}50`,
      marginLeft: 16, paddingLeft: 8,
      display: 'grid', gridTemplateColumns: '68px 1fr 28px', gap: '4px 6px', alignItems: 'center',
      opacity: dimmed ? 0.3 : 1,
    }}>
      {children}
    </span>
  );
}

export function GlobalAudioControls({
  bpm, onBpmChange,
  chordAudioOn, onToggleChordAudio,
  metVolume, onMetVolumeChange,
  chordVolume, onChordVolumeChange,
  noteVolume, onNoteVolumeChange,
  bassVolume, onBassVolumeChange,
  noteAudioOn, onToggleNoteAudio, bassAudioOn, onToggleBassAudio,
  rhythmOn, onToggleRhythm,
  instrument, onInstrumentChange, rhythmMode, onRhythmModeChange,
  backingStyle, onBackingStyleChange,
  swingEnabled, swingAmount, onSwingAmountChange,
  countInEnabled, onToggleCountIn, countInVolume, onCountInVolumeChange, countInBars, isCountingIn,
  isPlaying, onTogglePlay, showPlayButton,
  loopLabel, onClearLoop, loopSelecting, onToggleLoopSelecting,
  leadingSlot, samplerLoading,
}: GlobalAudioControlsProps) {
  const [bpmStr, setBpmStr] = useState(String(bpm));
  useEffect(() => setBpmStr(String(bpm)), [bpm]);
  function commitBpm() {
    const v = parseInt(bpmStr, 10);
    const clamped = isNaN(v) ? bpm : Math.max(40, Math.min(320, v));
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
      const clamped = Math.max(40, Math.min(320, Math.round(60000 / avgMs)));
      onBpmChange(clamped);
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

  /** トグルボタン (音色選択等) */
  function ToggleBtn<T extends string>({ value, current, onSelect, color, label, title }: {
    value: T; current: T; onSelect: (v: T) => void; color: string; label: string; title: string;
  }) {
    const active = current === value;
    return (
      <button onClick={() => onSelect(value)} title={title}
        className="rounded cursor-pointer text-[13px] px-1.5 py-[1px]"
        style={{
          border: `1px solid ${active ? color : '#555'}`,
          background: active ? `${color}18` : '#1a1a1a',
          color: active ? color : '#888',
        }}>
        {label}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-3">
      {leadingSlot}
      {showPlayButton && onTogglePlay && (
        <button
          onClick={onTogglePlay}
          disabled={samplerLoading && !isPlaying}
          className="rounded cursor-pointer px-3 h-[24px] inline-flex items-center gap-1"
          style={{
            border: `1px solid ${samplerLoading && !isPlaying ? '#666' : isPlaying ? '#E74C3C' : '#27AE60'}`,
            background: samplerLoading && !isPlaying ? '#1a1a1a' : isPlaying ? '#2a1010' : '#102a10',
            color: samplerLoading && !isPlaying ? '#666' : isPlaying ? '#E74C3C' : '#27AE60',
            opacity: samplerLoading && !isPlaying ? 0.5 : 1,
            cursor: samplerLoading && !isPlaying ? 'not-allowed' : 'pointer',
          }}
        >
          {samplerLoading && !isPlaying ? (
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
            </svg>
          ) : isPlaying ? (
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
              {/* メロディ */}
              <ChannelRow color="#FF6B9D" label="メロディ" muted={!noteAudioOn} onToggle={onToggleNoteAudio}
                volume={noteVolume} onVolumeChange={onNoteVolumeChange} />
              <SubSection color="#FF6B9D" dimmed={!noteAudioOn}>
                <span className="text-[9px]" style={{ color: '#999' }}>音色</span>
                <span className="flex gap-1" style={{ gridColumn: 'span 2' }}>
                  <ToggleBtn value="guitar" current={instrument} onSelect={onInstrumentChange} color="#FF6B9D" label="🎸" title="ギター" />
                  <ToggleBtn value="saxophone" current={instrument} onSelect={onInstrumentChange} color="#FF6B9D" label="🎷" title="サクソフォン" />
                </span>
                <span className="text-[9px]" style={{ color: '#999', opacity: swingEnabled ? 1 : 0.35 }}>スウィング</span>
                <input type="range" min={0} max={100} step={5}
                  value={Math.round(swingAmount * 100)}
                  onChange={e => onSwingAmountChange(Number(e.target.value) / 100)}
                  style={{ accentColor: '#E67E22', opacity: swingEnabled ? 1 : 0.3 }}
                  disabled={!swingEnabled} />
                <span className="text-[10px] text-text-dim text-right" style={{ opacity: swingEnabled ? 1 : 0.35 }}>{Math.round(swingAmount * 100)}%</span>
              </SubSection>

              <Gap />

              {/* コード */}
              <ChannelRow color="#27AE60" label="コード" muted={!chordAudioOn} onToggle={onToggleChordAudio}
                volume={chordVolume} onVolumeChange={onChordVolumeChange} />

              <Gap />

              {/* ベース */}
              <ChannelRow color="#1ABC9C" label="ベース" muted={!bassAudioOn} onToggle={onToggleBassAudio}
                volume={bassVolume} onVolumeChange={onBassVolumeChange} />

              <Gap />

              {/* リズム */}
              <ChannelRow color="#F1C40F" label="リズム" muted={!rhythmOn} onToggle={onToggleRhythm}
                volume={metVolume} onVolumeChange={onMetVolumeChange} />
              <SubSection color="#F1C40F" dimmed={!rhythmOn}>
                <span className="text-[9px]" style={{ color: '#999' }}>音色</span>
                <span className="flex gap-1" style={{ gridColumn: 'span 2' }}>
                  <ToggleBtn value="metronome" current={rhythmMode} onSelect={onRhythmModeChange} color="#F1C40F" label="🔔" title="メトロノーム" />
                  <ToggleBtn value="drums" current={rhythmMode} onSelect={onRhythmModeChange} color="#F1C40F" label="🥁" title="ドラム" />
                </span>
              </SubSection>

              <Gap />

              {/* カウントイン */}
              <ChannelRow color="#BB86FC" label="カウントイン" muted={!countInEnabled} onToggle={onToggleCountIn}
                volume={countInVolume} onVolumeChange={onCountInVolumeChange}
                muteLabel={countInEnabled ? `${countInBars}小節` : 'OFF'} />
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => onBpmChange(Math.max(40, bpm - 1))}
        className={btnBase}
        style={{ border: '1px solid #444', background: '#1a1a1a', color: '#999' }}
      >−</button>
      <input
        type="number"
        value={bpmStr}
        onChange={e => setBpmStr(e.target.value)}
        onBlur={commitBpm}
        onKeyDown={e => e.key === 'Enter' && commitBpm()}
        className="w-10 text-center bg-transparent font-mono text-[12px] rounded border border-[#444] h-[24px] text-white"
        min={40} max={320}
      />
      <span className="text-[10px] text-text-dim">BPM</span>
      <button
        onClick={() => onBpmChange(Math.min(320, bpm + 1))}
        className={btnBase}
        style={{ border: '1px solid #444', background: '#1a1a1a', color: '#999' }}
      >+</button>
      <button
        onClick={handleTapTempo}
        title="タップテンポ（連続タップでBPM設定）"
        className={btnBase}
        style={{ border: '1px solid #444', background: '#1a1a1a', color: '#999', fontSize: 9, letterSpacing: 1 }}
      >TAP</button>
      {/* Style selector (compact) */}
      <select
        value={backingStyle}
        onChange={e => onBackingStyleChange(e.target.value as BackingStyle)}
        className="bg-[#111] rounded text-[10px] font-mono px-1 h-[24px] cursor-pointer text-white"
        style={{ border: '1px solid #444' }}
      >
        {BACKING_STYLES.map(s => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
    </div>
  );
}
