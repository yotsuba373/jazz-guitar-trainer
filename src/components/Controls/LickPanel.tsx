import { useState, useMemo, useRef, useEffect } from 'react';
import type { LickEntry } from '../../types';
import { SOURCE_DISPLAY_NAMES, inferModeCandidates, QUALITY_TO_LICK_TYPE } from '../../utils';
import { MODE_TEMPLATES, MODE_COLORS } from '../../constants';

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

/** Root semitone values for each lick type (what key licks are stored in) */
const TYPE_ROOT_SEMITONE: Record<string, number> = {
  'dom7': 7, 'min7': 2, 'maj7': 0, 'm7b5': 2,
};

const CHROMATIC_DEGREE: Record<number, string> = {
  0: 'R', 1: '♭2', 2: '2', 3: '♭3', 4: '3', 5: '4',
  6: '♭5', 7: '5', 8: '♭6', 9: '6', 10: '♭7', 11: '7',
};
const CHROMATIC_NAMES = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];

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
  highOctave: boolean;
  onToggleOctave: () => void;
}

export function LickPanel({
  licks, selectedIdx, onSelect, onPlay, onStop, isPlaying, lickType, onClear,
  quality, rootSemitone, highOctave, onToggleOctave,
}: LickPanelProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hasSelection = selectedIdx != null;
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected item
  useEffect(() => {
    if (!open || selectedIdx == null || !listRef.current) return;
    const el = listRef.current.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  // Precompute mode candidates + start/end note info for each lick
  const lickMeta = useMemo(() => {
    const lt = QUALITY_TO_LICK_TYPE[quality] ?? quality;
    const storedRoot = TYPE_ROOT_SEMITONE[lt] ?? 0;
    const transpose = rootSemitone - storedRoot;

    return licks.map(lick => {
      const modes = inferModeCandidates(lick, quality, rootSemitone);
      const modeNames = modes.map(m => MODE_TEMPLATES[m.modeIdx].name);
      const modeKeys = modes.map(m => MODE_TEMPLATES[m.modeIdx].key);

      const pitched = lick.notes.filter(n => !n.rest && n.pitch != null);
      let startDeg = '', endDeg = '', startNote = '', endNote = '';
      if (pitched.length > 0) {
        const info = (p: number) => {
          const real = ((p + transpose) % 12 + 12) % 12;
          const deg = ((p + transpose - rootSemitone) % 12 + 12) % 12;
          return { note: CHROMATIC_NAMES[real], deg: CHROMATIC_DEGREE[deg] };
        };
        const s = info(pitched[0].pitch!);
        const e = info(pitched[pitched.length - 1].pitch!);
        startDeg = s.deg; startNote = s.note;
        endDeg = e.deg; endNote = e.note;
      }
      return { modes, modeNames, modeKeys, startDeg, endDeg, startNote, endNote };
    });
  }, [licks, quality, rootSemitone]);

  // Filter licks by search query (matches id, source display name, mode names, degrees)
  const filtered = useMemo(() => {
    if (!query.trim()) return licks.map((l, i) => ({ lick: l, origIdx: i }));
    const q = query.trim().toLowerCase();
    return licks.reduce<{ lick: LickEntry; origIdx: number }[]>((acc, lick, i) => {
      const id = (lick.id ?? '').toLowerCase();
      const src = lick.source
        ? (SOURCE_DISPLAY_NAMES[lick.source] ?? lick.source).toLowerCase()
        : '';
      const meta = `${lick.noteCount}音 ${lick.beats}拍`;
      const m = lickMeta[i];
      const modeStr = m ? m.modeNames.join(' ').toLowerCase() : '';
      const noteStr = m ? `${m.startDeg} ${m.endDeg} ${m.startNote} ${m.endNote}`.toLowerCase() : '';
      if (id.includes(q) || src.includes(q) || meta.includes(q) || modeStr.includes(q) || noteStr.includes(q)) {
        acc.push({ lick, origIdx: i });
      }
      return acc;
    }, []);
  }, [licks, query, lickMeta]);

  // Header bar (always visible) — acts as toggle
  const headerContent = (
    <div
      className="flex items-center gap-1.5 px-3 cursor-pointer select-none h-[31px]"
      style={{
        background: '#1a1a1a',
        borderBottom: '1px solid #333',
        fontSize: 11,
      }}
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
      <span className="text-text-dim">{licks.length}件</span>

      {/* Inline controls when collapsed & selected */}
      {!open && hasSelection && (
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <svg width="1" height="16" className="flex-shrink-0"><line x1="0.5" y1="0" x2="0.5" y2="16" stroke="#333" strokeWidth="1" /></svg>
          <span style={{ color: '#FF6B9D' }}>
            {licks[selectedIdx]?.id ?? `#${selectedIdx + 1}`}
          </span>
          <button
            onClick={isPlaying ? onStop : onPlay}
            className="rounded cursor-pointer px-1.5 h-[24px] inline-flex items-center justify-center"
            style={{
              border: '1px solid #555',
              background: isPlaying ? '#3a2020' : '#1a2a1a',
              color: isPlaying ? '#F88' : '#8F8',
            }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8">
              {isPlaying
                ? <rect x="1" y="1" width="6" height="6" fill="currentColor" />
                : <polygon points="1,0 8,4 1,8" fill="currentColor" />
              }
            </svg>
          </button>
          <button
            onClick={onToggleOctave}
            className="rounded cursor-pointer px-1.5 h-[24px] inline-flex items-center justify-center text-[9px] font-mono"
            style={{
              border: '1px solid #555',
              background: highOctave ? '#2a2a3a' : '#1a1a1a',
              color: highOctave ? '#8BF' : '#888',
            }}
            title={highOctave ? 'ローポジションで再生' : 'ハイポジションで再生'}
          >
            8va
          </button>
          <button
            onClick={() => { onClear(); onStop(); }}
            className="rounded cursor-pointer px-1.5 h-[24px] inline-flex items-center justify-center"
            style={{ border: '1px solid #444', background: '#1a1a1a', color: '#888' }}
            title="フレーズ解除"
          >
            <svg width="8" height="8" viewBox="0 0 8 8">
              <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" />
              <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
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
      style={{
        background: '#1a1a1a',
        border: '1px solid #3a2a30',
        borderRadius: 6,
        fontSize: 10,
      }}
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
              placeholder="検索 (ID, アーティスト, 音数...)"
              className="flex-1 text-[10px] rounded px-1.5 py-0.5 outline-none"
              style={{
                background: '#111',
                border: '1px solid #333',
                color: '#CCC',
                minWidth: 0,
              }}
              onClick={e => e.stopPropagation()}
            />
            {hasSelection && (
              <>
                <button
                  onClick={isPlaying ? onStop : onPlay}
                  className="rounded cursor-pointer text-[10px] font-mono px-2 h-[24px] inline-flex items-center flex-shrink-0"
                  style={{
                    border: '1px solid #555',
                    background: isPlaying ? '#3a2020' : '#1a2a1a',
                    color: isPlaying ? '#F88' : '#8F8',
                  }}
                >
                  {isPlaying ? '■ Stop' : '▶ Play'}
                </button>
                <button
                  onClick={onToggleOctave}
                  className="rounded cursor-pointer text-[10px] font-mono px-1.5 h-[24px] inline-flex items-center flex-shrink-0"
                  style={{
                    border: '1px solid #555',
                    background: highOctave ? '#2a2a3a' : '#1a1a1a',
                    color: highOctave ? '#8BF' : '#888',
                  }}
                  title={highOctave ? 'ローポジションで再生' : 'ハイポジションで再生'}
                >
                  8va
                </button>
                <button
                  onClick={() => { onClear(); onStop(); }}
                  className="rounded cursor-pointer text-[10px] font-mono px-1.5 h-[24px] inline-flex items-center flex-shrink-0"
                  style={{ border: '1px solid #444', background: '#1a1a1a', color: '#888' }}
                  title="フレーズ解除"
                >
                  ✕
                </button>
              </>
            )}
            <span className="text-[9px] text-text-dim flex-shrink-0">
              {filtered.length !== licks.length ? `${filtered.length}/` : ''}{licks.length}
            </span>
          </div>

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
              {filtered.map(({ lick, origIdx }) => {
                const isSelected = origIdx === selectedIdx;
                const sourceName = lick.source
                  ? (SOURCE_DISPLAY_NAMES[lick.source] ?? lick.source)
                  : '';
                const meta = lickMeta[origIdx];
                return (
                  <div
                    key={origIdx}
                    onClick={() => onSelect(origIdx)}
                    className="cursor-pointer px-2 py-[3px] flex items-center gap-1.5"
                    style={{
                      background: isSelected ? '#2a2a3a' : 'transparent',
                      borderLeft: isSelected ? '2px solid #FF6B9D' : '2px solid transparent',
                    }}
                  >
                    <span
                      className="text-[10px] font-mono flex-shrink-0"
                      style={{
                        color: isSelected ? '#FF6B9D' : '#666',
                        width: '40px',
                      }}
                    >
                      {lick.id ?? `#${origIdx + 1}`}
                    </span>
                    <LickContourMini notes={lick.notes} selected={isSelected} />
                    <span
                      className="text-[9px] flex-shrink-0"
                      style={{ color: isSelected ? '#CCC' : '#888', width: '28px' }}
                    >
                      {lick.noteCount}音
                    </span>
                    <span className="text-[9px] flex-shrink-0" style={{ color: isSelected ? '#CCC' : '#999', width: '24px' }}>
                      {lick.beats}拍
                    </span>
                    {meta && meta.startDeg && (
                      <span
                        className="text-[9px] font-mono flex-shrink-0 inline-flex items-center"
                        style={{ color: isSelected ? '#CCC' : '#999', width: '42px', marginLeft: '4px' }}
                      >
                        <span style={{ width: '16px', textAlign: 'center' }}>{meta.startDeg}</span>
                        <span style={{ width: '10px', textAlign: 'center', color: isSelected ? '#888' : '#666' }}>→</span>
                        <span style={{ width: '16px', textAlign: 'center' }}>{meta.endDeg}</span>
                      </span>
                    )}
                    {meta && meta.startNote && (
                      <span
                        className="text-[9px] font-mono flex-shrink-0 inline-flex items-center"
                        style={{ color: isSelected ? '#BBB' : '#888', width: '42px', marginLeft: '4px' }}
                      >
                        <span style={{ width: '16px', textAlign: 'center' }}>{meta.startNote}</span>
                        <span style={{ width: '10px', textAlign: 'center', color: isSelected ? '#999' : '#666' }}>→</span>
                        <span style={{ width: '16px', textAlign: 'center' }}>{meta.endNote}</span>
                      </span>
                    )}
                    <span
                      className="text-[9px] flex-shrink-0"
                      style={{ color: isSelected ? '#CCC' : '#999', width: '130px', marginLeft: '4px' }}
                    >
                      {sourceName || '\u00A0'}
                    </span>
                    {meta && meta.modes.length > 0 && (
                      <span className="text-[9px] truncate min-w-0">
                        {meta.modes.map((m, mi) => (
                          <span key={m.modeIdx}>
                            {mi > 0 && <span style={{ color: '#666' }}>, </span>}
                            <span style={{ color: MODE_COLORS[meta.modeKeys[mi]] ?? '#888' }}>
                              {meta.modeNames[mi]}
                            </span>
                          </span>
                        ))}
                      </span>
                    )}
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
