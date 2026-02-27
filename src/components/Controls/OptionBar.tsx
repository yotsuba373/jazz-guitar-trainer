import type { Mode, LabelMode } from '../../types';

interface OptionBarProps {
  mode: Mode;
  showCT: boolean;
  labelMode: LabelMode;
  onToggleCT: (checked: boolean) => void;
  onSetLabelMode: (mode: LabelMode) => void;
}

const btnBase = 'rounded cursor-pointer font-mono';

export function OptionBar({ mode, showCT, labelMode, onToggleCT, onSetLabelMode }: OptionBarProps) {
  return (
    <div className="flex gap-3.5 mb-3 flex-wrap items-center">
      <label className="text-[10px] text-text-muted cursor-pointer flex items-center gap-1">
        <input type="checkbox" checked={showCT} onChange={e => onToggleCT(e.target.checked)} />
        {mode.chord} コードトーン強調
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
