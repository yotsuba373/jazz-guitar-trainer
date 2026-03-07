/**
 * Analyze generated phrases from the lick library.
 * Simulates phrase generation to characterize output patterns.
 * Run: node scripts/analyze_generated_phrases.cjs
 */
const fs = require('fs');
const path = require('path');

// Load lick library
const libPath = path.join(__dirname, '..', 'public', 'data', 'lick_library.json');
const library = JSON.parse(fs.readFileSync(libPath, 'utf8'));

const CHROMATIC = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

// Interval name helper
function intervalName(semitones) {
  const abs = ((semitones % 12) + 12) % 12;
  const names = ['P1','m2','M2','m3','M3','P4','TT','P5','m6','M6','m7','M7'];
  return names[abs];
}

// Analyze a single lick
function analyzeLick(lick, rootSemi = 0) {
  const notes = lick.steps.map(s => CHROMATIC[(rootSemi + s) % 12]);
  const intervals = lick.intervals.map(i => {
    const dir = i > 0 ? '↑' : i < 0 ? '↓' : '=';
    return `${dir}${intervalName(Math.abs(i))}`;
  });

  // Detect patterns
  const patterns = [];

  // Stepwise motion (consecutive m2/M2)
  let stepCount = 0;
  for (const iv of lick.intervals) {
    if (Math.abs(iv) <= 2) stepCount++;
  }
  const stepRatio = stepCount / lick.intervals.length;

  // Arpeggiation (consecutive m3/M3/P4/P5)
  let arpCount = 0;
  for (const iv of lick.intervals) {
    if (Math.abs(iv) >= 3 && Math.abs(iv) <= 7) arpCount++;
  }
  const arpRatio = arpCount / lick.intervals.length;

  // Enclosure detection: up-down-target or down-up-target within 1-2 semitones
  let enclosures = 0;
  for (let i = 0; i < lick.steps.length - 2; i++) {
    const a = lick.steps[i], b = lick.steps[i+1], c = lick.steps[i+2];
    const d1 = b - a, d2 = c - b;
    if ((d1 > 0 && d2 < 0 && Math.abs(d1) <= 2 && Math.abs(d2) <= 2) ||
        (d1 < 0 && d2 > 0 && Math.abs(d1) <= 2 && Math.abs(d2) <= 2)) {
      enclosures++;
    }
  }

  // 1-2-3-5 pattern detection (any transposition)
  let has1235 = false;
  for (let i = 0; i < lick.steps.length - 3; i++) {
    const base = lick.steps[i];
    const rel = lick.steps.slice(i, i+4).map(s => ((s - base) + 12) % 12);
    // Major: 0,2,4,7 or Minor: 0,2,3,7
    if ((rel[1]===2 && rel[2]===4 && rel[3]===7) ||
        (rel[1]===2 && rel[2]===3 && rel[3]===7)) {
      has1235 = true;
    }
  }

  // Bebop scale run detection (chromatic passing tone pattern)
  let chromaticRuns = 0;
  for (let i = 0; i < lick.intervals.length - 2; i++) {
    if (Math.abs(lick.intervals[i]) === 1 && Math.abs(lick.intervals[i+1]) === 1 &&
        Math.abs(lick.intervals[i+2]) === 1) {
      chromaticRuns++;
    }
  }

  // Repeated notes
  let repeats = 0;
  for (const iv of lick.intervals) {
    if (iv === 0) repeats++;
  }

  // Range
  const range = Math.max(...lick.steps) - Math.min(...lick.steps);

  // Unique pitch classes
  const uniquePCs = new Set(lick.steps.map(s => s % 12)).size;

  return {
    notes, intervals, stepRatio, arpRatio, enclosures, has1235,
    chromaticRuns, repeats, range, uniquePCs,
    length: lick.length, duration: lick.durationBeats,
    direction: lick.direction, source: lick.source
  };
}

// ==========================================
// MAIN ANALYSIS
// ==========================================

console.log('=== LICK LIBRARY ANALYSIS ===\n');

