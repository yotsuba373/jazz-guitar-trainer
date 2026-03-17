import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { LabelMode, RootName, Progression, ChordNotationPrefs, GeneratedPhrase, InstrumentType, LickDB, LickEntry, Position, FretMap } from './types';
import { MODE_TEMPLATES, ROOTS, MODE_COLORS } from './constants';
import {
  buildFretMap, generatePositions, generateDimPositions, resolveMode,
  loadProgressions, saveProgressions, QUALITY_TO_MODES,
  computeEffectiveSelections,
  formatChordSymbol, loadChordNotationPrefs, saveChordNotationPrefs,
  getChartLayout, buildChordRows,
  getGuideTones, findNoteLocations, classifyResolution,
  findVoicingsInPosition,
  buildNotePool,
  loadLickDB, QUALITY_TO_LICK_TYPE, buildLickContext, getTransposeSemitones,
  selectBestInstance, hasAlternateOctave,
  detectIiVPattern, isIiVLickId, buildIiVLickContext, getIiVTransposeSemitones,
  sliceLick, getChordBeatCount,
  findLickById, findOriginatorIdx, resolveChordPositions, buildPhraseForLick,
} from './utils';
import { useAudioContext, usePreviewPlayback, useAutoPlay } from './hooks';
import { Fretboard } from './components/Fretboard';
import { RootSelector, ModeSelector, PositionSelector, OptionBar, PhraseAnalysisPanel, GlobalAudioControls, LickPanel } from './components/Controls';
import { PositionGrid } from './components/PositionGrid';
import { ProgressionEditor, ProgressionPlayer } from './components/Progression';
import { Footer } from './components/Footer';

