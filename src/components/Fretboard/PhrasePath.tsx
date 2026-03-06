import type { GeneratedPhrase } from '../../types';
import { FW, SG, TP, LP } from '../../constants';

/** Generate a beat color via linear interpolation between start and end hues.
 *  Warm pink (first note) → cool violet (last note). */
function getBeatColor(i: number, total: number): string {
  if (total <= 1) return '#FFA0B0';
  const t = i / (total - 1);
  // Interpolate hue from 340 (pink) to 260 (violet)
  const h = Math.round(340 - t * 80);
  const s = Math.round(90 + t * 10);
  const l = Math.round(75 - t * 5);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Rhythm marker sizes: quarter=6, eighth=5, triplet=4, sixteenth=3.5 */
const RHYTHM_MARKER_SIZE: Record<string, number> = {
  'q': 6, 'e': 5, 't': 4, 's': 3.5,
};

/** Generate beat label from beatStart (0-based fractional) */
function beatLabel(beatStart: number | undefined, beatPosition: number): string {
  if (beatStart == null) return String(beatPosition);
  const beat = Math.floor(beatStart) + 1;
  const frac = beatStart - Math.floor(beatStart);
  if (Math.abs(frac) < 0.05) return String(beat);
  if (Math.abs(frac - 0.5) < 0.05) return `${beat}+`;
  if (Math.abs(frac - 1/3) < 0.05) return `${beat}t`;
  if (Math.abs(frac - 2/3) < 0.05) return `${beat}t`;
  if (Math.abs(frac - 0.25) < 0.05) return `${beat}e`;
  if (Math.abs(frac - 0.75) < 0.05) return `${beat}e`;
  return String(beatPosition);
}

/** Clamp value to [lo, hi] */
function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

interface PhrasePathProps {
  phrase: GeneratedPhrase;
  animKey?: number;
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

export function PhrasePath({ phrase, animKey, animSpeed = 350 }: PhrasePathProps) {
  const points = phrase.notes.map(n => toSvg(n.stringIdx, n.fret));
  const segs = buildSegments(points);
  const fadeDur = Math.max(60, Math.round(animSpeed * 0.4));
  const fadeStyle = (i: number): React.CSSProperties => {
    if (animSpeed <= 0) return {};
    const delay = (phrase.notes[i].beatStart ?? 0) * animSpeed * 2;
    return { animation: `phraseIn ${fadeDur}ms ease-out ${Math.round(delay)}ms both` };
  };

  // Key forces remount on phrase change or play trigger → restarts CSS animations
  const phraseId = phrase.notes.map(n => `${n.stringIdx}:${n.fret}`).join(',') + (animKey ? `:${animKey}` : '');

  return (
    <g key={phraseId}>
      {/* CSS animation keyframes (SVG-embedded) */}
      <defs>
        <style>{`@keyframes phraseIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
      </defs>

      {/* Per-beat groups: segment + marker + number appear together */}
      {phrase.notes.map((n, i) => {
        const { x, y } = points[i];
        const color = getBeatColor(i, phrase.notes.length);

        // Beat number y-offset for revisited positions
        let visitIdx = 0;
        for (let j = 0; j < i; j++) {
          if (phrase.notes[j].stringIdx === n.stringIdx &&
              phrase.notes[j].fret === n.fret) visitIdx++;
        }
        const offsets = [-11, 15, 26, -22];
        const yOff = offsets[visitIdx % offsets.length];

        // Note marker element — size varies by rhythm type
        const mSize = RHYTHM_MARKER_SIZE[n.duration ?? 'e'] ?? 5;
        let marker: React.ReactNode;
        if (n.isChordTone) {
          marker = <circle cx={x} cy={y} r={mSize} fill={color} stroke="#FFF" strokeWidth={1} opacity={0.9} />;
        } else if (n.isApproach) {
          const hs = mSize * 0.7;
          marker = <rect x={x - hs} y={y - hs} width={hs * 2} height={hs * 2} transform={`rotate(45,${x},${y})`} fill={color} opacity={0.7} />;
        } else {
          marker = <circle cx={x} cy={y} r={mSize - 1} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />;
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
              {beatLabel(n.beatStart, n.beatPosition)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
