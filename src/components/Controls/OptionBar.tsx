import { useState } from 'react';
import type { Mode, LabelMode, ChordNotationPrefs, FoundVoicing } from '../../types';
import { formatChordSymbol, CHORD_NOTATION_OPTIONS, formatVoicingLabel } from '../../utils';

interface OptionBarProps {
  mode: Mode;
  showCT: boolean;
  labelMode: LabelMode;
  chordPrefs: ChordNotationPrefs;
  onToggleCT: (checked: boolean) => void;
  onSetLabelMode: (mode: LabelMode) => void;
  onChordPrefsChange: (prefs: ChordNotationPrefs) => void;
  progMode?: boolean;
  showGT?: boolean;
  onToggleGT?: (checked: boolean) => void;
  canShowChordForms?: boolean;
  showChordForms?: boolean;
  onToggleChordForms?: (checked: boolean) => void;
  availableVoicings?: FoundVoicing[];
  selectedVoicingIdx?: number;
  onSelectVoicing?: (idx: number) => void;
}

const btnBase = 'rounded cursor-pointer font-mono';

export function OptionBar({
  mode, showCT, labelMode, chordPrefs,
  onToggleCT, onSetLabelMode, onChordPrefsChange,
  progMode, showGT, onToggleGT,
  canShowChordForms, showChordForms, onToggleChordForms,
  availableVoicings, selectedVoicingIdx, onSelectVoicing,
}: OptionBarProps) {
  const [notationOpen, setNotationOpen] = useState(false);

  function cycleNotation(key: keyof ChordNotationPrefs) {
    const opts = CHORD_NOTATION_OPTIONS[key];
    if (opts.length <= 1) return;
    const idx = opts.indexOf(chordPrefs[key]);
    const next = opts[(idx + 1) % opts.length];
    onChordPrefsChange({ ...chordPrefs, [key]: next });
  }

  // Chord tone highlight label: use base quality (tensions like #11, b13, b9
  // don't change the highlighted chord tones 1-3-5-b7)
  const CT_BASE: Record<string, string> = { '7#11': '7', '7b13': '7', '7b9': '7' };
  const ctQuality = CT_BASE[mode.chordQuality] ?? mode.chordQuality;
  const chordDisplay = formatChordSymbol(mode.notes[0], ctQuality, chordPrefs);

  return (
    <div className="flex gap-3.5 mb-3 flex-wrap items-center">
      <label className="text-[10px] text-text-muted cursor-pointer flex items-center gap-1">
        <input type="checkbox" checked={showCT} onChange={e => onToggleCT(e.target.checked)} />
        {chordDisplay} コードトーン強調
      </label>

      {progMode && onToggleGT && (
        <label className="text-[10px] text-text-muted cursor-pointer flex items-center gap-1">
          <input type="checkbox" checked={showGT ?? false} onChange={e => onToggleGT(e.target.checked)} />
          ガイドトーン (3度/7度)
        </label>
      )}

      {canShowChordForms && onToggleChordForms && (
        <label className="text-[10px] text-text-muted cursor-pointer flex items-center gap-1">
          <input type="checkbox" checked={showChordForms ?? false} onChange={e => onToggleChordForms(e.target.checked)} />
          コードフォーム
        </label>
      )}

      {showChordForms && availableVoicings && availableVoicings.length > 0 && onSelectVoicing && (
        <div className="flex gap-1 items-center">
          <button
            onClick={() => onSelectVoicing(Math.max(0, (selectedVoicingIdx ?? 0) - 1))}
            className={`${btnBase} text-[9px] px-1.5 py-[3px]`}
            style={{ border: '1px solid #444', background: '#1a1a1a', color: '#CCC' }}>
            ◀
          </button>
          <span className="text-[10px] text-text-muted whitespace-nowrap">
            {formatVoicingLabel(availableVoicings[selectedVoicingIdx ?? 0])}
            {' '}({(selectedVoicingIdx ?? 0) + 1}/{availableVoicings.length})
          </span>
          <button
            onClick={() => onSelectVoicing(Math.min(availableVoicings.length - 1, (selectedVoicingIdx ?? 0) + 1))}
            className={`${btnBase} text-[9px] px-1.5 py-[3px]`}
            style={{ border: '1px solid #444', background: '#1a1a1a', color: '#CCC' }}>
            ▶
          </button>
        </div>
      )}

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
        {notationOpen && (['maj7', 'm7', 'm7♭5', 'dim', 'mMaj7', 'aug'] as const).map(key => {
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

      {(showCT || showGT || showChordForms) && (
        <div className="flex gap-2.5 items-center text-[10px]">
          <span className="text-text-muted">|</span>
          {showCT && (
            <>
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
            </>
          )}
          {showGT && (
            <>
              <span className="inline-flex items-center gap-[3px]">
                <span className="inline-block w-[10px] h-[10px] bg-[#F1C40F]" style={{ transform: 'rotate(45deg)' }} />
                <span className="text-text-label">3rd</span>
              </span>
              <span className="inline-flex items-center gap-[3px]">
                <span className="inline-block w-[10px] h-[10px] bg-[#3498DB]" style={{ transform: 'rotate(45deg)' }} />
                <span className="text-text-label">7th</span>
              </span>
              <span className="inline-flex items-center gap-[3px]">
                <span className="inline-block w-[11px] h-[11px] rounded-full border-2 border-dashed border-[#F1C40F]" />
                <span className="text-text-muted">次3rd</span>
              </span>
            </>
          )}
          {showChordForms && (
            <span className="inline-flex items-center gap-[3px]">
              <span className="inline-block w-[13px] h-[13px] rounded-sm border-2 border-[#00E5FF]"
                style={{ background: 'rgba(0,229,255,0.15)' }} />
              <span className="text-text-label">Form</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
