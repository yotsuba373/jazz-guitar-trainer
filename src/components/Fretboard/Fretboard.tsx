import type { Position } from '../../types';
import { STR_LABELS, POS_COLORS, FC, FW, SG, TP, LP, DOTS, SVG_WIDTH, SVG_HEIGHT } from '../../constants';
import { FretboardNote } from './FretboardNote';

interface FretboardProps {
  visible: Position[];
  selPosId: number | null;
  dim: boolean;
  showCT: boolean;
  ctSet: Set<string>;
  getLabel: (nn: string) => string;
  rootNote: string;
}

export function Fretboard({ visible, selPosId, dim, showCT, ctSet, getLabel, rootNote }: FretboardProps) {
  return (
    <div className="overflow-x-auto mb-[14px]">
      <svg width={SVG_WIDTH} height={SVG_HEIGHT}
        className="bg-bg-svg rounded-lg block">
        {/* Fret numbers */}
        {Array.from({ length: FC }, (_, i) => i + 1).map(f =>
          <text key={f} x={LP + (f - 0.5) * FW} y={TP - 26} textAnchor="middle"
            fontSize="9" fill="#444" fontFamily="monospace">{f}</text>
        )}

        {/* Nut */}
        <line x1={LP} y1={TP - 4} x2={LP} y2={TP + 5 * SG + 4} stroke="#999" strokeWidth="5" />

        {/* Fret lines */}
        {Array.from({ length: FC }, (_, i) => i + 1).map(f =>
          <line key={f} x1={LP + f * FW} y1={TP - 4} x2={LP + f * FW} y2={TP + 5 * SG + 4}
            stroke="#2a2a2a" strokeWidth="1" />
        )}

        {/* Dot inlays */}
        {DOTS.map(f => f === 12 ? (
          <g key={f}>
            <circle cx={LP + (f - 0.5) * FW} cy={TP + 1.5 * SG} r="3" fill="#2a2a2a" />
            <circle cx={LP + (f - 0.5) * FW} cy={TP + 3.5 * SG} r="3" fill="#2a2a2a" />
          </g>
        ) : (
          <circle key={f} cx={LP + (f - 0.5) * FW} cy={TP + 2.5 * SG} r="3" fill="#2a2a2a" />
        ))}

        {/* Strings */}
        {Array.from({ length: 6 }, (_, s) => (
          <g key={s}>
            <line x1={LP} y1={TP + s * SG} x2={LP + FC * FW} y2={TP + s * SG}
              stroke={s === 1 ? '#887766' : '#555'} strokeWidth={s === 1 ? 1.2 : 0.7 + s * 0.3} />
            <text x={LP - 22} y={TP + s * SG + 4} textAnchor="middle"
              fontSize="11" fill={s === 1 ? '#aa9977' : '#666'} fontWeight="600" fontFamily="monospace">
              {STR_LABELS[s]}
            </text>
          </g>
        ))}

        {/* B-string 2-note annotation */}
        <text x={LP + FC * FW + 12} y={TP + 1 * SG + 4} textAnchor="start"
          fontSize="8" fill="#665544" fontFamily="monospace">★2音</text>

        {/* Notes */}
        {visible.map(pos => {
          const c = POS_COLORS[pos.id - 1];
          return (
            <g key={pos.id} opacity={(!dim || selPosId === pos.id) ? 1 : 0.07}>
              {pos.instances.map((inst, iIdx) =>
                inst.strings.map((notes, sIdx) =>
                  notes && notes.map(([n, f]) => (
                    <FretboardNote
                      key={`${pos.id}-${iIdx}-${sIdx}-${f}`}
                      posId={pos.id}
                      stringIndex={sIdx}
                      noteName={n}
                      fret={f}
                      posColor={c}
                      isRoot={n === rootNote}
                      isCT={showCT && ctSet.has(n)}
                      showCT={showCT}
                      label={getLabel(n)}
                    />
                  ))
                )
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
