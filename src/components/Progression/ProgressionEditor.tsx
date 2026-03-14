import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { Progression, ChordSlot, ChartLayout, RootName, SongKey, ChordNotationPrefs } from '../../types';
import type { SelectedBeatInfo } from './ChordChart';
import { ROOTS } from '../../constants';
import { parseChordSymbol, buildChordSlot, suggestMode, displayChordName, PRESET_PROGRESSIONS, removeChordFromLayout, computeInsertFlatIndex, insertChordAtBeat, deriveChartLayout, splitSection, mergeSections, splitEndings, removeEndings, renameSection, findChordMeasure, adjustEndingSplit, splitSectionAtEnding, insertEmptyMeasure } from '../../utils';
import { SongImporter } from './SongImporter';
import { ChordAutocomplete } from '../Controls';
import { useUndoRedo } from '../../hooks';

interface EditorSnapshot {
  chords: ChordSlot[];
  chartLayout: ChartLayout | undefined;
}

interface ProgressionEditorProps {
  progressions: Progression[];
  activeProgIdx: number;
  chordPrefs: ChordNotationPrefs;
  activeChordIdx: number;
  onSave: (progs: Progression[]) => void;
  onSelectProg: (idx: number) => void;
  onClose: () => void;
  children?: (
    editingChords: ChordSlot[],
    onRemoveChord: (idx: number) => void,
    chartLayout: ChartLayout | undefined,
    onInsertAtBeat: (referenceIdx: number, beat: number) => void,
    onEmptyMeasureBeat: (sectionIdx: number, measureIdx: number, endingIdx: number | undefined, beat: number) => void,
    onRemoveEmptyMeasure: (sectionIdx: number, measureIdx: number, endingIdx: number | undefined) => void,
    selectedBeat: SelectedBeatInfo | null,
  ) => ReactNode;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]';

