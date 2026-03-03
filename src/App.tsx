import { useState, useMemo, useEffect, useCallback } from 'react';
import type { LabelMode, RootName, Progression, ChordNotationPrefs } from './types';
import { MODE_TEMPLATES, ROOTS, MODE_COLORS } from './constants';
import {
  buildFretMap, generatePositions, generateDimPositions, resolveMode,
  loadProgressions, saveProgressions, QUALITY_TO_MODES,
  computeEffectiveSelections,
  formatChordSymbol, loadChordNotationPrefs, saveChordNotationPrefs,
  getChartLayout, buildChordRows,
  getGuideTones, findNoteLocations, classifyResolution,
  findVoicingsInPosition,
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
  const [selPosIds, setSelPosIds] = useState<number[]>([]);
  const [overlay, setOverlay] = useState(false);
  const [showCT, setShowCT] = useState(true);
  const [labelMode, setLabelMode] = useState<LabelMode>('note');
  const [chordPrefs, setChordPrefs] = useState<ChordNotationPrefs>(() => loadChordNotationPrefs());

  const [showGT, setShowGT] = useState(false);
  const [showChordForms, setShowChordForms] = useState(false);
  const [selectedVoicingIdx, setSelectedVoicingIdx] = useState(0);

  // Progression mode state
  const [progMode, setProgMode] = useState(false);
  const [progressions, setProgressions] = useState<Progression[]>(() => loadProgressions());
  const [activeProgIdx, setActiveProgIdx] = useState(0);
  const [activeChordIdx, setActiveChordIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);

  const template = MODE_TEMPLATES[modeIdx];
  const mode = useMemo(() => resolveMode(rootName, template), [rootName, modeIdx]);
  const is8Note = mode.notes.length > 7;
  const fretMap = useMemo(() => buildFretMap(mode.semi, mode.notes), [rootName, modeIdx]);
  const allPos = useMemo(
    () => is8Note ? generateDimPositions(fretMap, mode.semi[0]) : generatePositions(fretMap, mode.notes),
    [fretMap, is8Note],
  );
  const ctSet = useMemo(() => new Set(mode.chordTones), [rootName, modeIdx]);

  // Chord form voicings (only when exactly 1 position selected)
  const canShowChordForms = selPosIds.length === 1 && !overlay && !is8Note && modeIdx <= 6;
  const selPos = selPosIds.length === 1 ? allPos.find(p => p.id === selPosIds[0]) ?? null : null;

  const availableVoicings = useMemo(() => {
    if (!showChordForms || !selPos || !canShowChordForms) return [];
    return findVoicingsInPosition(selPos, mode);
  }, [showChordForms, selPos, canShowChordForms, mode]);

  // Group voicings by template (type + inversion + string set) across all instances
  // so the same shape in different octaves is shown simultaneously
  const groupedVoicings = useMemo(() => {
    const map = new Map<string, typeof availableVoicings>();
    for (const v of availableVoicings) {
      const key = `${v.template.type}-${v.template.inversion}-${v.template.stringIndices.join(',')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return Array.from(map.values());
  }, [availableVoicings]);

  // One representative per group for display (◀/▶ count)
  const deduplicatedVoicings = useMemo(
    () => groupedVoicings.map(g => g[0]),
    [groupedVoicings],
  );

  // Reset voicing index when position/mode/root changes
  useEffect(() => { setSelectedVoicingIdx(0); }, [selPosIds, modeIdx, rootName]);

  const deg = mode.degrees;
  const rootNote = mode.notes[0];

  const visible = overlay ? allPos : (selPosIds.length > 0 ? allPos.filter(p => selPosIds.includes(p.id)) : allPos);
  const dim = selPosIds.length > 0 && !overlay;

  // Sync display state from active chord in progression mode
  const activeProg = progressions[activeProgIdx];
  const activeChord = activeProg?.chords[activeChordIdx];
  const isSkipped = activeChord && !QUALITY_TO_MODES[activeChord.quality];

  // In progression mode: restore voicing index from saved key on the active chord.
  // In normal mode: clamp synchronously to prevent out-of-bounds after position switch.
  const effectiveVoicingIdx = useMemo(() => {
    if (progMode && activeChord?.voicingKey && deduplicatedVoicings.length > 0) {
      const idx = deduplicatedVoicings.findIndex(v =>
        `${v.template.type}-${v.template.inversion}-${v.template.stringIndices.join(',')}` === activeChord.voicingKey
      );
      return idx >= 0 ? idx : 0;
    }
    return Math.min(selectedVoicingIdx, Math.max(0, deduplicatedVoicings.length - 1));
  }, [progMode, activeChord?.voicingKey, deduplicatedVoicings, selectedVoicingIdx]);

  const voicingHighlights = useMemo(() => {
    if (!groupedVoicings.length) return null;
    // Union of all instances sharing the same template
    const group = groupedVoicings[effectiveVoicingIdx];
    return new Set(group.flatMap(v => v.notes.map(n => `${n.stringIdx}:${n.fret}`)));
  }, [groupedVoicings, effectiveVoicingIdx]);

  // Compute effective selections for the whole progression (resolves auto-suggestion chain)
  const effectiveAll = useMemo(
    () => activeProg ? computeEffectiveSelections(activeProg.chords, activeProg.songKey) : [],
    [activeProg],
  );

  // Guide tone info for fretboard display
  // Derive mode/fretMap/positions directly from effectiveAll to avoid 1-frame lag
  const guideToneInfo = useMemo(() => {
    if (!progMode || !showGT || !activeChord || isSkipped) return null;
    const curEff = effectiveAll[activeChordIdx];
    if (!curEff || !QUALITY_TO_MODES[activeChord.quality]) return null;

    const isDim = activeChord.quality === 'dim';
    const curMode = resolveMode(activeChord.rootName, MODE_TEMPLATES[curEff.modeIdx]);
    const curFretMap = buildFretMap(curMode.semi, curMode.notes);
    const curIs8 = curMode.notes.length > 7;
    const curAllPos = curIs8
      ? generateDimPositions(curFretMap, curMode.semi[0])
      : generatePositions(curFretMap, curMode.notes);

    // dim7 is symmetric (all m3 intervals) — own 3rd/7th are ambiguous
    const currentGT = getGuideTones(curMode);
    const gtThird = isDim ? null : currentGT.third;
    const gtSeventh = isDim ? null : currentGT.seventh;
    const noNext = { third: gtThird, seventh: gtSeventh, nextThird: null, nextThirdLocations: [] as { stringIdx: number; fret: number }[], resolution: null };

    const chords = activeProg?.chords;
    if (!chords) return noNext;

    // Look ahead: next chord's 3rd as ghost note
    const nextChord = chords[activeChordIdx + 1];
    const nextEff = effectiveAll[activeChordIdx + 1];
    if (!nextChord || !nextEff || !QUALITY_TO_MODES[nextChord.quality]) return noNext;

    // Skip next-3rd ghost for dim7 (symmetric, no unique 3rd)
    if (nextChord.quality === 'dim') return noNext;

    const nextMode = resolveMode(nextChord.rootName, MODE_TEMPLATES[nextEff.modeIdx]);
    const nextGT = getGuideTones(nextMode);
    const nextThirdSemi = nextMode.semi[nextMode.notes.indexOf(nextGT.third)];
    const allLocs = findNoteLocations(nextGT.third, curFretMap, nextThirdSemi);

    // Filter: only show ghost if same-string note in current position is <3 frets away
    const curPos = curAllPos.find(p => p.id === curEff.posId);
    const nextThirdLocations = curPos
      ? allLocs.filter(loc =>
          curPos.instances.some(inst => {
            const strNotes = inst.strings[loc.stringIdx];
            if (!strNotes) return false;
            return strNotes.some(([, f]) => Math.abs(f - loc.fret) < 3);
          }))
      : allLocs;

    // Resolution: only compute when current chord has a 7th (not dim)
    const resolution = !isDim && currentGT.seventh
      ? classifyResolution(curMode.semi[curMode.notes.indexOf(currentGT.seventh)], nextThirdSemi)
      : null;
    return { third: gtThird, seventh: gtSeventh, nextThird: nextGT.third, nextThirdLocations, resolution };
  }, [progMode, showGT, activeChordIdx, effectiveAll, activeProg, activeChord, isSkipped]);

  useEffect(() => {
    if (!progMode || !activeChord || isSkipped) return;
    const eff = effectiveAll[activeChordIdx];
    if (!eff) return;
    setRootName(activeChord.rootName);
    setModeIdx(eff.modeIdx);
    setSelPosIds([eff.posId]);
    setOverlay(false);
  }, [progMode, activeChordIdx, effectiveAll, activeChord, isSkipped]);

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
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const layout = getChartLayout(activeProg);
      const rows = buildChordRows(layout);
      setActiveChordIdx(cur => {
        const curRow = rows.findIndex(row => row.includes(cur));
        if (curRow < 0) return cur;
        const posInRow = rows[curRow].indexOf(cur);
        const targetRow = e.key === 'ArrowUp'
          ? Math.max(0, curRow - 1)
          : Math.min(rows.length - 1, curRow + 1);
        const target = rows[targetRow];
        return target[Math.min(posInRow, target.length - 1)];
      });
    }
  }, [progMode, editing, activeProg]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // BPM auto-advance: setTimeout chain for variable beat durations
  useEffect(() => {
    if (!isPlaying || !progMode || !activeProg) return;
    const layout = getChartLayout(activeProg);
    const beatMap = new Map<number, number>();
    function addMeasures(measures: typeof layout.sections[0]['measures']) {
      for (const measure of measures) {
        const count = measure.chordIndices.length;
        const bwSum = measure.beatWidths
          ? measure.beatWidths.reduce((a, b) => a + b, 0)
          : count;
        measure.chordIndices.forEach((ci, i) => {
          const bw = measure.beatWidths?.[i] ?? 1;
          beatMap.set(ci, (bw / bwSum) * 4);
        });
      }
    }
    for (const section of layout.sections) {
      addMeasures(section.measures);
      if (section.endings) {
        for (const ending of section.endings) addMeasures(ending);
      }
    }
    const beats = beatMap.get(activeChordIdx) ?? 4;
    const timer = setTimeout(() => {
      setActiveChordIdx(i => {
        const next = i + 1;
        return next >= activeProg.chords.length ? 0 : next;
      });
    }, (60000 / bpm) * beats);
    return () => clearTimeout(timer);
  }, [isPlaying, activeChordIdx, bpm, activeProg, progMode]);

  function handleSaveProgressions(progs: Progression[]) {
    setProgressions(progs);
    saveProgressions(progs);
  }

  function handleChordModeChange(chordIdx: number, newModeIdx: number) {
    const copy = [...progressions];
    const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
    prog.chords[chordIdx] = { ...prog.chords[chordIdx], modeIdx: newModeIdx, modeConfirmed: true };
    copy[activeProgIdx] = prog;
    handleSaveProgressions(copy);
  }

  function handleChordPosChange(chordIdx: number, posId: number, shiftKey: boolean) {
    if (shiftKey) {
      // Shift+click: visual toggle only (don't save to chord)
      setSelPosIds(prev => prev.includes(posId) ? prev.filter(x => x !== posId) : [...prev, posId]);
    } else {
      // Normal click: save to chord data
      const copy = [...progressions];
      const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
      prog.chords[chordIdx] = { ...prog.chords[chordIdx], posId, posConfirmed: true };
      copy[activeProgIdx] = prog;
      handleSaveProgressions(copy);
    }
  }

  function handleSelectVoicing(idx: number) {
    setSelectedVoicingIdx(idx);
    if (progMode && deduplicatedVoicings[idx]) {
      const v = deduplicatedVoicings[idx];
      const key = `${v.template.type}-${v.template.inversion}-${v.template.stringIndices.join(',')}`;
      const copy = [...progressions];
      const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
      prog.chords[activeChordIdx] = { ...prog.chords[activeChordIdx], voicingKey: key };
      copy[activeProgIdx] = prog;
      handleSaveProgressions(copy);
    }
  }

  function handleResetSelections() {
    const copy = [...progressions];
    const prog = { ...copy[activeProgIdx], chords: copy[activeProgIdx].chords.map(c => ({
      ...c, posConfirmed: false, modeConfirmed: false, voicingKey: undefined,
    }))};
    copy[activeProgIdx] = prog;
    handleSaveProgressions(copy);
  }

  function handleChordPrefsChange(prefs: ChordNotationPrefs) {
    setChordPrefs(prefs);
    saveChordNotationPrefs(prefs);
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
            onClick={() => { setProgMode(false); setEditing(false); setIsPlaying(false); }}
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
            onClick={() => { setProgMode(true); setActiveChordIdx(0); setIsPlaying(false); }}
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
              onClick={() => { setEditing(!editing); setIsPlaying(false); }}
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
                chordPrefs={chordPrefs}
                onSave={handleSaveProgressions}
                onSelectProg={(idx) => { setActiveProgIdx(idx); setActiveChordIdx(0); setIsPlaying(false); }}
                onClose={() => setEditing(false)}
              />
            )}

            {activeProg && activeProg.chords.length > 0 && (
              <ProgressionPlayer
                progression={activeProg}
                activeChordIdx={activeChordIdx}
                allPos={allPos}
                chordPrefs={chordPrefs}
                onChordSelect={setActiveChordIdx}
                onModeChange={handleChordModeChange}
                onPosChange={handleChordPosChange}
                onReset={handleResetSelections}
                isPlaying={isPlaying}
                bpm={bpm}
                onTogglePlay={() => setIsPlaying(p => !p)}
                onBpmChange={setBpm}
                selPosIds={selPosIds}
                availableVoicings={showChordForms ? deduplicatedVoicings : undefined}
                selectedVoicingIdx={effectiveVoicingIdx}
                onSelectVoicing={handleSelectVoicing}
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

        {!progMode && (
          <PositionSelector
            positions={allPos}
            selPosIds={selPosIds}
            overlay={overlay}
            onSelectAll={() => { setSelPosIds([]); setOverlay(false); }}
            onSelectPosition={(id, shiftKey) => {
              if (shiftKey) {
                setSelPosIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
              } else {
                setSelPosIds([id]);
              }
              setOverlay(false);
            }}
            onToggleOverlay={() => { setOverlay(true); setSelPosIds([]); }}
            availableVoicings={showChordForms ? deduplicatedVoicings : undefined}
            selectedVoicingIdx={effectiveVoicingIdx}
            onSelectVoicing={handleSelectVoicing}
          />
        )}

        <div className="text-[11px] text-text-secondary mb-1">
          <span className="font-bold" style={{ color: MODE_COLORS[mode.key] }}>{rootNote} {mode.name}</span>
          <span className="text-text-dim ml-2">{mode.notes.map(n => `${n}(${mode.degrees[n]})`).join(' ')}</span>
        </div>
        <div className="text-[10px] text-text-dim mb-2.5">
          {formatChordSymbol(rootNote, mode.chordQuality, chordPrefs)}: {mode.chordTones.map((n, i) => `${n}(${mode.chordSub.split(' ')[i] ?? mode.degrees[n]})`).join(' ')}
        </div>

        <OptionBar
          mode={mode}
          showCT={showCT}
          labelMode={labelMode}
          chordPrefs={chordPrefs}
          onToggleCT={setShowCT}
          onSetLabelMode={setLabelMode}
          onChordPrefsChange={handleChordPrefsChange}
          progMode={progMode}
          showGT={showGT}
          onToggleGT={setShowGT}
          canShowChordForms={canShowChordForms}
          showChordForms={showChordForms}
          onToggleChordForms={setShowChordForms}
        />

        <Fretboard
          visible={visible}
          selPosIds={selPosIds}
          dim={dim}
          showCT={showCT}
          ctSet={ctSet}
          getLabel={getLabel}
          rootNote={rootNote}
          guideToneInfo={guideToneInfo}
          voicingHighlights={voicingHighlights}
        />

        {selPos && (
          <PositionDetail
            position={selPos}
            mode={mode}
            showCT={showCT}
            ctSet={ctSet}
            getLabel={getLabel}
            rootNote={rootNote}
            chordPrefs={chordPrefs}
          />
        )}

        {!progMode && (
          <PositionGrid
            positions={allPos}
            selPosIds={selPosIds}
            onSelectPosition={(id, shiftKey) => {
              if (shiftKey) {
                setSelPosIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
              } else {
                setSelPosIds([id]);
              }
              setOverlay(false);
            }}
          />
        )}

        <Footer chordPrefs={chordPrefs} />
      </div>
    </div>
  );
}
