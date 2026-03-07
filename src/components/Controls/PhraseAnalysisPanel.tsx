import { useState, useMemo } from 'react';
import type { GeneratedPhrase, Mode } from '../../types';
import { analyzePhrase } from '../../utils';
import { PHRASE_TEMPLATES } from '../../utils/bebopTemplates';
import { PianoRoll } from './PianoRoll';

interface PhraseAnalysisPanelProps {
  phrase: GeneratedPhrase;
  mode: Mode;
}

const PHRASE_COLOR = '#FF6B9D';
const SKELETON_COLOR = '#B0B0FF';
const DIGITAL_COLOR = '#FFB060';
const GOAL_COLOR = '#80FFAA';
const BEBOP_COLOR = '#FFB060';
const EXT_COLOR = '#80FFAA';

const APPROACH_TYPE_SHORT: Record<string, string> = {
  'single-below': '半音↑',
  'single-above': '半音↓',
  'enclosure': 'Encl.',
  'parker-enclosure': 'Parker',
  'b9-arpeggio': '♭9 Arp',
};

const SEG_TYPE_LABEL: Record<string, [string, string]> = {
  //                        asc              desc
  arpeggio:              ['アルペジオ上行', 'アルペジオ下行'],
  scaleRun:              ['スケール上昇',   'スケール下降'],
  enclosure:             ['エンクロージャー上', 'エンクロージャー下'],
  '1235':                ['1-2-3-5 上行',   '1-2-3-5 下行'],
  approachCT:            ['アプローチ→CT上', 'アプローチ→CT下'],
  dim7From3rd:           ['dim7アルペジオ上行', 'dim7アルペジオ下行'],
  upperStructure:        ['アッパーストラクチャー上行', 'アッパーストラクチャー下行'],
  chromatic:             ['クロマチック上昇', 'クロマチック下降'],
  octaveDisp:            ['オクターブ跳躍上', 'オクターブ跳躍下'],
};

const FALLBACK_TEMPLATE_LABELS: Record<string, string> = {
  'scale-down-fallback': 'スケール下降 (フォールバック)',
};

function buildDebugJson(phrase: GeneratedPhrase): string {
  const obj: Record<string, unknown> = {
    root: phrase.rootName,
    mode: phrase.modeKey,
    posId: phrase.posId,
    templateId: phrase.templateId ?? null,
    contour: phrase.config.contour ?? null,
    goalReason: phrase.goalReason ?? null,
    beatCount: phrase.config.beatCount ?? 4,
    totalBeats: phrase.totalBeats,
  };
  if (phrase.config.nextChordContext) {
    const c = phrase.config.nextChordContext;
    obj.nextChord = { third: c.thirdNote, seventh: c.seventhNote, root: c.rootNote, quality: c.quality };
  }
  if (phrase.config.goalNoteOverride) {
    obj.goalOverride = phrase.config.goalNoteOverride.noteName;
  }
  obj.notes = phrase.notes.map(n => {
    const r: Record<string, unknown> = {
      n: n.noteName, s: n.stringIdx, f: n.fret, ct: n.isChordTone,
    };
    if (n.isApproach) r.ap = true;
    if (n.segmentIdx != null) r.seg = n.segmentIdx;
    if (n.beatStart != null) r.beat = n.beatStart;
    if (n.duration) r.dur = n.duration;
    return r;
  });
  return JSON.stringify(obj, null, 2);
}

