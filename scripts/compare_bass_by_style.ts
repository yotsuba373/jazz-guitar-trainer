/**
 * Per-style comparison: iReal Pro vs Our System
 * Usage: npx tsx scripts/compare_bass_by_style.ts
 */
import { generateBassLine } from '../src/utils/bassPatterns';
import type { BackingStyle } from '../src/types';
import * as fs from 'fs';

interface ChordSpan {
  rootSemi: number; quality: string; beats: number; bassSemi: number | null;
}

function loadTimelines(): Record<string, ChordSpan[]> {
  return JSON.parse(fs.readFileSync('scripts/compare_timelines.json', 'utf-8'));
}

// Song → style mapping (from MusicXML lyricist field)
const SONG_STYLE: Record<string, BackingStyle> = {
  'Autumn Leaves': 'medium-swing',
  'Beautiful Love': 'medium-swing',
  'Days Of Wine And Roses': 'medium-swing',
  'Fly Me To The Moon': 'medium-swing',
  'Softly, As In A Morning Sunrise': 'medium-swing',
  'All The Things You Are': 'medium-up-swing',
  "Billie's Bounce": 'medium-up-swing',
  'Blues For Alice': 'medium-up-swing',
  'Rhythm Changes': 'medium-up-swing',
  'Stella By Starlight (Medium Up Swing)': 'medium-up-swing',
  'Yardbird Suite': 'medium-up-swing',
  'Anthropology': 'up-tempo-swing',
  'Au Privave': 'up-tempo-swing',
  'Cherokee': 'up-tempo-swing',
  'Confirmation': 'up-tempo-swing',
  "It's All Right With Me": 'up-tempo-swing',
  'Oleo': 'up-tempo-swing',
};

interface Stats {
  intervals: number[];
  beat1Root: { root: number; nonRoot: number };
  approach: Record<number, number>;
  contour: { asc: number; desc: number; static: number };
  noteCount: { four: number; five: number };
  durations: number[];
}

function emptyStats(): Stats {
  return {
    intervals: [], beat1Root: { root: 0, nonRoot: 0 },
    approach: {}, contour: { asc: 0, desc: 0, static: 0 },
    noteCount: { four: 0, five: 0 }, durations: [],
  };
}

function simulate(timelines: Record<string, ChordSpan[]>, filterStyle?: BackingStyle): Stats {
  const stats = emptyStats();
  for (const [song, timeline] of Object.entries(timelines)) {
    const style = SONG_STYLE[song];
    if (!style || (filterStyle && style !== filterStyle)) continue;
    for (let ci = 0; ci < 30; ci++) {
      let prevLastMidi: number | null = null;
      const chorusBeats = timeline.reduce((s, c) => s + c.beats, 0);
      for (let si = 0; si < timeline.length; si++) {
        const span = timeline[si];
        const nextSpan = si + 1 < timeline.length ? timeline[si + 1] : null;
        const refSemi = span.bassSemi ?? span.rootSemi;
        const nextRefSemi = nextSpan ? (nextSpan.bassSemi ?? nextSpan.rootSemi) : null;
        const globalBeatOffset = ci * chorusBeats + timeline.slice(0, si).reduce((s, c) => s + c.beats, 0);

        const notes = generateBassLine(refSemi, span.quality, span.beats, nextRefSemi, style, globalBeatOffset);
        if (notes.length === 0) continue;

        const firstMidi = notes[0].midi;
        const lastMidi = notes[notes.length - 1].midi;

        // Beat 1 root
        if ((firstMidi - refSemi + 120) % 12 === 0) stats.beat1Root.root++;
        else stats.beat1Root.nonRoot++;

        // Cross-chord interval
        if (prevLastMidi !== null) stats.intervals.push(Math.abs(firstMidi - prevLastMidi));
        prevLastMidi = lastMidi;

        // 4-beat stats
        if (span.beats === 4) {
          if (notes.length === 4) stats.noteCount.four++;
          if (notes.length >= 5) stats.noteCount.five++;
          if (notes.length >= 4) {
            const p0 = notes[0].midi, p3 = notes[3].midi;
            if (p3 > p0 + 1) stats.contour.asc++;
            else if (p3 < p0 - 1) stats.contour.desc++;
            else stats.contour.static++;
          }
        }

        // Approach
        if (span.beats >= 4 && nextRefSemi !== null) {
          let d = Math.abs(lastMidi % 12 - nextRefSemi) % 12;
          if (d > 6) d = 12 - d;
          stats.approach[d] = (stats.approach[d] || 0) + 1;
        }

        // Durations
        for (const n of notes) stats.durations.push(n.duration);
      }
    }
  }
  return stats;
}

