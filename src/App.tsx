import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { LabelMode, RootName, Progression, ChordNotationPrefs, ChartLayout, SongKey, ChordSlot, GeneratedPhrase, InstrumentType, LickDB, LickEntry, Position, FretMap } from './types';
import { MODE_TEMPLATES, ROOTS, MODE_COLORS } from './constants';
import {
  buildFretMap, generatePositions, generateDimPositions, resolveMode,
  loadProgressions, saveProgressions, QUALITY_TO_MODES,
  computeEffectiveSelections,
  formatChordSymbol, loadChordNotationPrefs, saveChordNotationPrefs,
  getChartLayout, buildChordRows,
  getGuideTones, findNoteLocations, classifyResolution,
  findVoicingsInPosition,
  playChordStrum,
  buildNotePool, schedulePhrase,
  loadLickDB, QUALITY_TO_LICK_TYPE, buildLickContext, getTransposeSemitones,
  lickToGeneratedPhrase, selectBestInstance, hasAlternateOctave,
  detectIiVPattern, isIiVLickId, buildIiVLickContext, getIiVTransposeSemitones,
  sliceLick, getChordBeatCount,
} from './utils';
import { Fretboard } from './components/Fretboard';
import { RootSelector, ModeSelector, PositionSelector, OptionBar, PhraseAnalysisPanel, GlobalAudioControls, LickPanel } from './components/Controls';
import { PositionGrid } from './components/PositionGrid';
import { ProgressionEditor, ProgressionPlayer } from './components/Progression';
import { Footer } from './components/Footer';

