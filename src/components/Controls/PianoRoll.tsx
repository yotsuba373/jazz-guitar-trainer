import type { GeneratedPhrase, NoteAnalysis, PhraseNote, RhythmType } from '../../types';
import { CHROMATIC_NAMES } from '../../constants';
import { absolutePitch } from '../../utils/lickEngine';

interface PianoRollProps {
  phrase: GeneratedPhrase;
  noteAnalysis: NoteAnalysis[];
}

const RHYTHM_BEATS: Record<RhythmType, number> = {
  'q': 1.0, 't': 1/3, 'e': 0.5, 's': 0.25,
};

// Colors by note function
const CT_COLOR = '#5EBBFF';
const APPROACH_COLOR = '#FFCC44';
const SCALE_COLOR = '#7A8899';

function noteColor(n: PhraseNote): string {
  if (n.approachGroup?.role === 'target') return CT_COLOR;
  if (n.isChordTone) return CT_COLOR;
  if (n.isApproach || n.approachGroup?.role === 'approach') return APPROACH_COLOR;
  return SCALE_COLOR;
}

/** Duration in beats for a note, preferring exact durationBeats over RhythmType */
function noteDur(n: PhraseNote): number {
  return n.durationBeats ?? RHYTHM_BEATS[n.duration ?? 'e'];
}

export function PianoRoll({ phrase, noteAnalysis }: PianoRollProps) {
  const notes = phrase.notes;
  if (notes.length === 0) return null;

  // Compute pitch range (exclude rests)
  const soundNotes = notes.filter(n => !n.isRest);
  if (soundNotes.length === 0) return null;
  const pitches = soundNotes.map(absolutePitch);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  const pitchRange = Math.max(maxPitch - minPitch, 4);

  // Compute total beats
  let totalBeats = 0;
  for (const n of notes) {
    const bs = n.beatStart ?? totalBeats;
    totalBeats = Math.max(totalBeats, bs + noteDur(n));
  }
  totalBeats = Math.max(totalBeats, phrase.totalBeats ?? 4);

  // SVG dimensions
  const margin = { top: 16, bottom: 20, left: 36, right: 8 };
  const width = 500;
  const pitchRows = pitchRange + 2; // pad 1 above and below
  const rowH = Math.max(8, Math.min(14, 120 / pitchRows));
  const height = margin.top + pitchRows * rowH + margin.bottom;
  const plotW = width - margin.left - margin.right;
  const plotH = pitchRows * rowH;

  // Scale functions
  const xScale = (beat: number) => margin.left + (beat / totalBeats) * plotW;
  const yScale = (pitch: number) => margin.top + (maxPitch + 1 - pitch) * rowH;

  // Note name from MIDI-like pitch
  const pitchName = (p: number) => {
    const oct = Math.floor(p / 12) - 1;
    return `${CHROMATIC_NAMES[p % 12]}${oct}`;
  };

  return (
    <svg width={width} height={height} style={{ display: 'block', marginTop: 6 }}>
      {/* Background */}
      <rect x={margin.left} y={margin.top} width={plotW} height={plotH}
        fill="#111" rx={3} />

      {/* Beat grid lines */}
      {Array.from({ length: Math.ceil(totalBeats) + 1 }, (_, i) => {
        const x = xScale(i);
        return (
          <line key={`beat-${i}`}
            x1={x} y1={margin.top} x2={x} y2={margin.top + plotH}
            stroke="#333" strokeWidth={1}
          />
        );
      })}

      {/* Half-beat dashed lines */}
      {Array.from({ length: Math.ceil(totalBeats) }, (_, i) => {
        const x = xScale(i + 0.5);
        return (
          <line key={`half-${i}`}
            x1={x} y1={margin.top} x2={x} y2={margin.top + plotH}
            stroke="#222" strokeWidth={0.5} strokeDasharray="2,3"
          />
        );
      })}

      {/* Beat numbers at bottom */}
      {Array.from({ length: Math.ceil(totalBeats) }, (_, i) => (
        <text key={`bl-${i}`}
          x={xScale(i + 0.5)} y={margin.top + plotH + 14}
          textAnchor="middle" fontSize="8" fill="#555" fontFamily="monospace">
          {i + 1}
        </text>
      ))}

      {/* Pitch axis labels (left) */}
      {Array.from({ length: pitchRows }, (_, i) => {
        const p = maxPitch + 1 - i;
        if ((p - minPitch) % 2 !== 0) return null;
        return (
          <text key={`pl-${i}`}
            x={margin.left - 4} y={margin.top + i * rowH + rowH / 2 + 3}
            textAnchor="end" fontSize="7" fill="#444" fontFamily="monospace">
            {pitchName(p)}
          </text>
        );
      })}

      {/* Note rectangles */}
      {notes.map((n, i) => {
        const bs = n.beatStart ?? (i * 0.5);
        const dur = noteDur(n);
        const x = xScale(bs);
        const w = Math.max(2, xScale(bs + dur) - x - 1);

        if (n.isRest) {
          const midY = margin.top + plotH / 2;
          return (
            <line key={i} x1={x} y1={midY - 4} x2={x + w} y2={midY - 4}
              stroke="#666" strokeWidth={1} strokeDasharray="2,2" opacity={0.5} />
          );
        }

        const pitch = absolutePitch(n);
        const y = yScale(pitch);
        const color = noteColor(n);
        const analysis = noteAnalysis[i];

        return (
          <g key={i}>
            {/* Note bar */}
            <rect x={x} y={y} width={w} height={rowH - 1}
              fill={color} opacity={0.92} rx={1.5}
            />
            {/* Degree label above */}
            {analysis && w > 10 && (
              <text x={x + w / 2} y={y - 2}
                textAnchor="middle" fontSize="7" fill={color}
                fontFamily="monospace" opacity={0.9}>
                {analysis.scaleDegree}
              </text>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${margin.left + 4}, ${margin.top - 4})`}>
        {[
          { color: CT_COLOR, label: 'CT' },
          { color: APPROACH_COLOR, label: 'App' },
          { color: SCALE_COLOR, label: 'Scale' },
        ].map(({ color, label }, i) => (
          <g key={label} transform={`translate(${i * 48}, 0)`}>
            <rect x={0} y={-6} width={8} height={6} fill={color} rx={1} opacity={0.92} />
            <text x={10} y={0} fontSize="7" fill="#666" fontFamily="monospace">{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
