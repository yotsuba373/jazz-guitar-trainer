import { useState, useMemo, useRef, useEffect } from 'react';
import type { LickEntry } from '../../types';
import type { IiVDetection } from '../../utils';
import { SOURCE_DISPLAY_NAMES, inferModeCandidates, isIiVLickId, getIiVTransposeSemitones } from '../../utils';
import { MODE_TEMPLATES, MODE_COLORS, CHROMATIC_NAMES, CHROMATIC_DEGREE } from '../../constants';

/** Tiny SVG contour preview of a lick's melody */
function LickContourMini({ notes, selected }: { notes: LickEntry['notes']; selected: boolean }) {
  const pitched = notes.filter(n => n.pitch != null && !n.rest);
  if (pitched.length < 2) return <div className="w-14 h-5" />;

  const pitches = pitched.map(n => n.pitch!);
  const minP = Math.min(...pitches);
  const maxP = Math.max(...pitches);
  const range = maxP - minP || 1;

  const W = 56, H = 20, PAD = 2;
  const points = pitched.map((n, i) => {
    const x = PAD + (i / (pitched.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((n.pitch! - minP) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={W} height={H} className="flex-shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke="#FF6B9D"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.5}
      />
    </svg>
  );
}


/** Grid column template shared by header and list rows */
const LICK_GRID_COLS = '16px 48px 42px 60px 28px 24px 46px 46px 46px 116px minmax(0, 1fr)';

/** Lick type display badge */
const LICK_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  'dom7': { label: 'dom7', color: '#E67E22' },
  'min7': { label: 'min7', color: '#27AE60' },
  'maj7': { label: 'maj7', color: '#3498DB' },
  'm7b5': { label: 'm7♭5', color: '#8E44AD' },
  'maj-ii-v-short': { label: 'ii-V S', color: '#4FC3F7' },
  'maj-ii-v-long': { label: 'ii-V L', color: '#4FC3F7' },
  'min-ii-v-short': { label: 'ii-V m', color: '#4FC3F7' },
};

/* ---- Reusable small button components ---- */

const BTN_BASE = 'rounded cursor-pointer h-[24px] inline-flex items-center justify-center flex-shrink-0';

function PlayStopBtn({ isPlaying, onPlay, onStop, compact }: { isPlaying: boolean; onPlay: () => void; onStop: () => void; compact?: boolean }) {
  return (
    <button
      onClick={isPlaying ? onStop : onPlay}
      className={`${BTN_BASE} ${compact ? 'px-1.5' : 'text-[10px] font-mono px-2'}`}
      style={{
        border: '1px solid #555',
        background: isPlaying ? '#3a2020' : '#1a2a1a',
        color: isPlaying ? '#F88' : '#8F8',
      }}
    >
      {compact ? (
        <svg width="8" height="8" viewBox="0 0 8 8">
          {isPlaying
            ? <rect x="1" y="1" width="6" height="6" fill="currentColor" />
            : <polygon points="1,0 8,4 1,8" fill="currentColor" />
          }
        </svg>
      ) : (isPlaying ? '■ Stop' : '▶ Play')}
    </button>
  );
}

function StepBtn({ direction, disabled, active, onClick }: { direction: 'back' | 'fwd'; disabled: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${BTN_BASE} px-1`}
      style={{
        border: '1px solid #555',
        background: active ? '#2a2030' : '#1a1a1a',
        color: disabled ? '#444' : active ? '#FF6B9D' : '#888',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      title={direction === 'back' ? '前の音 (ステップ)' : '次の音 (ステップ)'}
    >
      <svg width="10" height="8" viewBox="0 0 10 8">
        {direction === 'back' ? (
          <>
            <rect x="0" y="0" width="2" height="8" fill="currentColor" />
            <polygon points="10,0 3,4 10,8" fill="currentColor" />
          </>
        ) : (
          <>
            <polygon points="0,0 7,4 0,8" fill="currentColor" />
            <rect x="8" y="0" width="2" height="8" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );
}

function ToggleBtn({ label, active, disabled, activeColor, onClick, title }: {
  label: string; active: boolean; disabled: boolean; activeColor: string;
  onClick: () => void; title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${BTN_BASE} text-[9px] font-mono px-1.5`}
      style={{
        border: '1px solid #555',
        background: disabled ? '#111' : active ? '#2a2a3a' : '#1a1a1a',
        color: disabled ? '#444' : active ? activeColor : '#888',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      title={title}
    >
      {label}
    </button>
  );
}

function ClearBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`${BTN_BASE} px-1.5`}
      style={{ border: '1px solid #444', background: '#1a1a1a', color: '#888' }}
      title="フレーズ解除"
    >
      <svg width="8" height="8" viewBox="0 0 8 8">
        <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" />
        <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

/* ---- Main component ---- */

interface LickPanelProps {
  licks: LickEntry[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onPlay: () => void;
  onStop: () => void;
  isPlaying: boolean;
  lickType: string;
  onClear: () => void;
  quality: string;
  rootSemitone: number;
  iiV: IiVDetection | null;
  singleLickCount: number;
  vChordQuality?: string;
  vChordRootSemitone?: number;
  favorites: Set<string>;
  onToggleFavorite: (lickId: string) => void;
  highOctave: boolean;
  onToggleOctave: () => void;
  canHighOctave: boolean;
  highInstance: boolean;
  onToggleInstance: () => void;
  canHighInstance: boolean;
  stepIndex: number | null;
  onStepForward: () => void;
  onStepBackward: () => void;
  soundingNoteCount: number;
  stepPosition: number;
}

export function LickPanel({
  licks, selectedIdx, onSelect, onPlay, onStop, isPlaying, lickType, onClear,
  quality, rootSemitone, iiV, singleLickCount,
  vChordQuality, vChordRootSemitone,
  favorites, onToggleFavorite,
  highOctave, onToggleOctave, canHighOctave,
  highInstance, onToggleInstance, canHighInstance,
  stepIndex, onStepForward, onStepBackward, soundingNoteCount, stepPosition,
}: LickPanelProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hasSelection = selectedIdx != null;
  const listRef = useRef<HTMLDivElement>(null);
  const iiVLickCount = licks.length - singleLickCount;
  const isStepMode = stepIndex != null;
  const atFirst = isStepMode && stepPosition <= 1;
  const atLast = isStepMode && stepPosition >= soundingNoteCount;

  // Snapshot favorites when the panel opens (avoid re-sort while browsing)
  const sortFavoritesRef = useRef(favorites);
  const prevOpenRef = useRef(open);
  if (open && !prevOpenRef.current) sortFavoritesRef.current = favorites;
  prevOpenRef.current = open;
  const sortFavorites = sortFavoritesRef.current;

  // Auto-scroll to selected item — need to account for separator in DOM
  useEffect(() => {
    if (!open || selectedIdx == null || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-lick-idx="${selectedIdx}"]`) as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  // Precompute mode candidates + start/end note info for each lick
  const lickMeta = useMemo(() => {
    return licks.map((lick) => {
      const iiVType = isIiVLickId(lick.id);
      const isIiV = !!iiVType;

      const q = isIiV && vChordQuality ? vChordQuality : quality;
      const rs = isIiV && vChordRootSemitone != null ? vChordRootSemitone : rootSemitone;

      const modes = inferModeCandidates(lick, q, rs);
      const modeNames = modes.map(m => MODE_TEMPLATES[m.modeIdx].name);
      const modeKeys = modes.map(m => MODE_TEMPLATES[m.modeIdx].key);

      const transpose = isIiV && iiV ? getIiVTransposeSemitones(iiV.keyCenterSemitone) : rootSemitone;
      const degRef = isIiV && vChordRootSemitone != null ? vChordRootSemitone : rootSemitone;

      const pitched = lick.notes.filter(n => !n.rest && n.pitch != null);
      let startLabel = '', endLabel = '', resLabel = '';
      if (pitched.length > 0) {
        const info = (p: number) => {
          const real = ((p + transpose) % 12 + 12) % 12;
          const deg = ((p + transpose - degRef) % 12 + 12) % 12;
          return { note: CHROMATIC_NAMES[real], deg: CHROMATIC_DEGREE[deg] };
        };
        const fmt = (i: { note: string; deg: string }) => `${i.note}(${i.deg})`;
        const s = info(pitched[0].pitch!);
        startLabel = fmt(s);

        const lastNote = lick.notes[lick.notes.length - 1];
        const measures = lick.beats / 4;
        const hasTrailingRest = lastNote.rest === true && lastNote.duration >= 1.0;
        let hasResolution = false;
        if (hasTrailingRest && measures >= 2) {
          const lastMeasurePitched = pitched.filter(n => n.beatStart >= (measures - 1) * 4);
          hasResolution = lastMeasurePitched.length === 1;
        }

        if (hasResolution && pitched.length >= 2) {
          const res = info(pitched[pitched.length - 1].pitch!);
          const end = info(pitched[pitched.length - 2].pitch!);
          endLabel = fmt(end);
          resLabel = res.note;
        } else {
          const e = info(pitched[pitched.length - 1].pitch!);
          endLabel = fmt(e);
        }
      }

      let badge: { label: string; color: string } | null = null;
      if (isIiV && iiVType) {
        badge = LICK_TYPE_BADGE[iiVType] ?? null;
      } else {
        const id = lick.id ?? '';
        const prefixType = id.startsWith('D-') ? 'dom7'
          : id.startsWith('m-') ? 'min7'
          : id.startsWith('M-') ? 'maj7'
          : id.startsWith('H-') ? 'm7b5'
          : null;
        if (prefixType) badge = LICK_TYPE_BADGE[prefixType] ?? null;
      }

      return { modes, modeNames, modeKeys, startLabel, endLabel, resLabel, isIiV, badge };
    });
  }, [licks, quality, rootSemitone, iiV, vChordQuality, vChordRootSemitone]);

  // Filter licks by search query, sort favorites first
  const filtered = useMemo(() => {
    let items: { lick: LickEntry; origIdx: number }[];
    if (!query.trim()) {
      items = licks.map((l, i) => ({ lick: l, origIdx: i }));
    } else {
      const q = query.trim().toLowerCase();
      items = licks.reduce<{ lick: LickEntry; origIdx: number }[]>((acc, lick, i) => {
        const id = (lick.id ?? '').toLowerCase();
        const src = lick.source
          ? (SOURCE_DISPLAY_NAMES[lick.source] ?? lick.source).toLowerCase()
          : '';
        const meta = `${lick.noteCount}音 ${lick.beats}拍`;
        const m = lickMeta[i];
        const modeStr = m ? m.modeNames.join(' ').toLowerCase() : '';
        const noteStr = m ? `${m.startLabel} ${m.endLabel} ${m.resLabel}`.toLowerCase() : '';
        const badgeStr = m?.badge ? m.badge.label.toLowerCase() : '';
        if (id.includes(q) || src.includes(q) || meta.includes(q) || modeStr.includes(q) || noteStr.includes(q) || badgeStr.includes(q) || 'ii-v'.includes(q) && m?.isIiV) {
          acc.push({ lick, origIdx: i });
        }
        return acc;
      }, []);
    }
    if (sortFavorites.size > 0) {
      items.sort((a, b) => {
        const aFav = sortFavorites.has(a.lick.id ?? '') ? 1 : 0;
        const bFav = sortFavorites.has(b.lick.id ?? '') ? 1 : 0;
        const aIiV = lickMeta[a.origIdx]?.isIiV ? 1 : 0;
        const bIiV = lickMeta[b.origIdx]?.isIiV ? 1 : 0;
        if (aIiV !== bIiV) return aIiV - bIiV;
        return bFav - aFav;
      });
    }
    return items;
  }, [licks, query, lickMeta, sortFavorites]);

  // Build items with separator insertion
  const listItems = useMemo(() => {
    const items: Array<{ type: 'lick'; lick: LickEntry; origIdx: number } | { type: 'separator' }> = [];
    let separatorInserted = false;
    for (const f of filtered) {
      if (!separatorInserted && lickMeta[f.origIdx]?.isIiV && singleLickCount > 0) {
        items.push({ type: 'separator' });
        separatorInserted = true;
      }
      items.push({ type: 'lick', ...f });
    }
    return items;
  }, [filtered, lickMeta, singleLickCount]);

  /** Shared action buttons: Play, Step ◀/▶, 8va, Hi, ✕ */
  const actionButtons = (compact: boolean) => (
    <>
      <PlayStopBtn isPlaying={isPlaying} onPlay={onPlay} onStop={onStop} compact={compact} />
      <StepBtn direction="back" disabled={atFirst} active={isStepMode} onClick={onStepBackward} />
      <span className="text-[9px] font-mono flex-shrink-0 h-[24px] inline-flex items-center leading-none" style={{ color: isStepMode ? '#FF6B9D' : '#666' }}>
        {isStepMode ? stepPosition : '-'}/{soundingNoteCount}
      </span>
      <StepBtn direction="fwd" disabled={atLast} active={isStepMode} onClick={onStepForward} />
      <svg width="1" height="16" className="flex-shrink-0"><line x1="0.5" y1="0" x2="0.5" y2="16" stroke="#333" strokeWidth="1" /></svg>
      <ToggleBtn label="8va" active={highOctave} disabled={!canHighOctave} activeColor="#8BF"
        onClick={onToggleOctave}
        title={!canHighOctave ? 'この音域ではオクターブ上に収まりません' : highOctave ? '通常オクターブで再生' : 'オクターブ上で再生'}
      />
      <ToggleBtn label="Hi" active={highInstance} disabled={!canHighInstance} activeColor="#F8B"
        onClick={onToggleInstance}
        title={!canHighInstance ? 'このポジションにはハイインスタンスがありません' : highInstance ? 'ローインスタンスで再生' : 'ハイインスタンスで再生'}
      />
      <svg width="1" height="16" className="flex-shrink-0"><line x1="0.5" y1="0" x2="0.5" y2="16" stroke="#333" strokeWidth="1" /></svg>
      <ClearBtn onClick={() => { onClear(); onStop(); }} />
    </>
  );

  // Header bar (always visible) — acts as toggle
  const iiVCountStr = iiVLickCount > 0 ? ` + ii-V ${iiVLickCount}` : '';
  const headerContent = (
    <div
      className="flex items-center gap-1.5 px-3 cursor-pointer select-none h-[31px]"
      style={{ background: '#1a1a1a', borderBottom: '1px solid #333', fontSize: 11 }}
      onClick={() => setOpen(p => !p)}
    >
      <span style={{ color: '#FF6B9D' }} className="inline-flex items-center gap-1">
        <svg width="8" height="8" viewBox="0 0 8 8" className="flex-shrink-0">
          {open
            ? <polygon points="0,2 8,2 4,7" fill="currentColor" />
            : <polygon points="2,0 7,4 2,8" fill="currentColor" />
          }
        </svg>
        フレーズ
      </span>
      <span className="px-1.5 py-0.5 rounded" style={{ background: '#2a2a3a', color: '#AAA' }}>{lickType}</span>
      <span className="text-text-dim">{singleLickCount}件{iiVCountStr}</span>

      {/* Inline controls when collapsed & selected */}
      {!open && hasSelection && (
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <svg width="1" height="16" className="flex-shrink-0"><line x1="0.5" y1="0" x2="0.5" y2="16" stroke="#333" strokeWidth="1" /></svg>
          <span style={{ color: '#FF6B9D' }}>
            {licks[selectedIdx]?.id ?? `#${selectedIdx + 1}`}
          </span>
          {actionButtons(true)}
        </div>
      )}
      {!open && !hasSelection && (
        <span className="text-text-dim inline-flex items-center gap-1.5"><svg width="1" height="16" className="flex-shrink-0"><line x1="0.5" y1="0" x2="0.5" y2="16" stroke="#333" strokeWidth="1" /></svg>クリックで展開</span>
      )}
    </div>
  );

  return (
    <div
      className="overflow-hidden"
      style={{ background: '#1a1a1a', border: '1px solid #3a2a30', borderRadius: 6, fontSize: 10 }}
    >
      {headerContent}

      {open && (
        <>
          {/* Search + action bar */}
          <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: '1px solid #2a2a2a' }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="検索 (ID, アーティスト, 音数, ii-V...)"
              className="flex-1 text-[10px] rounded px-1.5 py-0.5 outline-none"
              style={{ background: '#111', border: '1px solid #333', color: '#CCC', minWidth: 0 }}
              onClick={e => e.stopPropagation()}
            />
            {hasSelection && actionButtons(false)}
            <span className="text-[9px] text-text-dim flex-shrink-0">
              {filtered.length !== licks.length ? `${filtered.length}/` : ''}{licks.length}
            </span>
          </div>

          {/* Column Headers */}
          {filtered.length > 0 && (
            <div
              className="grid items-center px-2 py-[2px]"
              style={{
                gridTemplateColumns: LICK_GRID_COLS,
                borderBottom: '1px solid #333', color: '#666', fontSize: 9, fontFamily: 'monospace',
                columnGap: 4,
              }}
            >
              <span>{/* fav */}</span>
              <span>ID</span>
              <span>タイプ</span>
              <span>コンター</span>
              <span className="text-center">音数</span>
              <span className="text-center">拍数</span>
              <span className="text-center">開始音</span>
              <span className="text-center">末尾音</span>
              <span className="text-center">解決音</span>
              <span>ソース</span>
              <span>モード</span>
            </div>
          )}

          {/* List */}
          {filtered.length === 0 ? (
            <p className="text-[10px] text-text-dim px-2.5 py-2">
              {licks.length === 0 ? 'このコード品質のフレーズがありません' : '一致するフレーズがありません'}
            </p>
          ) : (
            <div
              ref={listRef}
              className="overflow-y-auto scrollbar-thin"
              style={{ maxHeight: '160px' }}
            >
              {listItems.map((item) => {
                if (item.type === 'separator') {
                  return (
                    <div
                      key="sep"
                      className="flex items-center gap-2 px-2 py-[2px] select-none"
                      style={{ color: '#4FC3F7', fontSize: 9 }}
                    >
                      <span style={{ flex: 1, borderBottom: '1px solid #333' }} />
                      <span>ii-V</span>
                      <span style={{ flex: 1, borderBottom: '1px solid #333' }} />
                    </div>
                  );
                }
                const { lick, origIdx } = item;
                const isSelected = origIdx === selectedIdx;
                const sourceName = lick.source
                  ? (SOURCE_DISPLAY_NAMES[lick.source] ?? lick.source)
                  : '';
                const meta = lickMeta[origIdx];
                return (
                  <div
                    key={origIdx}
                    data-lick-idx={origIdx}
                    onClick={() => onSelect(origIdx)}
                    className="cursor-pointer px-2 py-[3px] grid items-center"
                    style={{
                      gridTemplateColumns: LICK_GRID_COLS,
                      columnGap: 4,
                      background: isSelected ? '#2a2a3a' : 'transparent',
                      borderLeft: isSelected ? '2px solid #FF6B9D' : '2px solid transparent',
                    }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); if (lick.id) onToggleFavorite(lick.id); }}
                      className="cursor-pointer bg-transparent border-none p-0 leading-none"
                      title={favorites.has(lick.id ?? '') ? 'お気に入り解除' : 'お気に入り'}
                      style={{ color: favorites.has(lick.id ?? '') ? '#F1C40F' : '#555', fontSize: 12 }}
                    >
                      {favorites.has(lick.id ?? '') ? '\u2605' : '\u2606'}
                    </button>
                    <span
                      className="text-[10px] font-mono truncate"
                      style={{ color: isSelected ? '#FF6B9D' : '#666' }}
                    >
                      {lick.id ?? `#${origIdx + 1}`}
                    </span>
                    <span className="min-w-0 overflow-hidden">
                      {meta?.badge ? (
                        <span
                          className="text-[8px] font-mono rounded px-1"
                          style={{
                            color: meta.badge.color,
                            background: '#1a2a3a',
                            border: `1px solid ${meta.badge.color}33`,
                          }}
                        >
                          {meta.badge.label}
                        </span>
                      ) : '\u00A0'}
                    </span>
                    <LickContourMini notes={lick.notes} selected={isSelected} />
                    <span className="text-[9px] text-center" style={{ color: isSelected ? '#CCC' : '#888' }}>
                      {lick.noteCount}
                    </span>
                    <span className="text-[9px] text-center" style={{ color: isSelected ? '#CCC' : '#999' }}>
                      {lick.beats}
                    </span>
                    <span className="text-[9px] font-mono text-center" style={{ color: isSelected ? '#CCC' : '#999' }}>
                      {meta?.startLabel || '\u00A0'}
                    </span>
                    <span className="text-[9px] font-mono text-center" style={{ color: isSelected ? '#CCC' : '#999' }}>
                      {meta?.endLabel || '\u00A0'}
                    </span>
                    <span className="text-[9px] font-mono text-center" style={{ color: isSelected ? '#CCC' : '#999' }}>
                      {meta?.resLabel || '\u00A0'}
                    </span>
                    <span className="text-[9px] truncate" style={{ color: isSelected ? '#CCC' : '#999' }}>
                      {sourceName || '\u00A0'}
                    </span>
                    <span className="text-[9px] truncate">
                      {meta && meta.modes.length > 0 && meta.modes.map((m, mi) => (
                        <span key={m.modeIdx}>
                          {mi > 0 && <span style={{ color: '#666' }}>, </span>}
                          <span style={{ color: MODE_COLORS[meta.modeKeys[mi]] ?? '#888' }}>
                            {meta.modeNames[mi]}
                          </span>
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