function TemplateInfo({ phrase }: { phrase: GeneratedPhrase }) {
  const [copied, setCopied] = useState(false);
  const tmpl = PHRASE_TEMPLATES.find(t => t.id === phrase.templateId);

  // Count notes per segment
  const segCounts = new Map<number, number>();
  for (const n of phrase.notes) {
    if (n.segmentIdx != null) segCounts.set(n.segmentIdx, (segCounts.get(n.segmentIdx) ?? 0) + 1);
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(buildDebugJson(phrase)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const circled = ['①', '②', '③', '④', '⑤'];
  const segLabel = (type: string, dir: string) => {
    const pair = SEG_TYPE_LABEL[type];
    if (pair) return dir === 'asc' ? pair[0] : pair[1];
    return type;
  };

  return (
    <div className="mt-1 pt-1" style={{ borderTop: '1px solid #333', color: '#666' }}>
      <div className="flex items-center gap-2">
        <span title={tmpl?.description}>テンプレート: <b style={{ color: '#DDD' }}>{tmpl?.label ?? FALLBACK_TEMPLATE_LABELS[phrase.templateId!] ?? phrase.templateId}</b></span>
        <button
          onClick={handleCopy}
          style={{
            marginLeft: 'auto', background: copied ? '#2a4a2a' : '#2a2a2a',
            border: '1px solid #555', borderRadius: 3, color: copied ? '#80FF80' : '#AAA',
            fontSize: 9, padding: '1px 6px', cursor: 'pointer',
          }}
        >
          {copied ? '✓ Copied' : '📋 Debug'}
        </button>
      </div>
      {tmpl && tmpl.segments.length > 1 && (
        <div style={{ marginTop: 2, color: '#888' }}>
          {tmpl.segments.map((seg, i) => {
            const name = segLabel(seg.type, seg.direction);
            const beats = seg.beats > 0 ? `${seg.beats}拍` : '残り';
            const count = segCounts.get(i);
            return (
              <span key={i}>
                {i > 0 && <span style={{ margin: '0 4px' }}>→</span>}
                {circled[i] ?? `${i + 1}`} {name} ({beats}){count != null && <span style={{ color: '#AAA' }}> {count}音</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PhraseAnalysisPanel({ phrase, mode }: PhraseAnalysisPanelProps) {
  const [open, setOpen] = useState(false);
  const analysis = useMemo(() => analyzePhrase(phrase, mode), [phrase, mode]);
  const { notes, summary } = analysis;

  const patternStr = summary.approachPatternsUsed.length > 0
    ? summary.approachPatternsUsed.map(p => `${APPROACH_TYPE_SHORT[p.type] ?? p.type}×${p.count}`).join(' ')
    : 'なし';

  const isSegmented = !!phrase.templateId && phrase.notes.some(n => n.segmentIdx != null);
  const hasMultiSections = isSegmented;

  return (
    <div className="mb-2" style={{ background: '#1a1a1a', border: `1px solid ${PHRASE_COLOR}30`, borderRadius: 6, fontSize: 10, fontFamily: 'monospace' }}>
      {/* Summary bar — Row 1: existing stats */}
      <button
        className="w-full flex flex-col gap-0 items-start px-3 py-[5px] cursor-pointer"
        style={{ background: 'transparent', border: 'none', color: '#AAA' }}
        onClick={() => setOpen(!open)}
      >
        <div className="flex gap-3 items-center w-full">
          <span style={{ color: PHRASE_COLOR }}>{open ? '▼' : '▶'} 分析</span>
          <span title="フレーズ全体の音形パターン（アーチ＝上行→下行、逆アーチ＝下行→上行、下行、波形）">音形: <b style={{ color: '#DDD' }}>{summary.contourLabel}</b></span>
          <span title="最高音と最低音の距離（半音数）">音域: <b style={{ color: '#DDD' }}>{summary.rangeSemitones}半音</b></span>
          <span title="半音〜全音の順次進行（隣接音への移動）の割合。高いほど滑らかなライン">順次: <b style={{ color: '#DDD' }}>{summary.stepwisePct}%</b></span>
          <span title="3度跳躍（3〜4半音）の割合。アルペジオ的な動きの指標">3度: <b style={{ color: '#DDD' }}>{summary.thirdsPct}%</b></span>
          <span title="上行↔下行の切り替え回数。多いほど波打つようなライン">方向転換: <b style={{ color: '#DDD' }}>{summary.directionChanges}</b></span>
          <span title="使用されたアプローチパターン（半音↑↓＝半音接近、Encl.＝上下から挟む、Parker＝3音エンクロージャー、♭9 Arp＝♭9アルペジオ）">パターン: <b style={{ color: '#DDD' }}>{patternStr}</b></span>
        </div>
        {/* Row 2: generation metadata */}
        <div className="flex gap-3 items-center w-full" style={{ fontSize: 9, marginTop: 1 }}>
          {summary.templateLabel && (
            <span title={PHRASE_TEMPLATES.find(t => t.id === phrase.templateId)?.description ?? ''}>テンプレ: <b style={{ color: PHRASE_COLOR }}>{summary.templateLabel}</b></span>
          )}
          {summary.skeletonLabel && (
            <span title="ハーモニック・スケルトン: 強拍(1,3,5,8拍)に配置するコードトーンのアルペジオパターンと方向（↑上行/↓下行/↕混合）">骨格: <b style={{ color: SKELETON_COLOR }}>{summary.skeletonLabel}</b></span>
          )}
          {summary.digitalPatternUsed && (
            <span title="デジタルパターン: パーカー語彙に基づくコードトーン進行パターン（例: 1-2-3-5 = R→2nd→3rd→5th）">デジタルP: <b style={{ color: DIGITAL_COLOR }}>{summary.digitalPatternUsed}</b>
              {summary.digitalPatternBeats && <span style={{ color: '#888' }}> (拍{summary.digitalPatternBeats})</span>}
            </span>
          )}
          {summary.motifLabel && (
            <span title="モチーフ: フレーズ冒頭の音程パターン。次フレーズ生成時に類似パターンが優先される">冒頭音程: <b style={{ color: '#DDD' }}>{summary.motifLabel}</b></span>
          )}
          {summary.goalReason && (
            <span title="ゴール音（8拍目）の選択理由。進行モードでは次コードの3rdをターゲットにすることで滑らかな接続を実現">ゴール: <b style={{ color: GOAL_COLOR }}>{summary.goalReason}</b></span>
          )}
        </div>
      </button>

      {/* Detail table */}
      {open && (
        <div className="px-3 pb-2 pt-1" style={{ borderTop: '1px solid #333' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#666' }}>
                {hasMultiSections && <th className="text-left py-[2px] pr-1" style={{ width: 20 }}></th>}
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
                const dp = n.digitalPattern;

                // Approach group bracket styling
                const isGroupStart = ag && ag.role === 'approach' && ag.positionInGroup === 0;
                const isGroupEnd = ag && ag.role === 'target';
                const isInGroup = !!ag;

                // Digital pattern bracket styling
                const isDpStart = dp && dp.position === 0;
                const isDpEnd = dp && dp.position === dp.size - 1;
                const isInDp = !!dp;

                const rowColor = n.isBebopPassing ? BEBOP_COLOR
                  : n.isExtension ? EXT_COLOR
                  : isCT ? '#EEE'
                  : isApproach ? '#CC9'
                  : '#888';

                // Left border: approach group takes priority, then digital pattern
                const borderLeft = isInGroup ? `2px solid ${PHRASE_COLOR}60`
                  : isInDp ? `2px solid ${DIGITAL_COLOR}60`
                  : '2px solid transparent';

                // Boundary detection for segmented templates
                const curSegIdx = phrase.notes[i].segmentIdx;
                const prevSegIdx = i > 0 ? phrase.notes[i - 1].segmentIdx : curSegIdx;
                const isBoundary = isSegmented && i > 0 && curSegIdx !== prevSegIdx;
                const sectionNum = curSegIdx ?? -1;
                const sectionBadge = sectionNum === 0 ? '①' : sectionNum === 1 ? '②' : sectionNum === 2 ? '③' : '∙';

                return (
                  <tr key={i} style={{ color: rowColor, borderLeft, ...(isBoundary ? { borderTop: '2px dashed #FF6B9D80' } : {}) }}>
                    {hasMultiSections && (
                      <td className="py-[2px] pr-1" style={{ color: '#666', fontSize: 8 }}>
                        {(i === 0 || isBoundary) ? sectionBadge : ''}
                      </td>
                    )}
                    <td className="py-[2px] pr-2" style={{
                      color: n.beatPosition === 1 || n.beatPosition === 8 ? PHRASE_COLOR : rowColor,
                      fontWeight: n.isSkeletonBeat ? 700 : 400,
                      ...(n.isSkeletonBeat ? { background: `${SKELETON_COLOR}18`, borderRadius: 2 } : {}),
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
                      {!isInGroup && isDpStart && '┌ '}
                      {!isInGroup && isInDp && !isDpStart && !isDpEnd && '│ '}
                      {!isInGroup && isDpEnd && '└ '}
                      {n.functionLabel}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Composition summary */}
          <div className="mt-2 pt-1 flex gap-3 flex-wrap" style={{ borderTop: '1px solid #333', color: '#666' }}>
            <span title="コードトーン (R, 3rd, 5th, 7th) の数。強拍に配置されるほど調性が明確">CT: <b style={{ color: '#DDD' }}>{summary.chordToneCount}/{phrase.notes.length}</b></span>
            <span title="アプローチノート（半音/エンクロージャー等でCTに解決する装飾音）の数">アプローチ: <b style={{ color: '#CC9' }}>{summary.approachNoteCount}</b></span>
            <span title="スケール音（CTでもアプローチでもない音階上の音）の数">スケール: <b style={{ color: '#888' }}>{summary.scaleNoteCount}</b></span>
            {summary.bebopPassingCount != null && summary.bebopPassingCount > 0 && (
              <span title="ビバップスケールの経過音（Mixolydianのnat7、Dorianのnat3等）。弱拍で使い8分音符の流れを維持">ビバップ: <b style={{ color: BEBOP_COLOR }}>{summary.bebopPassingCount}</b></span>
            )}
            {summary.extensionCount != null && summary.extensionCount > 0 && (
              <span title="テンション（9th, 13th等）。コードに色彩を加えるスケール外の音">テンション: <b style={{ color: EXT_COLOR }}>{summary.extensionCount}</b></span>
            )}
          </div>

          {/* Template info */}
          {phrase.templateId && (
            <TemplateInfo phrase={phrase} />
          )}

          {/* Piano Roll visualization */}
          <div className="mt-2 pt-1" style={{ borderTop: '1px solid #333' }}>
            <PianoRoll phrase={phrase} noteAnalysis={notes} />
          </div>
        </div>
      )}
    </div>
  );
}
