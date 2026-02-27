import { useState, useMemo } from 'react';
import type { LabelMode, RootName } from './types';
import { MODE_TEMPLATES, ROOTS, MODE_COLORS } from './constants';
import { buildFretMap, generatePositions, resolveMode } from './utils';
import { Fretboard } from './components/Fretboard';
import { RootSelector, ModeSelector, PositionSelector, OptionBar } from './components/Controls';
import { PositionDetail } from './components/PositionDetail';
import { PositionGrid } from './components/PositionGrid';
import { Footer } from './components/Footer';

export default function App() {
  const [rootName, setRootName] = useState<RootName>('C');
  const [modeIdx, setModeIdx] = useState(0);
  const [selPosId, setSelPosId] = useState<number | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [showCT, setShowCT] = useState(false);
  const [labelMode, setLabelMode] = useState<LabelMode>('note');

  const template = MODE_TEMPLATES[modeIdx];
  const mode = useMemo(() => resolveMode(rootName, template), [rootName, modeIdx]);
  const fretMap = useMemo(() => buildFretMap(mode.semi, mode.notes), [rootName, modeIdx]);
  const allPos = useMemo(() => generatePositions(fretMap, mode.notes), [fretMap]);
  const ctSet = useMemo(() => new Set(mode.chordTones), [rootName, modeIdx]);
  const deg = mode.degrees;
  const rootNote = mode.notes[0];
  const selPos = selPosId != null ? allPos.find(p => p.id === selPosId) ?? null : null;

  const visible = overlay ? allPos : (selPos ? [selPos] : allPos);
  const dim = selPos != null && !overlay;

  function getLabel(nn: string): string {
    return labelMode === 'degree' ? (deg[nn] || nn) : nn;
  }

  return (
    <div className="bg-bg-root text-text-primary min-h-screen font-mono p-4">
      <div className="max-w-[1040px] mx-auto">
        <h2 className="text-lg font-bold mb-0.5 tracking-wide">
          Berklee 7-Position System
        </h2>
        <p className="text-[10px] text-text-dim mb-3">
          B弦2音 + 他弦3音 ｜ 7モード対応
        </p>

        <RootSelector roots={ROOTS} selectedRoot={rootName} onRootChange={setRootName} />
        <ModeSelector templates={MODE_TEMPLATES} modeIdx={modeIdx} rootName={rootName} onModeChange={setModeIdx} />

        <div className="text-[11px] text-text-secondary mb-1">
          <span className="font-bold" style={{ color: MODE_COLORS[mode.key] }}>{rootNote} {mode.name}</span>
          <span className="text-text-dim ml-2">{mode.notes.join(' ')}</span>
        </div>
        <div className="text-[10px] text-text-dim mb-2.5">
          {mode.chord}: {mode.chordTones.join(' ')} ({mode.chordSub})
        </div>

        <PositionSelector
          positions={allPos}
          selPosId={selPosId}
          overlay={overlay}
          onSelectAll={() => { setSelPosId(null); setOverlay(false); }}
          onSelectPosition={(id) => { setSelPosId(id); setOverlay(false); }}
          onToggleOverlay={() => { setOverlay(true); setSelPosId(null); }}
        />

        <OptionBar
          mode={mode}
          showCT={showCT}
          labelMode={labelMode}
          onToggleCT={setShowCT}
          onSetLabelMode={setLabelMode}
        />

        <Fretboard
          visible={visible}
          selPosId={selPosId}
          dim={dim}
          showCT={showCT}
          ctSet={ctSet}
          getLabel={getLabel}
          rootNote={rootNote}
        />

        {selPos && (
          <PositionDetail
            position={selPos}
            mode={mode}
            showCT={showCT}
            ctSet={ctSet}
            getLabel={getLabel}
            rootNote={rootNote}
          />
        )}

        <PositionGrid
          positions={allPos}
          selPosId={selPosId}
          onSelectPosition={(id) => { setSelPosId(id); setOverlay(false); }}
        />

        <Footer />
      </div>
    </div>
  );
}
