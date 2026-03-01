import { useState } from 'react';
import type { Mode, LabelMode, ChordNotationPrefs } from '../../types';
import { formatChordSymbol, CHORD_NOTATION_OPTIONS } from '../../utils';

interface OptionBarProps {
  mode: Mode;
  showCT: boolean;
  labelMode: LabelMode;
  chordPrefs: ChordNotationPrefs;
  onToggleCT: (checked: boolean) => void;
  onSetLabelMode: (mode: LabelMode) => void;
  onChordPrefsChange: (prefs: ChordNotationPrefs) => void;
}

const btnBase = 'rounded cursor-pointer font-mono';

export function OptionBar({
  mode, showCT, labelMode, chordPrefs,
  onToggleCT, onSetLabelMode, onChordPrefsChange,
}: OptionBarProps) {
  const [notationOpen, setNotationOpen] = useState(false);

  function cycleNotation(key: keyof ChordNotationPrefs) {
    const opts = CHORD_NOTATION_OPTIONS[key];
    if (opts.length <= 1) return;
    const idx = opts.indexOf(chordPrefs[key]);
    const next = opts[(idx + 1) % opts.length];
    onChordPrefsChange({ ...chordPrefs, [key]: next });
  }

  const chordDisplay = formatChordSymbol(mode.notes[0], mode.chordQuality, chordPrefs);

  return (
    <div className="flex gap-3.5 mb-3 flex-wrap items-center">
      <label className="text-[10px] text-text-muted cursor-pointer flex items-center gap-1">
        <input type="checkbox" checked={showCT} onChange={e => onToggleCT(e.target.checked)} />
        {chordDisplay} コードトーン強調
      </label>

      <div className="flex gap-1">
        <span className="text-[10px] text-text-muted">ラベル:</span>
        {([['note', '音名'], ['degree', '度数']] as const).map(([k, v]) =>
          <button key={k} onClick={() => onSetLabelMode(k)}
            className={`${btnBase} text-[9px] px-2 py-[3px]`}
            style={{
              border: '1px solid #444',
              background: labelMode === k ? '#3a3a3a' : '#1a1a1a',
              color: '#CCC',
            }}
          >{v}</button>
        )}
      </div>

      <div className="flex gap-1 items-center">
        <button onClick={() => setNotationOpen(!notationOpen)}
          className={`${btnBase} text-[9px] px-2 py-[3px]`}
          style={{
            border: `1px solid ${notationOpen ? '#FFF' : '#444'}`,
            background: notationOpen ? '#3a3a3a' : '#1a1a1a',
            color: '#CCC',
          }}>
          記号
        </button>
        {notationOpen && (['maj7', 'm7', 'm7♭5'] as const).map(key => {
          const opts = CHORD_NOTATION_OPTIONS[key];
          if (opts.length <= 1) return null;
          return (
            <button key={key} onClick={() => cycleNotation(key)}
              className={`${btnBase} text-[10px] px-2 py-[3px]`}
              style={{
                border: '1px solid #555',
                background: '#1a1a1a',
                color: '#FFF',
              }}>
              {chordPrefs[key]}
            </button>
          );
        })}
      </div>

      {showCT && (
        <div className="flex gap-2.5 items-center text-[10px]">
          <span className="text-text-muted">|</span>
          <span className="inline-flex items-center gap-[3px]">
            <span className="inline-block w-[13px] h-[13px] rounded-full bg-white border-2 border-[#888]" />
            <span className="text-text-label">Root</span>
          </span>
          <span className="inline-flex items-center gap-[3px]">
            <span className="inline-block w-[13px] h-[13px] rounded-full bg-[#888]" />
            <span className="text-text-label">CT</span>
          </span>
          <span className="inline-flex items-center gap-[3px]">
            <span className="inline-block w-[11px] h-[11px] rounded-full bg-bg-panel border-[1.5px] border-[#888]" />
            <span className="text-text-muted">非CT</span>
          </span>
        </div>
      )}
    </div>
  );
}
