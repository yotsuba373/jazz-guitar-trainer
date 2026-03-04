import type { ApproachType } from '../../types';

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

const DOM7_QUALITIES = new Set(['7', '7b9', '7#11', '7b13']);

export function PhraseControls({
  approachTypes, onApproachTypesChange,
  onGenerate, phraseCount, phraseIdx, onPhraseNav,
  animSpeed, onAnimSpeedChange,
  chordQuality,
}: PhraseControlsProps) {
  const isDom7 = chordQuality ? DOM7_QUALITIES.has(chordQuality) : false;

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

      {/* Approach type checkboxes */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-[10px] text-text-muted mr-0.5">Approach:</span>
        {APPROACH_LABELS.map(({ type, label }) => {
          const disabled = type === 'b9-arpeggio' && !isDom7;
          return (
            <label key={type}
              className="text-[10px] flex items-center gap-0.5"
              style={{
                color: disabled ? '#555' : undefined,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              title={disabled ? 'Dom7 コードでのみ使用可能' : undefined}
            >
              <input type="checkbox"
                checked={approachTypes.includes(type)}
                onChange={() => toggleApproach(type)}
                disabled={disabled}
              />
              {label}
            </label>
          );
        })}
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        className={`${btnBase} text-[10px] px-3 py-[4px]`}
        style={{
          border: `1px solid ${PHRASE_COLOR}`,
          background: '#2a1a1e',
          color: PHRASE_COLOR,
          fontWeight: 700,
        }}>
        Generate
      </button>

      {/* History navigation */}
      {phraseCount > 0 && (
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

      {/* Animation speed slider */}
      <div className="flex gap-1 items-center text-[10px] text-text-muted">
        <span>速度</span>
        <input type="range" min={0} max={500} step={50}
          value={500 - animSpeed}
          onChange={e => onAnimSpeedChange(500 - Number(e.target.value))}
          className="w-16 accent-pink-400"
        />
      </div>
    </div>
  );
}