// 1. Overall statistics per quality
for (const quality of ['dom7','min7','maj7','min7b5','dim7']) {
  const licks = library[quality];
  if (!licks) continue;

  const analyses = licks.map(l => analyzeLick(l));

  console.log(`\n--- ${quality} (${licks.length} licks) ---`);

  // Duration distribution for 4-beat licks
  const fourBeat = licks.filter(l => l.durationBeats >= 1.5 && l.durationBeats <= 2.5);
  console.log(`  4-beat range (1.5-2.5 beats): ${fourBeat.length} licks`);

  // Average metrics
  const avgStep = analyses.reduce((a,b) => a + b.stepRatio, 0) / analyses.length;
  const avgArp = analyses.reduce((a,b) => a + b.arpRatio, 0) / analyses.length;
  const avgRange = analyses.reduce((a,b) => a + b.range, 0) / analyses.length;
  const avgUniq = analyses.reduce((a,b) => a + b.uniquePCs, 0) / analyses.length;
  const avgRepeats = analyses.reduce((a,b) => a + b.repeats, 0) / analyses.length;
  const avgEnclosures = analyses.reduce((a,b) => a + b.enclosures, 0) / analyses.length;
  const with1235 = analyses.filter(a => a.has1235).length;
  const withChromRun = analyses.filter(a => a.chromaticRuns > 0).length;

  console.log(`  Avg stepwise ratio: ${(avgStep*100).toFixed(1)}%`);
  console.log(`  Avg arpeggio ratio: ${(avgArp*100).toFixed(1)}%`);
  console.log(`  Avg range: ${avgRange.toFixed(1)} semitones`);
  console.log(`  Avg unique PCs: ${avgUniq.toFixed(1)}`);
  console.log(`  Avg repeats per lick: ${avgRepeats.toFixed(2)}`);
  console.log(`  Avg enclosures per lick: ${avgEnclosures.toFixed(2)}`);
  console.log(`  With 1-2-3-5 pattern: ${with1235} (${(with1235/analyses.length*100).toFixed(1)}%)`);
  console.log(`  With chromatic runs (3+ consecutive): ${withChromRun} (${(withChromRun/analyses.length*100).toFixed(1)}%)`);

  // Problem licks
  const problemLicks = analyses.filter(a =>
    a.uniquePCs <= 2 && a.length > 3 ||
    a.range <= 2 && a.length > 4 ||
    a.repeats > a.length * 0.5
  );
  console.log(`  Problem licks (low variety/narrow/repetitive): ${problemLicks.length} (${(problemLicks.length/analyses.length*100).toFixed(1)}%)`);
}

// 2. Simulate selectLick for dom7, 4-beat context
console.log('\n\n=== SIMULATED 4-BEAT PHRASE GENERATION (dom7, C root) ===\n');

// C Mixolydian semitones: 0,2,4,5,7,9,10
const cMixoSemi = [0,2,4,5,7,9,10];
const semiSet = new Set(cMixoSemi);

// Filter like selectLick does
const dom7Licks = library.dom7;
const eligible4Beat = dom7Licks.filter(l => {
  if (l.durationBeats > 4 || l.length < 3) return false;
  const uniqueOut = new Set(l.steps.filter(s => !semiSet.has(s))).size;
  return uniqueOut < 2;
});

console.log(`Eligible dom7 licks for 4-beat phrase: ${eligible4Beat.length} / ${dom7Licks.length}`);

// Score them like selectLick (goal = 3rd = E = semitone 4)
const goalSemi = 4;
const scored = eligible4Beat.map(l => {
  let score = 0;
  if (l.endStep === goalSemi) score += 30;
  else if (Math.abs(l.endStep - goalSemi) <= 1 || Math.abs(l.endStep - goalSemi) >= 11) score += 15;
  // Fill rate
  const fillRate = l.durationBeats / 4;
  if (fillRate >= 0.8) score += 15;
  else if (fillRate >= 0.5) score += 5;
  if (l.length <= 6) score += 5;
  return { lick: l, score: Math.max(1, score) };
});

scored.sort((a,b) => b.score - a.score);
const top20 = scored.slice(0, 20);

