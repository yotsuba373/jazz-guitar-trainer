import { useState, useMemo, useEffect, useCallback } from 'react';
import type { LabelMode, RootName, Progression } from './types';
import { MODE_TEMPLATES, ROOTS, MODE_COLORS } from './constants';
import type { Position } from './types';
import {
  buildFretMap, generatePositions, resolveMode,
  loadProgressions, saveProgressions, QUALITY_TO_MODES,
  rankPositionsByProximity,
} from './utils';
import { Fretboard } from './components/Fretboard';
import { RootSelector, ModeSelector, PositionSelector, OptionBar } from './components/Controls';
import { PositionDetail } from './components/PositionDetail';
import { PositionGrid } from './components/PositionGrid';
import { ProgressionEditor, ProgressionPlayer } from './components/Progression';
import { Footer } from './components/Footer';

export default function App() {
  const [rootName, setRootName] = useState<RootName>('C');
  const [modeIdx, setModeIdx] = useState(0);
  const [selPosId, setSelPosId] = useState<number | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [showCT, setShowCT] = useState(false);
  const [labelMode, setLabelMode] = useState<LabelMode>('note');

  // Progression mode state
  const [progMode, setProgMode] = useState(false);
  const [progressions, setProgressions] = useState<Progression[]>(() => loadProgressions());
  const [activeProgIdx, setActiveProgIdx] = useState(0);
  const [activeChordIdx, setActiveChordIdx] = useState(0);
  const [editing, setEditing] = useState(false);

  const template = MODE_TEMPLATES[modeIdx];
  const mode = useMemo(() => resolveMode(rootName, template), [rootName, modeIdx]);
  const fretMap = useMemo(() => buildFretMap(mode.semi, mode.notes), [rootName, modeIdx]);
  const allPos = useMemo(() => generatePositions(fretMap, mode.notes), [fretMap]);
  const ctSet = useMemo(() => new Set(mode.chordTones), [rootName, modeIdx]);
  const deg = mode.degrees;
  const rootNote = mode.notes[0];
  const selPos = selPosId != null ? allPos.find(p => p.id === selPosId) ?? null : null;

  const visible = overlay ? allPos : (selPos ? [selPos] : allPos);
  const dim = selPos != null && !overlay;

  // Sync display state from active chord in progression mode
  const activeProg = progressions[activeProgIdx];
  const activeChord = activeProg?.chords[activeChordIdx];
  const isSkipped = activeChord && !QUALITY_TO_MODES[activeChord.quality];

  useEffect(() => {
    if (!progMode || !activeChord || isSkipped) return;
    setRootName(activeChord.rootName);
    setModeIdx(activeChord.modeIdx);
    setOverlay(false);

    if (activeChord.posConfirmed) {
      setSelPosId(activeChord.posId);
    } else {
      // Auto-select closest position by computing rankings inline
      const curMode = resolveMode(activeChord.rootName, MODE_TEMPLATES[activeChord.modeIdx]);
      const curFretMap = buildFretMap(curMode.semi, curMode.notes);
      const curAllPos = generatePositions(curFretMap, curMode.notes);

      const prev = activeChordIdx > 0 ? activeProg?.chords[activeChordIdx - 1] : null;
      let prevPos: Position | null = null;
      if (prev && QUALITY_TO_MODES[prev.quality]) {
        const prevMode = resolveMode(prev.rootName, MODE_TEMPLATES[prev.modeIdx]);
        const prevFretMap = buildFretMap(prevMode.semi, prevMode.notes);
        const prevAllPos = generatePositions(prevFretMap, prevMode.notes);
        prevPos = prevAllPos.find(p => p.id === prev.posId) ?? null;
      }

      const ranked = rankPositionsByProximity(curAllPos, prevPos);
      setSelPosId(ranked[0] ?? 1);
    }
  }, [progMode, activeChordIdx, activeChord?.rootName, activeChord?.modeIdx, activeChord?.posId, activeChord?.posConfirmed]);

  // Keyboard navigation for progression mode
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!progMode || editing) return;
    if (!activeProg) return;
    const len = activeProg.chords.length;
    if (len === 0) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveChordIdx(i => Math.min(i + 1, len - 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveChordIdx(i => Math.max(i - 1, 0));
    }
  }, [progMode, editing, activeProg]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  function handleSaveProgressions(progs: Progression[]) {
    setProgressions(progs);
    saveProgressions(progs);
  }

  function handleChordModeChange(chordIdx: number, newModeIdx: number) {
    const copy = [...progressions];
    const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
    prog.chords[chordIdx] = { ...prog.chords[chordIdx], modeIdx: newModeIdx };
    copy[activeProgIdx] = prog;
    handleSaveProgressions(copy);
  }

  function handleChordPosChange(chordIdx: number, posId: number) {
    const copy = [...progressions];
    const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
    prog.chords[chordIdx] = { ...prog.chords[chordIdx], posId, posConfirmed: true };
    copy[activeProgIdx] = prog;
    handleSaveProgressions(copy);
  }

  function getLabel(nn: string): string {
    return labelMode === 'degree' ? (deg[nn] || nn) : nn;
  }

  return (
    <div className="bg-bg-root text-text-primary min-h-screen font-mono p-4">
      <div className="max-w-[1040px] mx-auto">
        <h2 className="text-lg font-bold mb-0.5 tracking-wide">
          Berklee 7-Position System
        </h2>
        <p className="text-[10px] text-text-dim mb-3">
          B弦2音 + 他弦3音 ｜ 7モード対応
        </p>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => { setProgMode(false); setEditing(false); }}
            className="rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]"
            style={{
              border: `1px solid ${!progMode ? '#FFF' : '#444'}`,
              background: !progMode ? '#3a3a3a' : '#1a1a1a',
              color: !progMode ? '#FFF' : '#888',
              fontWeight: !progMode ? 700 : 400,
            }}>
            通常モード
          </button>
          <button
            onClick={() => { setProgMode(true); setActiveChordIdx(0); }}
            className="rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]"
            style={{
              border: `1px solid ${progMode ? '#FFF' : '#444'}`,
              background: progMode ? '#3a3a3a' : '#1a1a1a',
              color: progMode ? '#FFF' : '#888',
              fontWeight: progMode ? 700 : 400,
            }}>
            進行モード
          </button>
          {progMode && (
            <button
              onClick={() => setEditing(!editing)}
              className="rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]"
              style={{
                border: `1px solid ${editing ? '#F1C40F' : '#666'}`,
                background: editing ? '#2a2a1a' : '#1a1a1a',
                color: editing ? '#F1C40F' : '#AAA',
              }}>
              {editing ? '編集中' : '編集'}
            </button>
          )}
        </div>

        {/* Progression mode */}
        {progMode && (
          <>
            {editing && (
              <ProgressionEditor
                progressions={progressions}
                activeProgIdx={activeProgIdx}
                onSave={handleSaveProgressions}
                onSelectProg={(idx) => { setActiveProgIdx(idx); setActiveChordIdx(0); }}
                onClose={() => setEditing(false)}
              />
            )}

            {activeProg && activeProg.chords.length > 0 && (
              <ProgressionPlayer
                progression={activeProg}
                activeChordIdx={activeChordIdx}
                allPos={allPos}
                onChordSelect={setActiveChordIdx}
                onModeChange={handleChordModeChange}
                onPosChange={handleChordPosChange}
              />
            )}

            {activeProg && activeProg.chords.length === 0 && !editing && (
              <p className="text-[10px] text-text-dim mb-3">
                コード進行が空です。「編集」ボタンからコードを追加してください。
              </p>
            )}
          </>
        )}

        {/* Normal mode controls */}
        {!progMode && (
          <>
            <RootSelector roots={ROOTS} selectedRoot={rootName} onRootChange={setRootName} />
            <ModeSelector templates={MODE_TEMPLATES} modeIdx={modeIdx} rootName={rootName} onModeChange={setModeIdx} />
          </>
        )}

        <div className="text-[11px] text-text-secondary mb-1">
          <span className="font-bold" style={{ color: MODE_COLORS[mode.key] }}>{rootNote} {mode.name}</span>
          <span className="text-text-dim ml-2">{mode.notes.join(' ')}</span>
        </div>
        <div className="text-[10px] text-text-dim mb-2.5">
          {mode.chord}: {mode.chordTones.join(' ')} ({mode.chordSub})
        </div>

        {!progMode && (
          <PositionSelector
            positions={allPos}
            selPosId={selPosId}
            overlay={overlay}
            onSelectAll={() => { setSelPosId(null); setOverlay(false); }}
            onSelectPosition={(id) => { setSelPosId(id); setOverlay(false); }}
            onToggleOverlay={() => { setOverlay(true); setSelPosId(null); }}
          />
        )}

        <OptionBar
          mode={mode}
          showCT={showCT}
          labelMode={labelMode}
          onToggleCT={setShowCT}
          onSetLabelMode={setLabelMode}
        />

        <Fretboard
          visible={visible}
          selPosId={selPosId}
          dim={dim}
          showCT={showCT}
          ctSet={ctSet}
          getLabel={getLabel}
          rootNote={rootNote}
        />

        {selPos && (
          <PositionDetail
            position={selPos}
            mode={mode}
            showCT={showCT}
            ctSet={ctSet}
            getLabel={getLabel}
            rootNote={rootNote}
          />
        )}

        {!progMode && (
          <PositionGrid
            positions={allPos}
            selPosId={selPosId}
            onSelectPosition={(id) => { setSelPosId(id); setOverlay(false); }}
          />
        )}

        <Footer />
      </div>
    </div>
  );
}
