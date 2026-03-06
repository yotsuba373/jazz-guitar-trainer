import type { ApproachType, PhraseEngine } from '../../types';

interface PhraseControlsProps {
  approachTypes: ApproachType[];
  onApproachTypesChange: (types: ApproachType[]) => void;
  onGenerate: () => void;
  phraseCount: number;
  phraseIdx: number;
  onPhraseNav: (idx: number) => void;
  animSpeed: number;
  onAnimSpeedChange: (ms: number) => void;
  /** Current chord quality — b9 Arp is only available on dominant 7 chords */
  chordQuality?: string;
  /** Manual phrase playback */
  onPlayPhrase?: () => void;
  isPhraseAudioPlaying?: boolean;
  hasPhrase?: boolean;
  /** Progression mode auto-play */
  progMode?: boolean;
  phraseAutoPlay?: boolean;
  onTogglePhraseAutoPlay?: () => void;
  onRegeneratePhraseMap?: () => void;
  isPlaying?: boolean;
  /** Metronome active (normal mode — speed slider disabled when on) */
  isMetronomeOn?: boolean;
  /** Beat count selector (normal mode) */
  beatCount?: 2 | 3 | 4;
  onBeatCountChange?: (bc: 2 | 3 | 4) => void;
  /** Goal note selection */
  goalSelectMode?: boolean;
  onGoalSelectModeChange?: (on: boolean) => void;
  selectedGoalNote?: { noteName: string } | null;
  /** Phrase engine selection */
  phraseEngine?: PhraseEngine;
  onPhraseEngineChange?: (engine: PhraseEngine) => void;
}

const PHRASE_COLOR = '#FF6B9D';
const btnBase = 'rounded cursor-pointer font-mono';

const APPROACH_LABELS: { type: ApproachType; label: string }[] = [
  { type: 'single-below', label: 'Single↓' },
  { type: 'single-above', label: 'Single↑' },
  { type: 'enclosure', label: 'Encl.' },
  { type: 'parker-enclosure', label: 'Parker' },
  { type: 'b9-arpeggio', label: 'b9 Arp' },
];