console.log('\nTop 20 licks that would be selected:');
for (const { lick, score } of top20) {
  const a = analyzeLick(lick);
  const noteStr = a.notes.join('-');
  const ivStr = a.intervals.join(' ');
  console.log(`  [${score}pts] ${noteStr} | ${ivStr} | ${lick.durationBeats}beats ${lick.length}notes ${lick.direction} (${lick.source})`);
}

// 3. Categorize common patterns in top eligible licks
console.log('\n\n=== PATTERN CATEGORIZATION (top 200 eligible dom7 licks) ===\n');
const top200 = scored.slice(0, 200);
let patternCounts = {
  pureStepwise: 0,     // >80% stepwise
  pureArpeggio: 0,     // >50% arpeggiated
  mixed: 0,            // balanced
  withEnclosure: 0,
  with1235: 0,
  withChromatic: 0,
  narrowRange: 0,      // range <= 4 semitones
  wideRange: 0,        // range >= 12 semitones
  ascending: 0,
  descending: 0,
  mixedDir: 0,
  hasRepeatedNotes: 0, // any interval of 0
};

for (const { lick } of top200) {
  const a = analyzeLick(lick);
  if (a.stepRatio > 0.8) patternCounts.pureStepwise++;
  else if (a.arpRatio > 0.5) patternCounts.pureArpeggio++;
  else patternCounts.mixed++;
  if (a.enclosures > 0) patternCounts.withEnclosure++;
  if (a.has1235) patternCounts.with1235++;
  if (a.chromaticRuns > 0) patternCounts.withChromatic++;
  if (a.range <= 4) patternCounts.narrowRange++;
  if (a.range >= 12) patternCounts.wideRange++;
  if (lick.direction === 'asc') patternCounts.ascending++;
  else if (lick.direction === 'desc') patternCounts.descending++;
  else patternCounts.mixedDir++;
  if (a.repeats > 0) patternCounts.hasRepeatedNotes++;
}

for (const [k,v] of Object.entries(patternCounts)) {
  console.log(`  ${k}: ${v} (${(v/200*100).toFixed(1)}%)`);
}

// 4. Compare: what do "classic bebop patterns" look like?
console.log('\n\n=== CLASSIC BEBOP PATTERN SEARCH IN LIBRARY ===\n');

// Search for known bebop idioms in the library
function findPattern(name, matchFn) {
  let count = 0;
  const examples = [];
  for (const [q, licks] of Object.entries(library)) {
    for (const l of licks) {
      if (matchFn(l)) {
        count++;
        if (examples.length < 3) {
          const a = analyzeLick(l);
          examples.push(`${q}: ${a.notes.join('-')} (${l.durationBeats}b)`);
        }
      }
    }
  }
  console.log(`${name}: ${count} found`);
  examples.forEach(e => console.log(`    ${e}`));
}

// 1-2-3-5 ascending
findPattern('1-2-3-5 ascending (0,2,3or4,7)', l => {
  for (let i = 0; i < l.steps.length - 3; i++) {
    const base = l.steps[i];
    const rel = l.steps.slice(i,i+4).map(s=>((s-base)+12)%12);
    if ((rel[1]===2 && rel[2]===4 && rel[3]===7) || (rel[1]===2 && rel[2]===3 && rel[3]===7)) return true;
  }
  return false;
});

// Descending bebop scale run (8 consecutive notes, stepwise down)
findPattern('Descending scale run (6+ stepwise down)', l => {
  let consec = 0, maxConsec = 0;
  for (const iv of l.intervals) {
    if (iv >= -2 && iv < 0) { consec++; maxConsec = Math.max(maxConsec, consec); }
    else consec = 0;
  }
  return maxConsec >= 5;
});

// Ascending scale run
findPattern('Ascending scale run (6+ stepwise up)', l => {
  let consec = 0, maxConsec = 0;
  for (const iv of l.intervals) {
    if (iv > 0 && iv <= 2) { consec++; maxConsec = Math.max(maxConsec, consec); }
    else consec = 0;
  }
  return maxConsec >= 5;
});

