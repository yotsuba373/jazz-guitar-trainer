import { LP, FW, TP, SG } from '../../constants';

interface FretboardNoteProps {
  posId: number;
  stringIndex: number;
  noteName: string;
  fret: number;
  posColor: string;
  isRoot: boolean;
  isCT: boolean;
  showCT: boolean;
  label: string;
}

export function FretboardNote({
  posId, stringIndex, noteName: _noteName, fret, posColor,
  isRoot, isCT, showCT, label,
}: FretboardNoteProps) {
  const cx = LP + (fret - 0.5) * FW;
  const cy = TP + stringIndex * SG;

  let fill = posColor, tc = '#FFF', r = 12, sk = 'none', sw = 0;
  if (isRoot) { fill = '#FFF'; tc = posColor; r = 13; sk = posColor; sw = 2.5; }
  else if (showCT && !isCT) { fill = '#1a1a1a'; tc = '#555'; sk = posColor; sw = 1.5; r = 11; }

  return (
    <g key={`${posId}-${stringIndex}-${fret}`}>
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={sk} strokeWidth={sw} />
      <text
        x={cx} y={cy + 3.5} textAnchor="middle"
        fontSize={label.length > 2 ? '7' : label.length > 1 ? '8' : '10'}
        fontWeight="700" fill={tc} fontFamily="monospace"
      >{label}</text>
    </g>
  );
}
