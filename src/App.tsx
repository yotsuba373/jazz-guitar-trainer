import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { LabelMode, RootName, Progression, ChordNotationPrefs, ChartLayout, SongKey, ChordSlot, ApproachType, GeneratedPhrase, PhraseConfig, PhraseNote, PhraseContour, InstrumentType, PoolNote, LickDB, LickEntry } from './types';
import { MODE_TEMPLATES, ROOTS, MODE_COLORS, OPEN_STRINGS } from './constants';
import {
  buildFretMap, generatePositions, generateDimPositions, resolveMode,
  loadProgressions, saveProgressions, QUALITY_TO_MODES,
  computeEffectiveSelections,
  formatChordSymbol, loadChordNotationPrefs, saveChordNotationPrefs,
  getChartLayout, buildChordRows,
  getGuideTones, findNoteLocations, classifyResolution,
  findVoicingsInPosition,
  playChordStrum,
  generatePhraseRule, buildNotePool, schedulePhrase,
  loadLickDB, QUALITY_TO_LICK_TYPE, buildLickContext, getTransposeSemitones,
  lickToGeneratedPhrase,
} from './utils';
import { Fretboard } from './components/Fretboard';
import { RootSelector, ModeSelector, PositionSelector, OptionBar, PhraseControls, PhraseAnalysisPanel, GlobalAudioControls, LickPanel } from './components/Controls';
import { PositionGrid } from './components/PositionGrid';
import { ProgressionEditor, ProgressionPlayer } from './components/Progression';
import { Footer } from './components/Footer';

function playClick(accent: boolean, ctx: AudioContext, volume: number) {
  if (ctx.state === 'suspended') ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = accent ? 1200 : 800;
  gain.gain.setValueAtTime(accent ? volume * 3 : volume * 1.5, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.04);
}

