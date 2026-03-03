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
  isGuideTone?: boolean;
  guideRole?: '3rd' | '7th';
  isVoicingNote?: boolean;
  onClick?: () => void;
}

export function FretboardNote({
  posId, stringIndex, noteName: _noteName, fret, posColor,
  isRoot, isCT, showCT, label, isGuideTone, guideRole, isVoicingNote, onClick,
}: FretboardNoteProps) {
  const cx = LP + (fret - 0.5) * FW;
  const cy = TP + stringIndex * SG;
  const fs = label.length > 2 ? '7' : label.length > 1 ? '8' : '10';

  // Guide tone: diamond shape (except root, which keeps its distinct style)
  if (isGuideTone && !isRoot) {
    const d = 16;
    const gtColor = guideRole === '3rd' ? '#F1C40F' : '#3498DB';
    return (
      <g key={`${posId}-${stringIndex}-${fret}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
        {isVoicingNote && (
          <rect x={cx - 15} y={cy - 15} width={30} height={30} rx={5}
            fill="rgba(0,229,255,0.12)" stroke="#00E5FF" strokeWidth={2.5} />
        )}
        <rect
          x={cx - d / 2} y={cy - d / 2} width={d} height={d}
          transform={`rotate(45 ${cx} ${cy})`}
          fill={gtColor} stroke="#FFF" strokeWidth={1.5}
        />
        <text
          x={cx} y={cy + 4} textAnchor="middle"
          fontSize="10" fontWeight="700" fill="#000" fontFamily="monospace"
        >{label}</text>
      </g>
    );
  }

  let fill = posColor, tc = '#FFF', r = 12, sk = 'none', sw = 0;
  if (isRoot) { fill = '#FFF'; tc = posColor; r = 13; sk = posColor; sw = 2.5; }
  else if (showCT && !isCT) { fill = '#1a1a1a'; tc = '#555'; sk = posColor; sw = 1.5; r = 11; }

  return (
    <g key={`${posId}-${stringIndex}-${fret}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {isVoicingNote && (
        <rect x={cx - 15} y={cy - 15} width={30} height={30} rx={5}
          fill="rgba(0,229,255,0.12)" stroke="#00E5FF" strokeWidth={2.5} />
      )}
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={sk} strokeWidth={sw} />
      <text
        x={cx} y={cy + 3.5} textAnchor="middle"
        fontSize={fs} fontWeight="700" fill={tc} fontFamily="monospace"
      >{label}</text>
    </g>
  );
}