export function ProgressionEditor({
  progressions, activeProgIdx, chordPrefs, activeChordIdx, onSave, onSelectProg,
  children,
}: ProgressionEditorProps) {
  const prog = progressions[activeProgIdx] ?? { name: '', chords: [] };
  const [name, setName] = useState(prog.name);
  const [songKey, setSongKey] = useState<SongKey | undefined>(prog.songKey);
  const {
    state: editorState,
    set: setEditorState,
    undo, redo, reset: resetEditorState,
    canUndo, canRedo,
  } = useUndoRedo<EditorSnapshot>({ chords: [...prog.chords], chartLayout: prog.chartLayout });

  const chords = editorState.chords;
  const chartLayout = editorState.chartLayout;
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [showImporter, setShowImporter] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // null = add mode, number = editing that chord index
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // When set, we're inserting a new chord at this beat (in the measure containing editIdx)
  const [insertBeat, setInsertBeat] = useState<number | null>(null);
  // When set, we're filling a chord into an empty measure at this beat
  const [emptyTarget, setEmptyTarget] = useState<{
    sectionIdx: number; measureIdx: number; endingIdx?: number; beat: number;
  } | null>(null);

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

  // Undo/Redo keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  function handleSubmit() {
    if (emptyTarget) {
      fillEmptyMeasure();
    } else if (editIdx != null && insertBeat != null) {
      insertAtBeat(insertBeat);
    } else if (editIdx != null) {
      updateChord();
    }
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
    if (old.rootName === updated.rootName && old.quality === updated.quality) {
      updated.modeIdx = old.modeIdx;
      updated.modeConfirmed = old.modeConfirmed;
      updated.posId = old.posId;
      updated.posConfirmed = old.posConfirmed;
    }
    const copy = [...chords];
    copy[editIdx] = updated;
    setEditorState({ chords: copy, chartLayout });
  }

  function handleBeatClick(referenceIdx: number, beat: number) {
    setEmptyTarget(null);
    if (beat === 0) {
      setEditIdx(referenceIdx);
      setInsertBeat(null);
      if (referenceIdx < chords.length) {
        setInput(displayChordName(chords[referenceIdx], chordPrefs));
      }
      setError('');
    } else {
      setEditIdx(referenceIdx);
      setInsertBeat(beat);
      setInput('');
      setError('');
    }
    requestAnimationFrame(() => inputRef.current?.focus());
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
    setEditorState({ chords: newChords, chartLayout: insertChordAtBeat(layout, editIdx, beat, flatIdx) });
    setInput('');
    setEditIdx(null);
  }

  function cancelEdit() {
    setEditIdx(null);
    setInsertBeat(null);
    setEmptyTarget(null);
    setInput('');
    setError('');
  }

  function removeChord(idx: number) {
    setEditorState({
      chords: chords.filter((_, i) => i !== idx),
      chartLayout: chartLayout ? removeChordFromLayout(chartLayout, idx) : undefined,
    });
    if (editIdx === idx) cancelEdit();
    else if (editIdx != null && editIdx > idx) setEditIdx(editIdx - 1);
  }

  function removeEmptyMeasure(sectionIdx: number, measureIdx: number, endingIdx: number | undefined) {
    const layout = chartLayout ?? deriveChartLayout(chords);
    const newSections = layout.sections.map((sec, si) => {
      if (si !== sectionIdx) return sec;
      if (endingIdx != null) {
        if (!sec.endings) return sec;
        const endings = sec.endings.map((e, ei) =>
          ei === endingIdx ? e.filter((_, mi) => mi !== measureIdx) : e,
        );
        return { ...sec, endings };
      }
      return { ...sec, measures: sec.measures.filter((_, mi) => mi !== measureIdx) };
    });
    setEditorState({ chords, chartLayout: { sections: newSections, barsPerRow: layout.barsPerRow } });
    // If the deleted measure was selected, clear selection
    if (emptyTarget?.sectionIdx === sectionIdx && emptyTarget?.measureIdx === measureIdx && emptyTarget?.endingIdx === endingIdx) {
      cancelEdit();
    }
  }

  // --- Add empty measure ---

  function handleAddMeasure() {
    const layout = ensureLayout();
    const updated = insertEmptyMeasure(layout, editIdx ?? undefined);
    setEditorState({ chords, chartLayout: updated });

    // Find the newly inserted empty measure and enter insert mode for beat 1
    let targetSi = 0;
    let targetMi = 0;
    let targetEi: number | undefined;
    if (editIdx == null) {
      // Appended to end of last section (or last ending)
      const lastSec = updated.sections[updated.sections.length - 1];
      targetSi = updated.sections.length - 1;
      if (lastSec.endings && lastSec.endings.length > 0) {
        targetEi = lastSec.endings.length - 1;
        targetMi = lastSec.endings[targetEi].length - 1;
      } else {
        targetMi = lastSec.measures.length - 1;
      }
    } else {
      // Inserted after the measure containing editIdx — find it
      const info = findChordMeasure(layout, editIdx);
      if (info) {
        targetSi = info.sectionIdx;
        if (info.endingIdx != null) {
          targetEi = info.endingIdx;
          targetMi = info.measureIdx + 1;
        } else {
          targetMi = info.measureIdx + 1;
        }
      }
    }

    setEditIdx(null);
    setInsertBeat(null);
    setEmptyTarget({ sectionIdx: targetSi, measureIdx: targetMi, endingIdx: targetEi, beat: 1 });
    setInput('');
    setError('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleEmptyMeasureBeat(sectionIdx: number, measureIdx: number, endingIdx: number | undefined, beat: number) {
    setEditIdx(null);
    setInsertBeat(null);
    setEmptyTarget({ sectionIdx, measureIdx, endingIdx, beat });
    setInput('');
    setError('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function fillEmptyMeasure() {
    if (!emptyTarget) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const parsed = parseChordSymbol(trimmed);
    if (!parsed) {
      setError(`"${trimmed}" は認識できないコードです`);
      return;
    }
    setError('');
    const layout = chartLayout ?? deriveChartLayout(chords);
    const { sectionIdx, measureIdx, endingIdx } = emptyTarget;

    const prevPosId = chords.length > 0 ? chords[chords.length - 1].posId : 1;
    const newChord = buildChordSlot(trimmed, parsed, prevPosId, songKey);

    // Count all chord indices up to this empty measure → flat insert position
    let flatIdx = 0;
    for (let si = 0; si < layout.sections.length; si++) {
      const s = layout.sections[si];
      for (let mi = 0; mi < s.measures.length; mi++) {
        if (si === sectionIdx && endingIdx == null && mi === measureIdx) break;
        flatIdx += s.measures[mi].chordIndices.length;
      }
      if (si === sectionIdx && endingIdx == null) break;
      if (si === sectionIdx && endingIdx != null) {
        // Add all main measures
        for (const m of s.measures) flatIdx += m.chordIndices.length;
        // Add endings up to target
        if (s.endings) {
          for (let ei = 0; ei < s.endings.length; ei++) {
            for (let mi = 0; mi < s.endings[ei].length; mi++) {
              if (ei === endingIdx && mi === measureIdx) break;
              flatIdx += s.endings[ei][mi].chordIndices.length;
            }
            if (ei === endingIdx) break;
          }
        }
        break;
      }
      if (si < sectionIdx) {
        if (s.endings) for (const e of s.endings) for (const m of e) flatIdx += m.chordIndices.length;
      }
    }

    // Insert chord into flat array
    const newChords = [...chords];
    newChords.splice(flatIdx, 0, newChord);

    // Update layout: fill the target measure, bump all other indices
    function patchMeasures(
      ms: { chordIndices: number[]; beatWidths?: number[] }[],
      isSi: boolean,
      isTargetArray: boolean,
    ) {
      return ms.map((m, mi) => {
        if (isSi && isTargetArray && mi === measureIdx && m.chordIndices.length === 0) {
          // Target empty measure: place chord (fills whole measure)
          return { chordIndices: [flatIdx] };
        }
        return {
          ...m,
          chordIndices: m.chordIndices.map(ci => ci >= flatIdx ? ci + 1 : ci),
          ...(m.beatWidths ? { beatWidths: [...m.beatWidths] } : {}),
        };
      });
    }

    const newSections = layout.sections.map((s, si) => {
      const isSi = si === sectionIdx;
      return {
        ...s,
        measures: patchMeasures(s.measures, isSi, endingIdx == null),
        ...(s.endings ? {
          endings: s.endings.map((e, ei) => patchMeasures(e, isSi, endingIdx === ei)),
        } : {}),
      };
    });

    setEditorState({ chords: newChords, chartLayout: { sections: newSections, barsPerRow: layout.barsPerRow } });
    setInput('');
    setEmptyTarget(null);
  }

  // --- Section structure operations (symbol buttons) ---

  function ensureLayout(): ChartLayout {
    if (chartLayout) return chartLayout;
    const derived = deriveChartLayout(chords);
    // Don't push to undo stack — just ensure layout exists
    return derived;
  }

  /** Smart section label: typing a label mid-section splits there; clearing merges back. */
  function handleSectionLabel(newLabel: string) {
    if (editIdx == null) return;
    const layout = ensureLayout();
    const info = findChordMeasure(layout, editIdx);
    if (!info) return;

    if (info.endingIdx != null) {
      // Inside an ending — split the section at this ending measure
      if (!newLabel) return; // can't clear label inside ending
      let updated = splitSectionAtEnding(layout, info.sectionIdx, info.endingIdx, info.measureIdx);
      updated = renameSection(updated, info.sectionIdx + 1, newLabel);
      setEditorState({ chords, chartLayout: updated });
      return;
    }

    if (info.measureIdx === 0) {
      // Already at section start — rename or merge
      if (!newLabel && info.sectionIdx > 0) {
        // Empty label on non-first section → merge with previous
        setEditorState({ chords, chartLayout: mergeSections(layout, info.sectionIdx - 1) });
      } else {
        setEditorState({ chords, chartLayout: renameSection(layout, info.sectionIdx, newLabel) });
      }
    } else if (newLabel) {
      // Mid-section with a label → split here and name the new section
      let updated = splitSection(layout, info.sectionIdx, info.measureIdx);
      updated = renameSection(updated, info.sectionIdx + 1, newLabel);
      setEditorState({ chords, chartLayout: updated });
    }
  }

  function handleRepeatStart() {
    if (editIdx == null) return;
    const layout = ensureLayout();
    const info = findChordMeasure(layout, editIdx);
    if (!info || info.endingIdx != null) return;

    const sec = layout.sections[info.sectionIdx];
    const hasRepeat = sec.repeats != null && sec.repeats >= 1;

    if (info.measureIdx === 0) {
      // Toggle repeat on current section
      const sections = layout.sections.map((s, i) =>
        i === info.sectionIdx ? { ...s, repeats: hasRepeat ? undefined : 1 } : s,
      );
      setEditorState({ chords, chartLayout: { ...layout, sections } });
    } else {
      // Split section here, then add repeat to the new (second) section
      let newLayout = splitSection(layout, info.sectionIdx, info.measureIdx);
      const sections = newLayout.sections.map((s, i) =>
        i === info.sectionIdx + 1 ? { ...s, repeats: 1 } : s,
      );
      setEditorState({ chords, chartLayout: { ...newLayout, sections } });
    }
  }

  function handleRepeatEnd() {
    if (editIdx == null) return;
    const layout = ensureLayout();
    const info = findChordMeasure(layout, editIdx);
    if (!info || info.endingIdx != null) return;

    const sec = layout.sections[info.sectionIdx];
    const hasRepeat = sec.repeats != null && sec.repeats >= 1;
    const isLast = info.measureIdx === sec.measures.length - 1;

    if (isLast) {
      // Toggle repeat on current section
      const sections = layout.sections.map((s, i) =>
        i === info.sectionIdx ? { ...s, repeats: hasRepeat ? undefined : 1 } : s,
      );
      setEditorState({ chords, chartLayout: { ...layout, sections } });
    } else {
      // Split after this measure, set repeat on first part
      let newLayout = splitSection(layout, info.sectionIdx, info.measureIdx + 1);
      const sections = newLayout.sections.map((s, i) =>
        i === info.sectionIdx ? { ...s, repeats: 1 } : s,
      );
      setEditorState({ chords, chartLayout: { ...newLayout, sections } });
    }
  }

  function handleVolta1() {
    if (editIdx == null) return;
    const layout = ensureLayout();
    const info = findChordMeasure(layout, editIdx);
    if (!info) return;

    if (info.endingIdx === 0) {
      // Already in volta 1 → remove endings
      setEditorState({ chords, chartLayout: removeEndings(layout, info.sectionIdx) });
    } else if (info.endingIdx == null && info.measureIdx > 0) {
      // Set volta starting at this measure
      let updated = layout;
      const sec = layout.sections[info.sectionIdx];
      if (sec.endings && sec.endings.length > 0) {
        updated = removeEndings(updated, info.sectionIdx);
      }
      updated = splitEndings(updated, info.sectionIdx, info.measureIdx);
      setEditorState({ chords, chartLayout: updated });
    }
  }

  function handleVolta2() {
    if (editIdx == null) return;
    const layout = ensureLayout();
    const info = findChordMeasure(layout, editIdx);
    if (!info || info.endingIdx == null) return;

    const sec = layout.sections[info.sectionIdx];
    if (!sec.endings || sec.endings.length === 0) return;

    // Compute flat index within all endings
    let endFlatIdx: number;
    if (sec.endings.length === 1) {
      // Only ending[0] exists — split it to create ending[1]
      endFlatIdx = info.measureIdx;
    } else if (info.endingIdx === 0) {
      endFlatIdx = info.measureIdx;
    } else {
      endFlatIdx = sec.endings[0].length + info.measureIdx;
    }

    if (endFlatIdx >= 1) {
      setEditorState({ chords, chartLayout: adjustEndingSplit(layout, info.sectionIdx, endFlatIdx) });
    }
  }

  // --- Standard operations ---

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
    resetEditorState({ chords: [], chartLayout: undefined });
    cancelEdit();
  }

  function handleDuplicate() {
    const current: Progression = {
      ...prog,
      name: prog.name + ' (copy)',
      chords: prog.chords.map(c => ({ ...c })),
      chartLayout: prog.chartLayout ? JSON.parse(JSON.stringify(prog.chartLayout)) : undefined,
    };
    const copy = [...progressions, current];
    onSave(copy);
    onSelectProg(copy.length - 1);
    setName(current.name);
    setSongKey(current.songKey);
    resetEditorState({ chords: [...current.chords], chartLayout: current.chartLayout });
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
      resetEditorState({ chords: [], chartLayout: undefined });
      cancelEdit();
      return;
    }
    const newIdx = Math.min(activeProgIdx, copy.length - 1);
    onSave(copy);
    onSelectProg(newIdx);
    setName(copy[newIdx].name);
    setSongKey(copy[newIdx].songKey);
    resetEditorState({ chords: [...copy[newIdx].chords], chartLayout: copy[newIdx].chartLayout });
    cancelEdit();
  }

  function handleLoadPreset(preset: Progression) {
    setName(preset.name);
    setSongKey(preset.songKey);
    resetEditorState({ chords: [...preset.chords], chartLayout: preset.chartLayout });
    cancelEdit();
  }

  function handleImport(imported: Progression) {
    setName(imported.name);
    setSongKey(imported.songKey);
    resetEditorState({ chords: [...imported.chords], chartLayout: imported.chartLayout });
    setShowImporter(false);
    cancelEdit();
  }

  function handleSongKeyChange(newKey: SongKey | undefined) {
    setSongKey(newKey);
    setEditorState({
      chords: chords.map(c => {
        if (c.modeConfirmed) return c;
        return { ...c, modeIdx: suggestMode(c.rootName, c.quality, newKey) };
      }),
      chartLayout,
    });
  }

  function handleSelectProg(idx: number) {
    handleSave();
    onSelectProg(idx);
    const p = progressions[idx];
    setName(p.name);
    setSongKey(p.songKey);
    resetEditorState({ chords: [...p.chords], chartLayout: p.chartLayout });
    cancelEdit();
  }

  const isEditing = editIdx != null;
  const effectiveLayout = chartLayout ?? (chords.length > 0 ? deriveChartLayout(chords) : null);

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
          <button onClick={handleAddMeasure} className={btnBase}
            style={{ border: '1px solid #8E44AD', background: '#1a1a1a', color: '#8E44AD' }}>
            + 小節
          </button>
          {(() => {
            const hasTarget = isEditing || emptyTarget;
            const isInsertMode = emptyTarget || insertBeat != null;
            const inputDisabled = !hasTarget;
            return (
              <>
                <ChordAutocomplete
                  inputRef={inputRef}
                  value={input}
                  onChange={v => { setInput(v); setError(''); }}
                  onSubmit={handleSubmit}
                  onCancel={cancelEdit}
                  disabled={inputDisabled}
                  placeholder={emptyTarget ? `${emptyTarget.beat}拍目に挿入` : insertBeat != null ? `${insertBeat}拍目に挿入` : isEditing ? `コード #${editIdx! + 1} を編集` : 'グリッドの + を選択'}
                  className="bg-[#111] rounded text-[11px] font-mono px-2 py-1 w-32"
                  style={{
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: inputDisabled ? '#333' : error ? '#E74C3C' : isInsertMode ? '#27AE60' : '#F1C40F',
                    color: inputDisabled ? '#555' : '#e8e8e8',
                    opacity: inputDisabled ? 0.5 : 1,
                  }}
                />
                {isInsertMode ? (
                  <button onClick={emptyTarget ? fillEmptyMeasure : () => insertAtBeat(insertBeat!)} className={btnBase}
                    disabled={inputDisabled}
                    style={{
                      border: `1px solid ${inputDisabled ? '#333' : '#27AE60'}`,
                      background: inputDisabled ? '#1a1a1a' : '#1a2a1a',
                      color: inputDisabled ? '#444' : '#27AE60',
                      opacity: inputDisabled ? 0.5 : 1,
                      cursor: inputDisabled ? 'default' : 'pointer',
                    }}>
                    挿入
                  </button>
                ) : (
                  <button onClick={isEditing ? updateChord : undefined} className={btnBase}
                    disabled={!isEditing}
                    style={{
                      border: `1px solid ${isEditing ? '#F1C40F' : '#333'}`,
                      background: isEditing ? '#2a2a1a' : '#1a1a1a',
                      color: isEditing ? '#F1C40F' : '#444',
                      opacity: isEditing ? 1 : 0.5,
                      cursor: isEditing ? 'pointer' : 'default',
                    }}>
                    更新
                  </button>
                )}
                <button onClick={hasTarget ? cancelEdit : undefined} className={btnBase}
                  disabled={!hasTarget}
                  style={{
                    border: `1px solid ${hasTarget ? '#666' : '#333'}`,
                    background: '#1a1a1a',
                    color: hasTarget ? '#888' : '#444',
                    opacity: hasTarget ? 1 : 0.5,
                    cursor: hasTarget ? 'pointer' : 'default',
                  }}>
                  取消
                </button>
              </>
            );
          })()}
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
          <button onClick={undo} disabled={!canUndo} className={btnBase}
            style={{
              border: `1px solid ${canUndo ? '#888' : '#333'}`,
              background: '#1a1a1a',
              color: canUndo ? '#AAA' : '#444',
              opacity: canUndo ? 1 : 0.5,
              cursor: canUndo ? 'pointer' : 'default',
            }}
            title="元に戻す (Ctrl+Z)">
            ↩
          </button>
          <button onClick={redo} disabled={!canRedo} className={btnBase}
            style={{
              border: `1px solid ${canRedo ? '#888' : '#333'}`,
              background: '#1a1a1a',
              color: canRedo ? '#AAA' : '#444',
              opacity: canRedo ? 1 : 0.5,
              cursor: canRedo ? 'pointer' : 'default',
            }}
            title="やり直す (Ctrl+Y)">
            ↪
          </button>
          <button onClick={handleSave} className={btnBase}
            style={{ border: '1px solid #2980B9', background: '#1a1a1a', color: '#2980B9' }}>
            保存
          </button>
          <button onClick={handleNew} className={btnBase}
            style={{ border: '1px solid #27AE60', background: '#1a1a1a', color: '#27AE60' }}>
            + 新規
          </button>
          <button onClick={handleDuplicate} className={btnBase}
            style={{ border: '1px solid #27AE60', background: '#1a1a1a', color: '#27AE60' }}>
            複製
          </button>
          <button onClick={handleDelete} className={btnBase}
            style={{ border: '1px solid #E74C3C', background: '#1a1a1a', color: '#E74C3C' }}>
            削除
          </button>
        </div>
        {error && <p className="text-[9px] text-[#E74C3C] mt-0.5">{error}</p>}

        {/* Symbol buttons row — stamp section markers on the selected measure */}
        {editIdx != null && insertBeat == null && effectiveLayout && (() => {
          const info = findChordMeasure(effectiveLayout, editIdx);
          if (!info) return null;

          const sec = effectiveLayout.sections[info.sectionIdx];
          const hasRepeat = sec.repeats != null && sec.repeats >= 1;
          const hasEndings = sec.endings && sec.endings.length > 0;
          const inEnding = info.endingIdx != null;
          const totalMeasures = sec.measures.length + (sec.endings?.flat().length ?? 0);

          // |: lit when this is the first measure of a repeated section
          const rsLit = hasRepeat && !inEnding && info.measureIdx === 0;
          // :| lit when this is the last main measure of a repeated section
          const reLit = hasRepeat && !inEnding && info.measureIdx === sec.measures.length - 1;
          // 1. lit when chord is in ending[0]
          const v1Lit = info.endingIdx === 0;
          // 2. lit when chord is in ending[1]
          const v2Lit = info.endingIdx === 1;

          // Enabled states
          const rsEnabled = !inEnding;
          const reEnabled = !inEnding;
          const v1Enabled = (hasRepeat && !inEnding && info.measureIdx > 0 && totalMeasures >= 3) || v1Lit;
          const v2Enabled = hasEndings && inEnding && info.measureIdx > 0;

          const symBtn = 'rounded cursor-pointer text-[11px] font-mono px-2 h-[24px] inline-flex items-center';

          return (
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-[9px] text-text-dim mr-0.5">Sec:</span>
              <input
                type="text"
                value={!inEnding && info.measureIdx === 0 ? sec.label : ''}
                onChange={e => handleSectionLabel(e.target.value)}
                className="w-8 text-center bg-[#222] border border-[#555] rounded text-[11px] text-text-primary font-mono font-bold px-0.5 py-0.5 h-[24px]"
                maxLength={3}
                placeholder="—"
                title={!inEnding && info.measureIdx === 0 ? 'セクション名を編集' : 'ラベルを入力するとここからセクション分割'}
              />
              <span className="text-[9px] text-text-dim mx-0.5">|</span>
              <button onClick={handleRepeatStart} disabled={!rsEnabled}
                className={symBtn}
                style={{
                  border: `1px solid ${rsLit ? '#F1C40F' : rsEnabled ? '#666' : '#333'}`,
                  background: rsLit ? '#2a2a1a' : '#1a1a1a',
                  color: rsLit ? '#F1C40F' : rsEnabled ? '#999' : '#444',
                  fontWeight: rsLit ? 700 : 400,
                  cursor: rsEnabled ? 'pointer' : 'default',
                  opacity: rsEnabled ? 1 : 0.5,
                }}>
                |:
              </button>
              <button onClick={handleRepeatEnd} disabled={!reEnabled}
                className={symBtn}
                style={{
                  border: `1px solid ${reLit ? '#F1C40F' : reEnabled ? '#666' : '#333'}`,
                  background: reLit ? '#2a2a1a' : '#1a1a1a',
                  color: reLit ? '#F1C40F' : reEnabled ? '#999' : '#444',
                  fontWeight: reLit ? 700 : 400,
                  cursor: reEnabled ? 'pointer' : 'default',
                  opacity: reEnabled ? 1 : 0.5,
                }}>
                :|
              </button>
              <button onClick={handleVolta1} disabled={!v1Enabled}
                className={symBtn}
                style={{
                  border: `1px solid ${v1Lit ? '#3498DB' : v1Enabled ? '#666' : '#333'}`,
                  background: v1Lit ? '#1a1a2a' : '#1a1a1a',
                  color: v1Lit ? '#3498DB' : v1Enabled ? '#999' : '#444',
                  fontWeight: v1Lit ? 700 : 400,
                  cursor: v1Enabled ? 'pointer' : 'default',
                  opacity: v1Enabled ? 1 : 0.5,
                }}>
                1.
              </button>
              <button onClick={handleVolta2} disabled={!v2Enabled}
                className={symBtn}
                style={{
                  border: `1px solid ${v2Lit ? '#27AE60' : v2Enabled ? '#666' : '#333'}`,
                  background: v2Lit ? '#1a2a1a' : '#1a1a1a',
                  color: v2Lit ? '#27AE60' : v2Enabled ? '#999' : '#444',
                  fontWeight: v2Lit ? 700 : 400,
                  cursor: v2Enabled ? 'pointer' : 'default',
                  opacity: v2Enabled ? 1 : 0.5,
                }}>
                2.
              </button>
              {(rsLit || reLit || v1Lit || v2Lit) && (
                <span className="text-[8px] text-[#666] ml-1">
                  {rsLit && '|: リピート開始 '}
                  {reLit && ':| リピート終了 '}
                  {v1Lit && '1括弧 '}
                  {v2Lit && '2括弧 '}
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {showImporter && (
        <SongImporter
          onImport={handleImport}
          onClose={() => setShowImporter(false)}
        />
      )}

      {/* Render chart via children slot with editing chords */}
      {children?.(chords, removeChord, chartLayout, handleBeatClick, handleEmptyMeasureBeat, removeEmptyMeasure,
        emptyTarget
          ? { type: 'empty', sectionIdx: emptyTarget.sectionIdx, measureIdx: emptyTarget.measureIdx, endingIdx: emptyTarget.endingIdx, beat: emptyTarget.beat }
          : editIdx != null
            ? { type: 'chord', chordIdx: editIdx, beat: insertBeat ?? 0 }
            : null,
      )}
    </div>
  );
}