// Enclosure (chromatic approach from above and below)
findPattern('Enclosure patterns (up-down or down-up within 2 semitones)', l => {
  for (let i = 0; i < l.steps.length - 2; i++) {
    const d1 = l.steps[i+1]-l.steps[i], d2 = l.steps[i+2]-l.steps[i+1];
    if ((d1>0&&d2<0||d1<0&&d2>0) && Math.abs(d1)<=2 && Math.abs(d2)<=2) return true;
  }
  return false;
});

// Arpeggio up then scale down
findPattern('Arp-up then scale-down', l => {
  if (l.steps.length < 6) return false;
  let arpUp = 0;
  for (let i = 0; i < Math.min(3, l.intervals.length); i++) {
    if (l.intervals[i] >= 3 && l.intervals[i] <= 5) arpUp++;
  }
  let scaleDown = 0;
  for (let i = Math.max(0, l.intervals.length-3); i < l.intervals.length; i++) {
    if (l.intervals[i] >= -2 && l.intervals[i] < 0) scaleDown++;
  }
  return arpUp >= 2 && scaleDown >= 2;
});

// Honeysuckle Rose / Cry Me a River motif (R-3-5 or 5-3-R arp)
findPattern('R-3-5 or 5-3-R arpeggio (0,4,7 or 0,3,7)', l => {
  for (let i = 0; i < l.steps.length - 2; i++) {
    const base = l.steps[i];
    const rel = l.steps.slice(i,i+3).map(s=>((s-base)+12)%12);
    if ((rel[1]===4&&rel[2]===7)||(rel[1]===3&&rel[2]===7)) return true;
    // descending
    const rel2 = l.steps.slice(i,i+3).map(s=>((base-s)+12)%12);
    if ((rel2[1]===3&&rel2[2]===5)||(rel2[1]===4&&rel2[2]===7)) return true;
  }
  return false;
});

// Repeated note patterns (>3 same notes)
findPattern('Repeated note (3+ same pitch in a row)', l => {
  for (let i = 0; i < l.steps.length - 2; i++) {
    if (l.steps[i]===l.steps[i+1]&&l.steps[i+1]===l.steps[i+2]) return true;
  }
  return false;
});

// Large leaps (> octave)
findPattern('Contains octave+ leap', l => {
  return l.intervals.some(iv => Math.abs(iv) >= 12);
});

// 5. Show some "best" and "worst" licks
console.log('\n\n=== SAMPLE "MUSICAL" vs "PROBLEMATIC" LICKS (dom7) ===\n');

// Musical: high variety, good range, enclosures or 1235
const musical = [];
const problematic = [];

for (const l of dom7Licks) {
  const a = analyzeLick(l);
  if (a.uniquePCs >= 5 && a.range >= 7 && a.range <= 14 && (a.enclosures > 0 || a.has1235) && a.repeats === 0 && l.durationBeats >= 1.5 && l.durationBeats <= 4) {
    musical.push({ lick: l, analysis: a });
  }
  if ((a.uniquePCs <= 2 && l.length > 4) || (a.range <= 2 && l.length > 4) || a.repeats > l.length * 0.4) {
    problematic.push({ lick: l, analysis: a });
  }
}

console.log(`"Musical" licks (varied, good range, patterns): ${musical.length}`);
musical.slice(0, 10).forEach(({ lick, analysis }) => {
  console.log(`  ${analysis.notes.join('-')} | range=${analysis.range} uniqPC=${analysis.uniquePCs} enc=${analysis.enclosures} 1235=${analysis.has1235} | ${lick.durationBeats}b ${lick.source}`);
});

console.log(`\n"Problematic" licks: ${problematic.length}`);
problematic.slice(0, 10).forEach(({ lick, analysis }) => {
  console.log(`  ${analysis.notes.join('-')} | range=${analysis.range} uniqPC=${analysis.uniquePCs} repeats=${analysis.repeats} | ${lick.durationBeats}b ${lick.source}`);
});

console.log('\n=== DONE ===');
