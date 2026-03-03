import { useMemo, useState, useEffect } from 'react';
import type { Progression, Position, ChordNotationPrefs, FoundVoicing } from '../../types';
import { MODE_TEMPLATES, POS_COLORS, MODE_COLORS } from '../../constants';
import {
  QUALITY_TO_MODES, rankPositionsByProximity, computeEffectiveSelections,
  resolveMode, buildFretMap, generatePositions, generateDimPositions,
} from '../../utils';
import { ChordChart } from './ChordChart';
import { VoicingGrid } from '../Controls/VoicingGrid';

interface ProgressionPlayerProps {
  progression: Progression;
  activeChordIdx: number;
  allPos: Position[];
  chordPrefs: ChordNotationPrefs;
  onChordSelect: (idx: number) => void;
  onModeChange: (chordIdx: number, modeIdx: number) => void;
  onPosChange: (chordIdx: number, posId: number, shiftKey: boolean) => void;
  onReset: () => void;
  isPlaying: boolean;
  bpm: number;
  onTogglePlay: () => void;
  onBpmChange: (bpm: number) => void;
  isMetronomeOn: boolean;
  onToggleMetronome: () => void;
  metVolume: number;
  onMetVolumeChange: (v: number) => void;
  selPosIds: number[];
  availableVoicings?: FoundVoicing[];
  selectedVoicingIdx?: number;
  onSelectVoicing?: (idx: number) => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2 py-[3px]';

export function ProgressionPlayer({
  progression, activeChordIdx, allPos, chordPrefs,
  onChordSelect, onModeChange, onPosChange, onReset,
  isPlaying, bpm, onTogglePlay, onBpmChange, isMetronomeOn, onToggleMetronome,
  metVolume, onMetVolumeChange,
  selPosIds, availableVoicings, selectedVoicingIdx, onSelectVoicing,
}: ProgressionPlayerProps) {
  const chords = progression.chords;
  const activeChord = chords[activeChordIdx];

  // BPM direct input state
  const [bpmStr, setBpmStr] = useState(String(bpm));
  useEffect(() => setBpmStr(String(bpm)), [bpm]);
  function commitBpm() {
    const v = parseInt(bpmStr, 10);
    const clamped = isNaN(v) ? bpm : Math.max(40, Math.min(240, v));
    onBpmChange(clamped);
    setBpmStr(String(clamped));
  }

  // Compute effective mode/pos for all chords (resolves auto-suggestion chain)
  const effectiveAll = useMemo(
    () => computeEffectiveSelections(chords, progression.songKey),
    [chords, progression.songKey],
  );

  const activeEff = effectiveAll[activeChordIdx];
  const effectiveModeIdx = activeEff?.modeIdx ?? 0;
  const effectivePosId = activeEff?.posId ?? 1;
  const isPosConfirmed = activeChord?.posConfirmed ?? false;
  const isModeConfirmed = activeChord?.modeConfirmed ?? false;

  // Rank positions for the active chord using effective prev position
  const prevPos = useMemo(() => {
    if (activeChordIdx === 0) return null;
    const prevChord = chords[activeChordIdx - 1];
    const prevEff = effectiveAll[activeChordIdx - 1];
    if (!prevChord || !prevEff || !QUALITY_TO_MODES[prevChord.quality]) return null;
    const prevMode = resolveMode(prevChord.rootName, MODE_TEMPLATES[prevEff.modeIdx]);
    const prevFretMap = buildFretMap(prevMode.semi, prevMode.notes);
    const prevIs8 = prevMode.notes.length > 7;
    const prevAllPos = prevIs8
      ? generateDimPositions(prevFretMap, prevMode.semi[0])
      : generatePositions(prevFretMap, prevMode.notes);
    return prevAllPos.find(p => p.id === prevEff.posId) ?? null;
  }, [activeChordIdx, chords, effectiveAll]);

  const rankedPosIds = activeChord
    ? rankPositionsByProximity(allPos, prevPos, allPos.length)
    : [];

  const compatibleModes = activeChord
    ? QUALITY_TO_MODES[activeChord.quality] ?? []
    : [];

  return (
    <div className="mb-3">
      {/* BPM / Playback controls */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={onTogglePlay}
          className="rounded cursor-pointer font-mono text-[13px] px-3 py-[3px]"
          style={{
            border: `1px solid ${isPlaying ? '#E74C3C' : '#27AE60'}`,
            background: isPlaying ? '#2a1010' : '#102a10',
            color: isPlaying ? '#E74C3C' : '#27AE60',
            fontWeight: 700,
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          onClick={onToggleMetronome}
          title="メトロノーム"
          className={btnBase}
          style={{
            border: `1px solid ${isMetronomeOn ? '#F1C40F' : '#444'}`,
            background: isMetronomeOn ? '#2a2a1a' : '#1a1a1a',
            color: isMetronomeOn ? '#F1C40F' : '#888',
          }}
        >♩</button>
        {isMetronomeOn && (
          <input
            type="range" min={0} max={1} step={0.05}
            value={metVolume}
            onChange={e => onMetVolumeChange(Number(e.target.value))}
            title={`音量 ${Math.round(metVolume * 100)}%`}
            className="w-28"
            style={{ accentColor: '#F1C40F' }}
          />
        )}
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
          className="w-14 text-center bg-transparent font-mono text-[12px] rounded border border-[#444] py-[3px] text-white"
          min={40} max={240}
        />
        <span className="text-[10px] text-text-dim">BPM</span>
        <button
          onClick={() => onBpmChange(Math.min(240, bpm + 1))}
          className={btnBase}
          style={{ border: '1px solid #444', background: '#1a1a1a', color: '#AAA' }}
        >+</button>
      </div>

      {/* Chord chart grid */}
      <ChordChart
        progression={progression}
        activeChordIdx={activeChordIdx}
        effectiveAll={effectiveAll}
        chordPrefs={chordPrefs}
        onChordSelect={onChordSelect}
      />

      {/* Active chord controls */}
      {activeChord && QUALITY_TO_MODES[activeChord.quality] && (
        <>
          {/* Row 1: Mode selection */}
          <div>
            <div className="text-[9px] text-text-dim mb-0.5">
              モード{!isModeConfirmed && ' — 自動提案中'}
            </div>
            <div className="flex flex-wrap gap-1">
              {compatibleModes.map(mi => {
                const tmpl = MODE_TEMPLATES[mi];
                const active = effectiveModeIdx === mi;
                const color = MODE_COLORS[tmpl.key];
                return (
                  <button key={mi} onClick={() => onModeChange(activeChordIdx, mi)}
                    className={btnBase}
                    style={{
                      border: `1px solid ${color}`,
                      background: active
                        ? (isModeConfirmed ? color : color + '60')
                        : '#1a1a1a',
                      color: active ? '#FFF' : color,
                      fontWeight: active ? 700 : 400,
                    }}>
                    {tmpl.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 2: Position + Chord form */}
          <div className="flex items-start gap-3 mt-1">
            <div>
              <div className="text-[9px] text-text-dim mb-0.5">
                ポジション (近接順){!isPosConfirmed && ' — 自動提案中'}
              </div>
              <div className="flex gap-1">
                {rankedPosIds.map(posId => {
                  const isPrimary = effectivePosId === posId;
                  const isActive = selPosIds.includes(posId);
                  const color = POS_COLORS[posId - 1];
                  return (
                    <button key={posId} onClick={(e) => onPosChange(activeChordIdx, posId, e.shiftKey)}
                      className={btnBase}
                      style={{
                        border: `1px solid ${color}`,
                        background: isActive
                          ? (isPrimary && isPosConfirmed ? color : color + '60')
                          : '#1a1a1a',
                        color: isActive ? '#FFF' : color,
                        fontWeight: isActive ? 700 : 400,
                      }}>
                      Pos {posId}
                    </button>
                  );
                })}
              </div>
            </div>

            {availableVoicings && availableVoicings.length > 0 && onSelectVoicing && (
              <VoicingGrid
                availableVoicings={availableVoicings}
                selectedVoicingIdx={selectedVoicingIdx ?? 0}
                onSelectVoicing={onSelectVoicing}
              />
            )}
          </div>
        </>
      )}

      {/* Keyboard hint + reset */}
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[9px] text-text-dim">← → ↑ ↓ キーでコード移動</span>
        {chords.some(c => c.posConfirmed || c.modeConfirmed) && (
          <button onClick={onReset} className={btnBase}
            style={{ border: '1px solid #666', background: '#1a1a1a', color: '#999' }}>
            選択リセット
          </button>
        )}
      </div>
    </div>
  );
}
