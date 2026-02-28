import { useMemo } from 'react';
import type { Progression, Position } from '../../types';
import { MODE_TEMPLATES, POS_COLORS, MODE_COLORS } from '../../constants';
import {
  QUALITY_TO_MODES, rankPositionsByProximity,
  resolveMode, buildFretMap, generatePositions,
} from '../../utils';

interface ProgressionPlayerProps {
  progression: Progression;
  activeChordIdx: number;
  allPos: Position[];
  onChordSelect: (idx: number) => void;
  onModeChange: (chordIdx: number, modeIdx: number) => void;
  onPosChange: (chordIdx: number, posId: number) => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2 py-[3px]';

export function ProgressionPlayer({
  progression, activeChordIdx, allPos,
  onChordSelect, onModeChange, onPosChange,
}: ProgressionPlayerProps) {
  const chords = progression.chords;
  const activeChord = chords[activeChordIdx];

  // Resolve previous chord's position from its OWN mode/root (not current allPos)
  const prevChord = activeChordIdx > 0 ? chords[activeChordIdx - 1] : null;
  const prevPos = useMemo(() => {
    if (!prevChord || !QUALITY_TO_MODES[prevChord.quality]) return null;
    const prevMode = resolveMode(prevChord.rootName, MODE_TEMPLATES[prevChord.modeIdx]);
    const prevFretMap = buildFretMap(prevMode.semi, prevMode.notes);
    const prevAllPos = generatePositions(prevFretMap, prevMode.notes);
    return prevAllPos.find(p => p.id === prevChord.posId) ?? null;
  }, [prevChord?.rootName, prevChord?.modeIdx, prevChord?.posId, prevChord?.quality]);

  const rankedPosIds = activeChord
    ? rankPositionsByProximity(allPos, prevPos)
    : [];

  // Effective posId: confirmed uses stored value, otherwise auto-suggest top ranked
  const effectivePosId = activeChord
    ? (activeChord.posConfirmed ? activeChord.posId : (rankedPosIds[0] ?? 1))
    : 1;
  const isConfirmed = activeChord?.posConfirmed ?? false;

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
          return (
            <button
              key={i}
              onClick={() => onChordSelect(i)}
              className="rounded cursor-pointer font-mono shrink-0 px-3 py-1.5 text-center min-w-[56px]"
              style={{
                border: `2px solid ${active ? '#FFF' : supported ? '#555' : '#333'}`,
                background: active ? '#2a2a2a' : '#111',
                color: supported ? (active ? '#FFF' : '#AAA') : '#555',
                opacity: supported ? 1 : 0.5,
              }}
            >
              <div className="text-[12px] font-bold">{c.symbol}</div>
              {supported && (
                <div className="text-[8px] mt-0.5" style={{ color: '#777' }}>
                  {MODE_TEMPLATES[c.modeIdx]?.name ?? '?'} · P{i === activeChordIdx ? effectivePosId : c.posId}
                  {i === activeChordIdx && !isConfirmed && ' ?'}
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
            <div className="text-[9px] text-text-dim mb-0.5">モード</div>
            <div className="flex gap-1">
              {compatibleModes.map(mi => {
                const tmpl = MODE_TEMPLATES[mi];
                const active = activeChord.modeIdx === mi;
                const color = MODE_COLORS[tmpl.key];
                return (
                  <button key={mi} onClick={() => onModeChange(activeChordIdx, mi)}
                    className={btnBase}
                    style={{
                      border: `1px solid ${color}`,
                      background: active ? color : '#1a1a1a',
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
              ポジション (近接順){!isConfirmed && ' — 自動提案中'}
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
                        ? (isConfirmed ? color : color + '60')
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

      {/* Keyboard hint */}
      <div className="text-[9px] text-text-dim mt-2">
        ← → キーでコード移動
      </div>
    </div>
  );
}
