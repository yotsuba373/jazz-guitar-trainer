import { useState, useMemo } from 'react';
import type { GeneratedPhrase, Mode } from '../../types';
import { analyzePhrase } from '../../utils';
import { PianoRoll } from './PianoRoll';

interface PhraseAnalysisPanelProps {
  phrase: GeneratedPhrase;
  mode: Mode;
  swingAmount?: number;
  bpm?: number;
}

const PHRASE_COLOR = '#FF6B9D';

const APPROACH_TYPE_SHORT: Record<string, string> = {
  'single-below': '半音↑',
  'single-above': '半音↓',
  'enclosure': 'Encl.',
  'parker-enclosure': 'Parker',
  'b9-arpeggio': '♭9 Arp',
};

export function PhraseAnalysisPanel({ phrase, mode, swingAmount, bpm }: PhraseAnalysisPanelProps) {
  const [open, setOpen] = useState(false);
  const analysis = useMemo(() => analyzePhrase(phrase, mode), [phrase, mode]);
  const { notes, summary } = analysis;

  const patternStr = summary.approachPatternsUsed.length > 0
    ? summary.approachPatternsUsed.map(p => `${APPROACH_TYPE_SHORT[p.type] ?? p.type}×${p.count}`).join(' ')
    : 'なし';

  return (
    <div className="mb-2" style={{ background: '#1a1a1a', border: `1px solid ${PHRASE_COLOR}30`, borderRadius: 6, fontSize: 10 }}>
      {/* Summary bar */}
      <button
        className="w-full flex flex-col gap-0 items-start px-3 py-[5px] cursor-pointer"
        style={{ background: 'transparent', border: 'none', color: '#AAA', fontSize: 11 }}
        onClick={() => setOpen(!open)}
      >
        <div className="flex gap-3 items-center w-full">
          <span style={{ color: PHRASE_COLOR }} className="inline-flex items-center gap-1">
            <svg width="8" height="8" viewBox="0 0 8 8" className="flex-shrink-0">
              {open
                ? <polygon points="0,2 8,2 4,7" fill="currentColor" />
                : <polygon points="2,0 7,4 2,8" fill="currentColor" />
              }
            </svg>
            分析
          </span>
          <span title="最高音と最低音の距離（半音数）">音域: <b style={{ color: '#DDD' }}>{summary.rangeSemitones}半音</b></span>
          <span title="順次進行の割合">順次: <b style={{ color: '#DDD' }}>{summary.stepwisePct}%</b></span>
          <span title="3度跳躍の割合">3度: <b style={{ color: '#DDD' }}>{summary.thirdsPct}%</b></span>
          <span title="方向転換回数">方向転換: <b style={{ color: '#DDD' }}>{summary.directionChanges}</b></span>
          <span title="アプローチパターン">パターン: <b style={{ color: '#DDD' }}>{patternStr}</b></span>
        </div>
      </button>

      {/* Detail table */}
      {open && (
        <div className="px-3 pb-2 pt-1" style={{ borderTop: '1px solid #333' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#666' }}>
                <th className="text-left py-[2px] pr-2" style={{ width: 28 }}>拍</th>
                <th className="text-left py-[2px] pr-2" style={{ width: 36 }}>音名</th>
                <th className="text-left py-[2px] pr-2" style={{ width: 36 }}>度数</th>
                <th className="text-left py-[2px] pr-2" style={{ width: 44 }}>音程</th>
                <th className="text-left py-[2px]">機能</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n, i) => {
                const isCT = phrase.notes[i].isChordTone;
                const isApproach = phrase.notes[i].isApproach;
                const ag = n.approachGroup;

                // Approach group bracket styling
                const isGroupStart = ag && ag.role === 'approach' && ag.positionInGroup === 0;
                const isGroupEnd = ag && ag.role === 'target';
                const isInGroup = !!ag;

                const rowColor = isCT ? '#EEE'
                  : isApproach ? '#CC9'
                  : '#888';

                const borderLeft = isInGroup ? `2px solid ${PHRASE_COLOR}60`
                  : '2px solid transparent';

                return (
                  <tr key={i} style={{ color: rowColor, borderLeft }}>
                    <td className="py-[2px] pr-2" style={{
                      color: n.beatPosition === 1 || n.beatPosition === 8 ? PHRASE_COLOR : rowColor,
                    }}>
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
          <div className="mt-2 pt-1 flex gap-3 flex-wrap" style={{ borderTop: '1px solid #333', color: '#666' }}>
            <span title="コードトーン数">CT: <b style={{ color: '#DDD' }}>{summary.chordToneCount}/{phrase.notes.length}</b></span>
            <span title="アプローチノート数">アプローチ: <b style={{ color: '#CC9' }}>{summary.approachNoteCount}</b></span>
            <span title="スケール音数">スケール: <b style={{ color: '#888' }}>{summary.scaleNoteCount}</b></span>
            {summary.extensionCount != null && summary.extensionCount > 0 && (
              <span title="テンション数">テンション: <b style={{ color: '#80FFAA' }}>{summary.extensionCount}</b></span>
            )}
          </div>

          {/* Piano Roll visualization */}
          <div className="mt-2 pt-1" style={{ borderTop: '1px solid #333' }}>
            <PianoRoll phrase={phrase} noteAnalysis={notes} swingAmount={swingAmount} bpm={bpm} />
          </div>
        </div>
      )}
    </div>
  );
}