function playClick(accent: boolean, ctx: AudioContext, volume: number, at?: number): OscillatorNode {
  if (ctx.state === 'suspended') ctx.resume();
  const t = at ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = accent ? 1200 : 800;
  gain.gain.setValueAtTime(accent ? volume * 1.5 : volume * 1.0, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.start(t);
  osc.stop(t + 0.04);
  return osc;
}

/** Build a flat playback sequence respecting section repeats and volta endings.
 *  Each entry includes `measureFlatIdx` — the visual measure index on the chart
 *  (consistent with ChordChart's flat index computation). */
function buildPlaybackSeq(layout: ChartLayout): { chordIdx: number; beats: number; measureFlatIdx: number }[] {
  const seq: { chordIdx: number; beats: number; measureFlatIdx: number }[] = [];
  let flatBase = 0;
  function addMeasure(m: { chordIndices: number[]; beatWidths?: number[] }, mfi: number) {
    const count = m.chordIndices.length;
    const bwSum = m.beatWidths ? m.beatWidths.reduce((a, b) => a + b, 0) : count;
    m.chordIndices.forEach((ci, i) => {
      const bw = m.beatWidths?.[i] ?? 1;
      seq.push({ chordIdx: ci, beats: (bw / bwSum) * 4, measureFlatIdx: mfi });
    });
  }
  for (const section of layout.sections) {
    const mainStart = flatBase;
    flatBase += section.measures.length;
    const endingStarts: number[] = [];
    if (section.endings) {
      for (const ending of section.endings) {
        endingStarts.push(flatBase);
        flatBase += ending.length;
      }
    }
    const passes = (section.repeats ?? 0) + 1;
    for (let pass = 0; pass < passes; pass++) {
      section.measures.forEach((m, mi) => addMeasure(m, mainStart + mi));
      if (section.endings?.[pass]) {
        section.endings[pass].forEach((m, mi) => addMeasure(m, endingStarts[pass] + mi));
      }
    }
  }
  return seq;
}

function computeCumBeats(seq: { beats: number }[], upToIdx: number): number {
  let cum = 0;
  for (let i = 0; i < upToIdx && i < seq.length; i++) cum += seq[i].beats;
  return cum;
}

/** Determine which notes to strum for a given chord in the progression. */
function getStrumNotes(
  chordIdx: number,
  chords: ChordSlot[],
  songKey?: SongKey,
): { stringIdx: number; fret: number }[] {
  const effAll = computeEffectiveSelections(chords, songKey);
  const chord = chords[chordIdx];
  const eff = effAll[chordIdx];
  if (!chord || !eff || !QUALITY_TO_MODES[chord.quality]) return [];

  const chordMode = resolveMode(chord.rootName, MODE_TEMPLATES[eff.modeIdx]);
  const chordFretMap = buildFretMap(chordMode.semi, chordMode.notes);
  const is8 = chordMode.notes.length > 7;
  const positions = is8
    ? generateDimPositions(chordFretMap, chordMode.semi[0])
    : generatePositions(chordFretMap, chordMode.notes);
  const pos = positions.find(p => p.id === eff.posId);

  // Prefer voicing if set
  if (chord.voicingKey && pos && !is8 && eff.modeIdx <= 6) {
    const voicings = findVoicingsInPosition(pos, chordMode);
    for (const v of voicings) {
      const key = `${v.template.type}-${v.template.inversion}-${v.template.stringIndices.join(',')}`;
      if (key === chord.voicingKey) {
        return v.notes.map(n => ({ stringIdx: n.stringIdx, fret: n.fret }));
      }
    }
  }

  // Fallback: pick one chord tone per string from the position
  if (pos && pos.instances.length > 0) {
    const inst = pos.instances[0];
    const ct = new Set(chordMode.chordTones);
    const notes: { stringIdx: number; fret: number }[] = [];
    for (let s = 5; s >= 0; s--) {
      const strNotes = inst.strings[s];
      if (!strNotes) continue;
      const ctNote = strNotes.find(([n]) => ct.has(n));
      if (ctNote) notes.push({ stringIdx: s, fret: ctNote[1] });
      if (notes.length >= 4) break;
    }
    return notes;
  }

  return [];
}

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
  const [activeProgIdx, setActiveProgIdx] = useState(0);
  const [activeChordIdx, setActiveChordIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(() => progressions[0]?.bpm ?? 120);
  const [metVolume, setMetVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('metVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const metVolumeRef = useRef(metVolume);
  // Chord audio state
  const [chordAudioOn, setChordAudioOn] = useState(() => localStorage.getItem('chordAudioOn') === 'true');
  const [chordVolume, setChordVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('chordVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });
  const chordVolumeRef = useRef(chordVolume);
  const chordAudioOnRef = useRef(chordAudioOn);
  const activeStrumRef = useRef<{ stop: () => void } | null>(null);   // auto-play strum
  const previewStrumRef = useRef<{ stop: () => void }[]>([]);  // preview strums (separate to avoid auto-advance cleanup)
  const previewMetRef = useRef<OscillatorNode[]>([]);                  // pre-scheduled metronome clicks for preview
  const songMetRef = useRef<OscillatorNode[]>([]);                    // pre-scheduled metronome clicks for song playback
  const pendingNextRef = useRef<{                                     // pre-scheduled next chord audio (look-ahead)
    strumHandle: { stop: () => void } | null;
    phraseHandle: { stop: () => void } | null;
    phrase: GeneratedPhrase | null;
    metNodes: OscillatorNode[];
  } | null>(null);
  const pendingPhraseRef = useRef<{                                   // deferred phrase start (consumed by phrase-start effect)
    phrase: GeneratedPhrase; switchToVPart?: GeneratedPhrase | null; iiBeats?: number;
  } | null>(null);
  // Drift-free auto-advance
  const chordStartRef = useRef(0);
  const wasAutoAdvanceRef = useRef(false);
  const playPosRef = useRef(0);
  const [advanceTick, setAdvanceTick] = useState(0);  // force effect re-run on same chordIdx

  // Single-note volume: shared between fretboard clicks and phrase playback
  const [noteVolume, setNoteVolume] = useState<number>(() => {
    const s = parseFloat(localStorage.getItem('noteVolume') ?? localStorage.getItem('phraseVolume') ?? '');
    return isNaN(s) ? 0.4 : s;
  });
  const noteVolumeRef = useRef(noteVolume);
  // Instrument selection for phrase/note playback
  const [instrument, setInstrument] = useState<InstrumentType>(() => {
    const s = localStorage.getItem('phraseInstrument');
    return s === 'saxophone' ? s : 'guitar';
  });
  const instrumentRef = useRef(instrument);
  // Swing state
  // Count-in state
  const [countInEnabled, setCountInEnabled] = useState(
    () => localStorage.getItem('countInEnabled') !== 'false' // default ON
  );
  const [countInVolume, setCountInVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('countInVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });
  const countInVolumeRef = useRef(countInVolume);
  const [countInBars, setCountInBars] = useState(() => {
    const saved = parseInt(localStorage.getItem('countInBars') ?? '', 10);
    return (saved === 1 || saved === 2) ? saved : 2;
  });
  const [isCountingIn, setIsCountingIn] = useState(false);
  const countInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countInNodesRef = useRef<OscillatorNode[]>([]);

  // Loop range (measure-based): null = full playback, set = loop only specified measures
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(
    () => progressions[0]?.loopRange ?? null
  );
  const loopRangeRef = useRef(loopRange);
  useEffect(() => { loopRangeRef.current = loopRange; }, [loopRange]);
  const [loopSelecting, setLoopSelecting] = useState(false);

  const [swingEnabled, setSwingEnabled] = useState(
    () => localStorage.getItem('swingEnabled') === 'true'
  );
  const [swingAmount, setSwingAmount] = useState(
    () => Number(localStorage.getItem('swingAmount')) || 0.2
  );
  const swingEnabledRef = useRef(swingEnabled);
  const swingAmountRef = useRef(swingAmount);
  const activePhraseStopRef = useRef<{ stop: () => void } | null>(null);
  const [autoPlayPhrase, setAutoPlayPhrase] = useState<GeneratedPhrase | null>(null);
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
  // During ii-V-long preview, temporarily show V part on fretboard
  const [iiVDisplayPhrase, setIiVDisplayPhrase] = useState<GeneratedPhrase | null>(null);
  const iiVSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (chord.lickBeatOffset != null && chord.lickBeatOffset > 0) {
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
    const isContinuation = chord.lickBeatOffset != null && chord.lickBeatOffset > 0;

    // Continuation chord: look up by lickId directly
    if (isContinuation && chord.lickId) {
      lick = findLickById(chord.lickId);
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
      lick = findLickById(chord.lickId);
      if (lick) {
        const iiVType = isIiVLickId(lick.id);
        if (iiVType && chord.lickBeatOffset === 0) {
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
      if (isOverflow && beatOffset === 0 && beatOffset + chordBeats < lick!.beats) {
        const nextSlice = sliceLick(lick!, chordBeats, Math.min(chordBeats, lick!.beats - chordBeats));
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
        if (isOverflow && beatOffset === 0 && beatOffset + chordBeats < lick.beats) {
          const nextSlice = sliceLick(lick, chordBeats, Math.min(chordBeats, lick.beats - chordBeats));
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
  useEffect(() => {
    const chord = activeProg?.chords[activeChordIdx];
    if (chord?.lickBeatOffset != null && chord.lickBeatOffset > 0) return;
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
      if (curLickId && prog.chords[activeChordIdx].lickBeatOffset != null) {
        for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
          const c = prog.chords[i];
          if (c?.lickId === curLickId && c?.lickBeatOffset != null && c.lickBeatOffset > 0) {
            prog.chords[i] = { ...c, ...updates };
          } else break;
        }
      }
      copy[activeProgIdx] = prog;
      handleSaveProgressions(copy);
    }
  }, [canHighOctave, canHighInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  const [isPhraseAudioPlaying, setIsPhraseAudioPlaying] = useState(false);

  const activePhrase = useMemo(() => {
    if (isCountingIn) return null;  // suppress phrase display during count-in
    if (iiVDisplayPhrase) return iiVDisplayPhrase;
    // During manual playback of ii-V-long, show full phrase (not split display)
    if (isPhraseAudioPlaying && previewLickPhrase) return previewLickPhrase;
    if (activeLickPhrase) return activeLickPhrase;
    if (progMode && autoPlayPhrase && isPlaying)
      return autoPlayPhrase;
    return null;
  }, [isCountingIn, iiVDisplayPhrase, isPhraseAudioPlaying, previewLickPhrase, activeLickPhrase, progMode, autoPlayPhrase, isPlaying]);

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

  // Keep metVolumeRef in sync and persist to localStorage
  useEffect(() => {
    metVolumeRef.current = metVolume;
    localStorage.setItem('metVolume', String(metVolume));
  }, [metVolume]);

  // Chord audio volume + toggle refs
  useEffect(() => {
    chordVolumeRef.current = chordVolume;
    localStorage.setItem('chordVolume', String(chordVolume));
  }, [chordVolume]);
  useEffect(() => { chordAudioOnRef.current = chordAudioOn; localStorage.setItem('chordAudioOn', String(chordAudioOn)); }, [chordAudioOn]);

  // Note volume ref + persistence (covers fretboard clicks + phrase playback)
  useEffect(() => { noteVolumeRef.current = noteVolume; localStorage.setItem('noteVolume', String(noteVolume)); }, [noteVolume]);
  useEffect(() => { instrumentRef.current = instrument; localStorage.setItem('phraseInstrument', instrument); }, [instrument]);
  useEffect(() => { countInVolumeRef.current = countInVolume; }, [countInVolume]);
  useEffect(() => {
    localStorage.setItem('countInVolume', String(countInVolume));
    localStorage.setItem('countInEnabled', String(countInEnabled));
    localStorage.setItem('countInBars', String(countInBars));
  }, [countInVolume, countInEnabled, countInBars]);
  useEffect(() => { swingEnabledRef.current = swingEnabled; localStorage.setItem('swingEnabled', String(swingEnabled)); }, [swingEnabled]);
  useEffect(() => { swingAmountRef.current = swingAmount; localStorage.setItem('swingAmount', String(swingAmount)); }, [swingAmount]);

  // Persist dictionary mode selections to localStorage
  useEffect(() => { localStorage.setItem('dictRootName', rootName); }, [rootName]);
  useEffect(() => { localStorage.setItem('dictModeIdx', String(modeIdx)); }, [modeIdx]);
  useEffect(() => { localStorage.setItem('dictSelPosIds', JSON.stringify(selPosIds)); }, [selPosIds]);
  useEffect(() => { localStorage.setItem('dictOverlay', String(overlay)); }, [overlay]);
  /** Find a lick from any DB section by ID */
  function findLickById(lickId: string): LickEntry | null {
    if (!lickDB) return null;
    for (const type of Object.keys(lickDB)) {
      const found = lickDB[type].find(l => l.id === lickId);
      if (found) return found;
    }
    return null;
  }

  /** Find the originator chord index for a continuation chord (scan backward for same lickId with offset 0). */
  function findOriginatorIdx(chords: ChordSlot[], continuationIdx: number): number {
    const lickId = chords[continuationIdx].lickId;
    for (let i = continuationIdx - 1; i >= 0; i--) {
      if (chords[i].lickId === lickId && (!chords[i].lickBeatOffset || chords[i].lickBeatOffset === 0)) {
        return i;
      }
    }
    return continuationIdx;
  }

  // Check if a chord has a saved lick that should be played during auto-advance
  function chordHasSavedLick(chordIdx: number, prog: Progression): boolean {
    const chord = prog.chords[chordIdx];
    if (!chord?.lickId || !lickDB) return false;
    return findLickById(chord.lickId) != null;
  }

  /** Clear the ii-V fretboard switch timer. */
  function clearIiVSwitchTimer() {
    if (iiVSwitchTimerRef.current) {
      clearTimeout(iiVSwitchTimerRef.current);
      iiVSwitchTimerRef.current = null;
    }
  }

  /** Resolve mode → fretMap → positions for a chord's root and mode index. */
  function resolveChordPositions(chordRootName: RootName, chordModeIdx: number) {
    const t = MODE_TEMPLATES[chordModeIdx];
    const m = resolveMode(chordRootName, t);
    const fm = buildFretMap(m.semi, m.notes);
    const positions = m.notes.length > 7
      ? generateDimPositions(fm, m.semi[0])
      : generatePositions(fm, m.notes);
    return { template: t, mode: m, fretMap: fm, positions };
  }

  /** Build a GeneratedPhrase for a lick mapped onto a specific position. */
  function buildPhraseForLick(
    lick: LickEntry, chordRootName: RootName, pos: Position,
    chordModeIdx: number, transposeSemitones: number,
    highOctave: boolean, highInstance: boolean,
  ): GeneratedPhrase {
    const { template, mode: m, fretMap: fm } = resolveChordPositions(chordRootName, chordModeIdx);
    const lickPitches = lick.notes
      .filter(n => !n.rest && n.pitch != null)
      .map(n => n.pitch! + transposeSemitones);
    const bestInstIdx = selectBestInstance(pos, lickPitches, highInstance);
    const singleInstPos = { ...pos, instances: [pos.instances[bestInstIdx]] };
    const pool = buildNotePool(singleInstPos, m, fm, true);
    return lickToGeneratedPhrase(
      lick, pos.id, template.key, chordRootName, pool, transposeSemitones, highOctave,
    );
  }

  // Play a saved lick for a given chord index (used during auto-advance)
  function playLickForChord(
    chordIdx: number,
    prog: Progression,
  ): GeneratedPhrase | null {
    const chords = prog.chords;
    const effAll = computeEffectiveSelections(chords, prog.songKey);
    const chord = chords[chordIdx];
    const eff = effAll[chordIdx];
    if (!chord || !eff || !QUALITY_TO_MODES[chord.quality]) return null;

    if (chord.lickId && lickDB) {
      const highOctave = chord.lickHighOctave ?? false;
      const highInstance = chord.lickHighInstance ?? false;

      const lick = findLickById(chord.lickId);
      if (!lick) return null;

      const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
      const iiVType = isIiVLickId(chord.lickId);
      const isContinuation = chord.lickBeatOffset != null && chord.lickBeatOffset > 0;

      // Compute transposition
      let transposeSemitones: number;
      if (iiVType) {
        const keyCenterSemi = isContinuation
          ? (rootSemi + 5) % 12
          : (() => { const iiV = detectIiVPattern(chords, chordIdx); return iiV?.keyCenterSemitone ?? 0; })();
        transposeSemitones = getIiVTransposeSemitones(keyCenterSemi);
      } else if (isContinuation) {
        const origIdx = findOriginatorIdx(chords, chordIdx);
        const origChord = chords[origIdx];
        const origRootSemi = ROOTS.find(r => r.name === origChord.rootName)?.semitone ?? 0;
        transposeSemitones = getTransposeSemitones(origChord.quality, origRootSemi);
      } else {
        transposeSemitones = getTransposeSemitones(chord.quality, rootSemi);
      }

      // Slice lick for this chord's portion
      const layout = getChartLayout(prog);
      const chordBeats = getChordBeatCount(layout, chordIdx);
      const beatOffset = chord.lickBeatOffset ?? 0;
      const isOverflow = chord.lickBeatOffset != null;
      const effectiveLick = isOverflow
        ? sliceLick(lick, beatOffset, Math.min(chordBeats, lick.beats - beatOffset))
        : lick;

      // Use the user's effective mode/position for mapping
      const { positions } = resolveChordPositions(chord.rootName, eff.modeIdx);
      const pos = positions.find(p => p.id === eff.posId);
      if (pos) {
        return buildPhraseForLick(effectiveLick, chord.rootName, pos, eff.modeIdx, transposeSemitones, highOctave, highInstance);
      }
    }

    return null;
  }

  /** Schedule strum + lick + metronome for a chord at a Web Audio timestamp. */
  function scheduleChordAudio(
    chordIdx: number,
    prog: Progression,
    startAt: number,
    globalBeatOffset: number,
  ): {
    strumHandle: { stop: () => void } | null;
    phraseHandle: { stop: () => void } | null;
    phrase: GeneratedPhrase | null;
    metNodes: OscillatorNode[];
  } {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    let strumHandle: { stop: () => void } | null = null;
    let phraseHandle: { stop: () => void } | null = null;
    let phrase: GeneratedPhrase | null = null;
    const metNodes: OscillatorNode[] = [];

    // Strum
    if (chordAudioOnRef.current) {
      const strumNotes = getStrumNotes(chordIdx, prog.chords, prog.songKey);
      if (strumNotes.length > 0) {
        strumHandle = playChordStrum(ctx, strumNotes, chordVolumeRef.current, startAt);
      }
    }

    // Lick
    if (chordHasSavedLick(chordIdx, prog)) {
      phrase = playLickForChord(chordIdx, prog);
      if (phrase) {
        const eighthDur = (60 / bpm) / 2;
        phraseHandle = schedulePhrase(ctx, phrase, startAt, eighthDur, noteVolumeRef.current, 99, instrumentRef.current, swingEnabledRef.current ? swingAmountRef.current : 0, bpm);
      }
    }

    // Metronome
    if (metVolumeRef.current > 0) {
      const layout = getChartLayout(prog);
      const chordBeats = getChordBeatCount(layout, chordIdx);
      const beatSec = 60 / bpm;
      for (let b = 0; b < chordBeats; b++) {
        const accent = (globalBeatOffset + b) % 4 === 0;
        const osc = playClick(accent, ctx, metVolumeRef.current, startAt + b * beatSec);
        metNodes.push(osc);
      }
    }

    return { strumHandle, phraseHandle, phrase, metNodes };
  }

  // BPM auto-advance: drift-free with look-ahead audio scheduling.
  // Audio (strum + lick + metronome) for the NEXT chord is pre-scheduled on the
  // Web Audio timeline immediately, so it plays at sample-accurate timing.
  // The setTimeout only handles React state updates (chord highlight, animation).
  useEffect(() => {
    if (!isPlaying || !progMode || !activeProg) {
      chordStartRef.current = 0;
      wasAutoAdvanceRef.current = false;
      activeStrumRef.current?.stop();
      activeStrumRef.current = null;
      activePhraseStopRef.current?.stop();
      activePhraseStopRef.current = null;
      stopSongMetronome();
      cancelPendingNext();
      stopCountIn();
      return;
    }
    // During count-in phase, skip normal playback logic
    if (isCountingIn) return;

    const seq = buildPlaybackSeq(getChartLayout(activeProg));
    if (!seq.length) return;

    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    // On playback start, BPM change, or user navigation: find position in sequence.
    // On auto-advance: playPosRef was already incremented in the timeout callback.
    if (!wasAutoAdvanceRef.current || chordStartRef.current === 0) {
      const isPlaybackStart = chordStartRef.current === 0;

      // Count-in: on fresh playback start only (chordStartRef === 0)
      if (isPlaybackStart && countInEnabled) {
        const beatSec = 60 / bpm;
        const countInBeats = countInBars * 4;
        const vol = countInVolumeRef.current;
        const startAt = ctx.currentTime + 0.05;
        const nodes: OscillatorNode[] = [];
        for (let b = 0; b < countInBeats; b++) {
          const osc = playClick(b % 4 === 0, ctx, vol, startAt + b * beatSec);
          nodes.push(osc);
        }
        countInNodesRef.current = nodes;
        setIsCountingIn(true);
        countInTimerRef.current = setTimeout(() => {
          countInTimerRef.current = null;
          countInNodesRef.current = [];
          // Set chordStartRef non-zero before clearing isCountingIn
          // so the next effect run sees isPlaybackStart=false → no re-entry
          chordStartRef.current = performance.now();
          setIsCountingIn(false);
        }, countInBeats * beatSec * 1000);
        return;
      }

      const pos = seq.findIndex(s => s.chordIdx === activeChordIdx);
      playPosRef.current = pos >= 0 ? pos : 0;
      chordStartRef.current = performance.now();

      // Cancel pending + active audio, then schedule current chord
      cancelPendingNext();
      activeStrumRef.current?.stop();
      activePhraseStopRef.current?.stop();
      stopSongMetronome();
      const cumBeats = computeCumBeats(seq, playPosRef.current);
      const result = scheduleChordAudio(activeChordIdx, activeProg, ctx.currentTime, cumBeats);
      activeStrumRef.current = result.strumHandle;
      activePhraseStopRef.current = result.phraseHandle;
      songMetRef.current = result.metNodes;
      if (result.phrase) {
        setAutoPlayPhrase(result.phrase);
        setPhraseAnimKey(k => k + 1);
      } else if (!isPlaybackStart) {
        setAutoPlayPhrase(null);
      }
    }
    wasAutoAdvanceRef.current = false;

    const step = seq[playPosRef.current];
    if (!step) return;

    const targetAt = chordStartRef.current + (60000 / bpm) * step.beats;
    const delay = Math.max(0, targetAt - performance.now());

    // Pre-schedule next chord's audio on the Web Audio timeline (look-ahead)
    let nextPos = (playPosRef.current + 1) % seq.length;
    // Loop boundary check: only wrap when EXITING the loop range
    // (i.e. current position is inside the loop but next would leave it)
    const lr = loopRangeRef.current;
    if (lr && seq[nextPos]) {
      const curInLoop = step.measureFlatIdx >= lr.start && step.measureFlatIdx <= lr.end;
      const nextInLoop = seq[nextPos].measureFlatIdx >= lr.start && seq[nextPos].measureFlatIdx <= lr.end;
      if (curInLoop && !nextInLoop) {
        const loopStartPos = seq.findIndex(s => s.measureFlatIdx >= lr.start && s.measureFlatIdx <= lr.end);
        if (loopStartPos >= 0) nextPos = loopStartPos;
      }
    }
    const nextChordIdx = seq[nextPos].chordIdx;
    const audioStartAt = ctx.currentTime + delay / 1000;
    // On loop, carry total beats so metronome accent stays consistent
    const cumBeatsNext = nextPos === 0
      ? computeCumBeats(seq, seq.length)
      : computeCumBeats(seq, nextPos);
    const nextResult = scheduleChordAudio(nextChordIdx, activeProg, audioStartAt, cumBeatsNext);
    pendingNextRef.current = nextResult;

    const timer = setTimeout(() => {
      wasAutoAdvanceRef.current = true;
      chordStartRef.current = targetAt;
      playPosRef.current = nextPos;

      // Transfer pre-scheduled handles from pendingNextRef to active refs
      activeStrumRef.current?.stop();
      activePhraseStopRef.current?.stop();
      stopSongMetronome();
      activeStrumRef.current = pendingNextRef.current?.strumHandle ?? null;
      activePhraseStopRef.current = pendingNextRef.current?.phraseHandle ?? null;
      songMetRef.current = pendingNextRef.current?.metNodes ?? [];
      const nextPhrase = pendingNextRef.current?.phrase ?? null;
      pendingNextRef.current = null;

      if (nextPhrase) {
        setAutoPlayPhrase(nextPhrase);
        setPhraseAnimKey(k => k + 1);
      } else {
        setAutoPlayPhrase(null);
      }

      setActiveChordIdx(nextChordIdx);
      setAdvanceTick(t => t + 1);  // ensure effect re-runs even if chordIdx unchanged (repeat)
    }, delay);

    return () => {
      clearTimeout(timer);
      // If timeout hasn't fired yet, cancel the pre-scheduled next chord audio
      cancelPendingNext();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, activeChordIdx, bpm, activeProg, progMode, isCountingIn, advanceTick]);

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

  // --- Manual phrase playback (preview / Play button) ---
  const manualPhraseRef = useRef<{ stop: () => void } | null>(null);
  const manualPhraseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justStartedPlayRef = useRef(false);
  const [phraseAnimKey, setPhraseAnimKey] = useState(0);

  function stopPreviewMetronome() {
    for (const osc of previewMetRef.current) { try { osc.stop(); } catch { /* already stopped */ } }
    previewMetRef.current = [];
  }

  function stopSongMetronome() {
    for (const osc of songMetRef.current) { try { osc.stop(); } catch { /* already stopped */ } }
    songMetRef.current = [];
  }

  function stopCountIn() {
    if (countInTimerRef.current) {
      clearTimeout(countInTimerRef.current);
      countInTimerRef.current = null;
    }
    for (const osc of countInNodesRef.current) { try { osc.stop(); } catch { /* already stopped */ } }
    countInNodesRef.current = [];
    setIsCountingIn(false);
  }

  function cancelPendingNext() {
    if (pendingNextRef.current) {
      pendingNextRef.current.strumHandle?.stop();
      pendingNextRef.current.phraseHandle?.stop();
      for (const osc of pendingNextRef.current.metNodes) { try { osc.stop(); } catch {} }
      pendingNextRef.current = null;
    }
  }

  // Queue a phrase for playback. Audio is NOT scheduled here — the start effect
  // fires after React renders and starts phrase + strum + metronome at the same
  // Web Audio timestamp, guaranteeing perfect sync regardless of render latency.
  const playPhraseAudio = useCallback((phrase: GeneratedPhrase, switchToVPart?: GeneratedPhrase | null, iiBeats?: number) => {
    manualPhraseRef.current?.stop();
    if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
    previewStrumRef.current.forEach(s => s.stop());
    previewStrumRef.current = [];
    stopPreviewMetronome();
    clearIiVSwitchTimer();
    setIiVDisplayPhrase(null);
    justStartedPlayRef.current = true;
    pendingPhraseRef.current = { phrase, switchToVPart, iiBeats };
    setIsPhraseAudioPlaying(true);
    setPhraseAnimKey(k => k + 1);
  }, []);

  // Phrase-start effect: fires after render, starts all audio at one ctx.currentTime.
  // Runs every render but no-ops immediately when no pending phrase exists.
  useEffect(() => {
    const pending = pendingPhraseRef.current;
    if (!pending) return;
    pendingPhraseRef.current = null;

    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const startAt = ctx.currentTime;
    const { phrase, switchToVPart, iiBeats } = pending;
    const eighthDur = (60 / bpm) / 2;

    // Phrase audio
    const result = schedulePhrase(ctx, phrase, startAt, eighthDur, noteVolumeRef.current, 99, instrumentRef.current, swingEnabledRef.current ? swingAmountRef.current : 0, bpm);
    manualPhraseRef.current = result;

    // Chord strum (same startAt)
    if (chordAudioOnRef.current) {
      if (progMode && activeProg) {
        const strumNotes = getStrumNotes(activeChordIdx, activeProg.chords, activeProg.songKey);
        if (strumNotes.length > 0) {
          previewStrumRef.current.push(playChordStrum(ctx, strumNotes, chordVolumeRef.current, startAt));
        }
      } else if (selPos && selPos.instances.length > 0) {
        const inst = selPos.instances[0];
        const ct = new Set(mode.chordTones);
        const strumNotes: { stringIdx: number; fret: number }[] = [];
        for (let s = 5; s >= 0; s--) {
          const strNotes = inst.strings[s];
          if (!strNotes) continue;
          const ctNote = strNotes.find(([n]) => ct.has(n));
          if (ctNote) strumNotes.push({ stringIdx: s, fret: ctNote[1] });
          if (strumNotes.length >= 4) break;
        }
        if (strumNotes.length > 0) {
          previewStrumRef.current.push(playChordStrum(ctx, strumNotes, chordVolumeRef.current, startAt));
        }
      }
    }

    // Metronome: schedule ALL clicks on the Web Audio timeline for the phrase duration.
    // This avoids handing off to the metronome setInterval effect, which would drift
    // by the React render latency between this effect and the metronome effect.
    stopPreviewMetronome();
    if (metVolumeRef.current > 0) {
      const beatSec = 60 / bpm;
      const totalBeats = Math.ceil(result.totalDuration / beatSec) + 1;
      for (let b = 0; b < totalBeats; b++) {
        const osc = playClick(b % 4 === 0, ctx, metVolumeRef.current, startAt + b * beatSec);
        previewMetRef.current.push(osc);
      }
    }

    // Overflow strums: schedule chord strums for all subsequent chords the lick spans
    if (switchToVPart && activeProg) {
      const layout = getChartLayout(activeProg);
      const firstChordBeats = iiBeats ?? 4;
      const switchSec = firstChordBeats * 2 * eighthDur;
      const switchDelay = switchSec * 1000;

      // Schedule strums for all overflow chords (2nd, 3rd, ...)
      if (chordAudioOnRef.current) {
        const totalSec = result.totalDuration;
        let accBeats = firstChordBeats; // quarter-note beats accumulated
        let ci = activeChordIdx + 1;
        while (ci < activeProg.chords.length) {
          const strumSec = accBeats * 2 * eighthDur; // convert quarter→eighth→seconds
          if (strumSec >= totalSec) break;
          const strumNotes = getStrumNotes(ci, activeProg.chords, activeProg.songKey);
          if (strumNotes.length > 0) {
            previewStrumRef.current.push(playChordStrum(ctx, strumNotes, chordVolumeRef.current, startAt + strumSec));
          }
          accBeats += getChordBeatCount(layout, ci);
          ci++;
        }
      }

      // setTimeout for React state update (fretboard display switch at 2nd chord)
      iiVSwitchTimerRef.current = setTimeout(() => {
        justStartedPlayRef.current = true;
        setIiVDisplayPhrase(switchToVPart);
        setPhraseAnimKey(k => k + 1);
        iiVSwitchTimerRef.current = null;
      }, switchDelay);
    }

    // Completion timer
    manualPhraseTimer.current = setTimeout(() => {
      manualPhraseRef.current = null;
      stopPreviewMetronome();
      setIsPhraseAudioPlaying(false);
    }, result.totalDuration * 1000 + 200);
  }, [phraseAnimKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop playback when activePhrase changes (e.g. chord navigation).
  // Skipped on the render that started playback (justStartedPlayRef guard).
  useEffect(() => {
    if (justStartedPlayRef.current) {
      justStartedPlayRef.current = false;
      return;
    }
    manualPhraseRef.current?.stop();
    manualPhraseRef.current = null;
    if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
    previewStrumRef.current.forEach(s => s.stop());
    previewStrumRef.current = [];
    stopPreviewMetronome();
    setIsPhraseAudioPlaying(false);
  }, [activePhrase]);


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
                onSelectProg={(idx) => { setActiveProgIdx(idx); setActiveChordIdx(0); setIsPlaying(false); setBpm(progressions[idx]?.bpm ?? 120); setLoopRange(progressions[idx]?.loopRange ?? null); }}
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

                        // Assign lick to current chord, overflow to subsequent chords if needed
                        if (lick.beats > chordBeats && activeChordIdx + 1 < prog.chords.length) {
                          let remaining = lick.beats;
                          let offset = 0;
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
                            };
                            offset += assignBeats;
                            remaining -= assignBeats;
                            ci++;
                          }
                        } else {
                          prog.chords[activeChordIdx] = {
                            ...prog.chords[activeChordIdx],
                            lickId: lick.id,
                            lickHighOctave: curOctave,
                            lickHighInstance: curInst,
                            lickBeatOffset: undefined,
                          };
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
                      const isOverflow = lick.beats > chordBeats;
                      const eff = effectiveAll[activeChordIdx];
                      if (eff) {
                        const { positions: posArr } = resolveChordPositions(chord.rootName, eff.modeIdx);
                        const pos = posArr.find(p => p.id === eff.posId);
                        if (pos) {
                          const phrase = buildPhraseForLick(lick, chord.rootName, pos, eff.modeIdx, ts, curOctave, curInst);
                          if (isOverflow) {
                            const nextSlice = sliceLick(lick, chordBeats, Math.min(chordBeats, lick.beats - chordBeats));
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
                              const nextSlice = sliceLick(lick, chordBeats, Math.min(chordBeats, lick.beats - chordBeats));
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
                    onStop={() => {
                      manualPhraseRef.current?.stop();
                      manualPhraseRef.current = null;
                      if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
                      previewStrumRef.current.forEach(s => s.stop());
                      previewStrumRef.current = [];
                      stopPreviewMetronome();
                      clearIiVSwitchTimer();
                      setIiVDisplayPhrase(null);
                      setIsPhraseAudioPlaying(false);
                    }}
                    onClear={() => {
                      setSelectedLickIdx(null);
                      const copy = [...progressions];
                      const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                      const curChord = prog.chords[activeChordIdx];
                      prog.chords[activeChordIdx] = { ...curChord, lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined, lickBeatOffset: undefined };
                      // Linked clear: if this was the originator, clear all continuations
                      if (curChord?.lickBeatOffset === 0) {
                        for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
                          const c = prog.chords[i];
                          if (c?.lickId === curChord.lickId && c?.lickBeatOffset != null && c.lickBeatOffset > 0) {
                            prog.chords[i] = { ...c, lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined, lickBeatOffset: undefined };
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
                        if (curLickId && prog.chords[activeChordIdx].lickBeatOffset != null) {
                          for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
                            const c = prog.chords[i];
                            if (c?.lickId === curLickId && c?.lickBeatOffset != null && c.lickBeatOffset > 0) {
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
                        if (curLickId && prog.chords[activeChordIdx].lickBeatOffset != null) {
                          for (let i = activeChordIdx + 1; i < prog.chords.length; i++) {
                            const c = prog.chords[i];
                            if (c?.lickId === curLickId && c?.lickBeatOffset != null && c.lickBeatOffset > 0) {
                              prog.chords[i] = { ...c, lickHighInstance: next };
                            } else break;
                          }
                        }
                        copy[activeProgIdx] = prog;
                        handleSaveProgressions(copy);
                        return next;
                      });
                    }}
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
          phraseAnimSpeed={isPhraseAudioPlaying || isPlaying
            ? Math.round((60000 / bpm) / 2)
            : 0}
          swingAmount={swingEnabled ? swingAmount : 0}
          bpm={bpm}
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
