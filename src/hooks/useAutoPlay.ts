import { useState, useRef, useEffect } from 'react';
import type { GeneratedPhrase, Progression, LickDB } from '../types';
import type { useAudioContext } from './useAudioContext';
import { stopHandle, stopHandleArray, type AudioHandle } from './useAudioContext';
import { useTimer } from './useTimer';
import {
  playClick, playChordStrum, schedulePhrase,
  getStrumNotes, getChartLayout, getChordBeatCount,
  buildPlaybackSeq, computeCumBeats,
  playLickForChord, buildAnacrusisPhrase, chordHasSavedLick,
  isLickOriginator,
  getSamplers, playSmplrPianoComp, playSmplrBassLine,
} from '../utils';

interface AutoPlayParams {
  isPlaying: boolean;
  progMode: boolean;
  activeProg: Progression | null;
  activeChordIdx: number;
  bpm: number;
  lickDB: LickDB | null;
  audio: ReturnType<typeof useAudioContext>;
  countIn: { enabled: boolean; bars: number };
  loopRange: { start: number; end: number } | null;
  onAdvance(chordIdx: number): void;
  onPhraseAnimKey(): void;
}

export function useAutoPlay(params: AutoPlayParams) {
  const { isPlaying, progMode, activeProg, activeChordIdx, bpm, lickDB, audio,
    countIn, loopRange } = params;

  // Stable refs for callbacks (avoid stale closures / effect dep churn)
  const onAdvanceRef = useRef(params.onAdvance);
  useEffect(() => { onAdvanceRef.current = params.onAdvance; });
  const onPhraseAnimKeyRef = useRef(params.onPhraseAnimKey);
  useEffect(() => { onPhraseAnimKeyRef.current = params.onPhraseAnimKey; });

  // --- State ---
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [advanceTick, setAdvanceTick] = useState(0);
  const [autoPlayPhrase, setAutoPlayPhrase] = useState<GeneratedPhrase | null>(null);

  // --- Refs ---
  const advanceOriginRef = useRef<'stopped' | 'start' | 'user-nav' | 'auto'>('stopped');
  const chordStartRef = useRef(0);
  const playPosRef = useRef(0);
  const activeStrumRef = useRef<AudioHandle | null>(null);
  const activeBassRef = useRef<AudioHandle | null>(null);
  const activePhraseStopRef = useRef<AudioHandle | null>(null);
  const songMetRef = useRef<AudioHandle[]>([]);
  const pendingNextRef = useRef<{
    strumHandle: AudioHandle | null;
    bassHandle: AudioHandle | null;
    phraseHandle: AudioHandle | null;
    phrase: GeneratedPhrase | null;
    metNodes: AudioHandle[];
  } | null>(null);
  const anacrusisAudioRef = useRef<AudioHandle | null>(null);
  const countInNodesRef = useRef<OscillatorNode[]>([]);
  const loopRangeRef = useRef(loopRange);

  // --- Timers ---
  const countInTimer = useTimer();
  const anacrusisDisplayTimer = useTimer();

  // --- Ref sync ---
  useEffect(() => { loopRangeRef.current = loopRange; }, [loopRange]);

  // --- Cleanup helpers ---
  function stopSongMetronome() { stopHandleArray(songMetRef); }

  function cancelPendingNext() {
    if (pendingNextRef.current) {
      pendingNextRef.current.strumHandle?.stop();
      pendingNextRef.current.bassHandle?.stop();
      pendingNextRef.current.phraseHandle?.stop();
      pendingNextRef.current.metNodes.forEach(h => { try { h.stop(); } catch { /* already stopped */ } });
      pendingNextRef.current = null;
    }
  }

  function stopCountIn() {
    countInTimer.clear();
    countInNodesRef.current.forEach(osc => { try { osc.stop(); } catch { /* already stopped */ } });
    countInNodesRef.current = [];
    setIsCountingIn(false);
  }

  function cleanup() {
    advanceOriginRef.current = 'stopped';
    chordStartRef.current = 0;
    stopHandle(activeStrumRef);
    stopHandle(activeBassRef);
    stopHandle(activePhraseStopRef);
    stopHandle(anacrusisAudioRef);
    anacrusisDisplayTimer.clear();
    stopSongMetronome();
    cancelPendingNext();
    stopCountIn();
  }

  // --- scheduleChordAudio ---
  function scheduleChordAudio(chordIdx: number, prog: Progression, startAt: number, globalBeatOffset: number) {
    const ctx = audio.getCtx();
    let strumHandle: AudioHandle | null = null;
    let bassHandle: AudioHandle | null = null;
    let phraseHandle: AudioHandle | null = null;
    let phrase: GeneratedPhrase | null = null;
    const metNodes: AudioHandle[] = [];

    // Strum
    if (audio.chordAudioOnRef.current) {
      const chord = prog.chords[chordIdx];
      const samplers = getSamplers();
      if (samplers && chord) {
        const layout = getChartLayout(prog);
        const chordBeats = getChordBeatCount(layout, chordIdx);
        const chordDur = chordBeats * (60 / bpm);
        strumHandle = playSmplrPianoComp(
          samplers.piano, chord.rootName, chord.quality,
          audio.chordVolumeRef.current, startAt, chordDur);
      } else {
        const strumNotes = getStrumNotes(chordIdx, prog.chords, prog.songKey);
        if (strumNotes.length > 0) {
          strumHandle = playChordStrum(ctx, strumNotes, audio.chordVolumeRef.current, startAt);
        }
      }
    }

    // Walking bass
    if (audio.bassVolumeRef.current > 0) {
      const samplers = getSamplers();
      if (samplers?.bass) {
        const chord = prog.chords[chordIdx];
        if (chord) {
          const layout = getChartLayout(prog);
          const chordBeats = getChordBeatCount(layout, chordIdx);
          const nextChord = prog.chords[chordIdx + 1];
          bassHandle = playSmplrBassLine(
            samplers.bass, chord.rootName, chord.quality,
            chordBeats, nextChord?.rootName ?? null,
            audio.bassVolumeRef.current, startAt, bpm,
          );
        }
      }
    }

    // Lick
    if (lickDB && chordHasSavedLick(chordIdx, prog, lickDB)) {
      phrase = playLickForChord(chordIdx, prog, lickDB);
      if (phrase) {
        const eighthDur = (60 / bpm) / 2;
        phraseHandle = schedulePhrase(ctx, phrase, startAt, eighthDur,
          audio.noteVolumeRef.current, 99, audio.instrumentRef.current,
          audio.swingEnabledRef.current ? audio.swingAmountRef.current : 0, bpm);
      }
    }

    // Metronome
    if (audio.metVolumeRef.current > 0) {
      const layout = getChartLayout(prog);
      const chordBeats = getChordBeatCount(layout, chordIdx);
      const beatSec = 60 / bpm;
      for (let b = 0; b < chordBeats; b++) {
        const accent = (globalBeatOffset + b) % 4 === 0;
        const osc = playClick(accent, ctx, audio.metVolumeRef.current, startAt + b * beatSec);
        metNodes.push(osc);
      }
    }

    return { strumHandle, bassHandle, phraseHandle, phrase, metNodes };
  }

  // --- Main auto-advance effect ---
  useEffect(() => {
    if (!isPlaying || !progMode || !activeProg) {
      cleanup();
      return;
    }
    if (isCountingIn) return;

    const ctx = audio.getCtx();
    const seq = buildPlaybackSeq(getChartLayout(activeProg));
    if (!seq.length) return;

    // === handleStartOrNav ===
    if (advanceOriginRef.current !== 'auto') {
      const isStart = advanceOriginRef.current === 'stopped';

      // Count-in (再生開始時のみ)
      if (isStart && countIn.enabled) {
        const beatSec = 60 / bpm;
        const countInBeats = countIn.bars * 4;
        const vol = audio.countInVolumeRef.current;
        const startAt = ctx.currentTime + 0.05;
        const nodes: OscillatorNode[] = [];
        for (let b = 0; b < countInBeats; b++) {
          nodes.push(playClick(b % 4 === 0, ctx, vol, startAt + b * beatSec));
        }
        countInNodesRef.current = nodes;
        setIsCountingIn(true);

        // カウントインのアナクルーシス
        const startChord = activeProg.chords[activeChordIdx];
        if (startChord && isLickOriginator(startChord)) {
          const startAna = startChord.lickAnacrusis ?? 0;
          if (startAna > 0 && startChord.lickId && lickDB) {
            const anaPhrase = buildAnacrusisPhrase(activeChordIdx, activeProg, startAna, lickDB);
            if (anaPhrase) {
              const eighthDurCi = (60 / bpm) / 2;
              const anacStartAt = startAt + (countInBeats - startAna) * beatSec;
              schedulePhrase(ctx, anaPhrase, anacStartAt, eighthDurCi,
                audio.noteVolumeRef.current, 99, audio.instrumentRef.current,
                audio.swingEnabledRef.current ? audio.swingAmountRef.current : 0, bpm, true);
              anacrusisDisplayTimer.set(() => {
                setAutoPlayPhrase(anaPhrase);
                onPhraseAnimKeyRef.current();
              }, (countInBeats - startAna) * beatSec * 1000);
            }
          }
        }

        countInTimer.set(() => {
          countInNodesRef.current = [];
          chordStartRef.current = performance.now();
          advanceOriginRef.current = 'start';
          setIsCountingIn(false);
        }, countInBeats * beatSec * 1000);
        return;
      }

      // seq位置検索 + 現コードスケジューリング
      const pos = seq.findIndex(s => s.chordIdx === activeChordIdx);
      playPosRef.current = pos >= 0 ? pos : 0;
      chordStartRef.current = performance.now();

      cancelPendingNext();
      stopHandle(activeStrumRef);
      stopHandle(activeBassRef);
      stopHandle(activePhraseStopRef);
      stopSongMetronome();
      const cumBeats = computeCumBeats(seq, playPosRef.current);
      const result = scheduleChordAudio(activeChordIdx, activeProg, ctx.currentTime, cumBeats);
      activeStrumRef.current = result.strumHandle;
      activeBassRef.current = result.bassHandle;
      activePhraseStopRef.current = result.phraseHandle;
      songMetRef.current = result.metNodes;
      if (result.phrase) {
        setAutoPlayPhrase(result.phrase);
        onPhraseAnimKeyRef.current();
      } else if (!isStart) {
        setAutoPlayPhrase(null);
      }
    }
    advanceOriginRef.current = 'stopped';

    // === scheduleLookahead ===
    const step = seq[playPosRef.current];
    if (!step) return;

    const targetAt = chordStartRef.current + (60000 / bpm) * step.beats;
    const delay = Math.max(0, targetAt - performance.now());

    let nextPos = (playPosRef.current + 1) % seq.length;
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
    const cumBeatsNext = nextPos === 0
      ? computeCumBeats(seq, seq.length)
      : computeCumBeats(seq, nextPos);
    const nextResult = scheduleChordAudio(nextChordIdx, activeProg, audioStartAt, cumBeatsNext);
    pendingNextRef.current = nextResult;

    // アナクルーシス look-ahead (現コードにリックがある場合はスキップ — 重複防止)
    stopHandle(anacrusisAudioRef);
    anacrusisDisplayTimer.clear();
    const curHasLick = lickDB != null && chordHasSavedLick(step.chordIdx, activeProg, lickDB);
    const nextChord = activeProg.chords[nextChordIdx];
    if (!curHasLick && nextChord && isLickOriginator(nextChord)) {
      const nextAna = nextChord.lickAnacrusis ?? 0;
      if (nextAna > 0 && nextChord.lickId && lickDB) {
        const anaPhrase = buildAnacrusisPhrase(nextChordIdx, activeProg, nextAna, lickDB);
        if (anaPhrase) {
          const beatSec = 60 / bpm;
          const anacrusisStartAt = Math.max(ctx.currentTime, audioStartAt - nextAna * beatSec);
          const eighthDurAna = (60 / bpm) / 2;
          anacrusisAudioRef.current = schedulePhrase(ctx, anaPhrase, anacrusisStartAt, eighthDurAna,
            audio.noteVolumeRef.current, 99, audio.instrumentRef.current,
            audio.swingEnabledRef.current ? audio.swingAmountRef.current : 0, bpm, true);
          const anacrusisDisplayDelay = Math.max(0, delay - nextAna * beatSec * 1000);
          if (anacrusisDisplayDelay > 0) {
            anacrusisDisplayTimer.set(() => {
              setAutoPlayPhrase(anaPhrase);
              onPhraseAnimKeyRef.current();
            }, anacrusisDisplayDelay);
          } else {
            setAutoPlayPhrase(anaPhrase);
            onPhraseAnimKeyRef.current();
          }
        }
      }
    }

    // === auto-advance setTimeout ===
    const timer = setTimeout(() => {
      advanceOriginRef.current = 'auto';
      chordStartRef.current = targetAt;
      playPosRef.current = nextPos;

      stopHandle(activeStrumRef);
      stopHandle(activeBassRef);
      stopHandle(activePhraseStopRef);
      stopSongMetronome();
      activeStrumRef.current = pendingNextRef.current?.strumHandle ?? null;
      activeBassRef.current = pendingNextRef.current?.bassHandle ?? null;
      activePhraseStopRef.current = pendingNextRef.current?.phraseHandle ?? null;
      songMetRef.current = pendingNextRef.current?.metNodes ?? [];
      const nextPhrase = pendingNextRef.current?.phrase ?? null;
      pendingNextRef.current = null;
      anacrusisAudioRef.current = null;

      if (nextPhrase) {
        setAutoPlayPhrase(nextPhrase);
        onPhraseAnimKeyRef.current();
      } else {
        setAutoPlayPhrase(null);
      }

      onAdvanceRef.current(nextChordIdx);
      setAdvanceTick(t => t + 1);
    }, delay);

    return () => {
      clearTimeout(timer);
      anacrusisDisplayTimer.clear();
      cancelPendingNext();
      stopHandle(anacrusisAudioRef);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, activeChordIdx, bpm, activeProg, progMode, isCountingIn, advanceTick]);

  return { autoPlayPhrase, isCountingIn };
}
