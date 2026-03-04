import { useState, useMemo } from 'react';
import type { GeneratedPhrase, Mode } from '../../types';
import { analyzePhrase } from '../../utils';

interface PhraseAnalysisPanelProps {
  phrase: GeneratedPhrase;
  mode: Mode;
}

const PHRASE_COLOR = '#FF6B9D';

const APPROACH_TYPE_SHORT: Record<string, string> = {
  'single-below': 'Single↑',
  'single-above': 'Single↓',
  'enclosure': 'Encl.',
  'parker-enclosure': 'Parker',
  'b9-arpeggio': '♭9 Arp',
};

export function PhraseAnalysisPanel({ phrase, mode }: PhraseAnalysisPanelProps) {
  const [open, setOpen] = useState(false);
  const analysis = useMemo(() => analyzePhrase(phrase, mode), [phrase, mode]);
  const { notes, summary } = analysis;

  const patternStr = summary.approachPatternsUsed.length > 0
    ? summary.approachPatternsUsed.map(p => `${APPROACH_TYPE_SHORT[p.type] ?? p.type}×${p.count}`).join(' ')
    : 'None';

  return (
    <div className="mb-2" style={{ background: '#1a1a1a', border: `1px solid ${PHRASE_COLOR}30`, borderRadius: 6, fontSize: 10, fontFamily: 'monospace' }}>
      {/* Summary bar */}
      <button
        className="w-full flex gap-3 items-center px-3 py-[5px] cursor-pointer"
        style={{ background: 'transparent', border: 'none', color: '#AAA' }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ color: PHRASE_COLOR }}>{open ? '▼' : '▶'} Analysis</span>
        <span>Contour: <b style={{ color: '#DDD' }}>{summary.contourLabel}</b></span>
        <span>Range: <b style={{ color: '#DDD' }}>{summary.rangeSemitones}st</b></span>
        <span>Step: <b style={{ color: '#DDD' }}>{summary.stepwisePct}%</b></span>
        <span>3rd: <b style={{ color: '#DDD' }}>{summary.thirdsPct}%</b></span>
        <span>Dir.Chg: <b style={{ color: '#DDD' }}>{summary.directionChanges}</b></span>
        <span>Pattern: <b style={{ color: '#DDD' }}>{patternStr}</b></span>
      </button>

      {/* Detail table */}
      {open && (
        <div className="px-3 pb-2 pt-1" style={{ borderTop: '1px solid #333' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#666' }}>
                <th className="text-left py-[2px] pr-2" style={{ width: 28 }}>Beat</th>
                <th className="text-left py-[2px] pr-2" style={{ width: 36 }}>Note</th>
                <th className="text-left py-[2px] pr-2" style={{ width: 36 }}>Deg</th>
                <th className="text-left py-[2px] pr-2" style={{ width: 44 }}>Int.</th>
                <th className="text-left py-[2px]">Function</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n, i) => {
                const isCT = phrase.notes[i].isChordTone;
                const isApproach = phrase.notes[i].isApproach;
                const ag = n.approachGroup;

                // Group bracket styling
                const isGroupStart = ag && ag.role === 'approach' && ag.positionInGroup === 0;
                const isGroupEnd = ag && ag.role === 'target';
                const isInGroup = !!ag;

                const rowColor = isCT ? '#EEE' : isApproach ? '#CC9' : '#888';
                const borderLeft = isInGroup ? `2px solid ${PHRASE_COLOR}60` : '2px solid transparent';

                return (
                  <tr key={i} style={{ color: rowColor, borderLeft }}>
                    <td className="py-[2px] pr-2" style={{ color: n.beatPosition === 1 || n.beatPosition === 8 ? PHRASE_COLOR : rowColor }}>
                      {n.beatPosition}
                    </td>
                    <td className="py-[2px] pr-2" style={{ fontWeight: isCT ? 700 : 400 }}>
                      {n.noteName}
                    </td>
                    <td className="py-[2px] pr-2">
                      {n.scaleDegree}
                    </td>
                    <td className="py-[2px] pr-2">
                      {n.intervalLabel}
                    </td>
                    <td className="py-[2px]">
                      {isGroupStart && '┌ '}
                      {isInGroup && !isGroupStart && !isGroupEnd && '│ '}
                      {isGroupEnd && '└ '}
                      {n.functionLabel}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Composition summary */}
          <div className="mt-2 pt-1 flex gap-3" style={{ borderTop: '1px solid #333', color: '#666' }}>
            <span>CT: <b style={{ color: '#DDD' }}>{summary.chordToneCount}/8</b></span>
            <span>Approach: <b style={{ color: '#CC9' }}>{summary.approachNoteCount}</b></span>
            <span>Scale: <b style={{ color: '#888' }}>{summary.scaleNoteCount}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
