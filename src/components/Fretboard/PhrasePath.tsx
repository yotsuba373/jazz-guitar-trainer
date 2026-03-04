import type { GeneratedPhrase } from '../../types';
import { FW, SG, TP, LP } from '../../constants';

const PHRASE_COLOR = '#FF6B9D';

interface PhrasePathProps {
  phrase: GeneratedPhrase;
}

/** Convert fretboard (stringIdx, fret) to SVG (x, y) */
function toSvg(stringIdx: number, fret: number): { x: number; y: number } {
  return {
    x: LP + (fret - 0.5) * FW,
    y: TP + stringIdx * SG,
  };
}

/**
 * Convert a sequence of points to a Catmull-Rom → Cubic Bezier SVG path.
 * Uses centripetal parameterisation (alpha=0.5) for smooth, kink-free curves.
 */
function catmullRomPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }

  const parts: string[] = [`M${points[0].x},${points[0].y}`];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to Bezier control points (uniform, tension=0)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    parts.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
  }

  return parts.join(' ');
}

/** Compute midpoint and angle between two points for arrow markers */
function midArrow(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
  return { mx, my, angle };
}

export function PhrasePath({ phrase }: PhrasePathProps) {
  const points = phrase.notes.map(n => toSvg(n.stringIdx, n.fret));

  const pathD = catmullRomPath(points);

  return (
    <g>
      {/* Main curve */}
      <path
        d={pathD}
        fill="none"
        stroke={PHRASE_COLOR}
        strokeWidth={2.5}
        opacity={0.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Arrow markers between consecutive notes */}
      {points.slice(0, -1).map((p, i) => {
        const { mx, my, angle } = midArrow(p, points[i + 1]);
        return (
          <polygon
            key={`arr-${i}`}
            points="-4,-3 4,0 -4,3"
            transform={`translate(${mx},${my}) rotate(${angle})`}
            fill={PHRASE_COLOR}
            opacity={0.6}
          />
        );
      })}

      {/* Note markers */}
      {phrase.notes.map((n, i) => {
        const { x, y } = points[i];
        if (n.isChordTone) {
          // Chord tone: filled circle
          return (
            <circle key={`pm-${i}`}
              cx={x} cy={y} r={5}
              fill={PHRASE_COLOR} stroke="#FFF" strokeWidth={1}
              opacity={0.9}
            />
          );
        } else if (n.isApproach) {
          // Approach note: small diamond
          return (
            <rect key={`pm-${i}`}
              x={x - 3.5} y={y - 3.5} width={7} height={7}
              transform={`rotate(45,${x},${y})`}
              fill={PHRASE_COLOR} opacity={0.7}
            />
          );
        } else {
          // Scale tone: open circle
          return (
            <circle key={`pm-${i}`}
              cx={x} cy={y} r={4}
              fill="none" stroke={PHRASE_COLOR} strokeWidth={1.5}
              opacity={0.85}
            />
          );
        }
      })}

      {/* Beat numbers */}
      {phrase.notes.map((n, i) => {
        const { x, y } = points[i];
        return (
          <text key={`bt-${i}`}
            x={x} y={y - 10}
            textAnchor="middle"
            fontSize="7" fontWeight="700" fill={PHRASE_COLOR}
            fontFamily="monospace" opacity={0.7}
          >
            {n.beatPosition}
          </text>
        );
      })}
    </g>
  );
}