export default function App() {
  const [rootName, setRootName] = useState<RootName>(() => {
    const saved = localStorage.getItem('dictRootName');
    return (saved && ROOTS.some(r => r.name === saved) ? saved : 'C') as RootName;
  });
  const [modeIdx, setModeIdx] = useState(() => {
    const saved = parseInt(localStorage.getItem('dictModeIdx') ?? '', 10);
    return isNaN(saved) || saved < 0 || saved >= MODE_TEMPLATES.length ? 0 : saved;
  });
  const [selPosIds, setSelPosIds] = useState<number[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dictSelPosIds') ?? '[]');
      return Array.isArray(saved) ? saved.filter((n: unknown) => typeof n === 'number' && n >= 1 && n <= 7) : [];
    } catch { return []; }
  });
  const [overlay, setOverlay] = useState(() => localStorage.getItem('dictOverlay') === 'true');
  const [showCT, setShowCT] = useState(true);
  const [labelMode, setLabelMode] = useState<LabelMode>('note');
  const [chordPrefs, setChordPrefs] = useState<ChordNotationPrefs>(() => loadChordNotationPrefs());

  const [showGT, setShowGT] = useState(false);
  const [showChordForms, setShowChordForms] = useState(false);
  const [selectedVoicingIdx, setSelectedVoicingIdx] = useState(0);

  // Progression mode state
  const [progMode, setProgMode] = useState(() => localStorage.getItem('progMode') === 'true');
  const [progressions, setProgressions] = useState<Progression[]>(() => loadProgressions());
  const [activeProgIdx, setActiveProgIdx] = useState(() => {
    const saved = parseInt(localStorage.getItem('activeProgIdx') ?? '', 10);
    return Number.isFinite(saved) && saved >= 0 && saved < progressions.length ? saved : 0;
  });
  const [activeChordIdx, setActiveChordIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(() => progressions[activeProgIdx]?.bpm ?? 120);
  const [metVolume, setMetVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('metVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });
  // Chord audio state
  const [chordAudioOn, setChordAudioOn] = useState(() => localStorage.getItem('chordAudioOn') === 'true');
  const [chordVolume, setChordVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('chordVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });

  // Single-note volume: shared between fretboard clicks and phrase playback
  const [noteVolume, setNoteVolume] = useState<number>(() => {
    const s = parseFloat(localStorage.getItem('noteVolume') ?? localStorage.getItem('phraseVolume') ?? '');
    return isNaN(s) ? 0.4 : s;
  });
  // Instrument selection for phrase/note playback
  const [instrument, setInstrument] = useState<InstrumentType>(() => {
    const s = localStorage.getItem('phraseInstrument');
    return s === 'saxophone' ? s : 'guitar';
  });
  // Count-in state
  const [countInEnabled, setCountInEnabled] = useState(
    () => localStorage.getItem('countInEnabled') !== 'false' // default ON
  );
  const [countInVolume, setCountInVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('countInVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });
  const [countInBars, setCountInBars] = useState(() => {
    const saved = parseInt(localStorage.getItem('countInBars') ?? '', 10);
    return (saved === 1 || saved === 2) ? saved : 2;
  });
  // Loop range (measure-based): null = full playback, set = loop only specified measures
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(
    () => progressions[activeProgIdx]?.loopRange ?? null
  );
  const [loopSelecting, setLoopSelecting] = useState(false);

  const [swingEnabled, setSwingEnabled] = useState(
    () => localStorage.getItem('swingEnabled') === 'true'
  );
  const [swingAmount, setSwingAmount] = useState(
    () => Number(localStorage.getItem('swingAmount')) || 0.2
  );
  // Lick practice state
  const [lickDB, setLickDB] = useState<LickDB | null>(null);
  const [selectedLickIdx, setSelectedLickIdx] = useState<number | null>(null);
  const [lickHighOctave, setLickHighOctave] = useState(false);
  const [lickHighInstance, setLickHighInstance] = useState(false);
  // Lick favorites (★ toggle, localStorage-persisted)
  // Zoom level (persisted)
  const [zoom, setZoom] = useState(() => {
    const s = parseFloat(localStorage.getItem('appZoom') ?? '');
    return isNaN(s) ? 1.0 : Math.max(1.0, Math.min(1.5, s));
  });

  const [lickFavorites, setLickFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('lickFavorites');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  function handleToggleLickFavorite(lickId: string) {
    setLickFavorites(prev => {
      const next = new Set(prev);
      if (next.has(lickId)) next.delete(lickId); else next.add(lickId);
      localStorage.setItem('lickFavorites', JSON.stringify([...next]));
      return next;
    });
  }
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

  // Load lick DB on mount
  useEffect(() => {
    loadLickDB().then(db => setLickDB(db)).catch(() => setLickDB(null));
  }, []);

  const deg = mode.degrees;
  const rootNote = mode.notes[0];

  const visible = overlay ? allPos : (selPosIds.length > 0 ? allPos.filter(p => selPosIds.includes(p.id)) : allPos);
  const dim = selPosIds.length > 0 && !overlay;

  // Sync display state from active chord in progression mode
  const activeProg = progressions[activeProgIdx];

  // --- Audio hooks ---
  const audio = useAudioContext({
    metVolume, chordVolume, chordAudioOn, noteVolume,
    countInVolume, instrument, swingEnabled, swingAmount,
  });

  const {
    playPhraseAudio, stopPreview, isPhraseAudioPlaying,
    iiVDisplayPhrase, setIiVDisplayPhrase, phraseAnimKey, clearIiVSwitchTimer, bumpAnimKey,
    stepIndex, stepForward, stepBackward, exitStepMode,
  } = usePreviewPlayback({
    bpm, audio, progMode, activeProg, activeChordIdx,
    songKey: activeProg?.songKey, selPos, mode,
  });

  const { autoPlayPhrase, isCountingIn } = useAutoPlay({
    isPlaying, progMode, activeProg, activeChordIdx, bpm, lickDB, audio,
    countIn: { enabled: countInEnabled, bars: countInBars },
    loopRange,
    onAdvance: (idx) => setActiveChordIdx(idx),
    onPhraseAnimKey: bumpAnimKey,
  });

  // Space key toggles play/stop in progression mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      if (!progMode || editing) return;
      if (!activeProg || activeProg.chords.length === 0) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      setIsPlaying(p => !p);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [progMode, editing, activeProg]);

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
    if (!showGT) return null;

    // Dictionary mode: show 3rd/7th for current mode only (no next chord)
    if (!progMode) {
      const isDim = mode.notes.length > 7;
      if (isDim) return null;
      const gt = getGuideTones(mode);
      return { third: gt.third, seventh: gt.seventh, nextThird: null, nextThirdLocations: [] as { stringIdx: number; fret: number }[], resolution: null };
    }

    // Practice mode: full guide tone with next chord resolution
    if (!activeChord || isSkipped) return null;
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
  }, [progMode, showGT, activeChordIdx, effectiveAll, activeProg, activeChord, isSkipped, mode, template]);

  useEffect(() => {
    if (!progMode || !activeChord || isSkipped) return;
    const eff = effectiveAll[activeChordIdx];
    if (!eff) return;
    setRootName(activeChord.rootName);
    setModeIdx(eff.modeIdx);
    setSelPosIds([eff.posId]);
    setOverlay(false);
  }, [progMode, activeChordIdx, effectiveAll, activeChord, isSkipped]);

  // Filtered licks for the active chord in progression mode (single + ii-V)
  const filteredLicks = useMemo((): {
    licks: LickEntry[];
    lickType: string;
    iiV: ReturnType<typeof detectIiVPattern>;
    singleLickCount: number;
  } => {
    const empty = { licks: [], lickType: '', iiV: null as ReturnType<typeof detectIiVPattern>, singleLickCount: 0 };
    if (!lickDB || !progMode || !activeProg) return empty;
    const chord = activeProg.chords[activeChordIdx];
    if (!chord) return empty;
    const lickType = QUALITY_TO_LICK_TYPE[chord.quality];
    const singleLicks = lickType ? (lickDB[lickType] ?? []) : [];

    // Detect ii-V pattern
    const iiV = detectIiVPattern(activeProg.chords, activeChordIdx);
    let iiVLicks: LickEntry[] = [];
    if (iiV) {
      for (const t of iiV.types) {
        iiVLicks = iiVLicks.concat(lickDB[t] ?? []);
      }
    }

    return {
      licks: [...singleLicks, ...iiVLicks],
      lickType: lickType ?? chord.quality,
      iiV,
      singleLickCount: singleLicks.length,
    };
  }, [lickDB, progMode, activeProg, activeChordIdx]);

  // Restore lick selection from ChordSlot when chord changes
  const prevChordRestoreRef = useRef({ chordIdx: activeChordIdx, progMode });
  useEffect(() => {
    // Only clear ii-V playback state when the chord actually changes (not on prog save)
    const prev = prevChordRestoreRef.current;
    const chordChanged = prev.chordIdx !== activeChordIdx || prev.progMode !== progMode;
    prevChordRestoreRef.current = { chordIdx: activeChordIdx, progMode };
    if (chordChanged) {
      setIiVDisplayPhrase(null);
      clearIiVSwitchTimer();
    }
    if (!progMode || !activeProg) { setSelectedLickIdx(null); setLickHighOctave(false); setLickHighInstance(false); return; }
    const chord = activeProg.chords[activeChordIdx];
    if (chord?.lickId) {
      // Continuation chord (overflow from a previous chord): lick isn't in filteredLicks.
      // Set selectedLickIdx to null so the continuation fallback path handles it.
      if (chord.lickBeatOffset != null && chord.lickBeatOffset > (chord.lickAnacrusis ?? 0)) {
        setSelectedLickIdx(null);
        setLickHighOctave(chord.lickHighOctave ?? false);
        setLickHighInstance(chord.lickHighInstance ?? false);
        return;
      }
      const idx = filteredLicks.licks.findIndex(l => l.id === chord.lickId);
      if (idx >= 0) {
        setSelectedLickIdx(idx);
        setLickHighOctave(chord.lickHighOctave ?? false);
        setLickHighInstance(chord.lickHighInstance ?? false);
        return;
      }
    }
    setSelectedLickIdx(null);
    setLickHighOctave(false);
    setLickHighInstance(false);
  }, [activeChordIdx, progMode, activeProg, filteredLicks.licks]);

  // Build GeneratedPhrase from selected lick (or continuation chord with saved lick)
  // Returns { display (per-chord slice), preview (full lick for audio), vPartPhrase (next chord's slice for animation) }
  const { activeLickPhrase, previewLickPhrase, vPartPhrase } = useMemo((): { activeLickPhrase: GeneratedPhrase | null; previewLickPhrase: GeneratedPhrase | null; vPartPhrase: GeneratedPhrase | null } => {
    const none = { activeLickPhrase: null, previewLickPhrase: null, vPartPhrase: null };
    if (!progMode || !activeProg) return none;
    const chord = activeProg.chords[activeChordIdx];
    if (!chord) return none;

    // Determine the lick source
    let lick: LickEntry | null = null;
    let keyCenterSemi: number | undefined;
    const isContinuation = chord.lickBeatOffset != null && chord.lickBeatOffset > (chord.lickAnacrusis ?? 0);

    // Continuation chord: look up by lickId directly
    if (isContinuation && chord.lickId) {
      lick = lickDB ? findLickById(lickDB, chord.lickId!) : null;
      if (lick) {
        const iiVType = isIiVLickId(lick.id);
        if (iiVType) {
          // ii-V: derive key center from this chord's context
          const vRootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
          keyCenterSemi = (vRootSemi + 5) % 12;
        }
      }
    } else if (selectedLickIdx != null && filteredLicks.licks[selectedLickIdx]) {
      lick = filteredLicks.licks[selectedLickIdx];
      if (filteredLicks.iiV) keyCenterSemi = filteredLicks.iiV.keyCenterSemitone;
    } else if (chord.lickId) {
      lick = lickDB ? findLickById(lickDB, chord.lickId!) : null;
      if (lick) {
        const iiVType = isIiVLickId(lick.id);
        if (iiVType && chord.lickBeatOffset === (chord.lickAnacrusis ?? 0)) {
          const iiV = detectIiVPattern(activeProg.chords, activeChordIdx);
          if (iiV) keyCenterSemi = iiV.keyCenterSemitone;
        }
      }
    }
    if (!lick) return none;

    // Compute transposition
    const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
    const iiVType = isIiVLickId(lick.id);
    let transposeSemitones: number;
    if (iiVType && keyCenterSemi != null) {
      transposeSemitones = getIiVTransposeSemitones(keyCenterSemi);
    } else if (isContinuation) {
      // Continuation of a regular lick: use originator chord's context
      const origIdx = findOriginatorIdx(activeProg.chords, activeChordIdx);
      const origChord = activeProg.chords[origIdx];
      const origRootSemi = ROOTS.find(r => r.name === origChord.rootName)?.semitone ?? 0;
      transposeSemitones = getTransposeSemitones(origChord.quality, origRootSemi);
    } else {
      transposeSemitones = getTransposeSemitones(chord.quality, rootSemi);
    }

    // Determine chord beats and slice for display
    const layout = getChartLayout(activeProg);
    const chordBeats = getChordBeatCount(layout, activeChordIdx);
    const beatOffset = chord.lickBeatOffset ?? 0;
    const isOverflow = chord.lickBeatOffset != null; // lick spans multiple chords
    const displayLick = isOverflow
      ? sliceLick(lick, beatOffset, Math.min(chordBeats, lick.beats - beatOffset))
      : lick;

    // Helper to build display (sliced), preview (full), and next-part phrases
    const buildAll = (pos: Position, mi: number) => {
      const display = buildPhraseForLick(displayLick, chord.rootName, pos, mi, transposeSemitones, lickHighOctave, lickHighInstance);
      const preview = isOverflow ? buildPhraseForLick(lick!, chord.rootName, pos, mi, transposeSemitones, lickHighOctave, lickHighInstance) : display;
      let vPart: GeneratedPhrase | null = null;
      const ana = chord.lickAnacrusis ?? 0;
      if (isOverflow && beatOffset === ana && beatOffset + chordBeats < lick!.beats) {
        const nextSlice = sliceLick(lick!, beatOffset + chordBeats, Math.min(chordBeats, lick!.beats - beatOffset - chordBeats));
        vPart = buildPhraseForLick(nextSlice, chord.rootName, pos, mi, transposeSemitones, lickHighOctave, lickHighInstance);
      }
      return { activeLickPhrase: display, previewLickPhrase: preview, vPartPhrase: vPart };
    };

    // If user has selected mode/position, use it
    const eff = effectiveAll[activeChordIdx];
    if (eff) {
      const { positions: userPositions } = resolveChordPositions(chord.rootName, eff.modeIdx);
      const userPos = userPositions.find(p => p.id === eff.posId);
      if (userPos) return buildAll(userPos, eff.modeIdx);
    }

    // Fallback: auto-detect
    if (iiVType && keyCenterSemi != null) {
      const nextChord = activeProg.chords[activeChordIdx + 1];
      const vChord = isContinuation ? chord : nextChord;
      if (vChord) {
        const vRootSemi = ROOTS.find(r => r.name === vChord.rootName)?.semitone ?? 0;
        const displayCtx = buildIiVLickContext(
          displayLick, keyCenterSemi,
          vChord.quality, vChord.rootName, vRootSemi,
          lickHighOctave, lickHighInstance,
        );
        if (!displayCtx) return none;
        const previewPhrase = isOverflow
          ? buildIiVLickContext(lick, keyCenterSemi, vChord.quality, vChord.rootName, vRootSemi, lickHighOctave, lickHighInstance)?.phrase ?? null
          : displayCtx.phrase;
        let vPart: GeneratedPhrase | null = null;
        const ana2 = chord.lickAnacrusis ?? 0;
        if (isOverflow && beatOffset === ana2 && beatOffset + chordBeats < lick.beats) {
          const nextSlice = sliceLick(lick, beatOffset + chordBeats, Math.min(chordBeats, lick.beats - beatOffset - chordBeats));
          const vCtx = buildIiVLickContext(nextSlice, keyCenterSemi, vChord.quality, vChord.rootName, vRootSemi, lickHighOctave, lickHighInstance);
          vPart = vCtx?.phrase ?? null;
        }
        return { activeLickPhrase: displayCtx.phrase, previewLickPhrase: previewPhrase, vPartPhrase: vPart };
      }
    }
    const ctx = buildLickContext(lick, chord.quality, chord.rootName, rootSemi, lickHighOctave, lickHighInstance);
    return { activeLickPhrase: ctx?.phrase ?? null, previewLickPhrase: ctx?.phrase ?? null, vPartPhrase: null };
  }, [selectedLickIdx, filteredLicks.licks, filteredLicks.iiV, progMode, activeProg, activeChordIdx, effectiveAll, lickHighOctave, lickHighInstance, lickDB]);

  // Check if 8va / high-instance toggles are available for current lick+position
  const { canHighOctave, canHighInstance } = useMemo(() => {
    const none = { canHighOctave: false, canHighInstance: false };
    if (selectedLickIdx == null || !filteredLicks.licks[selectedLickIdx]) return none;
    if (!progMode || !activeProg) return none;
    const chord = activeProg.chords[activeChordIdx];
    if (!chord) return none;
    const lick = filteredLicks.licks[selectedLickIdx];
    const iiVType = isIiVLickId(lick.id);
    const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
    const iiVTranspose = (iiVType && filteredLicks.iiV) ? getIiVTransposeSemitones(filteredLicks.iiV.keyCenterSemitone) : null;
    const transposeSemitones = iiVTranspose ?? getTransposeSemitones(chord.quality, rootSemi);

    // Resolve position: prefer user-selected (eff), then auto-detect
    let pos: Position | undefined;
    let modeObj: ReturnType<typeof resolveMode> | undefined;
    let fm: FretMap | undefined;
    const eff = effectiveAll[activeChordIdx];
    if (eff) {
      const resolved = resolveChordPositions(chord.rootName, eff.modeIdx);
      modeObj = resolved.mode;
      fm = resolved.fretMap;
      pos = resolved.positions.find(p => p.id === eff.posId);
    }
    if (!pos) {
      // Fallback: auto-detect (ii-V uses V chord, single uses current chord)
      if (iiVType && filteredLicks.iiV) {
        const nextChord = activeProg.chords[activeChordIdx + 1];
        if (nextChord) {
          const vRootSemi = ROOTS.find(r => r.name === nextChord.rootName)?.semitone ?? 0;
          const ctx = buildIiVLickContext(lick, filteredLicks.iiV.keyCenterSemitone, nextChord.quality, nextChord.rootName, vRootSemi);
          if (!ctx) return none;
          pos = ctx.positions.find(p => p.id === ctx.posId);
          modeObj = ctx.mode;
          fm = ctx.fretMap;
        }
      }
      if (!pos) {
        const ctx = buildLickContext(lick, chord.quality, chord.rootName, rootSemi);
        if (!ctx) return none;
        pos = ctx.positions.find(p => p.id === ctx.posId);
        modeObj = ctx.mode;
        fm = ctx.fretMap;
      }
      if (!pos) return none;
    }

    // canHighInstance: multiple instances in this position
    const chi = pos.instances.length > 1;

    // canHighOctave: check if an alternate octave exists in the current instance's pool
    const basePitches = lick.notes.filter(n => !n.rest && n.pitch != null)
      .map(n => n.pitch! + transposeSemitones);
    const instIdx = selectBestInstance(pos, basePitches, lickHighInstance);
    const singleInstPos = { ...pos, instances: [pos.instances[instIdx]] };
    const pool = buildNotePool(singleInstPos, modeObj!, fm!, true);
    const cho = hasAlternateOctave(lick, pool, transposeSemitones);

    return { canHighOctave: cho, canHighInstance: chi };
  }, [selectedLickIdx, filteredLicks.licks, filteredLicks.iiV, progMode, activeProg, activeChordIdx, effectiveAll, lickHighInstance]);

  // Auto-disable toggles when they become unavailable
  // Skip for continuation chords — they inherit 8va/Hi from the originator
  // Skip during auto-play — each chord has its own saved 8va/Hi; overwriting would cause re-scheduling glitches
  useEffect(() => {
    if (isPlaying) return;
    const chord = activeProg?.chords[activeChordIdx];
    if (chord?.lickBeatOffset != null && chord.lickBeatOffset > (chord.lickAnacrusis ?? 0)) return;
    let changed = false;
    const updates: Partial<{ lickHighOctave: boolean; lickHighInstance: boolean }> = {};
    if (!canHighOctave && lickHighOctave) {
      setLickHighOctave(false);
      updates.lickHighOctave = false;
      changed = true;
    }
    if (!canHighInstance && lickHighInstance) {
      setLickHighInstance(false);
      updates.lickHighInstance = false;
      changed = true;
    }
    if (changed && activeProg && activeProg.chords[activeChordIdx]) {
      const copy = [...progressions];
      const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
      prog.chords[activeChordIdx] = { ...prog.chords[activeChordIdx], ...updates };
      // Propagate to continuation chords
      const curLickId = prog.chords[activeChordIdx].lickId;
      const autoAna = prog.chords[activeChordIdx].lickAnacrusis ?? 0;
      if (curLickId && prog.chords[activeChordIdx].lickBeatOffset != null) {
        for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
          const c = prog.chords[i];
          if (c?.lickId === curLickId && c?.lickBeatOffset != null && c.lickBeatOffset > autoAna) {
            prog.chords[i] = { ...c, ...updates };
          } else break;
        }
      }
      copy[activeProgIdx] = prog;
      handleSaveProgressions(copy);
    }
  }, [canHighOctave, canHighInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePhrase = useMemo(() => {
    if (isCountingIn) return autoPlayPhrase ?? null;  // during count-in, only show anacrusis or nothing
    if (iiVDisplayPhrase) return iiVDisplayPhrase;
    // Step mode: show the phrase being stepped through
    if (stepIndex != null && (previewLickPhrase ?? activeLickPhrase)) return previewLickPhrase ?? activeLickPhrase;
    // During manual playback of ii-V-long, show full phrase (not split display)
    if (isPhraseAudioPlaying && previewLickPhrase) return previewLickPhrase;
    if (activeLickPhrase) return activeLickPhrase;
    if (progMode && autoPlayPhrase && isPlaying)
      return autoPlayPhrase;
    return null;
  }, [isCountingIn, iiVDisplayPhrase, stepIndex, isPhraseAudioPlaying, previewLickPhrase, activeLickPhrase, progMode, autoPlayPhrase, isPlaying]);

  // Sounding note count & step position for step mode display
  const { soundingNoteCount, stepPosition } = useMemo(() => {
    const p = previewLickPhrase ?? activeLickPhrase;
    if (!p) return { soundingNoteCount: 0, stepPosition: 0 };
    const si = p.notes.reduce<number[]>((acc, n, i) => { if (!n.isRest) acc.push(i); return acc; }, []);
    const pos = stepIndex != null ? si.indexOf(stepIndex) + 1 : 0;
    return { soundingNoteCount: si.length, stepPosition: pos };
  }, [previewLickPhrase, activeLickPhrase, stepIndex]);

  // Chord boundary beat for CSS-only phrase transition (overflow lick preview)
  const chordBoundaryBeat = useMemo(() => {
    if (!isPhraseAudioPlaying || !previewLickPhrase || !vPartPhrase || !activeProg) return undefined;
    return getChordBeatCount(getChartLayout(activeProg), activeChordIdx);
  }, [isPhraseAudioPlaying, previewLickPhrase, vPartPhrase, activeProg, activeChordIdx]);

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

  // Persist countIn settings to localStorage (not in useAudioContext)
  useEffect(() => {
    localStorage.setItem('countInEnabled', String(countInEnabled));
    localStorage.setItem('countInBars', String(countInBars));
  }, [countInEnabled, countInBars]);

  // Persist dictionary mode selections to localStorage
  useEffect(() => { localStorage.setItem('dictRootName', rootName); }, [rootName]);
  useEffect(() => { localStorage.setItem('dictModeIdx', String(modeIdx)); }, [modeIdx]);
  useEffect(() => { localStorage.setItem('dictSelPosIds', JSON.stringify(selPosIds)); }, [selPosIds]);
  useEffect(() => { localStorage.setItem('dictOverlay', String(overlay)); }, [overlay]);

  function handleSaveProgressions(progs: Progression[]) {
    setProgressions(progs);
    saveProgressions(progs);
  }

  // Measure loop: click to set/extend/shrink/clear loop range
  function handleMeasureLoopClick(flatIdx: number) {
    setLoopRange(prev => {
      let next: { start: number; end: number } | null;
      if (!prev) {
        // No loop → single measure
        next = { start: flatIdx, end: flatIdx };
      } else if (prev.start === flatIdx && prev.end === flatIdx) {
        // Single measure, same click → clear
        next = null;
      } else if (flatIdx >= prev.start && flatIdx <= prev.end) {
        // Click inside range → shrink (remove from nearest boundary)
        if (flatIdx === prev.start && flatIdx === prev.end) {
          next = null;
        } else if (flatIdx - prev.start <= prev.end - flatIdx) {
          // Closer to start → shrink from start
          next = { start: flatIdx + 1, end: prev.end };
        } else {
          // Closer to end → shrink from end
          next = { start: prev.start, end: flatIdx - 1 };
        }
        if (next && next.start > next.end) next = null;
      } else {
        // Click outside → extend
        next = { start: Math.min(prev.start, flatIdx), end: Math.max(prev.end, flatIdx) };
      }
      // Save to progression
      if (progMode && activeProg) {
        const copy = [...progressions];
        copy[activeProgIdx] = { ...copy[activeProgIdx], loopRange: next ?? undefined };
        handleSaveProgressions(copy);
      }
      return next;
    });
  }

  // Count-in cycle: 2小節 → OFF → 1小節 → 2小節 → ...
  function handleCycleCountIn() {
    if (countInEnabled && countInBars === 2) {
      setCountInEnabled(false);
    } else if (!countInEnabled) {
      setCountInBars(1);
      setCountInEnabled(true);
    } else {
      setCountInBars(2);
    }
  }

  // BPM change: update state + save to current progression
  function handleBpmChange(newBpm: number) {
    setBpm(newBpm);
    if (progMode && activeProg) {
      const copy = [...progressions];
      copy[activeProgIdx] = { ...copy[activeProgIdx], bpm: newBpm };
      handleSaveProgressions(copy);
    }
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
      lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined,
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

  return (<>
    <div className="bg-bg-root text-text-primary min-h-screen font-mono p-4" style={{ zoom }}>
      <div className="max-w-[1040px] mx-auto" style={{ transform: 'translateZ(0)' }}>
        <h2 className="text-lg font-bold mb-0.5 tracking-wide">
          Berklee 7-Position System
        </h2>
        <p className="text-[10px] text-text-dim mb-3">
          B弦2音 + 他弦3音 ｜ 7モード対応
        </p>

        {/* Mode toggle */}
        <div className="flex mb-3">
          <button
            onClick={() => { setProgMode(false); localStorage.setItem('progMode', 'false'); setEditing(false); setIsPlaying(false); }}
            className="rounded-l cursor-pointer text-[12px] font-mono px-4 h-[30px] inline-flex items-center gap-1.5 relative"
            style={{
              border: `1px solid ${!progMode ? '#3498DB' : '#444'}`,
              marginRight: -1,
              zIndex: !progMode ? 1 : 0,
              background: !progMode ? '#1a2a3a' : '#1a1a1a',
              color: !progMode ? '#3498DB' : '#666',
              fontWeight: !progMode ? 700 : 400,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
            辞典モード
          </button>
          <button
            onClick={() => { setProgMode(true); localStorage.setItem('progMode', 'true'); setActiveChordIdx(0); setIsPlaying(false); }}
            className="rounded-r cursor-pointer text-[12px] font-mono px-4 h-[30px] inline-flex items-center gap-1.5 relative"
            style={{
              border: `1px solid ${progMode ? '#27AE60' : '#444'}`,
              zIndex: progMode ? 1 : 0,
              background: progMode ? '#1a2a1a' : '#1a1a1a',
              color: progMode ? '#27AE60' : '#666',
              fontWeight: progMode ? 700 : 400,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            練習モード
          </button>
        </div>

        {/* Global audio controls — practice mode only */}
        {progMode && <GlobalAudioControls
          bpm={bpm}
          onBpmChange={handleBpmChange}
          chordAudioOn={chordAudioOn}
          onToggleChordAudio={() => setChordAudioOn(p => !p)}
          metVolume={metVolume}
          onMetVolumeChange={setMetVolume}
          chordVolume={chordVolume}
          onChordVolumeChange={setChordVolume}
          noteVolume={noteVolume}
          onNoteVolumeChange={setNoteVolume}
          instrument={instrument}
          onInstrumentChange={setInstrument}
          swingEnabled={swingEnabled}
          onToggleSwing={() => setSwingEnabled(p => !p)}
          swingAmount={swingAmount}
          onSwingAmountChange={setSwingAmount}
          countInEnabled={countInEnabled}
          onToggleCountIn={handleCycleCountIn}
          countInVolume={countInVolume}
          onCountInVolumeChange={setCountInVolume}
          countInBars={countInBars}
          isCountingIn={isCountingIn}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(p => !p)}
          showPlayButton={!!activeProg && activeProg.chords.length > 0}
          loopLabel={loopRange
            ? loopRange.start === loopRange.end
              ? `小節 ${loopRange.start + 1}`
              : `小節 ${loopRange.start + 1}-${loopRange.end + 1}`
            : undefined}
          onClearLoop={() => {
            setLoopRange(null);
            setLoopSelecting(false);
            if (activeProg) {
              const copy = [...progressions];
              copy[activeProgIdx] = { ...copy[activeProgIdx], loopRange: undefined };
              handleSaveProgressions(copy);
            }
          }}
          loopSelecting={loopSelecting}
          onToggleLoopSelecting={() => setLoopSelecting(p => !p)}
          leadingSlot={
            <button
              onClick={() => { setEditing(!editing); setIsPlaying(false); setLoopSelecting(false); }}
              className="rounded cursor-pointer text-[10px] font-mono px-2.5 h-[24px] inline-flex items-center"
              style={{
                border: `1px solid ${editing ? '#F1C40F' : '#666'}`,
                background: editing ? '#2a2a1a' : '#1a1a1a',
                color: editing ? '#F1C40F' : '#AAA',
              }}>
              {editing ? 'コード編集中' : 'コード編集'}
            </button>
          }
        />}

        {/* Practice mode */}
        {progMode && (
          <>
            {editing ? (
              <ProgressionEditor
                progressions={progressions}
                activeProgIdx={activeProgIdx}
                chordPrefs={chordPrefs}
                activeChordIdx={activeChordIdx}
                onSave={handleSaveProgressions}
                onSelectProg={(idx) => { setActiveProgIdx(idx); localStorage.setItem('activeProgIdx', String(idx)); setActiveChordIdx(0); setIsPlaying(false); setBpm(progressions[idx]?.bpm ?? 120); setLoopRange(progressions[idx]?.loopRange ?? null); }}
                onClose={() => setEditing(false)}
              >
                {(editingChords, onRemoveChord, editChartLayout, onInsertAtBeat, onEmptyMeasureBeat, onRemoveEmptyMeasure, selectedBeat) => (editingChords.length > 0 || editChartLayout) && (
                  <ProgressionPlayer
                    progression={{ ...activeProg!, chords: editingChords, chartLayout: editChartLayout }}
                    activeChordIdx={activeChordIdx}
                    allPos={allPos}
                    chordPrefs={chordPrefs}
                    onChordSelect={setActiveChordIdx}
                    onModeChange={handleChordModeChange}
                    onPosChange={handleChordPosChange}
                    onReset={handleResetSelections}
                    selPosIds={selPosIds}
                    availableVoicings={showChordForms ? deduplicatedVoicings : undefined}
                    selectedVoicingIdx={effectiveVoicingIdx}
                    onSelectVoicing={handleSelectVoicing}
                    editing={true}
                    onRemoveChord={onRemoveChord}
                    onInsertAtBeat={onInsertAtBeat}
                    onEmptyMeasureBeat={onEmptyMeasureBeat}
                    onRemoveEmptyMeasure={onRemoveEmptyMeasure}
                    selectedBeat={selectedBeat}
                  />
                )}
              </ProgressionEditor>
            ) : activeProg && activeProg.chords.length > 0 ? (
              <ProgressionPlayer
                progression={activeProg}
                activeChordIdx={activeChordIdx}
                allPos={allPos}
                chordPrefs={chordPrefs}
                onChordSelect={setActiveChordIdx}
                onModeChange={handleChordModeChange}
                onPosChange={handleChordPosChange}
                onReset={handleResetSelections}
                selPosIds={selPosIds}
                availableVoicings={showChordForms ? deduplicatedVoicings : undefined}
                selectedVoicingIdx={effectiveVoicingIdx}
                onSelectVoicing={handleSelectVoicing}
                loopMeasureRange={loopRange}
                onMeasureLoopClick={handleMeasureLoopClick}
                loopSelecting={loopSelecting}
                belowChart={lickDB && (
                  <LickPanel
                    licks={filteredLicks.licks}
                    selectedIdx={selectedLickIdx}
                    onSelect={(idx) => {
                      setSelectedLickIdx(idx);
                      const curOctave = lickHighOctave;
                      const curInst = lickHighInstance;
                      const lick = filteredLicks.licks[idx];
                      if (lick?.id) {
                        const copy = [...progressions];
                        const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                        const layout = getChartLayout(prog);
                        const chordBeats = getChordBeatCount(layout, activeChordIdx);

                        // Remember old lickId before overwriting (for orphan cleanup)
                        const oldLickId = prog.chords[activeChordIdx]?.lickId;

                        // Assign lick to current chord, overflow to subsequent chords if needed
                        const anacrusis = lick.anacrusis ?? 0;
                        const effectiveBeats = lick.beats - anacrusis;
                        let assignEnd = activeChordIdx + 1;
                        if (effectiveBeats > chordBeats && activeChordIdx + 1 < prog.chords.length) {
                          let remaining = effectiveBeats;
                          let offset = anacrusis;
                          let ci = activeChordIdx;
                          while (remaining > 0 && ci < prog.chords.length) {
                            const cb = ci === activeChordIdx ? chordBeats : getChordBeatCount(layout, ci);
                            const assignBeats = Math.min(cb, remaining);
                            prog.chords[ci] = {
                              ...prog.chords[ci],
                              lickId: lick.id,
                              lickHighOctave: curOctave,
                              lickHighInstance: curInst,
                              lickBeatOffset: offset,
                              lickAnacrusis: anacrusis > 0 ? anacrusis : undefined,
                            };
                            offset += assignBeats;
                            remaining -= assignBeats;
                            ci++;
                          }
                          assignEnd = ci;
                        } else {
                          prog.chords[activeChordIdx] = {
                            ...prog.chords[activeChordIdx],
                            lickId: lick.id,
                            lickHighOctave: curOctave,
                            lickHighInstance: curInst,
                            lickBeatOffset: anacrusis > 0 ? anacrusis : undefined,
                            lickAnacrusis: anacrusis > 0 ? anacrusis : undefined,
                          };
                        }

                        // Clean up orphaned continuations of the old lick beyond new assignment range
                        if (oldLickId) {
                          for (let i = assignEnd; i < prog.chords.length; i++) {
                            const c = prog.chords[i];
                            if (c?.lickId === oldLickId && c?.lickBeatOffset != null && c.lickBeatOffset > (c.lickAnacrusis ?? 0)) {
                              prog.chords[i] = { ...c, lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined, lickBeatOffset: undefined, lickAnacrusis: undefined };
                            } else {
                              break;
                            }
                          }
                        }

                        copy[activeProgIdx] = prog;
                        handleSaveProgressions(copy);
                      }
                      const chord = activeProg.chords[activeChordIdx];
                      if (!chord || !lick) return;
                      // Play preview (full lick)
                      const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
                      const iiVType = isIiVLickId(lick.id);
                      const iiVTransp = (iiVType && filteredLicks.iiV) ? getIiVTransposeSemitones(filteredLicks.iiV.keyCenterSemitone) : null;
                      const ts = iiVTransp ?? getTransposeSemitones(chord.quality, rootSemi);
                      const layout = getChartLayout(activeProg);
                      const chordBeats = getChordBeatCount(layout, activeChordIdx);
                      const lickAna = lick.anacrusis ?? 0;
                      const lickEffBeats = lick.beats - lickAna;
                      const isOverflow = lickEffBeats > chordBeats;
                      const eff = effectiveAll[activeChordIdx];
                      if (eff) {
                        const { positions: posArr } = resolveChordPositions(chord.rootName, eff.modeIdx);
                        const pos = posArr.find(p => p.id === eff.posId);
                        if (pos) {
                          const phrase = buildPhraseForLick(lick, chord.rootName, pos, eff.modeIdx, ts, curOctave, curInst);
                          if (isOverflow) {
                            const nextOffset = lickAna + chordBeats;
                            const nextSlice = sliceLick(lick, nextOffset, Math.min(chordBeats, lick.beats - nextOffset));
                            const vPartSwitch = buildPhraseForLick(nextSlice, chord.rootName, pos, eff.modeIdx, ts, curOctave, curInst);
                            playPhraseAudio(phrase, vPartSwitch, chordBeats);
                          } else {
                            playPhraseAudio(phrase);
                          }
                          return;
                        }
                      }
                      // Fallback: auto-detect
                      if (iiVType && filteredLicks.iiV) {
                        const nextChord = activeProg.chords[activeChordIdx + 1];
                        if (nextChord) {
                          const vRootSemi = ROOTS.find(r => r.name === nextChord.rootName)?.semitone ?? 0;
                          const fullCtx = buildIiVLickContext(lick, filteredLicks.iiV.keyCenterSemitone, nextChord.quality, nextChord.rootName, vRootSemi, curOctave, curInst);
                          if (fullCtx) {
                            if (isOverflow) {
                              const nextOffset = lickAna + chordBeats;
                              const nextSlice = sliceLick(lick, nextOffset, Math.min(chordBeats, lick.beats - nextOffset));
                              const vCtx = buildIiVLickContext(nextSlice, filteredLicks.iiV.keyCenterSemitone, nextChord.quality, nextChord.rootName, vRootSemi, curOctave, curInst);
                              playPhraseAudio(fullCtx.phrase, vCtx?.phrase ?? null, chordBeats);
                            } else {
                              playPhraseAudio(fullCtx.phrase);
                            }
                          }
                        }
                      } else {
                        const ctx = buildLickContext(lick, chord.quality, chord.rootName, rootSemi, curOctave, curInst);
                        if (ctx) playPhraseAudio(ctx.phrase);
                      }
                    }}
                    onPlay={() => {
                      exitStepMode();
                      const p = previewLickPhrase ?? activeLickPhrase;
                      if (!p) return;
                      if (vPartPhrase) {
                        const layout = getChartLayout(activeProg!);
                        const chordBeats = getChordBeatCount(layout, activeChordIdx);
                        playPhraseAudio(p, vPartPhrase, chordBeats);
                      } else {
                        playPhraseAudio(p);
                      }
                    }}
                    onStop={stopPreview}
                    onClear={() => {
                      setSelectedLickIdx(null);
                      const copy = [...progressions];
                      const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                      const curChord = prog.chords[activeChordIdx];
                      prog.chords[activeChordIdx] = { ...curChord, lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined, lickBeatOffset: undefined, lickAnacrusis: undefined };
                      // Linked clear: clear all continuations of the same lick after this chord
                      if (curChord?.lickId) {
                        for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
                          const c = prog.chords[i];
                          if (c?.lickId === curChord.lickId && c?.lickBeatOffset != null && c.lickBeatOffset > (c.lickAnacrusis ?? 0)) {
                            prog.chords[i] = { ...c, lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined, lickBeatOffset: undefined, lickAnacrusis: undefined };
                          } else {
                            break;
                          }
                        }
                      }
                      copy[activeProgIdx] = prog;
                      handleSaveProgressions(copy);
                    }}
                    isPlaying={isPhraseAudioPlaying}
                    lickType={filteredLicks.lickType}
                    quality={activeProg.chords[activeChordIdx]?.quality ?? ''}
                    rootSemitone={ROOTS.find(r => r.name === activeProg.chords[activeChordIdx]?.rootName)?.semitone ?? 0}
                    iiV={filteredLicks.iiV}
                    singleLickCount={filteredLicks.singleLickCount}
                    vChordQuality={activeProg.chords[activeChordIdx + 1]?.quality}
                    vChordRootSemitone={ROOTS.find(r => r.name === activeProg.chords[activeChordIdx + 1]?.rootName)?.semitone}
                    favorites={lickFavorites}
                    onToggleFavorite={handleToggleLickFavorite}
                    highOctave={lickHighOctave}
                    canHighOctave={canHighOctave}
                    onToggleOctave={() => {
                      setLickHighOctave(v => {
                        const next = !v;
                        const copy = [...progressions];
                        const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                        prog.chords[activeChordIdx] = { ...prog.chords[activeChordIdx], lickHighOctave: next };
                        // Propagate to continuation chords
                        const curLickId = prog.chords[activeChordIdx].lickId;
                        const octAna = prog.chords[activeChordIdx].lickAnacrusis ?? 0;
                        if (curLickId && prog.chords[activeChordIdx].lickBeatOffset != null) {
                          for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
                            const c = prog.chords[i];
                            if (c?.lickId === curLickId && c?.lickBeatOffset != null && c.lickBeatOffset > octAna) {
                              prog.chords[i] = { ...c, lickHighOctave: next };
                            } else break;
                          }
                        }
                        copy[activeProgIdx] = prog;
                        handleSaveProgressions(copy);
                        return next;
                      });
                    }}
                    highInstance={lickHighInstance}
                    canHighInstance={canHighInstance}
                    onToggleInstance={() => {
                      setLickHighInstance(v => {
                        const next = !v;
                        const copy = [...progressions];
                        const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                        prog.chords[activeChordIdx] = { ...prog.chords[activeChordIdx], lickHighInstance: next };
                        // Propagate to continuation chords
                        const curLickId = prog.chords[activeChordIdx].lickId;
                        const instAna = prog.chords[activeChordIdx].lickAnacrusis ?? 0;
                        if (curLickId && prog.chords[activeChordIdx].lickBeatOffset != null) {
                          for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
                            const c = prog.chords[i];
                            if (c?.lickId === curLickId && c?.lickBeatOffset != null && c.lickBeatOffset > instAna) {
                              prog.chords[i] = { ...c, lickHighInstance: next };
                            } else break;
                          }
                        }
                        copy[activeProgIdx] = prog;
                        handleSaveProgressions(copy);
                        return next;
                      });
                    }}
                    stepIndex={stepIndex}
                    onStepForward={() => { const p = previewLickPhrase ?? activeLickPhrase; if (p) stepForward(p); }}
                    onStepBackward={() => { const p = previewLickPhrase ?? activeLickPhrase; if (p) stepBackward(p); }}
                    soundingNoteCount={soundingNoteCount}
                    stepPosition={stepPosition}
                  />
                )}
              />
            ) : null}

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
          activePhrase={activePhrase}
          phraseAnimKey={phraseAnimKey}
          phraseAnimSpeed={stepIndex != null ? 0
            : isPhraseAudioPlaying || isPlaying
              ? Math.round((60000 / bpm) / 2)
              : 0}
          swingAmount={swingEnabled ? swingAmount : 0}
          bpm={bpm}
          chordBoundaryBeat={chordBoundaryBeat}
          phraseHighlightUpTo={stepIndex ?? undefined}
        />

        {activePhrase && <PhraseAnalysisPanel phrase={activePhrase} mode={mode} />}

        {/* Mode description section */}
        <div className="mt-2 mb-3 rounded-md px-3 py-2" style={{ background: '#1a1a1a', borderLeft: `3px solid ${MODE_COLORS[mode.key]}` }}>
          <div className="text-[12px] text-text-secondary mb-1">
            <span className="font-bold" style={{ color: MODE_COLORS[mode.key] }}>{rootNote} {mode.name}</span>
            <span className="text-text-dim ml-2">{mode.notes.map(n => `${n}(${mode.degrees[n]})`).join(' ')}</span>
          </div>
          <div className="text-[11px] text-text-dim mb-1.5">
            {formatChordSymbol(rootNote, mode.chordQuality, chordPrefs)}: {mode.chordTones.map((n, i) => `${n}(${mode.chordSub.split(' ')[i] ?? mode.degrees[n]})`).join(' ')}
          </div>
          <div className="text-[11px] text-text-dim leading-relaxed">
            {template.description.split('♮').flatMap((part, i) =>
              i === 0 ? [part] : [<span key={i} style={{ fontSize: '1.25em', lineHeight: 1, verticalAlign: '-0.12em' }}>♮</span>, part]
            )}
          </div>
        </div>

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

    {/* Zoom control — outside zoom container, fixed at bottom-right */}
    <div className="fixed bottom-3 right-3 flex items-center gap-2 bg-bg-root/90 backdrop-blur border border-border-faint rounded-lg px-3 py-1.5 shadow-lg z-50 font-mono">
      <span className="text-[10px] text-text-muted select-none">倍率</span>
      <input
        type="range"
        min="100" max="150" step="1"
        value={Math.round(zoom * 100)}
        onChange={e => {
          const v = parseInt(e.target.value) / 100;
          setZoom(v);
          localStorage.setItem('appZoom', String(v));
        }}
        className="w-20 h-1 accent-blue-500 cursor-pointer"
      />
      <span className="text-[10px] text-text-muted tabular-nums w-8 text-right select-none">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => { setZoom(1.0); localStorage.setItem('appZoom', '1'); }}
        className="text-text-muted hover:text-text-primary cursor-pointer"
        style={{ visibility: zoom !== 1.0 ? 'visible' : 'hidden' }}
        title="100%にリセット"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>
        </svg>
      </button>
    </div>
  </>);
}