export function PhraseControls({
  approachTypes, onApproachTypesChange,
  onGenerate, phraseCount, phraseIdx, onPhraseNav,
  animSpeed, onAnimSpeedChange,
  chordQuality: _chordQuality,
  onPlayPhrase, isPhraseAudioPlaying, hasPhrase,
  progMode, phraseAutoPlay, onTogglePhraseAutoPlay, onRegeneratePhraseMap: _onRegeneratePhraseMap,
  isPlaying,
  isMetronomeOn,
  beatCount, onBeatCountChange,
  goalSelectMode, onGoalSelectModeChange, selectedGoalNote,
  phraseEngine, onPhraseEngineChange,
}: PhraseControlsProps) {
  const autoPlaying = phraseAutoPlay && isPlaying;

  function toggleApproach(type: ApproachType) {
    if (approachTypes.includes(type)) {
      onApproachTypesChange(approachTypes.filter(t => t !== type));
    } else {
      onApproachTypesChange([...approachTypes, type]);
    }
  }

  const prev = () => onPhraseNav((phraseIdx - 1 + phraseCount) % phraseCount);
  const next = () => onPhraseNav((phraseIdx + 1) % phraseCount);

  return (
    <div className="mb-3 rounded-md px-3 py-2 flex flex-wrap gap-3 items-center"
      style={{ background: '#1a1a1a', border: `1px solid ${PHRASE_COLOR}40` }}>

      {/* Engine toggle */}
      {onPhraseEngineChange && (
        <div className="flex gap-0.5 items-center">
          <span className="text-[10px] text-text-muted mr-0.5">エンジン:</span>
          {(['lick', 'rule'] as const).map(eng => (
            <button key={eng}
              onClick={() => onPhraseEngineChange(eng)}
              className={`${btnBase} text-[10px] px-2 py-[2px]`}
              style={{
                border: `1px solid ${phraseEngine === eng ? PHRASE_COLOR : '#555'}`,
                background: phraseEngine === eng ? '#2a1020' : '#1a1a1a',
                color: phraseEngine === eng ? PHRASE_COLOR : '#888',
                fontWeight: phraseEngine === eng ? 700 : 400,
              }}
              title={eng === 'lick' ? 'リックライブラリベース' : 'ルールベース (ビバップ構造)'}>
              {eng === 'lick' ? 'Lick' : 'Rule'}
            </button>
          ))}
        </div>
      )}

      {/* Approach type checkboxes — disabled (lick-only mode, future connector feature) */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-[10px] text-text-muted mr-0.5">Approach:</span>
        {APPROACH_LABELS.map(({ type, label }) => (
          <label key={type}
            className="text-[10px] flex items-center gap-0.5"
            style={{
              color: '#555',
              cursor: 'not-allowed',
            }}
            title="将来のコネクタ機能で使用予定"
          >
            <input type="checkbox"
              checked={approachTypes.includes(type)}
              onChange={() => toggleApproach(type)}
              disabled
            />
            {label}
          </label>
        ))}
      </div>

      {/* Beat count selector (normal mode only) */}
      {!progMode && onBeatCountChange && (
        <div className="flex gap-0.5 items-center">
          <span className="text-[10px] text-text-muted mr-0.5">拍数:</span>
          {([2, 3, 4] as const).map(bc => (
            <button key={bc}
              onClick={() => onBeatCountChange(bc)}
              className={`${btnBase} text-[10px] px-2 py-[2px]`}
              style={{
                border: `1px solid ${beatCount === bc ? PHRASE_COLOR : '#555'}`,
                background: beatCount === bc ? '#2a1020' : '#1a1a1a',
                color: beatCount === bc ? PHRASE_COLOR : '#888',
                fontWeight: beatCount === bc ? 700 : 400,
              }}>
              {bc}
            </button>
          ))}
        </div>
      )}

      {/* Goal note selection toggle */}
      {onGoalSelectModeChange && (
        <div className="flex gap-1 items-center">
          <button
            onClick={() => onGoalSelectModeChange(!goalSelectMode)}
            className={`${btnBase} text-[10px] px-2.5 py-[3px]`}
            style={{
              border: `1px solid ${goalSelectMode ? '#80FFAA' : '#555'}`,
              background: goalSelectMode ? '#102a1a' : '#1a1a1a',
              color: goalSelectMode ? '#80FFAA' : '#888',
              fontWeight: goalSelectMode ? 700 : 400,
            }}
            title="指板クリックでゴールノートを指定">
            {goalSelectMode ? 'ゴール ON' : 'ゴール'}
          </button>
          {selectedGoalNote && (
            <span className="text-[10px]" style={{ color: '#80FFAA' }}>
              {selectedGoalNote.noteName}
            </span>
          )}
        </div>
      )}

      {/* Auto-play toggle (progression mode only) */}
      {progMode && onTogglePhraseAutoPlay && (
        <div className="flex gap-1 items-center">
          <button
            onClick={onTogglePhraseAutoPlay}
            className={`${btnBase} text-[10px] px-3 py-[4px]`}
            style={{
              border: `1px solid ${phraseAutoPlay ? PHRASE_COLOR : '#666'}`,
              background: phraseAutoPlay ? '#2a1020' : '#1a1a1a',
              color: phraseAutoPlay ? PHRASE_COLOR : '#888',
              fontWeight: phraseAutoPlay ? 700 : 400,
            }}>
            Auto ▶
          </button>
        </div>
      )}

      {/* Generate + Play buttons — hidden during auto-play playback */}
      {!autoPlaying && (
        <div className="flex gap-1 items-center">
          <button
            onClick={onGenerate}
            className={`${btnBase} text-[10px] px-3 py-[4px]`}
            style={{
              border: `1px solid ${PHRASE_COLOR}`,
              background: '#2a1a1e',
              color: PHRASE_COLOR,
              fontWeight: 700,
            }}>
            {phraseAutoPlay ? '↻ Regenerate' : 'Generate'}
          </button>
          {onPlayPhrase && (
            <button
              onClick={onPlayPhrase}
              disabled={!hasPhrase}
              title={isPhraseAudioPlaying ? 'フレーズ停止' : 'フレーズ再生'}
              className={`${btnBase} text-[10px] px-2.5 py-[4px]`}
              style={{
                border: `1px solid ${!hasPhrase ? '#444' : isPhraseAudioPlaying ? '#E74C3C' : PHRASE_COLOR}`,
                background: isPhraseAudioPlaying ? '#2a1010' : '#2a1a1e',
                color: !hasPhrase ? '#555' : isPhraseAudioPlaying ? '#E74C3C' : PHRASE_COLOR,
                cursor: !hasPhrase ? 'not-allowed' : 'pointer',
              }}>
              {isPhraseAudioPlaying ? '■ Stop' : '▶ Play'}
            </button>
          )}
        </div>
      )}

      {/* History navigation — hidden during auto-play */}
      {!phraseAutoPlay && phraseCount > 0 && (
        <div className="flex gap-1 items-center text-[10px]"
          style={{ color: PHRASE_COLOR }}>
          <button onClick={prev}
            className={`${btnBase} px-1.5 py-[2px]`}
            style={{ border: `1px solid ${PHRASE_COLOR}60`, background: '#1a1a1a', color: PHRASE_COLOR }}>
            ◀
          </button>
          <span className="min-w-[40px] text-center">
            {phraseIdx + 1}/{phraseCount}
          </span>
          <button onClick={next}
            className={`${btnBase} px-1.5 py-[2px]`}
            style={{ border: `1px solid ${PHRASE_COLOR}60`, background: '#1a1a1a', color: PHRASE_COLOR }}>
            ▶
          </button>
        </div>
      )}

      {/* Animation speed slider — hidden during auto-play (BPM-synced), disabled when metronome on */}
      {!autoPlaying && (() => {
        const disabled = !!isMetronomeOn;
        return (
          <div className="flex gap-1 items-center text-[10px]" style={{ color: disabled ? '#555' : undefined, opacity: disabled ? 0.5 : 1 }}>
            <span>{disabled ? '速度 (BPM同期)' : '速度'}</span>
            <input type="range" min={0} max={500} step={50}
              value={500 - animSpeed}
              onChange={e => onAnimSpeedChange(500 - Number(e.target.value))}
              className="w-16 accent-pink-400"
              disabled={disabled}
            />
          </div>
        );
      })()}
    </div>
  );
}
