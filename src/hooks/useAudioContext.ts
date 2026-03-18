import { useState, useRef, useEffect, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { InstrumentType, RhythmMode, BackingStyle } from '../types';
import type { SamplerStatus } from '../utils/sampler';
import { loadSamplers } from '../utils/sampler';

export interface AudioHandle { stop(): void; }

export interface DrumAudioHandle extends AudioHandle {
  /** 未来のスケジュール済みヒットのみキャンセル。再生中の音は自然減衰させる */
  letRing(): void;
}

export function stopHandle(ref: MutableRefObject<AudioHandle | null>): void {
  ref.current?.stop();
  ref.current = null;
}

export function stopHandleArray(ref: MutableRefObject<AudioHandle[]>): void {
  ref.current.forEach(h => { try { h.stop(); } catch { /* already stopped */ } });
  ref.current = [];
}

/** コード遷移時にドラムを自然減衰させる。DrumAudioHandle なら letRing、そうでなければ stop */
export function letRingDrums(ref: MutableRefObject<AudioHandle | null>): void {
  if (ref.current && 'letRing' in ref.current) {
    (ref.current as DrumAudioHandle).letRing();
  } else {
    ref.current?.stop();
  }
  ref.current = null;
}

export function useAudioContext(volumes: {
  metVolume: number;
  chordVolume: number;
  chordAudioOn: boolean;
  noteVolume: number;
  noteAudioOn: boolean;
  countInVolume: number;
  instrument: InstrumentType;
  bassVolume: number;
  bassAudioOn: boolean;
  rhythmMode: RhythmMode;
  rhythmOn: boolean;
  swingEnabled: boolean;
  swingAmount: number;
  backingStyle: BackingStyle;
}) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [samplerStatus, setSamplerStatus] = useState<SamplerStatus>('idle');

  const getCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    loadSamplers(audioCtxRef.current, setSamplerStatus);
    return audioCtxRef.current;
  }, []);

  // Volume refs (コールバック内から最新値を参照するため)
  const metVolumeRef = useRef(volumes.metVolume);
  const chordVolumeRef = useRef(volumes.chordVolume);
  const chordAudioOnRef = useRef(volumes.chordAudioOn);
  const noteVolumeRef = useRef(volumes.noteVolume);
  const countInVolumeRef = useRef(volumes.countInVolume);
  const instrumentRef = useRef(volumes.instrument);
  const noteAudioOnRef = useRef(volumes.noteAudioOn);
  const bassVolumeRef = useRef(volumes.bassVolume);
  const bassAudioOnRef = useRef(volumes.bassAudioOn);
  const rhythmModeRef = useRef(volumes.rhythmMode);
  const rhythmOnRef = useRef(volumes.rhythmOn);
  const swingEnabledRef = useRef(volumes.swingEnabled);
  const swingAmountRef = useRef(volumes.swingAmount);
  const backingStyleRef = useRef(volumes.backingStyle);

  // Ref sync + localStorage persistence
  useEffect(() => {
    metVolumeRef.current = volumes.metVolume;
    localStorage.setItem('metVolume', String(volumes.metVolume));
  }, [volumes.metVolume]);

  useEffect(() => {
    chordVolumeRef.current = volumes.chordVolume;
    localStorage.setItem('chordVolume', String(volumes.chordVolume));
  }, [volumes.chordVolume]);

  useEffect(() => {
    chordAudioOnRef.current = volumes.chordAudioOn;
    localStorage.setItem('chordAudioOn', String(volumes.chordAudioOn));
  }, [volumes.chordAudioOn]);

  useEffect(() => {
    noteVolumeRef.current = volumes.noteVolume;
    localStorage.setItem('noteVolume', String(volumes.noteVolume));
  }, [volumes.noteVolume]);

  useEffect(() => {
    noteAudioOnRef.current = volumes.noteAudioOn;
    localStorage.setItem('noteAudioOn', String(volumes.noteAudioOn));
  }, [volumes.noteAudioOn]);

  useEffect(() => {
    countInVolumeRef.current = volumes.countInVolume;
    localStorage.setItem('countInVolume', String(volumes.countInVolume));
  }, [volumes.countInVolume]);

  useEffect(() => {
    instrumentRef.current = volumes.instrument;
    localStorage.setItem('phraseInstrument', volumes.instrument);
  }, [volumes.instrument]);

  useEffect(() => {
    bassVolumeRef.current = volumes.bassVolume;
    localStorage.setItem('bassVolume', String(volumes.bassVolume));
  }, [volumes.bassVolume]);

  useEffect(() => {
    bassAudioOnRef.current = volumes.bassAudioOn;
    localStorage.setItem('bassAudioOn', String(volumes.bassAudioOn));
  }, [volumes.bassAudioOn]);

  useEffect(() => {
    rhythmModeRef.current = volumes.rhythmMode;
    localStorage.setItem('rhythmMode', volumes.rhythmMode);
  }, [volumes.rhythmMode]);

  useEffect(() => {
    rhythmOnRef.current = volumes.rhythmOn;
    localStorage.setItem('rhythmOn', String(volumes.rhythmOn));
  }, [volumes.rhythmOn]);

  useEffect(() => {
    swingEnabledRef.current = volumes.swingEnabled;
  }, [volumes.swingEnabled]);

  useEffect(() => {
    swingAmountRef.current = volumes.swingAmount;
    localStorage.setItem('swingAmount', String(volumes.swingAmount));
  }, [volumes.swingAmount]);

  useEffect(() => {
    backingStyleRef.current = volumes.backingStyle;
  }, [volumes.backingStyle]);

  return {
    getCtx, samplerStatus,
    metVolumeRef, chordVolumeRef, chordAudioOnRef,
    noteVolumeRef, noteAudioOnRef, countInVolumeRef,
    bassVolumeRef, bassAudioOnRef,
    rhythmModeRef, rhythmOnRef, instrumentRef, swingEnabledRef, swingAmountRef,
    backingStyleRef,
  };
}
