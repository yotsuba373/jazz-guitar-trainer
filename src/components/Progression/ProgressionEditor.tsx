import { useState, useEffect, type ReactNode } from 'react';
import type { Progression, ChordSlot, ChartLayout, RootName, SongKey, ChordNotationPrefs } from '../../types';
import { ROOTS } from '../../constants';
import { parseChordSymbol, buildChordSlot, suggestMode, displayChordName, PRESET_PROGRESSIONS, appendChordToLayout, removeChordFromLayout, computeInsertFlatIndex, insertChordAtBeat, deriveChartLayout } from '../../utils';
import { SongImporter } from './SongImporter';

interface ProgressionEditorProps {
  progressions: Progression[];
  activeProgIdx: number;
  chordPrefs: ChordNotationPrefs;
  activeChordIdx: number;
  onSave: (progs: Progression[]) => void;
  onSelectProg: (idx: number) => void;
  onClose: () => void;
  children?: (editingChords: ChordSlot[], onRemoveChord: (idx: number) => void, chartLayout: ChartLayout | undefined, onInsertAtBeat: (referenceIdx: number, beat: number) => void) => ReactNode;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]';

export function ProgressionEditor({
  progressions, activeProgIdx, chordPrefs, activeChordIdx, onSave, onSelectProg,
  children,
}: ProgressionEditorProps) {
  const prog = progressions[activeProgIdx] ?? { name: '', chords: [] };
  const [name, setName] = useState(prog.name);
  const [songKey, setSongKey] = useState<SongKey | undefined>(prog.songKey);
  const [chords, setChords] = useState<ChordSlot[]>([...prog.chords]);
  const [chartLayout, setChartLayout] = useState<ChartLayout | undefined>(prog.chartLayout);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [showImporter, setShowImporter] = useState(false);
  // null = add mode, number = editing that chord index
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // When set, we're inserting a new chord at this beat (in the measure containing editIdx)
  const [insertBeat, setInsertBeat] = useState<number | null>(null);

  // When activeChordIdx changes (user clicks chart), enter edit mode for that chord
  useEffect(() => {
    if (activeChordIdx >= 0 && activeChordIdx < chords.length) {
      const c = chords[activeChordIdx];
      setEditIdx(activeChordIdx);
      setInsertBeat(null);
      setInput(displayChordName(c, chordPrefs));
      setError('');
    }
  }, [activeChordIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit() {
    if (editIdx != null && insertBeat != null) {
      insertAtBeat(insertBeat);
    } else if (editIdx != null) {
      updateChord();
    } else {
      addChord();
    }
  }

  function addChord() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const parsed = parseChordSymbol(trimmed);
    if (!parsed) {
      setError(`"${trimmed}" は認識できないコードです`);
      return;
    }
    setError('');
    const prevPosId = chords.length > 0 ? chords[chords.length - 1].posId : 1;
    const newIdx = chords.length;
    setChords([...chords, buildChordSlot(trimmed, parsed, prevPosId, songKey)]);
    setChartLayout(prev => prev ? appendChordToLayout(prev, newIdx) : undefined);
    setInput('');
  }

  function updateChord() {
    if (editIdx == null) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const parsed = parseChordSymbol(trimmed);
    if (!parsed) {
      setError(`"${trimmed}" は認識できないコードです`);
      return;
    }
    setError('');
    const old = chords[editIdx];
    const updated = buildChordSlot(trimmed, parsed, old.posId, songKey);
    // Preserve confirmed mode/pos if root+quality unchanged
    if (old.rootName === updated.rootName && old.quality === updated.quality) {
      updated.modeIdx = old.modeIdx;
      updated.modeConfirmed = old.modeConfirmed;
      updated.posId = old.posId;
      updated.posConfirmed = old.posConfirmed;
    }
    const copy = [...chords];
    copy[editIdx] = updated;
    setChords(copy);
    // chartLayout is unchanged — chord index stays the same
  }

  function handleBeatClick(referenceIdx: number, beat: number) {
    if (beat === 0) {
      // Chord cell clicked in beat grid — switch to edit mode
      setEditIdx(referenceIdx);
      setInsertBeat(null);
      if (referenceIdx < chords.length) {
        setInput(displayChordName(chords[referenceIdx], chordPrefs));
      }
      setError('');
      return;
    }
    // Empty beat clicked — switch to insert mode
    setEditIdx(referenceIdx);
    setInsertBeat(beat);
    setInput('');
    setError('');
  }

  function insertAtBeat(beat: number) {
    if (editIdx == null) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const parsed = parseChordSymbol(trimmed);
    if (!parsed) {
      setError(`"${trimmed}" は認識できないコードです`);
      return;
    }
    setError('');
    const layout = chartLayout ?? deriveChartLayout(chords);
    const flatIdx = computeInsertFlatIndex(layout, editIdx, beat);
    if (flatIdx == null) return;
    const prevPosId = chords[editIdx]?.posId ?? 1;
    const newChord = buildChordSlot(trimmed, parsed, prevPosId, songKey);
    const newChords = [...chords];
    newChords.splice(flatIdx, 0, newChord);
    setChords(newChords);
    setChartLayout(insertChordAtBeat(layout, editIdx, beat, flatIdx));
    setInput('');
    setEditIdx(null);
  }

  function cancelEdit() {
    setEditIdx(null);
    setInsertBeat(null);
    setInput('');
    setError('');
  }

  function removeChord(idx: number) {
    setChords(chords.filter((_, i) => i !== idx));
    setChartLayout(prev => prev ? removeChordFromLayout(prev, idx) : undefined);
    if (editIdx === idx) cancelEdit();
    else if (editIdx != null && editIdx > idx) setEditIdx(editIdx - 1);
  }

  function handleSave() {
    const updated: Progression = { name: name || 'Untitled', songKey, chords, chartLayout };
    const copy = [...progressions];
    if (activeProgIdx < copy.length) {
      copy[activeProgIdx] = updated;
    } else {
      copy.push(updated);
    }
    onSave(copy);
  }

  function handleNew() {
    const copy = [...progressions, { name: 'New', chords: [] }];
    onSave(copy);
    onSelectProg(copy.length - 1);
    setName('New');
    setSongKey(undefined);
    setChords([]);
    setChartLayout(undefined);
    cancelEdit();
  }

  function handleDelete() {
    const copy = progressions.filter((_, i) => i !== activeProgIdx);
    if (copy.length === 0) {
      const fresh = [{ name: 'New', chords: [] as ChordSlot[] }];
      onSave(fresh);
      onSelectProg(0);
      setName('New');
      setSongKey(undefined);
      setChords([]);
      setChartLayout(undefined);
      cancelEdit();
      return;
    }
    const newIdx = Math.min(activeProgIdx, copy.length - 1);
    onSave(copy);
    onSelectProg(newIdx);
    setName(copy[newIdx].name);
    setSongKey(copy[newIdx].songKey);
    setChords([...copy[newIdx].chords]);
    setChartLayout(copy[newIdx].chartLayout);
    cancelEdit();
  }

  function handleLoadPreset(preset: Progression) {
    setName(preset.name);
    setSongKey(preset.songKey);
    setChords([...preset.chords]);
    setChartLayout(preset.chartLayout);
    cancelEdit();
  }

  function handleImport(imported: Progression) {
    setName(imported.name);
    setSongKey(imported.songKey);
    setChords([...imported.chords]);
    setChartLayout(imported.chartLayout);
    setShowImporter(false);
    cancelEdit();
  }

  function handleSongKeyChange(newKey: SongKey | undefined) {
    setSongKey(newKey);
    setChords(chords.map(c => {
      if (c.modeConfirmed) return c;
      return { ...c, modeIdx: suggestMode(c.rootName, c.quality, newKey) };
    }));
  }

  function handleSelectProg(idx: number) {
    handleSave();
    onSelectProg(idx);
    const p = progressions[idx];
    setName(p.name);
    setSongKey(p.songKey);
    setChords([...p.chords]);
    setChartLayout(p.chartLayout);
    cancelEdit();
  }

  const isEditing = editIdx != null;

  return (
    <div>
      {/* Compact toolbar */}
      <div className="bg-[#1a1a1a] border border-[#444] rounded p-2 mb-2">
        {/* Saved progressions */}
        <div className="flex gap-0.5 overflow-x-auto scrollbar-thin pb-0.5 mb-1.5">
          {progressions.map((p, i) => (
            <button key={i} onClick={() => handleSelectProg(i)}
              className="rounded cursor-pointer text-[10px] font-mono px-2 h-[22px] inline-flex items-center whitespace-nowrap shrink-0"
              style={{
                border: `1px solid ${i === activeProgIdx ? '#FFF' : '#444'}`,
                background: i === activeProgIdx ? '#3a3a3a' : '#1a1a1a',
                color: i === activeProgIdx ? '#FFF' : '#888',
                fontWeight: i === activeProgIdx ? 700 : 400,
              }}>
              {p.name}
            </button>
          ))}
        </div>

        {/* Name + Key */}
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="進行名"
            className="bg-[#111] border border-[#444] rounded text-[11px] text-text-primary font-mono px-2 py-1 w-36"
          />
          <span className="text-[9px] text-text-dim">Key:</span>
          <select
            value={songKey?.root ?? ''}
            onChange={e => {
              const root = e.target.value as RootName;
              handleSongKeyChange(root ? { root, minor: songKey?.minor ?? false } : undefined);
            }}
            className="bg-[#111] border border-[#444] rounded text-[11px] text-text-primary font-mono px-1.5 py-1 cursor-pointer"
          >
            <option value="">未設定</option>
            {ROOTS.map(r => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
          {songKey && (
            <>
              <button onClick={() => handleSongKeyChange({ ...songKey, minor: false })}
                className={btnBase}
                style={{
                  border: `1px solid ${!songKey.minor ? '#FFF' : '#444'}`,
                  background: !songKey.minor ? '#3a3a3a' : '#1a1a1a',
                  color: !songKey.minor ? '#FFF' : '#888',
                  fontWeight: !songKey.minor ? 700 : 400,
                }}>
                Major
              </button>
              <button onClick={() => handleSongKeyChange({ ...songKey, minor: true })}
                className={btnBase}
                style={{
                  border: `1px solid ${songKey.minor ? '#FFF' : '#444'}`,
                  background: songKey.minor ? '#3a3a3a' : '#1a1a1a',
                  color: songKey.minor ? '#FFF' : '#888',
                  fontWeight: songKey.minor ? 700 : 400,
                }}>
                Minor
              </button>
            </>
          )}
        </div>

        {/* Chord input + actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="text"
            value={input}
            onChange={e => { setInput(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') cancelEdit(); }}
            placeholder={insertBeat != null ? `${insertBeat}拍目に挿入` : isEditing ? `コード #${editIdx + 1} を編集` : 'Dm7, G7, CM7...'}
            className="bg-[#111] rounded text-[11px] text-text-primary font-mono px-2 py-1 w-32"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: error ? '#E74C3C' : insertBeat != null ? '#27AE60' : isEditing ? '#F1C40F' : '#444',
            }}
          />
          {isEditing ? (
            <>
              {insertBeat != null ? (
                <button onClick={() => insertAtBeat(insertBeat)} className={btnBase}
                  style={{ border: '1px solid #27AE60', background: '#1a2a1a', color: '#27AE60' }}>
                  挿入
                </button>
              ) : (
                <button onClick={updateChord} className={btnBase}
                  style={{ border: '1px solid #F1C40F', background: '#2a2a1a', color: '#F1C40F' }}>
                  更新
                </button>
              )}
              <button onClick={cancelEdit} className={btnBase}
                style={{ border: '1px solid #666', background: '#1a1a1a', color: '#888' }}>
                取消
              </button>
            </>
          ) : (
            <button onClick={addChord} className={btnBase}
              style={{ border: '1px solid #27AE60', background: '#1a1a1a', color: '#27AE60' }}>
              追加
            </button>
          )}
          <span className="text-[9px] text-text-dim mx-0.5">|</span>
          <select
            onChange={e => {
              const idx = Number(e.target.value);
              if (idx >= 0) handleLoadPreset(PRESET_PROGRESSIONS[idx]);
            }}
            value=""
            className="bg-[#111] border border-[#555] rounded text-[10px] text-[#AAA] font-mono px-1.5 py-1 cursor-pointer"
          >
            <option value="">プリセット</option>
            {PRESET_PROGRESSIONS.map((preset, i) => (
              <option key={i} value={i}>{preset.name}</option>
            ))}
          </select>
          <button onClick={() => setShowImporter(!showImporter)}
            className={btnBase}
            style={{
              border: `1px solid ${showImporter ? '#FFF' : '#2980B9'}`,
              background: showImporter ? '#1a2a3a' : '#1a1a1a',
              color: '#2980B9',
            }}>
            インポート
          </button>
          <span className="text-[9px] text-text-dim mx-0.5">|</span>
          <button onClick={handleSave} className={btnBase}
            style={{ border: '1px solid #2980B9', background: '#1a1a1a', color: '#2980B9' }}>
            保存
          </button>
          <button onClick={handleNew} className={btnBase}
            style={{ border: '1px solid #27AE60', background: '#1a1a1a', color: '#27AE60' }}>
            + 新規
          </button>
          <button onClick={handleDelete} className={btnBase}
            style={{ border: '1px solid #E74C3C', background: '#1a1a1a', color: '#E74C3C' }}>
            削除
          </button>
        </div>
        {error && <p className="text-[9px] text-[#E74C3C] mt-0.5">{error}</p>}
      </div>

      {showImporter && (
        <SongImporter
          onImport={handleImport}
          onClose={() => setShowImporter(false)}
        />
      )}

      {/* Render chart via children slot with editing chords */}
      {children?.(chords, removeChord, chartLayout, handleBeatClick)}
    </div>
  );
}
