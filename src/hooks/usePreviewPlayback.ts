import { useState, useRef, useEffect, useCallback } from 'react';
import type { GeneratedPhrase, PhraseNote, Progression, Position, Mode, SongKey } from '../types';
import type { useAudioContext } from './useAudioContext';
import { stopHandle, stopHandleArray, type AudioHandle } from './useAudioContext';
import { useTimer } from './useTimer';
import { playClick, playChordStrum, schedulePhrase, getStrumNotes, getChartLayout, getChordBeatCount, fretToFrequency, playNote } from '../utils';

interface PreviewParams {
  bpm: number;
  audio: ReturnType<typeof useAudioContext>;
  progMode: boolean;
  activeProg: Progression | null;
  activeChordIdx: number;
  songKey?: SongKey;
  // 辞典モードストラム用
  selPos: Position | null;
  mode: Mode;
}

export function usePreviewPlayback(params: PreviewParams) {
  const { bpm, audio, progMode, activeProg, activeChordIdx, songKey, selPos, mode } = params;

  // --- State ---
  const [isPhraseAudioPlaying, setIsPhraseAudioPlaying] = useState(false);
  const [iiVDisplayPhrase, setIiVDisplayPhrase] = useState<GeneratedPhrase | null>(null);
  const [phraseAnimKey, setPhraseAnimKey] = useState(0);

  // --- Refs ---
  const pendingPhraseRef = useRef<{
    phrase: GeneratedPhrase;
    switchToVPart?: GeneratedPhrase | null;
    iiBeats?: number;
  } | null>(null);
  const manualPhraseRef = useRef<AudioHandle | null>(null);
  const previewStrumRef = useRef<AudioHandle[]>([]);
  const previewMetRef = useRef<AudioHandle[]>([]);
  const justStartedPlayRef = useRef(false);

  // --- Timers ---
  const iiVSwitchTimer = useTimer();
  const completionTimer = useTimer();

  // --- Helpers ---
  function stopPreviewMetronome() {
    stopHandleArray(previewMetRef);
  }

  // --- Step mode (defined early so playPhraseAudio can reference exitStepMode) ---
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const stepNoteRef = useRef<AudioHandle | null>(null);

  const exitStepMode = useCallback(() => {
    stopHandle(stepNoteRef);
    setStepIndex(null);
  }, []);

  // --- playPhraseAudio ---
  const playPhraseAudio = useCallback((
    phrase: GeneratedPhrase,
    switchToVPart?: GeneratedPhrase | null,
    iiBeats?: number,
  ) => {
    exitStepMode();
    stopHandle(manualPhraseRef);
    completionTimer.clear();
    stopHandleArray(previewStrumRef);
    stopPreviewMetronome();
    iiVSwitchTimer.clear();
    setIiVDisplayPhrase(null);
    justStartedPlayRef.current = true;
    pendingPhraseRef.current = { phrase, switchToVPart, iiBeats };
    setIsPhraseAudioPlaying(true);
    setPhraseAnimKey(k => k + 1);
  }, [completionTimer, iiVSwitchTimer, exitStepMode]);

  // --- Phrase-start effect ---
  useEffect(() => {
    const pending = pendingPhraseRef.current;
    if (!pending) return;
    pendingPhraseRef.current = null;

    const ctx = audio.getCtx();
    const startAt = ctx.currentTime;
    const { phrase, switchToVPart, iiBeats } = pending;
    const eighthDur = (60 / bpm) / 2;
    const anacrusis = phrase.anacrusis ?? 0;
    const beatDurSec = eighthDur * 2;
    const anacrusisDur = anacrusis * beatDurSec;

    // 1. Phrase audio
    const result = schedulePhrase(ctx, phrase, startAt, eighthDur,
      audio.noteVolumeRef.current, 99, audio.instrumentRef.current,
      audio.swingEnabledRef.current ? audio.swingAmountRef.current : 0, bpm);
    manualPhraseRef.current = result;

    // 2. Chord strum (delayed by anacrusis)
    if (audio.chordAudioOnRef.current) {
      if (progMode && activeProg) {
        const strumNotes = getStrumNotes(activeChordIdx, activeProg.chords, songKey);
        if (strumNotes.length > 0) {
          previewStrumRef.current.push(
            playChordStrum(ctx, strumNotes, audio.chordVolumeRef.current, startAt + anacrusisDur));
        }
      } else if (selPos && selPos.instances.length > 0) {
        // 辞典モードストラム
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
          previewStrumRef.current.push(
            playChordStrum(ctx, strumNotes, audio.chordVolumeRef.current, startAt + anacrusisDur));
        }
      }
    }

    // 3. Metronome
    stopPreviewMetronome();
    if (audio.metVolumeRef.current > 0) {
      const beatSec = 60 / bpm;
      const totalBeats = Math.ceil(result.totalDuration / beatSec) + 1;
      for (let b = 0; b < totalBeats; b++) {
        const osc = playClick(b % 4 === 0, ctx, audio.metVolumeRef.current, startAt + b * beatSec);
        previewMetRef.current.push(osc);
      }
    }

    // 4. Overflow strums (ii-V long等)
    if (switchToVPart && activeProg) {
      const layout = getChartLayout(activeProg);
      const firstChordBeats = iiBeats ?? 4;

      if (audio.chordAudioOnRef.current) {
        const totalSec = result.totalDuration;
        let accBeats = firstChordBeats;
        let ci = activeChordIdx + 1;
        while (ci < activeProg.chords.length) {
          const strumSec = (anacrusis + accBeats) * 2 * eighthDur;
          if (strumSec >= totalSec) break;
          const strumNotes = getStrumNotes(ci, activeProg.chords, songKey);
          if (strumNotes.length > 0) {
            previewStrumRef.current.push(
              playChordStrum(ctx, strumNotes, audio.chordVolumeRef.current, startAt + strumSec));
          }
          accBeats += getChordBeatCount(layout, ci);
          ci++;
        }
      }

      // Display stays on previewLickPhrase (full lick) throughout playback.
      // Each note's CSS animation-delay (based on beatStart) handles onset timing,
      // so no mid-playback display switch is needed (avoids React re-render latency).
    }

    // 5. Completion timer
    completionTimer.set(() => {
      manualPhraseRef.current = null;
      stopPreviewMetronome();
      setIsPhraseAudioPlaying(false);
    }, result.totalDuration * 1000 + 200);
  }, [phraseAnimKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Stop-on-change effect ---
  useEffect(() => {
    if (justStartedPlayRef.current) {
      justStartedPlayRef.current = false;
      return;
    }
    stopHandle(manualPhraseRef);
    completionTimer.clear();
    stopHandleArray(previewStrumRef);
    stopPreviewMetronome();
    iiVSwitchTimer.clear();
    setIsPhraseAudioPlaying(false);
    setIiVDisplayPhrase(null);
    exitStepMode();
  }, [activeChordIdx, progMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Return indices of non-rest notes */
  function soundingIndices(phrase: GeneratedPhrase): number[] {
    return phrase.notes.reduce<number[]>((acc, n, i) => { if (!n.isRest) acc.push(i); return acc; }, []);
  }

  function playStepNote(note: PhraseNote) {
    stopHandle(stepNoteRef);
    if (note.isRest) return;
    const ctx = audio.getCtx();
    const freq = fretToFrequency(note.stringIdx, note.fret);
    stepNoteRef.current = playNote(ctx, freq, audio.noteVolumeRef.current, ctx.currentTime, 1.0, audio.instrumentRef.current);
  }

  const stopPreviewInternal = useCallback(() => {
    stopHandle(manualPhraseRef);
    completionTimer.clear();
    stopHandleArray(previewStrumRef);
    stopPreviewMetronome();
    iiVSwitchTimer.clear();
    setIiVDisplayPhrase(null);
    setIsPhraseAudioPlaying(false);
  }, [completionTimer, iiVSwitchTimer]);

  const stepForward = useCallback((phrase: GeneratedPhrase) => {
    if (isPhraseAudioPlaying) stopPreviewInternal();
    const si = soundingIndices(phrase);
    if (si.length === 0) return;
    setStepIndex(prev => {
      const curPos = prev == null ? -1 : si.indexOf(prev);
      const nextPos = curPos < 0 ? 0 : Math.min(curPos + 1, si.length - 1);
      const nextIdx = si[nextPos];
      playStepNote(phrase.notes[nextIdx]);
      return nextIdx;
    });
  }, [isPhraseAudioPlaying, stopPreviewInternal]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepBackward = useCallback((phrase: GeneratedPhrase) => {
    if (isPhraseAudioPlaying) stopPreviewInternal();
    const si = soundingIndices(phrase);
    if (si.length === 0) return;
    setStepIndex(prev => {
      const curPos = prev == null ? 0 : si.indexOf(prev);
      const prevPos = curPos <= 0 ? 0 : curPos - 1;
      const prevIdx = si[prevPos];
      playStepNote(phrase.notes[prevIdx]);
      return prevIdx;
    });
  }, [isPhraseAudioPlaying, stopPreviewInternal]); // eslint-disable-line react-hooks/exhaustive-deps

  // stopPreview (外部からの明示的停止)
  const stopPreview = useCallback(() => {
    stopPreviewInternal();
    exitStepMode();
  }, [stopPreviewInternal, exitStepMode]);

  const clearIiVSwitchTimer = useCallback(() => {
    iiVSwitchTimer.clear();
  }, [iiVSwitchTimer]);

  const bumpAnimKey = useCallback(() => setPhraseAnimKey(k => k + 1), []);

  return {
    playPhraseAudio,
    stopPreview,
    isPhraseAudioPlaying,
    iiVDisplayPhrase,
    setIiVDisplayPhrase,
    phraseAnimKey,
    clearIiVSwitchTimer,
    bumpAnimKey,
    stepIndex,
    stepForward,
    stepBackward,
    exitStepMode,
  };
}
