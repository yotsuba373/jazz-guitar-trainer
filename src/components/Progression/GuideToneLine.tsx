import { useMemo } from 'react';
import type { Progression, ChordNotationPrefs } from '../../types';
import { MODE_TEMPLATES } from '../../constants';
import {
  QUALITY_TO_MODES, computeEffectiveSelections, resolveMode,
  displayChordName,
} from '../../utils';
import { getGuideTones, classifyResolution } from '../../utils/guideTones';

interface GuideToneLineProps {
  progression: Progression;
  activeChordIdx: number;
  chordPrefs: ChordNotationPrefs;
}

export function GuideToneLine({ progression, activeChordIdx, chordPrefs }: GuideToneLineProps) {
  const chords = progression.chords;

  const entries = useMemo(() => {
    const effAll = computeEffectiveSelections(chords, progression.songKey);
    return chords.map((c, i) => {
      const eff = effAll[i];
      if (!eff || !QUALITY_TO_MODES[c.quality]) return null;
      const mode = resolveMode(c.rootName, MODE_TEMPLATES[eff.modeIdx]);
      const gt = getGuideTones(mode);
      const thirdSemi = mode.semi[mode.notes.indexOf(gt.third)];
      const seventhSemi = mode.semi[mode.notes.indexOf(gt.seventh)];
      return { symbol: c.symbol, third: gt.third, seventh: gt.seventh, thirdSemi, seventhSemi };
    });
  }, [chords, progression.songKey]);

  if (entries.every(e => e == null)) return null;

  function resolutionMarker(prevSevSemi: number, curThirdSemi: number): string {
    const r = classifyResolution(prevSevSemi, curThirdSemi);
    if (r === 'half-step-down') return '↓½';
    if (r === 'half-step-up') return '↑½';
    if (r === 'common-tone') return '=';
    return '';
  }

  return (
    <div className="overflow-x-auto mb-2">
      <div className="inline-flex font-mono text-[9px] leading-tight">
        {entries.map((entry, i) => {
          if (!entry) return (
            <div key={i} className="px-2 py-1 text-center min-w-[48px] opacity-30">
              <div className="text-text-dim">{chords[i].symbol}</div>
              <div>—</div>
              <div>—</div>
            </div>
          );

          const active = i === activeChordIdx;
          const prev = i > 0 ? entries[i - 1] : null;
          const mark = prev ? resolutionMarker(prev.seventhSemi, entry.thirdSemi) : '';

          return (
            <div key={i} className="flex items-stretch">
              {/* Resolution arrow column */}
              {i > 0 && (
                <div className="flex flex-col items-center justify-center px-0.5 text-[8px] text-text-dim">
                  {mark ? <span className="text-[#F1C40F]">{mark}</span> : <span>→</span>}
                </div>
              )}
              {/* Chord column */}
              <div
                className="px-1.5 py-1 text-center min-w-[40px] rounded"
                style={{
                  background: active ? '#2a2a3a' : 'transparent',
                  border: active ? '1px solid #555' : '1px solid transparent',
                }}
              >
                <div className="text-text-dim mb-0.5 truncate">
                  {displayChordName(chords[i], chordPrefs)}
                </div>
                <div className="text-[#F1C40F]">3: {entry.third}</div>
                <div className="text-[#3498DB]">7: {entry.seventh}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
