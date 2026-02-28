import { useState } from 'react';
import type { Progression, ChordSlot, RootName, SongKey } from '../../types';
import { ROOTS } from '../../constants';
import { parseChordSymbol, buildChordSlot, suggestMode, PRESET_PROGRESSIONS } from '../../utils';

interface ProgressionEditorProps {
  progressions: Progression[];
  activeProgIdx: number;
  onSave: (progs: Progression[]) => void;
  onSelectProg: (idx: number) => void;
  onClose: () => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]';

export function ProgressionEditor({
  progressions, activeProgIdx, onSave, onSelectProg, onClose,
}: ProgressionEditorProps) {
  const prog = progressions[activeProgIdx] ?? { name: '', chords: [] };
  const [name, setName] = useState(prog.name);
  const [songKey, setSongKey] = useState<SongKey | undefined>(prog.songKey);
  const [chords, setChords] = useState<ChordSlot[]>([...prog.chords]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  function addChord() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const parsed = parseChordSymbol(trimmed);
    if (!parsed) {
      setError(`"${trimmed}" は対応外のコードです (M7/m7/7/m7♭5 のみ)`);
      return;
    }
    setError('');
    const prevPosId = chords.length > 0 ? chords[chords.length - 1].posId : 1;
    setChords([...chords, buildChordSlot(trimmed, parsed, prevPosId, songKey)]);
    setInput('');
  }

  function removeChord(idx: number) {
    setChords(chords.filter((_, i) => i !== idx));
  }

  function moveChord(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= chords.length) return;
    const copy = [...chords];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    setChords(copy);
  }

  function handleSave() {
    const updated: Progression = { name: name || 'Untitled', songKey, chords };
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
  }

  function handleDelete() {
    if (progressions.length <= 1) return;
    const copy = progressions.filter((_, i) => i !== activeProgIdx);
    const newIdx = Math.min(activeProgIdx, copy.length - 1);
    onSave(copy);
    onSelectProg(newIdx);
    setName(copy[newIdx].name);
    setSongKey(copy[newIdx].songKey);
    setChords([...copy[newIdx].chords]);
  }

  function handleLoadPreset(preset: Progression) {
    setName(preset.name);
    setSongKey(preset.songKey);
    setChords([...preset.chords]);
  }

  function handleSongKeyChange(newKey: SongKey | undefined) {
    setSongKey(newKey);
    // Re-suggest modes for unconfirmed chords
    setChords(chords.map(c => {
      if (c.modeConfirmed) return c;
      return { ...c, modeIdx: suggestMode(c.rootName, c.quality, newKey) };
    }));
  }

  function handleSelectProg(idx: number) {
    // Save current first
    handleSave();
    onSelectProg(idx);
    const p = progressions[idx];
    setName(p.name);
    setSongKey(p.songKey);
    setChords([...p.chords]);
  }

  return (
    <div className="bg-[#1a1a1a] border border-[#444] rounded p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-text-primary">進行エディタ</span>
        <button onClick={onClose} className={btnBase}
          style={{ border: '1px solid #666', background: '#1a1a1a', color: '#CCC' }}>
          閉じる
        </button>
      </div>

      {/* Progression selector */}
      <div className="flex flex-wrap gap-1 mb-2">
        {progressions.map((p, i) => (
          <button key={i} onClick={() => handleSelectProg(i)}
            className={btnBase}
            style={{
              border: `1px solid ${i === activeProgIdx ? '#FFF' : '#444'}`,
              background: i === activeProgIdx ? '#3a3a3a' : '#1a1a1a',
              color: i === activeProgIdx ? '#FFF' : '#888',
            }}>
            {p.name}
          </button>
        ))}
        <button onClick={handleNew} className={btnBase}
          style={{ border: '1px solid #27AE60', background: '#1a1a1a', color: '#27AE60' }}>
          + 新規
        </button>
      </div>

      {/* Preset loader */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className="text-[9px] text-text-dim mr-1 self-center">プリセット:</span>
        {PRESET_PROGRESSIONS.map((preset, i) => (
          <button key={i} onClick={() => handleLoadPreset(preset)}
            className={btnBase}
            style={{ border: '1px solid #555', background: '#1a1a1a', color: '#AAA' }}>
            {preset.name}
          </button>
        ))}
      </div>

      {/* Name + Key input */}
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="進行名"
          className="bg-[#111] border border-[#444] rounded text-[11px] text-text-primary font-mono px-2 py-1 w-48"
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

      {/* Chord list */}
      <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
        {chords.map((c, i) => (
          <div key={i} className="flex items-center gap-0.5 bg-[#222] border border-[#444] rounded px-1.5 py-0.5">
            <span className="text-[11px] text-text-primary font-mono">{c.symbol}</span>
            <button onClick={() => moveChord(i, -1)} className="text-[9px] text-text-dim hover:text-white cursor-pointer px-0.5">◀</button>
            <button onClick={() => moveChord(i, 1)} className="text-[9px] text-text-dim hover:text-white cursor-pointer px-0.5">▶</button>
            <button onClick={() => removeChord(i)} className="text-[9px] text-[#E74C3C] hover:text-white cursor-pointer px-0.5">×</button>
          </div>
        ))}
        {chords.length === 0 && (
          <span className="text-[10px] text-text-dim self-center">コードを追加してください</span>
        )}
      </div>

      {/* Add chord input */}
      <div className="flex items-center gap-1.5 mb-1">
        <input
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') addChord(); }}
          placeholder="Dm7, G7, Cmaj7..."
          className="bg-[#111] border border-[#444] rounded text-[11px] text-text-primary font-mono px-2 py-1 w-36"
          style={error ? { borderColor: '#E74C3C' } : undefined}
        />
        <button onClick={addChord} className={btnBase}
          style={{ border: '1px solid #27AE60', background: '#1a1a1a', color: '#27AE60' }}>
          追加
        </button>
        <button onClick={handleSave} className={btnBase}
          style={{ border: '1px solid #2980B9', background: '#1a1a1a', color: '#2980B9' }}>
          保存
        </button>
        <button onClick={handleDelete} className={btnBase}
          style={{ border: '1px solid #E74C3C', background: '#1a1a1a', color: '#E74C3C',
            opacity: progressions.length <= 1 ? 0.3 : 1 }}>
          削除
        </button>
      </div>
      {error && <p className="text-[9px] text-[#E74C3C] mt-0.5">{error}</p>}
    </div>
  );
}
