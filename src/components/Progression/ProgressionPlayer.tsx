import { useMemo } from 'react';
import type { Progression, Position, ChordNotationPrefs } from '../../types';
import { MODE_TEMPLATES, POS_COLORS, MODE_COLORS } from '../../constants';
import {
  QUALITY_TO_MODES, rankPositionsByProximity, computeEffectiveSelections,
  isDiatonic, formatChordSymbol, resolveMode, buildFretMap, generatePositions,
} from '../../utils';

interface ProgressionPlayerProps {
  progression: Progression;
  activeChordIdx: number;
  allPos: Position[];
  chordPrefs: ChordNotationPrefs;
  onChordSelect: (idx: number) => void;
  onModeChange: (chordIdx: number, modeIdx: number) => void;
  onPosChange: (chordIdx: number, posId: number) => void;
  onReset: () => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2 py-[3px]';

export function ProgressionPlayer({
  progression, activeChordIdx, allPos, chordPrefs,
  onChordSelect, onModeChange, onPosChange, onReset,
}: ProgressionPlayerProps) {
  const chords = progression.chords;
  const activeChord = chords[activeChordIdx];

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
    const prevAllPos = generatePositions(prevFretMap, prevMode.notes);
    return prevAllPos.find(p => p.id === prevEff.posId) ?? null;
  }, [activeChordIdx, chords, effectiveAll]);

  const rankedPosIds = activeChord
    ? rankPositionsByProximity(allPos, prevPos)
    : [];

  const compatibleModes = activeChord
    ? QUALITY_TO_MODES[activeChord.quality] ?? []
    : [];

  return (
    <div className="mb-3">
      {/* Chord cards - horizontal scroll */}
      <div className="flex gap-1 overflow-x-auto pb-1.5 mb-2">
        {chords.map((c, i) => {
          const active = i === activeChordIdx;
          const supported = QUALITY_TO_MODES[c.quality] != null;
          const diatonic = !progression.songKey || !supported || isDiatonic(c.rootName, c.quality, progression.songKey);
          const eff = effectiveAll[i];
          const borderColor = !supported ? '#333'
            : !diatonic ? '#E67E22'
            : active ? '#FFF'
            : '#555';
          return (
            <button
              key={i}
              onClick={() => onChordSelect(i)}
              className="rounded cursor-pointer font-mono shrink-0 px-3 py-1.5 text-center min-w-[56px]"
              style={{
                border: `2px solid ${borderColor}`,
                background: active ? (diatonic ? '#2a2a2a' : '#2a2010') : '#111',
                color: supported ? (active ? '#FFF' : '#AAA') : '#555',
                opacity: supported ? 1 : 0.5,
              }}
            >
              <div className="text-[12px] font-bold">{formatChordSymbol(c.rootName, c.quality, chordPrefs)}</div>
              {supported && eff && (
                <div className="text-[8px] mt-0.5" style={{ color: '#666' }}>
                  {MODE_TEMPLATES[eff.modeIdx]?.name ?? '?'} · P{eff.posId}
                  {active && (!isPosConfirmed || !isModeConfirmed) && ' ?'}
                </div>
              )}
              {!supported && (
                <div className="text-[8px] mt-0.5" style={{ color: '#555' }}>Skip</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Active chord controls */}
      {activeChord && QUALITY_TO_MODES[activeChord.quality] && (
        <div className="flex flex-wrap items-start gap-3">
          {/* Mode selection */}
          <div>
            <div className="text-[9px] text-text-dim mb-0.5">
              モード{!isModeConfirmed && ' — 自動提案中'}
            </div>
            <div className="flex gap-1">
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

          {/* Position selection */}
          <div>
            <div className="text-[9px] text-text-dim mb-0.5">
              ポジション (近接順){!isPosConfirmed && ' — 自動提案中'}
            </div>
            <div className="flex gap-1">
              {rankedPosIds.map(posId => {
                const selected = effectivePosId === posId;
                const color = POS_COLORS[posId - 1];
                return (
                  <button key={posId} onClick={() => onPosChange(activeChordIdx, posId)}
                    className={btnBase}
                    style={{
                      border: `1px solid ${color}`,
                      background: selected
                        ? (isPosConfirmed ? color : color + '60')
                        : '#1a1a1a',
                      color: selected ? '#FFF' : color,
                      fontWeight: selected ? 700 : 400,
                    }}>
                    Pos {posId}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Keyboard hint + reset */}
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[9px] text-text-dim">← → キーでコード移動</span>
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
