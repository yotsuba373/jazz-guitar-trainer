import type { PhraseSource, ApproachType } from '../../types';

interface PhraseControlsProps {
  source: PhraseSource;
  onSourceChange: (s: PhraseSource) => void;
  approachTypes: ApproachType[];
  onApproachTypesChange: (types: ApproachType[]) => void;
  onGenerate: () => void;
  phraseCount: number;
  phraseIdx: number;
  onPhraseNav: (idx: number) => void;
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
  source, onSourceChange,
  approachTypes, onApproachTypesChange,
  onGenerate, phraseCount, phraseIdx, onPhraseNav,
}: PhraseControlsProps) {

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

      {/* Source selector */}
      <div className="flex gap-1 items-center">
        <span className="text-[10px] text-text-muted mr-0.5">ソース:</span>
        {([['scale', 'Scale'], ['approach', 'Approach'], ['both', '両方']] as const).map(([key, label]) =>
          <button key={key}
            onClick={() => onSourceChange(key)}
            className={`${btnBase} text-[9px] px-2 py-[3px]`}
            style={{
              border: `1px solid ${source === key ? PHRASE_COLOR : '#444'}`,
              background: source === key ? '#2a1a1e' : '#1a1a1a',
              color: source === key ? PHRASE_COLOR : '#999',
              fontWeight: source === key ? 700 : 400,
            }}>
            {label}
          </button>
        )}
      </div>

      {/* Approach type checkboxes (only when approach is active) */}
      {(source === 'approach' || source === 'both') && (
        <div className="flex gap-2 items-center flex-wrap">
          {APPROACH_LABELS.map(({ type, label }) =>
            <label key={type} className="text-[10px] text-text-muted cursor-pointer flex items-center gap-0.5">
              <input type="checkbox"
                checked={approachTypes.includes(type)}
                onChange={() => toggleApproach(type)}
              />
              {label}
            </label>
          )}
        </div>
      )}

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
    </div>
  );
}
