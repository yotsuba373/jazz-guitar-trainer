import { LP, FW, TP, SG } from '../../constants';

interface GhostNoteProps {
  stringIdx: number;
  fret: number;
  noteName: string;
  color: string;
}

export function GhostNote({ stringIdx, fret, noteName: _noteName, color }: GhostNoteProps) {
  const cx = LP + (fret - 0.5) * FW;
  const cy = TP + stringIdx * SG;

  return (
    <g>
      {/* Outer dashed ring — visible over any existing note */}
      <circle
        cx={cx} cy={cy} r={16}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="4 2.5"
        opacity={0.7}
      />
      {/* Small label outside the ring */}
      <text
        x={cx} y={cy - 19} textAnchor="middle"
        fontSize="7" fontWeight="700" fill={color} fontFamily="monospace"
        opacity={0.8}
      >次3</text>
    </g>
  );
}