/** Build a flat playback sequence respecting section repeats and volta endings. */
function buildPlaybackSeq(layout: ChartLayout): { chordIdx: number; beats: number }[] {
  const seq: { chordIdx: number; beats: number }[] = [];
  function addMeasure(m: { chordIndices: number[]; beatWidths?: number[] }) {
    const count = m.chordIndices.length;
    const bwSum = m.beatWidths ? m.beatWidths.reduce((a, b) => a + b, 0) : count;
    m.chordIndices.forEach((ci, i) => {
      const bw = m.beatWidths?.[i] ?? 1;
      seq.push({ chordIdx: ci, beats: (bw / bwSum) * 4 });
    });
  }
  for (const section of layout.sections) {
    const passes = (section.repeats ?? 0) + 1;
    for (let pass = 0; pass < passes; pass++) {
      for (const m of section.measures) addMeasure(m);
      if (section.endings?.[pass]) {
        for (const m of section.endings[pass]) addMeasure(m);
      }
    }
  }
  return seq;
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

  // Phrase generator state
  const [showPhrase, setShowPhrase] = useState(false);
  const [phraseApproachTypes, setPhraseApproachTypes] = useState<ApproachType[]>(
    ['single-below', 'single-above', 'enclosure']
  );
  const [phraseHistory, setPhraseHistory] = useState<GeneratedPhrase[]>([]);
  const [activePhraseIdx, setActivePhraseIdx] = useState(0);
  const [phraseAnimSpeed, setPhraseAnimSpeed] = useState(() =>
    Number(localStorage.getItem('phraseAnimSpeed')) || 350
  );

  // Progression mode state
  const [progMode, setProgMode] = useState(false);
  const [progressions, setProgressions] = useState<Progression[]>(() => loadProgressions());
  const [activeProgIdx, setActiveProgIdx] = useState(0);
  const [activeChordIdx, setActiveChordIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [isMetronomeOn, setIsMetronomeOn] = useState(false);
  const [metVolume, setMetVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('metVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const metBeatRef = useRef(0);
  const [metSyncKey, setMetSyncKey] = useState(0);
  const metVolumeRef = useRef(metVolume);
  // Chord audio state
  const [chordAudioOn, setChordAudioOn] = useState(false);
  const [chordVolume, setChordVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('chordVolume') ?? '');
    return isNaN(saved) ? 0.5 : saved;
  });
  const chordVolumeRef = useRef(chordVolume);
  const chordAudioOnRef = useRef(chordAudioOn);
  const activeStrumRef = useRef<{ stop: () => void } | null>(null);
  // Drift-free auto-advance: track ideal chord start time + repeat position
  const chordStartRef = useRef(0);
  const wasAutoAdvanceRef = useRef(false);
  const playPosRef = useRef(0);

  // Phrase auto-play state (progression mode)
  const [phraseAutoPlay, setPhraseAutoPlay] = useState(false);
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
  const [swingEnabled, setSwingEnabled] = useState(
    () => localStorage.getItem('swingEnabled') === 'true'
  );
  const [swingAmount, setSwingAmount] = useState(
    () => Number(localStorage.getItem('swingAmount')) || 0.2
  );
  const swingEnabledRef = useRef(swingEnabled);
  const swingAmountRef = useRef(swingAmount);
  const phraseAutoPlayRef = useRef(phraseAutoPlay);
  const activePhraseStopRef = useRef<{ stop: () => void } | null>(null);
  const [autoPlayPhrase, setAutoPlayPhrase] = useState<GeneratedPhrase | null>(null);
  // Lick practice state
  const [lickDB, setLickDB] = useState<LickDB | null>(null);
  const [selectedLickIdx, setSelectedLickIdx] = useState<number | null>(null);
  // Refs for on-the-fly phrase chaining across chords
  const prevLastNoteRef = useRef<PhraseNote | undefined>(undefined);
  const prevContourRef = useRef<PhraseContour | undefined>(undefined);
  const prevMotifRef = useRef<number[] | undefined>(undefined);
  const prevResolvedStartRef = useRef<PhraseConfig['resolvedStart'] | undefined>(undefined);

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

  // Phrase beat count (normal mode) and goal selection
  const [beatCount, setBeatCount] = useState<2 | 3 | 4>(4);
  const [goalSelectMode, setGoalSelectMode] = useState(false);
  const [selectedGoalNote, setSelectedGoalNote] = useState<PhraseConfig['goalNoteOverride'] | null>(null);

  // Phrase generator: available when single position selected, not overlay, not dim scale
  const canShowPhrase = selPosIds.length === 1 && !overlay && !is8Note;
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

  // Clear phrase history when context changes
  useEffect(() => {
    setPhraseHistory([]);
    setActivePhraseIdx(0);
  }, [rootName, modeIdx, selPosIds, activeChordIdx]);

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

  // Filtered licks for the active chord in progression mode
  const filteredLicks = useMemo((): { licks: LickEntry[]; lickType: string } => {
    if (!lickDB || !progMode || !activeProg) return { licks: [], lickType: '' };
    const chord = activeProg.chords[activeChordIdx];
    if (!chord) return { licks: [], lickType: '' };
    const lickType = QUALITY_TO_LICK_TYPE[chord.quality];
    if (!lickType) return { licks: [], lickType: chord.quality };
    return { licks: lickDB[lickType] ?? [], lickType };
  }, [lickDB, progMode, activeProg, activeChordIdx]);

  // Reset lick selection when chord changes
  useEffect(() => {
    setSelectedLickIdx(null);
  }, [activeChordIdx]);

  // Build GeneratedPhrase from selected lick
  const activeLickPhrase = useMemo((): GeneratedPhrase | null => {
    if (selectedLickIdx == null || !filteredLicks.licks[selectedLickIdx]) return null;
    if (!progMode || !activeProg) return null;
    const chord = activeProg.chords[activeChordIdx];
    if (!chord) return null;

    const lick = filteredLicks.licks[selectedLickIdx];
    const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
    const ctx = buildLickContext(lick, chord.quality, chord.rootName, rootSemi);
    if (!ctx) return null;

    // If user has changed mode/position, rebuild with current selections
    const eff = effectiveAll[activeChordIdx];
    if (eff) {
      const userModeIdx = eff.modeIdx;
      const userPosId = eff.posId;
      const userTemplate = MODE_TEMPLATES[userModeIdx];
      const userMode = resolveMode(chord.rootName, userTemplate);
      if (userMode.notes.length <= 7) {
        const userFretMap = buildFretMap(userMode.semi, userMode.notes);
        const userPositions = generatePositions(userFretMap, userMode.notes);
        const userPos = userPositions.find(p => p.id === userPosId);
        if (userPos) {
          const userPool = buildNotePool(userPos, userMode, userFretMap, true);
          const transposeSemitones = getTransposeSemitones(chord.quality, rootSemi);
          return lickToGeneratedPhrase(
            lick, userPosId, userTemplate.key, chord.rootName, userPool, transposeSemitones,
          );
        }
      }
    }

    return ctx.phrase;
  }, [selectedLickIdx, filteredLicks.licks, progMode, activeProg, activeChordIdx, effectiveAll]);

  const activePhrase = useMemo(() => {
    // Lick phrase takes priority in progression mode
    if (activeLickPhrase) return activeLickPhrase;
    // During auto-play in progression mode, show the on-the-fly generated phrase
    if (phraseAutoPlay && progMode && autoPlayPhrase)
      return autoPlayPhrase;
    // Normal manual mode
    if (showPhrase && phraseHistory.length > 0)
      return phraseHistory[activePhraseIdx] ?? null;
    return null;
  }, [activeLickPhrase, phraseAutoPlay, progMode, autoPlayPhrase, showPhrase, phraseHistory, activePhraseIdx]);

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
  useEffect(() => { chordAudioOnRef.current = chordAudioOn; }, [chordAudioOn]);

  // Note volume ref + persistence (covers fretboard clicks + phrase playback)
  useEffect(() => { noteVolumeRef.current = noteVolume; localStorage.setItem('noteVolume', String(noteVolume)); }, [noteVolume]);
  useEffect(() => { instrumentRef.current = instrument; localStorage.setItem('phraseInstrument', instrument); }, [instrument]);
  useEffect(() => { swingEnabledRef.current = swingEnabled; localStorage.setItem('swingEnabled', String(swingEnabled)); }, [swingEnabled]);
  useEffect(() => { swingAmountRef.current = swingAmount; localStorage.setItem('swingAmount', String(swingAmount)); }, [swingAmount]);
  useEffect(() => { phraseAutoPlayRef.current = phraseAutoPlay; }, [phraseAutoPlay]);

  // Auto-enable showPhrase when phraseAutoPlay is turned on
  useEffect(() => { if (phraseAutoPlay && !showPhrase) setShowPhrase(true); }, [phraseAutoPlay]);
  // Turn off phraseAutoPlay when leaving progression mode
  useEffect(() => { if (!progMode) setPhraseAutoPlay(false); }, [progMode]);

  // Generate a phrase on-the-fly for a given chord index (used during auto-advance)
  function generatePhraseForChord(
    chordIdx: number,
    prog: Progression,
    step: { beats: number },
  ): GeneratedPhrase | null {
    const chords = prog.chords;
    const effAll = computeEffectiveSelections(chords, prog.songKey);
    const chord = chords[chordIdx];
    const eff = effAll[chordIdx];
    if (!chord || !eff || !QUALITY_TO_MODES[chord.quality]) return null;

    const chordMode = resolveMode(chord.rootName, MODE_TEMPLATES[eff.modeIdx]);
    if (chordMode.notes.length > 7) return null;

    const chordFretMap = buildFretMap(chordMode.semi, chordMode.notes);
    const positions = generatePositions(chordFretMap, chordMode.notes);
    const pos = positions.find(p => p.id === eff.posId);
    if (!pos) return null;

    let targetThirdNote: string | undefined;
    let nextChordContext: PhraseConfig['nextChordContext'] | undefined;
    let nextChordPool: PoolNote[] | undefined;
    let nextPosFretRange: { fretMin: number; fretMax: number } | undefined;
    const nextIdx = (chordIdx + 1) % chords.length;
    if (nextIdx !== chordIdx) {
      const nextChord = chords[nextIdx];
      const nextEff = effAll[nextIdx];
      if (nextChord && nextEff && QUALITY_TO_MODES[nextChord.quality]) {
        const nextMode = resolveMode(nextChord.rootName, MODE_TEMPLATES[nextEff.modeIdx]);
        if (nextMode.notes.length <= 7) {
          const gt = getGuideTones(nextMode);
          targetThirdNote = gt.third;
          nextChordContext = {
            thirdNote: gt.third,
            seventhNote: gt.seventh,
            rootNote: nextMode.notes[0],
            quality: nextChord.quality,
          };
          // Build next chord's note pool for VL resolution
          const nextFretMap = buildFretMap(nextMode.semi, nextMode.notes);
          const nextPositions = generatePositions(nextFretMap, nextMode.notes);
          const nextPos = nextPositions.find(p => p.id === nextEff.posId);
          if (nextPos) {
            nextChordPool = buildNotePool(nextPos, nextMode, nextFretMap, false);
            const nextInst = nextPos.instances[0];
            if (nextInst) {
              nextPosFretRange = { fretMin: nextInst.fretMin, fretMax: nextInst.fretMax };
            }
          }
        }
      }
    }

    const phraseLength = Math.min(8, Math.max(4, Math.round(step.beats * 2)));
    const pln = prevLastNoteRef.current;
    const resolvedStart = prevResolvedStartRef.current;
    const config: PhraseConfig = {
      approachTypes: phraseApproachTypes,
      resolvedStart: resolvedStart ?? undefined,
      startHint: resolvedStart ? undefined : (pln ? {
        noteName: pln.noteName,
        stringIdx: pln.stringIdx,
        fret: pln.fret,
        semitone: pln.semitone,
      } : undefined),
      phraseLength,
      prevContour: prevContourRef.current,
      nextChordContext,
      prevMotif: prevMotifRef.current,
    };

    const phrase = generatePhraseRule(pos, chordMode, chordFretMap, config, targetThirdNote, nextChordPool, nextPosFretRange);
    if (phrase) {
      prevLastNoteRef.current = phrase.notes[phrase.notes.length - 1];
      prevContourRef.current = phrase.config.contour;
      prevMotifRef.current = phrase.motif;
      prevResolvedStartRef.current = phrase.resolvedGoalForNext;
    } else {
      prevLastNoteRef.current = undefined;
      prevContourRef.current = undefined;
      prevMotifRef.current = undefined;
      prevResolvedStartRef.current = undefined;
    }
    return phrase;
  }

  // Reset chaining refs when auto-play is toggled off
  useEffect(() => {
    if (!phraseAutoPlay) {
      setAutoPlayPhrase(null);
      prevLastNoteRef.current = undefined;
      prevContourRef.current = undefined;
      prevMotifRef.current = undefined;
      prevResolvedStartRef.current = undefined;
    }
  }, [phraseAutoPlay]);

  // BPM auto-advance: drift-free, respects section repeats and volta endings
  useEffect(() => {
    if (!isPlaying || !progMode || !activeProg) {
      chordStartRef.current = 0;
      wasAutoAdvanceRef.current = false;
      activeStrumRef.current?.stop();
      activeStrumRef.current = null;
      activePhraseStopRef.current?.stop();
      activePhraseStopRef.current = null;
      return;
    }
    const seq = buildPlaybackSeq(getChartLayout(activeProg));
    if (!seq.length) return;

    // On playback start, BPM change, or user navigation: find position in sequence.
    // On auto-advance: playPosRef was already incremented in the timeout callback.
    if (!wasAutoAdvanceRef.current || chordStartRef.current === 0) {
      const isPlaybackStart = chordStartRef.current === 0;
      const pos = seq.findIndex(s => s.chordIdx === activeChordIdx);
      playPosRef.current = pos >= 0 ? pos : 0;
      chordStartRef.current = performance.now();

      // Play strum for the initial chord on playback start
      if (isPlaybackStart && chordAudioOnRef.current) {
        activeStrumRef.current?.stop();
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const strumNotes = getStrumNotes(activeChordIdx, activeProg.chords, activeProg.songKey);
        if (strumNotes.length > 0) {
          activeStrumRef.current = playChordStrum(ctx, strumNotes, chordVolumeRef.current, ctx.currentTime);
        }
      }
      // Generate + schedule phrase for initial chord on playback start
      if (isPlaybackStart && phraseAutoPlayRef.current) {
        activePhraseStopRef.current?.stop();
        prevLastNoteRef.current = undefined;
        prevContourRef.current = undefined;
        prevMotifRef.current = undefined;
        prevResolvedStartRef.current = undefined;
        const initStep = seq[playPosRef.current];
        const phrase = initStep ? generatePhraseForChord(activeChordIdx, activeProg, initStep) : null;
        if (phrase) {
          setAutoPlayPhrase(phrase);
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
          const ctx = audioCtxRef.current;
          const eighthDur = (60 / bpm) / 2;
          activePhraseStopRef.current = schedulePhrase(ctx, phrase, ctx.currentTime, eighthDur, noteVolumeRef.current, 99, instrumentRef.current, swingEnabledRef.current ? swingAmountRef.current : 0, bpm);
        }
      }
    }
    wasAutoAdvanceRef.current = false;

    const step = seq[playPosRef.current];
    if (!step) return;

    const targetAt = chordStartRef.current + (60000 / bpm) * step.beats;
    const delay = Math.max(0, targetAt - performance.now());

    const timer = setTimeout(() => {
      wasAutoAdvanceRef.current = true;
      chordStartRef.current = targetAt;
      const nextPos = (playPosRef.current + 1) % seq.length;
      playPosRef.current = nextPos;
      const nextChordIdx = seq[nextPos].chordIdx;

      // Play chord strum on auto-advance
      if (chordAudioOnRef.current && activeProg) {
        activeStrumRef.current?.stop();
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const strumNotes = getStrumNotes(nextChordIdx, activeProg.chords, activeProg.songKey);
        if (strumNotes.length > 0) {
          activeStrumRef.current = playChordStrum(ctx, strumNotes, chordVolumeRef.current, ctx.currentTime);
        }
      }

      // Generate + schedule phrase for the next chord on auto-advance
      if (phraseAutoPlayRef.current && activeProg) {
        activePhraseStopRef.current?.stop();
        const nextStep = seq[nextPos];
        const phrase = generatePhraseForChord(nextChordIdx, activeProg, nextStep);
        if (phrase) {
          setAutoPlayPhrase(phrase);
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
          const ctx = audioCtxRef.current;
          const eighthDur = (60 / bpm) / 2;
          activePhraseStopRef.current = schedulePhrase(ctx, phrase, ctx.currentTime, eighthDur, noteVolumeRef.current, 99, instrumentRef.current, swingEnabledRef.current ? swingAmountRef.current : 0, bpm);
        }
      }

      setActiveChordIdx(nextChordIdx);
    }, delay);
    return () => clearTimeout(timer);
  }, [isPlaying, activeChordIdx, bpm, activeProg, progMode]);

  // Metronome: progression mode uses beat-grid alignment; normal mode uses simple interval.
  useEffect(() => {
    if (!isMetronomeOn) return;

    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    const beatMs = 60000 / bpm;

    let delayToNext = 0;

    // Progression mode with active playback: grid-aligned metronome
    if (isPlaying && progMode && activeProg) {
      const seq = buildPlaybackSeq(getChartLayout(activeProg));
      let cumBeats = 0;
      for (let i = 0; i < playPosRef.current && i < seq.length; i++) {
        cumBeats += seq[i].beats;
      }
      const elapsedMs = chordStartRef.current > 0 ? performance.now() - chordStartRef.current : 0;
      const globalBeat = cumBeats + elapsedMs / beatMs;

      const nextBeat = Math.ceil(globalBeat - 15 / beatMs);
      metBeatRef.current = nextBeat;
      delayToNext = Math.max(0, (nextBeat - globalBeat) * beatMs);
    } else {
      // Normal mode (or prog mode not playing): simple metronome
      metBeatRef.current = 0;
      delayToNext = 0;
    }

    // Wait until the next beat, then fire + start interval
    let intervalId: ReturnType<typeof setInterval>;
    const timerId = setTimeout(() => {
      const accent = metBeatRef.current % 4 === 0;
      playClick(accent, ctx, metVolumeRef.current);
      metBeatRef.current++;
      intervalId = setInterval(() => {
        const a = metBeatRef.current % 4 === 0;
        playClick(a, ctx, metVolumeRef.current);
        metBeatRef.current++;
      }, beatMs);
    }, delayToNext);
    return () => { clearTimeout(timerId); clearInterval(intervalId); };
  }, [isPlaying, isMetronomeOn, progMode, bpm, activeProg, metSyncKey]);

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

  // Manual phrase playback (single phrase, not auto-play)
  const manualPhraseRef = useRef<{ stop: () => void } | null>(null);
  const manualPhraseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPhraseAudioPlaying, setIsPhraseAudioPlaying] = useState(false);
  const [phraseAnimKey, setPhraseAnimKey] = useState(0);

  // Play a phrase with audio + animation sync
  const playPhraseAudio = useCallback((phrase: GeneratedPhrase) => {
    // Stop any current playback
    manualPhraseRef.current?.stop();
    if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);

    // Prevent the activePhrase-change effect from killing this playback
    justStartedPlayRef.current = true;

    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    // When metronome is on, sync phrase to BPM; otherwise use speed slider
    const eighthDur = isMetronomeOn
      ? (60 / bpm) / 2
      : Math.max(0.1, phraseAnimSpeed / 1000);
    const result = schedulePhrase(ctx, phrase, ctx.currentTime, eighthDur, noteVolumeRef.current, 99, instrumentRef.current, swingEnabledRef.current ? swingAmountRef.current : 0, bpm);
    manualPhraseRef.current = result;
    setIsPhraseAudioPlaying(true);
    setPhraseAnimKey(k => k + 1);
    manualPhraseTimer.current = setTimeout(() => {
      manualPhraseRef.current = null;
      setIsPhraseAudioPlaying(false);
    }, result.totalDuration * 1000 + 200);

    // Restart metronome interval to sync downbeat with phrase start
    if (isMetronomeOn) setMetSyncKey(k => k + 1);

    // Normal mode chord strum on phrase play
    if (!progMode && chordAudioOnRef.current) {
      activeStrumRef.current?.stop();
      // Build strum from current position's chord tones
      if (selPos && selPos.instances.length > 0) {
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
          activeStrumRef.current = playChordStrum(ctx, strumNotes, chordVolumeRef.current, ctx.currentTime);
        }
      }
    }
  }, [phraseAnimSpeed, progMode, selPos, mode.chordTones, isMetronomeOn, bpm]);

  const handlePlayPhrase = useCallback(() => {
    // Toggle off if already playing
    if (manualPhraseRef.current) {
      manualPhraseRef.current.stop();
      manualPhraseRef.current = null;
      if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
      setIsPhraseAudioPlaying(false);
      return;
    }
    if (!activePhrase) return;
    playPhraseAudio(activePhrase);
  }, [activePhrase, playPhraseAudio]);

  // Stop manual phrase on context change — but skip if we just started playback
  // (Generate triggers both activePhrase change and playPhraseAudio in the same tick)
  const justStartedPlayRef = useRef(false);
  useEffect(() => {
    if (justStartedPlayRef.current) {
      justStartedPlayRef.current = false;
      return;
    }
    manualPhraseRef.current?.stop();
    manualPhraseRef.current = null;
    if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
    setIsPhraseAudioPlaying(false);
  }, [activePhrase]);

  const handleNoteClick = useCallback((stringIdx: number, fret: number) => {
    // Goal note selection mode
    if (goalSelectMode && canShowPhrase && selPos) {
      const inst = selPos.instances[0];
      if (fret >= inst.fretMin - 1 && fret <= inst.fretMax + 1) {
        const semi = (OPEN_STRINGS[stringIdx] + fret) % 12;
        const CHROMATIC_NAMES = ['C', 'D\u266D', 'D', 'E\u266D', 'E', 'F', 'G\u266D', 'G', 'A\u266D', 'A', 'B\u266D', 'B'];
        const noteName = CHROMATIC_NAMES[semi];
        setSelectedGoalNote({ noteName, stringIdx, fret, semitone: semi });
      }
      return;
    }
  }, [goalSelectMode, canShowPhrase, selPos]);

  const handleGeneratePhrase = useCallback(() => {
    if (!canShowPhrase || selPosIds.length !== 1) return;
    const pos = allPos.find(p => p.id === selPosIds[0]);
    if (!pos) return;

    // In progression mode, compute next chord's 3rd as target
    let targetThirdNote: string | undefined;
    let nextChordCtx: PhraseConfig['nextChordContext'] | undefined;
    if (progMode && activeProg) {
      const nextChord = activeProg.chords[activeChordIdx + 1];
      const nextEff = effectiveAll[activeChordIdx + 1];
      if (nextChord && nextEff && QUALITY_TO_MODES[nextChord.quality]) {
        const nextMode = resolveMode(nextChord.rootName, MODE_TEMPLATES[nextEff.modeIdx]);
        const gt = getGuideTones(nextMode);
        targetThirdNote = gt.third;
        nextChordCtx = {
          thirdNote: gt.third,
          seventhNote: gt.seventh,
          rootNote: nextMode.notes[0],
          quality: nextChord.quality,
        };
      }
    }

    const config: PhraseConfig = {
      approachTypes: phraseApproachTypes,
      nextChordContext: nextChordCtx,
      ...(!progMode && { beatCount }),
      ...(selectedGoalNote && { goalNoteOverride: selectedGoalNote }),
    };
    const phrase = generatePhraseRule(pos, mode, fretMap, config, targetThirdNote);
    if (!phrase) return;

    setPhraseHistory(prev => {
      const next = [...prev, phrase];
      if (next.length > 20) next.shift();
      return next;
    });
    setActivePhraseIdx(
      Math.min(phraseHistory.length, 19)
    );

    // Auto-play the generated phrase
    playPhraseAudio(phrase);
  }, [canShowPhrase, selPosIds, allPos, mode, fretMap, phraseApproachTypes, progMode, activeProg, activeChordIdx, effectiveAll, phraseHistory.length, beatCount, selectedGoalNote, playPhraseAudio]);

  function getLabel(nn: string): string {
    return labelMode === 'degree' ? (deg[nn] || nn) : nn;
  }

  return (
    <div className="bg-bg-root text-text-primary min-h-screen font-mono p-4">
      <div className="max-w-[1040px] mx-auto" style={{ transform: 'translateZ(0)' }}>
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
            className="rounded cursor-pointer text-[10px] font-mono px-2.5 h-[24px] inline-flex items-center"
            style={{
              border: `1px solid ${!progMode ? '#FFF' : '#444'}`,
              background: !progMode ? '#3a3a3a' : '#1a1a1a',
              color: !progMode ? '#FFF' : '#888',
              fontWeight: !progMode ? 700 : 400,
            }}>
            辞典モード
          </button>
          <button
            onClick={() => { setProgMode(true); setActiveChordIdx(0); setIsPlaying(false); }}
            className="rounded cursor-pointer text-[10px] font-mono px-2.5 h-[24px] inline-flex items-center"
            style={{
              border: `1px solid ${progMode ? '#FFF' : '#444'}`,
              background: progMode ? '#3a3a3a' : '#1a1a1a',
              color: progMode ? '#FFF' : '#888',
              fontWeight: progMode ? 700 : 400,
            }}>
            練習モード
          </button>
        </div>

        {/* Global audio controls — practice mode only */}
        {progMode && <GlobalAudioControls
          bpm={bpm}
          onBpmChange={setBpm}
          isMetronomeOn={isMetronomeOn}
          onToggleMetronome={() => setIsMetronomeOn(p => !p)}
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
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(p => !p)}
          showPlayButton={!!activeProg && activeProg.chords.length > 0}
          leadingSlot={
            <button
              onClick={() => { setEditing(!editing); setIsPlaying(false); }}
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
                onSelectProg={(idx) => { setActiveProgIdx(idx); setActiveChordIdx(0); setIsPlaying(false); }}
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
                belowChart={lickDB && (
                  <LickPanel
                    licks={filteredLicks.licks}
                    selectedIdx={selectedLickIdx}
                    onSelect={(idx) => {
                      setSelectedLickIdx(idx);
                      const chord = activeProg.chords[activeChordIdx];
                      if (!chord) return;
                      const lick = filteredLicks.licks[idx];
                      if (!lick) return;
                      const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
                      const ctx = buildLickContext(lick, chord.quality, chord.rootName, rootSemi);
                      if (ctx) playPhraseAudio(ctx.phrase);
                    }}
                    onPlay={() => { if (activeLickPhrase) playPhraseAudio(activeLickPhrase); }}
                    onStop={() => {
                      manualPhraseRef.current?.stop();
                      manualPhraseRef.current = null;
                      if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
                      setIsPhraseAudioPlaying(false);
                    }}
                    onClear={() => setSelectedLickIdx(null)}
                    isPlaying={isPhraseAudioPlaying}
                    lickType={filteredLicks.lickType}
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

        {false && (showPhrase || phraseAutoPlay) && canShowPhrase && (
          <PhraseControls
            approachTypes={phraseApproachTypes}
            onApproachTypesChange={setPhraseApproachTypes}
            onGenerate={handleGeneratePhrase}
            onPlayPhrase={handlePlayPhrase}
            isPhraseAudioPlaying={isPhraseAudioPlaying}
            hasPhrase={!!activePhrase}
            phraseCount={phraseHistory.length}
            phraseIdx={activePhraseIdx}
            onPhraseNav={setActivePhraseIdx}
            animSpeed={phraseAnimSpeed}
            onAnimSpeedChange={v => { setPhraseAnimSpeed(v); localStorage.setItem('phraseAnimSpeed', String(v)); }}
            chordQuality={template.chordQuality}
            progMode={progMode}
            phraseAutoPlay={phraseAutoPlay}
            onTogglePhraseAutoPlay={() => setPhraseAutoPlay(p => !p)}
            onRegeneratePhraseMap={handleGeneratePhrase}
            isPlaying={isPlaying}
            isMetronomeOn={isMetronomeOn}
            beatCount={beatCount}
            onBeatCountChange={setBeatCount}
            goalSelectMode={goalSelectMode}
            onGoalSelectModeChange={setGoalSelectMode}
            selectedGoalNote={selectedGoalNote}
          />
        )}

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
          onNoteClick={handleNoteClick}
          activePhrase={activePhrase}
          phraseAnimKey={phraseAnimKey}
          phraseAnimSpeed={(phraseAutoPlay && progMode && isPlaying) || isMetronomeOn
            ? Math.round((60000 / bpm) / 2)
            : phraseAnimSpeed}
          swingAmount={swingEnabled ? swingAmount : 0}
          bpm={bpm}
          selectedGoalNote={selectedGoalNote}
          goalSelectMode={goalSelectMode}
        />

        {activePhrase && <PhraseAnalysisPanel phrase={activePhrase} mode={mode} swingAmount={swingEnabled ? swingAmount : 0} bpm={bpm} />}

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
  );
}