function report(label: string, s: Stats) {
  const arr = s.intervals;
  if (arr.length === 0) return;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const step = arr.filter(x => x <= 2).length / arr.length * 100;
  const bt = s.beat1Root.root + s.beat1Root.nonRoot;
  const ct = s.contour.asc + s.contour.desc + s.contour.static;
  const nc = s.noteCount.four + s.noteCount.five;
  const at = Object.values(s.approach).reduce((a, b) => a + b, 0);
  const dur = s.durations.length > 0 ? s.durations.reduce((a, b) => a + b, 0) / s.durations.length : 0;

  console.log(`  ${label}:`);
  console.log(`    VL: mean=${mean.toFixed(1)} step=${step.toFixed(0)}%`);
  console.log(`    Beat1 root: ${(s.beat1Root.root / bt * 100).toFixed(1)}%`);
  if (ct > 0) console.log(`    Contour: asc=${(s.contour.asc/ct*100).toFixed(0)}% desc=${(s.contour.desc/ct*100).toFixed(0)}% static=${(s.contour.static/ct*100).toFixed(0)}%`);
  if (nc > 0) console.log(`    Notes/4beat: 4n=${(s.noteCount.four/nc*100).toFixed(0)}% 5n=${(s.noteCount.five/nc*100).toFixed(0)}%`);
  console.log(`    Duration: mean=${dur.toFixed(2)}`);
  if (at > 0) console.log(`    Approach: ${[0,1,2,3,4,5,6].map(d => `d${d}=${((s.approach[d]||0)/at*100).toFixed(0)}%`).join(' ')}`);
}

async function main() {
  const { loadBassPhraseDB } = await import('../src/utils/bassPatterns');
  const { loadBassConfig } = await import('../src/utils/configLoader');
  const bassPhrasesJson = fs.readFileSync('public/bass-phrases.generated.json', 'utf-8');
  const bassConfigJson = fs.readFileSync('public/bass-config.json', 'utf-8');
  (globalThis as any).fetch = async (url: string) => {
    if (url.includes('bass-phrases')) return { ok: true, json: async () => JSON.parse(bassPhrasesJson) };
    if (url.includes('bass-config')) return { ok: true, json: async () => JSON.parse(bassConfigJson) };
    return { ok: false };
  };
  await loadBassConfig();
  await loadBassPhraseDB();

  // Need to regenerate timelines with all 17 songs
  // For now use existing timelines (5 original songs)
  const timelines = loadTimelines();

  console.log('=== Per-Style Comparison: Our System ===\n');
  console.log('--- iReal Pro reference (from earlier analysis) ---');
  console.log('  medium-swing:    VL mean=5.3 step=40% | root=93.8% | 4n=53% 5n=47% | dur=0.90');
  console.log('  medium-up-swing: VL mean=5.2 step=42% | root=95.3% | 4n=49% 5n=51% | dur=0.90');
  console.log('  up-tempo-swing:  VL mean=5.0 step=38% | root=82.2% | 4n=96% 5n=4%  | dur=0.99');
  console.log();

  console.log('--- Our system ---');
  for (const style of ['medium-swing', 'medium-up-swing', 'up-tempo-swing'] as BackingStyle[]) {
    const stats = simulate(timelines, style);
    report(style, stats);
  }
}

main().catch(console.error);
