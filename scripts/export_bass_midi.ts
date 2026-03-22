/**
 * Confirmation ウォーキングベースを generateBassLine() で生成し、MIDI に書き出す。
 * Usage: npx tsx scripts/export_bass_midi.ts
 */
import { generateBassLine } from '../src/utils/bassPatterns';
import { loadBassConfig } from '../src/utils/configLoader';
import { loadBassPhraseDB } from '../src/utils/bassPatterns';
import * as fs from 'fs';

// --- Confirmation chord changes (Key: F, 32 bars) ---
// Each entry: [rootName, quality, beats]
const CONFIRMATION: [string, string, number][] = [
  // A section (8 bars)
  ['F', 'maj7', 4],
  ['E', 'm7b5', 2], ['A', '7', 2],
  ['D', 'm7', 2], ['G', '7', 2],
  ['C', 'm7', 2], ['F', '7', 2],
  ['B♭', '7', 4],
  ['A', 'm7', 2], ['D', '7', 2],
  ['G', '7', 4],
  ['C', '7', 4],
  // A' section (8 bars)
  ['F', 'maj7', 4],
  ['E', 'm7b5', 2], ['A', '7', 2],
  ['D', 'm7', 2], ['G', '7', 2],
  ['C', 'm7', 2], ['F', '7', 2],
  ['B♭', '7', 4],
  ['A', 'm7', 2], ['D', '7', 2],
  ['G', 'm7', 2], ['C', '7', 2],
  ['F', 'maj7', 4],
  // B section (8 bars)
  ['C', 'm7', 4],
  ['F', '7', 4],
  ['B♭', 'maj7', 4],
  ['B♭', 'maj7', 4],
  ['E♭', 'm7', 4],
  ['A♭', '7', 4],
  ['D♭', 'maj7', 4],
  ['G', 'm7', 2], ['C', '7', 2],
  // A'' section (8 bars)
  ['F', 'maj7', 4],
  ['E', 'm7b5', 2], ['A', '7', 2],
  ['D', 'm7', 2], ['G', '7', 2],
  ['C', 'm7', 2], ['F', '7', 2],
  ['B♭', '7', 4],
  ['A', 'm7', 2], ['D', '7', 2],
  ['G', 'm7', 2], ['C', '7', 2],
  ['F', 'maj7', 2], ['C', '7', 2],
];

const ROOT_PC: Record<string, number> = {
  'C': 0, 'D♭': 1, 'Db': 1, 'C#': 1,
  'D': 2, 'E♭': 3, 'Eb': 3, 'D#': 3,
  'E': 4, 'F♭': 4, 'Fb': 4,
  'F': 5, 'G♭': 6, 'Gb': 6, 'F#': 6,
  'G': 7, 'A♭': 8, 'Ab': 8, 'G#': 8,
  'A': 9, 'B♭': 10, 'Bb': 10, 'A#': 10,
  'B': 11, 'C♭': 11, 'Cb': 11,
};

// --- Simple MIDI writer ---
function writeVarLen(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  bytes.unshift(v & 0x7f);
  while ((v >>= 7) > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
  }
  return bytes;
}

function writeMidi(notes: { midi: number; tick: number; duration: number; velocity: number }[], bpm: number, outPath: string) {
  const ppq = 480;

  // Build track data
  const events: number[] = [];

  // Tempo meta event (FF 51 03 tttttt)
  const uspqn = Math.round(60_000_000 / bpm);
  events.push(0x00, 0xff, 0x51, 0x03,
    (uspqn >> 16) & 0xff, (uspqn >> 8) & 0xff, uspqn & 0xff);

  // Sort notes by tick
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);

  // Build note-on/note-off event list
  interface MidiEvent { tick: number; type: 'on' | 'off'; midi: number; velocity: number }
  const midiEvents: MidiEvent[] = [];
  for (const n of sorted) {
    midiEvents.push({ tick: n.tick, type: 'on', midi: n.midi, velocity: n.velocity });
    midiEvents.push({ tick: n.tick + n.duration, type: 'off', midi: n.midi, velocity: 0 });
  }
  midiEvents.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));

  let prevTick = 0;
  for (const ev of midiEvents) {
    const delta = ev.tick - prevTick;
    events.push(...writeVarLen(delta));
    if (ev.type === 'on') {
      events.push(0x90, ev.midi, ev.velocity);
    } else {
      events.push(0x80, ev.midi, 0);
    }
    prevTick = ev.tick;
  }

  // End of track
  events.push(0x00, 0xff, 0x2f, 0x00);

  // Track chunk
  const trackData = Buffer.from(events);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write('MTrk', 0);
  trackHeader.writeUInt32BE(trackData.length, 4);

  // File header (format 0, 1 track)
  const fileHeader = Buffer.alloc(14);
  fileHeader.write('MThd', 0);
  fileHeader.writeUInt32BE(6, 4);
  fileHeader.writeUInt16BE(0, 8);  // format 0
  fileHeader.writeUInt16BE(1, 10); // 1 track
  fileHeader.writeUInt16BE(ppq, 12);

  const midi = Buffer.concat([fileHeader, trackHeader, trackData]);
  fs.writeFileSync(outPath, midi);
  console.log(`Written: ${outPath} (${sorted.length} notes, ${midi.length} bytes)`);
}

// --- Main ---
async function main() {
  // Load bass config and phrase DB
  // Mock fetch for Node.js
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const filePath = urlStr.startsWith('/') ? `public${urlStr}` : urlStr;
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return { ok: true, json: async () => JSON.parse(data) } as Response;
    } catch {
      return { ok: false } as Response;
    }
  };

  await loadBassConfig();
  await loadBassPhraseDB();
  globalThis.fetch = origFetch;

  const BPM = 160;
  const PPQ = 480;
  const CHORUSES = 3;
  const STYLE = 'medium-up-swing' as const;

  const allNotes: { midi: number; tick: number; duration: number; velocity: number }[] = [];
  let globalBeatOffset = 0;
  let prevLastMidi: number | null = null;

  for (let chorus = 0; chorus < CHORUSES; chorus++) {
    for (let i = 0; i < CONFIRMATION.length; i++) {
      const [rootName, quality, beats] = CONFIRMATION[i];
      const rootSemi = ROOT_PC[rootName] ?? 0;

      // Next root
      const nextIdx = (i + 1) % CONFIRMATION.length;
      const nextRootName = CONFIRMATION[nextIdx][0];
      const nextRootSemi = ROOT_PC[nextRootName] ?? null;

      const bassLine = generateBassLine(
        rootSemi, quality, beats,
        nextRootSemi, STYLE, globalBeatOffset, prevLastMidi,
      );

      for (const bn of bassLine) {
        const tickStart = Math.round((globalBeatOffset + bn.beatStart) * PPQ);
        const tickDur = Math.round(bn.duration * PPQ);
        allNotes.push({
          midi: bn.midi,
          tick: tickStart,
          duration: tickDur,
          velocity: bn.velocity ?? 80,
        });
      }

      prevLastMidi = bassLine.length > 0 ? bassLine[bassLine.length - 1].midi : prevLastMidi;
      globalBeatOffset += beats;
    }
  }

  const outPath = 'scripts/output/confirmation_bass_3chorus.mid';
  writeMidi(allNotes, BPM, outPath);
  console.log(`Total beats: ${globalBeatOffset}, Total notes: ${allNotes.length}`);
}

main().catch(console.error);
