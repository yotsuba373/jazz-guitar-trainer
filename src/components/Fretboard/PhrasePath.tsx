import type { GeneratedPhrase } from '../../types';
import { FW, SG, TP, LP } from '../../constants';

/** Beat-indexed color gradient: warm pink (beat 1) → cool violet (beat 8).
 *  Hue-shifted rather than darkened so all beats stay readable. */
const BEAT_COLORS = [
  '#FFA0B0', '#FF90B8', '#FF80C8', '#FF7ED8',
  '#EE80E8', '#DD88F0', '#CC90F8', '#BBA0FF',
];

/** Clamp value to [lo, hi] */
function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

interface PhrasePathProps {
  phrase: GeneratedPhrase;
  animSpeed?: number;
}

/** Convert fretboard (stringIdx, fret) to SVG (x, y) */
function toSvg(stringIdx: number, fret: number): { x: number; y: number } {
  return {
    x: LP + (fret - 0.5) * FW,
    y: TP + stringIdx * SG,
  };
}

type Point = { x: number; y: number };

/** Move `from` toward `to` by `px` pixels */
function inset(from: Point, to: Point, px: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < px * 3) return from;
  const r = px / len;
  return { x: from.x + dx * r, y: from.y + dy * r };
}

const SEG_GAP = 7;  // inset from note center (approx marker radius)
const BOW_PX = 8;   // vertical bow for same-string fold-backs

interface Segment { d: string }

/**
 * Build individual Catmull-Rom → Cubic Bezier segment paths.
 * - Inset from note centers to create gaps at markers.
 * - Y-axis control point clamping prevents zigzag self-crossing.
 * - Same-string segments are bowed up/down by X-direction so
 *   fold-back lines (e.g. fret 4→3→2→3) don't overlap.
 */
function buildSegments(points: Point[]): Segment[] {
  if (points.length < 2) return [];

  return points.slice(0, -1).map((_, i) => {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to Bezier control points (uniform, tension=0)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    let cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    let cp2y = p2.y - (p3.y - p1.y) / 6;

    // Clamp y to prevent overshoot on zigzag string crossings
    const pad = SG * 0.35;
    const yLo = Math.min(p1.y, p2.y) - pad;
    const yHi = Math.max(p1.y, p2.y) + pad;
    cp1y = clamp(cp1y, yLo, yHi);
    cp2y = clamp(cp2y, yLo, yHi);

    // Bow on fold-backs (X direction reversal) for same & adjacent strings
    const dy = Math.abs(p2.y - p1.y);
    const nearScale = Math.max(0, 1 - dy / (SG * 1.5));
    if (nearScale > 0) {
      const prevDx = p1.x - p0.x;
      const curDx = p2.x - p1.x;
      if (prevDx * curDx < 0) {  // direction reversal
        const bow = ((curDx > 0) ? 1 : -1) * BOW_PX * nearScale;
        cp1y += bow;
        cp2y += bow;
      }
    }

    // Inset start/end from note centers
    const start = inset(p1, p2, SEG_GAP);
    const end = inset(p2, p1, SEG_GAP);

    return {
      d: `M${start.x},${start.y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${end.x},${end.y}`,
    };
  });
}

export function PhrasePath({ phrase, animSpeed = 350 }: PhrasePathProps) {
  const points = phrase.notes.map(n => toSvg(n.stringIdx, n.fret));
  const segs = buildSegments(points);
  const fadeDur = Math.round(animSpeed * 1.4);
  const fadeStyle = (i: number): React.CSSProperties =>
    animSpeed > 0
      ? { animation: `phraseIn ${fadeDur}ms ease-out ${i * animSpeed}ms both` }
      : {};

  // Key forces remount on phrase change → restarts CSS animations
  const phraseId = phrase.notes.map(n => `${n.stringIdx}:${n.fret}`).join(',');

  return (
    <g key={phraseId}>
      {/* CSS animation keyframes (SVG-embedded) */}
      <defs>
        <style>{`@keyframes phraseIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
      </defs>

      {/* Per-beat groups: segment + marker + number appear together */}
      {phrase.notes.map((n, i) => {
        const { x, y } = points[i];
        const color = BEAT_COLORS[i];

        // Beat number y-offset for revisited positions
        let visitIdx = 0;
        for (let j = 0; j < i; j++) {
          if (phrase.notes[j].stringIdx === n.stringIdx &&
              phrase.notes[j].fret === n.fret) visitIdx++;
        }
        const offsets = [-11, 15, 26, -22];
        const yOff = offsets[visitIdx % offsets.length];

        // Note marker element
        let marker: React.ReactNode;
        if (n.isChordTone) {
          marker = <circle cx={x} cy={y} r={5} fill={color} stroke="#FFF" strokeWidth={1} opacity={0.9} />;
        } else if (n.isApproach) {
          marker = <rect x={x - 3.5} y={y - 3.5} width={7} height={7} transform={`rotate(45,${x},${y})`} fill={color} opacity={0.7} />;
        } else {
          marker = <circle cx={x} cy={y} r={4} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />;
        }

        return (
          <g key={`beat-${i}`} style={fadeStyle(i)}>
            {/* Curve segment leading TO this beat (from previous) */}
            {i > 0 && (
              <path d={segs[i - 1].d} fill="none" stroke={color} strokeWidth={2} opacity={0.6} strokeLinecap="round" />
            )}
            {/* Note marker */}
            {marker}
            {/* Beat number */}
            <text x={x} y={y + yOff} textAnchor="middle"
              fontSize="9" fontWeight="800" fill={color}
              stroke="#1a1a2e" strokeWidth={2.5} paintOrder="stroke"
              fontFamily="monospace" opacity={0.95}>
              {n.beatPosition}
            </text>
          </g>
        );
      })}
    </g>
  );
}
