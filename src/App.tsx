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
  splitIiVLongLick,
} from './utils';
import { Fretboard } from './components/Fretboard';
import { RootSelector, ModeSelector, PositionSelector, OptionBar, PhraseAnalysisPanel, GlobalAudioControls, LickPanel } from './components/Controls';
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
  const [chordAudioOn, setChordAudioOn] = useState(() => localStorage.getItem('chordAudioOn') === 'true');
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
  const activePhraseStopRef = useRef<{ stop: () => void } | null>(null);
  const [autoPlayPhrase, setAutoPlayPhrase] = useState<GeneratedPhrase | null>(null);
  // Lick practice state
  const [lickDB, setLickDB] = useState<LickDB | null>(null);
  const [selectedLickIdx, setSelectedLickIdx] = useState<number | null>(null);
  const [lickHighOctave, setLickHighOctave] = useState(false);
  const [lickHighInstance, setLickHighInstance] = useState(false);
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
      // V chord of split ii-V-long: lick isn't in filteredLicks (it's an ii-V type, not dom7).
      // Set selectedLickIdx to null so the V-chord fallback path in activeLickPhrase handles it.
      if (chord.lickIiVPart === 'V') {
        setSelectedLickIdx(null);
        setLickHighOctave(chord.lickHighOctave ?? false);
        setLickHighInstance(chord.lickHighInstance ?? false);
        return;
      }
      // For ii-V licks on ii chord, search in the combined list (which includes ii-V licks after single licks)
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

  // Build GeneratedPhrase from selected lick (or V chord with saved split lick)
  // Returns { display, preview }: display is per-chord (split), preview is full lick for audio
  const { activeLickPhrase, previewLickPhrase, vPartPhrase } = useMemo((): { activeLickPhrase: GeneratedPhrase | null; previewLickPhrase: GeneratedPhrase | null; vPartPhrase: GeneratedPhrase | null } => {
    const none = { activeLickPhrase: null, previewLickPhrase: null, vPartPhrase: null };
    if (!progMode || !activeProg) return none;
    const chord = activeProg.chords[activeChordIdx];
    if (!chord) return none;

    // Determine the lick source: user selection, or saved lick on this chord
    let lick: LickEntry | null = null;
    let iiVPart: 'ii' | 'V' | undefined;
    let keyCenterSemi: number | undefined;

    // V chord of split ii-V-long: always look up by lickId (the lick isn't in filteredLicks)
    if (chord.lickIiVPart === 'V' && chord.lickId) {
      lick = findLickById(chord.lickId);
      if (lick) {
        iiVPart = 'V';
        const vRootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
        keyCenterSemi = (vRootSemi + 5) % 12;
      }
    } else if (selectedLickIdx != null && filteredLicks.licks[selectedLickIdx]) {
      lick = filteredLicks.licks[selectedLickIdx];
      iiVPart = chord.lickIiVPart;
      if (filteredLicks.iiV) keyCenterSemi = filteredLicks.iiV.keyCenterSemitone;
    } else if (chord.lickId) {
      // Saved lick not in current filteredLicks (e.g. after mode/quality change)
      lick = findLickById(chord.lickId);
      if (lick) {
        iiVPart = chord.lickIiVPart;
        if (chord.lickIiVPart === 'ii') {
          const iiV = detectIiVPattern(activeProg.chords, activeChordIdx);
          if (iiV) keyCenterSemi = iiV.keyCenterSemitone;
        }
      }
    }
    if (!lick) return none;

    const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
    const iiVType = isIiVLickId(lick.id);
    const isSplitLong = iiVType === 'maj-ii-v-long' && iiVPart && keyCenterSemi != null;
    // Split lick for display; keep full lick for preview
    let displayLick = lick;
    let overrideTranspose: number | undefined;
    if (isSplitLong) {
      const { iiLick, vLick } = splitIiVLongLick(lick);
      displayLick = iiVPart === 'ii' ? iiLick : vLick;
      overrideTranspose = getIiVTransposeSemitones(keyCenterSemi!);
    }

    const iiVTranspose = (iiVType && !overrideTranspose && keyCenterSemi != null)
      ? getIiVTransposeSemitones(keyCenterSemi) : overrideTranspose;

    const transposeSemitones = iiVTranspose ?? getTransposeSemitones(chord.quality, rootSemi);

    // Helper to build display (split), preview (full), and V-part phrases
    const buildAll = (pos: Position, mi: number) => {
      const display = buildPhraseForLick(displayLick, chord.rootName, pos, mi, transposeSemitones, lickHighOctave, lickHighInstance);
      const preview = isSplitLong ? buildPhraseForLick(lick!, chord.rootName, pos, mi, transposeSemitones, lickHighOctave, lickHighInstance) : display;
      let vPart: GeneratedPhrase | null = null;
      if (isSplitLong && iiVPart === 'ii') {
        const { vLick } = splitIiVLongLick(lick!);
        vPart = buildPhraseForLick(vLick, chord.rootName, pos, mi, transposeSemitones, lickHighOctave, lickHighInstance);
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
      const vChord = iiVPart === 'V' ? chord : nextChord;
      if (vChord) {
        const vRootSemi = ROOTS.find(r => r.name === vChord.rootName)?.semitone ?? 0;
        const displayCtx = buildIiVLickContext(
          displayLick, keyCenterSemi,
          vChord.quality, vChord.rootName, vRootSemi,
          lickHighOctave, lickHighInstance,
        );
        if (!displayCtx) return none;
        const previewPhrase = isSplitLong
          ? buildIiVLickContext(lick, keyCenterSemi, vChord.quality, vChord.rootName, vRootSemi, lickHighOctave, lickHighInstance)?.phrase ?? null
          : displayCtx.phrase;
        // Build V part for ii chord animation switch
        let vPart: GeneratedPhrase | null = null;
        if (isSplitLong && iiVPart === 'ii') {
          const { vLick } = splitIiVLongLick(lick);
          const vCtx = buildIiVLickContext(vLick, keyCenterSemi, vChord.quality, vChord.rootName, vRootSemi, lickHighOctave, lickHighInstance);
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
  useEffect(() => {
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
      copy[activeProgIdx] = prog;
      handleSaveProgressions(copy);
    }
  }, [canHighOctave, canHighInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  const [isPhraseAudioPlaying, setIsPhraseAudioPlaying] = useState(false);

  const activePhrase = useMemo(() => {
    if (iiVDisplayPhrase) return iiVDisplayPhrase;
    // During manual playback of ii-V-long, show full phrase (not split display)
    if (isPhraseAudioPlaying && previewLickPhrase) return previewLickPhrase;
    if (activeLickPhrase) return activeLickPhrase;
    if (progMode && autoPlayPhrase && isPlaying)
      return autoPlayPhrase;
    return null;
  }, [iiVDisplayPhrase, isPhraseAudioPlaying, previewLickPhrase, activeLickPhrase, progMode, autoPlayPhrase, isPlaying]);

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
  useEffect(() => { swingEnabledRef.current = swingEnabled; localStorage.setItem('swingEnabled', String(swingEnabled)); }, [swingEnabled]);
  useEffect(() => { swingAmountRef.current = swingAmount; localStorage.setItem('swingAmount', String(swingAmount)); }, [swingAmount]);
  /** Find a lick from any DB section by ID */
  function findLickById(lickId: string): LickEntry | null {
    if (!lickDB) return null;
    for (const type of Object.keys(lickDB)) {
      const found = lickDB[type].find(l => l.id === lickId);
      if (found) return found;
    }
    return null;
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

      // For split ii-V-long licks, use only the relevant half
      let effectiveLick = lick;
      let transposeSemitones: number;
      if (iiVType === 'maj-ii-v-long' && chord.lickIiVPart) {
        const { iiLick, vLick } = splitIiVLongLick(lick);
        effectiveLick = chord.lickIiVPart === 'ii' ? iiLick : vLick;
        // Compute key center from chord context
        const keyCenterSemi = chord.lickIiVPart === 'ii'
          ? (() => { const iiV = detectIiVPattern(chords, chordIdx); return iiV?.keyCenterSemitone ?? 0; })()
          : (rootSemi + 5) % 12; // V chord: I = V + P4
        transposeSemitones = getIiVTransposeSemitones(keyCenterSemi);
      } else if (iiVType || chord.lickIiVType) {
        const iiV = detectIiVPattern(chords, chordIdx);
        if (!iiV) return null;
        transposeSemitones = getIiVTransposeSemitones(iiV.keyCenterSemitone);
      } else {
        transposeSemitones = getTransposeSemitones(chord.quality, rootSemi);
      }

      // Use the user's effective mode/position for mapping
      const { positions } = resolveChordPositions(chord.rootName, eff.modeIdx);
      const pos = positions.find(p => p.id === eff.posId);
      if (pos) {
        return buildPhraseForLick(effectiveLick, chord.rootName, pos, eff.modeIdx, transposeSemitones, highOctave, highInstance);
      }
    }

    return null;
  }

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
      // Schedule saved lick for initial chord on playback start
      if (isPlaybackStart && (chordHasSavedLick(activeChordIdx, activeProg))) {
        activePhraseStopRef.current?.stop();
        const phrase = playLickForChord(activeChordIdx, activeProg);
        if (phrase) {
          setAutoPlayPhrase(phrase);
          setPhraseAnimKey(k => k + 1);
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
      if (activeProg && chordHasSavedLick(nextChordIdx, activeProg)) {
        activePhraseStopRef.current?.stop();
        const phrase = playLickForChord(nextChordIdx, activeProg);
        if (phrase) {
          setAutoPlayPhrase(phrase);
          setPhraseAnimKey(k => k + 1);
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
          const ctx = audioCtxRef.current;
          const eighthDur = (60 / bpm) / 2;
          activePhraseStopRef.current = schedulePhrase(ctx, phrase, ctx.currentTime, eighthDur, noteVolumeRef.current, 99, instrumentRef.current, swingEnabledRef.current ? swingAmountRef.current : 0, bpm);
        }
      } else {
        // No saved lick — clear everything
        activePhraseStopRef.current?.stop();
        activePhraseStopRef.current = null;
        setAutoPlayPhrase(null);
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
      lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined,
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
  const [phraseAnimKey, setPhraseAnimKey] = useState(0);

  // Play a phrase with audio + animation sync
  const playPhraseAudio = useCallback((phrase: GeneratedPhrase, switchToVPart?: GeneratedPhrase | null, iiBeats?: number) => {
    // Stop any current playback
    manualPhraseRef.current?.stop();
    if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
    clearIiVSwitchTimer();
    setIiVDisplayPhrase(null);

    // Prevent the activePhrase-change effect from killing this playback
    justStartedPlayRef.current = true;

    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    // Always sync phrase to BPM
    const eighthDur = (60 / bpm) / 2;
    const result = schedulePhrase(ctx, phrase, ctx.currentTime, eighthDur, noteVolumeRef.current, 99, instrumentRef.current, swingEnabledRef.current ? swingAmountRef.current : 0, bpm);
    manualPhraseRef.current = result;
    setIsPhraseAudioPlaying(true);
    setPhraseAnimKey(k => k + 1);

    // Schedule ii→V fretboard switch at the split point
    if (switchToVPart) {
      const switchDelay = (iiBeats ?? 4) * 2 * eighthDur * 1000;
      iiVSwitchTimerRef.current = setTimeout(() => {
        justStartedPlayRef.current = true; // prevent playback stop on activePhrase change
        setIiVDisplayPhrase(switchToVPart);
        setPhraseAnimKey(k => k + 1);
        iiVSwitchTimerRef.current = null;
      }, switchDelay);
    }

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
  }, [progMode, selPos, mode.chordTones, isMetronomeOn, bpm]);

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
                      // Preserve current chord's 8va / Hi settings when switching licks
                      const curOctave = lickHighOctave;
                      const curInst = lickHighInstance;
                      const lick = filteredLicks.licks[idx];
                      const iiVType = isIiVLickId(lick?.id) ?? undefined;
                      if (lick?.id) {
                        const copy = [...progressions];
                        const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                        // For ii-V-long: split across ii and V chords
                        if (iiVType === 'maj-ii-v-long' && activeChordIdx + 1 < prog.chords.length) {
                          prog.chords[activeChordIdx] = {
                            ...prog.chords[activeChordIdx],
                            lickId: lick.id,
                            lickHighOctave: curOctave,
                            lickHighInstance: curInst,
                            lickIiVType: iiVType,
                            lickIiVPart: 'ii',
                          };
                          prog.chords[activeChordIdx + 1] = {
                            ...prog.chords[activeChordIdx + 1],
                            lickId: lick.id,
                            lickHighOctave: curOctave,
                            lickHighInstance: curInst,
                            lickIiVType: iiVType,
                            lickIiVPart: 'V',
                          };
                        } else {
                          prog.chords[activeChordIdx] = {
                            ...prog.chords[activeChordIdx],
                            lickId: lick.id,
                            lickHighOctave: curOctave,
                            lickHighInstance: curInst,
                            lickIiVType: iiVType,
                            lickIiVPart: undefined,
                          };
                        }
                        copy[activeProgIdx] = prog;
                        handleSaveProgressions(copy);
                      }
                      const chord = activeProg.chords[activeChordIdx];
                      if (!chord) return;
                      if (!lick) return;
                      // Play preview (full lick) — use user's current position for mapping
                      const rootSemi = ROOTS.find(r => r.name === chord.rootName)?.semitone ?? 0;
                      const iiVTransp = (iiVType && filteredLicks.iiV) ? getIiVTransposeSemitones(filteredLicks.iiV.keyCenterSemitone) : null;
                      const ts = iiVTransp ?? getTransposeSemitones(chord.quality, rootSemi);
                      const eff = effectiveAll[activeChordIdx];
                      if (eff) {
                        const { positions: posArr } = resolveChordPositions(chord.rootName, eff.modeIdx);
                        const pos = posArr.find(p => p.id === eff.posId);
                        if (pos) {
                          const phrase = buildPhraseForLick(lick, chord.rootName, pos, eff.modeIdx, ts, curOctave, curInst);
                          if (iiVType === 'maj-ii-v-long') {
                            const split = splitIiVLongLick(lick);
                            const vPartSwitch = buildPhraseForLick(split.vLick, chord.rootName, pos, eff.modeIdx, ts, curOctave, curInst);
                            playPhraseAudio(phrase, vPartSwitch, split.iiLick.beats);
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
                            if (iiVType === 'maj-ii-v-long') {
                              const split = splitIiVLongLick(lick);
                              const vCtx = buildIiVLickContext(split.vLick, filteredLicks.iiV.keyCenterSemitone, nextChord.quality, nextChord.rootName, vRootSemi, curOctave, curInst);
                              playPhraseAudio(fullCtx.phrase, vCtx?.phrase ?? null, split.iiLick.beats);
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
                      if (vPartPhrase && selectedLickIdx != null) {
                        const srcLick = filteredLicks.licks[selectedLickIdx];
                        playPhraseAudio(p, vPartPhrase, srcLick ? splitIiVLongLick(srcLick).iiLick.beats : undefined);
                      } else {
                        playPhraseAudio(p);
                      }
                    }}
                    onStop={() => {
                      manualPhraseRef.current?.stop();
                      manualPhraseRef.current = null;
                      if (manualPhraseTimer.current) clearTimeout(manualPhraseTimer.current);
                      clearIiVSwitchTimer();
                      setIiVDisplayPhrase(null);
                      setIsPhraseAudioPlaying(false);
                    }}
                    onClear={() => {
                      setSelectedLickIdx(null);
                      const copy = [...progressions];
                      const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                      const curChord = prog.chords[activeChordIdx];
                      prog.chords[activeChordIdx] = { ...curChord, lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined, lickIiVType: undefined, lickIiVPart: undefined };
                      // Linked clear: if this was ii part of ii-V-long, also clear V chord
                      if (curChord?.lickIiVPart === 'ii' && activeChordIdx + 1 < prog.chords.length) {
                        const vChord = prog.chords[activeChordIdx + 1];
                        if (vChord?.lickId === curChord.lickId && vChord?.lickIiVPart === 'V') {
                          prog.chords[activeChordIdx + 1] = { ...vChord, lickId: undefined, lickHighOctave: undefined, lickHighInstance: undefined, lickIiVType: undefined, lickIiVPart: undefined };
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
                    highOctave={lickHighOctave}
                    canHighOctave={canHighOctave}
                    onToggleOctave={() => {
                      setLickHighOctave(v => {
                        const next = !v;
                        const copy = [...progressions];
                        const prog = { ...copy[activeProgIdx], chords: [...copy[activeProgIdx].chords] };
                        prog.chords[activeChordIdx] = { ...prog.chords[activeChordIdx], lickHighOctave: next };
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
