import { describe, it, expect } from 'vitest';
import { parseSongKey, extractChordSymbols, extractStructuredChords, songToProgression, searchSongs } from '../jazzStandards';
import type { RawJazzStandard } from '../../types';

// --- parseSongKey ---

describe('parseSongKey', () => {
  it('major key: "C"', () => {
    expect(parseSongKey('C')).toEqual({ root: 'C', minor: false });
  });

  it('flat major: "Bb"', () => {
    expect(parseSongKey('Bb')).toEqual({ root: 'B♭', minor: false });
  });

  it('sharp key: "F#" → G♭', () => {
    expect(parseSongKey('F#')).toEqual({ root: 'G♭', minor: false });
  });

  it('minor with "min": "Dmin"', () => {
    expect(parseSongKey('Dmin')).toEqual({ root: 'D', minor: true });
  });

  it('minor with "minor": "G minor"', () => {
    expect(parseSongKey('G minor')).toEqual({ root: 'G', minor: true });
  });

  it('flat minor: "Bbmin"', () => {
    expect(parseSongKey('Bbmin')).toEqual({ root: 'B♭', minor: true });
  });

  it('undefined for missing/empty', () => {
    expect(parseSongKey(undefined)).toBeUndefined();
    expect(parseSongKey('')).toBeUndefined();
  });

  it('undefined for unrecognized key', () => {
    expect(parseSongKey('X#')).toBeUndefined();
  });
});

// --- extractChordSymbols ---

describe('extractChordSymbols', () => {
  it('splits pipes into individual chords', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{ MainSegment: { Chords: 'Dm7|G7|Cmaj7' } }],
    };
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'G7', 'Cmaj7']);
  });

  it('resolves % repeat marker', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{ MainSegment: { Chords: 'Dm7|%|G7' } }],
    };
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'Dm7', 'G7']);
  });

  it('splits commas within measures', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{ MainSegment: { Chords: 'Dm7,G7|Cmaj7' } }],
    };
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'G7', 'Cmaj7']);
  });

  it('includes all endings in flat output', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{
        MainSegment: { Chords: 'Dm7|G7' },
        Endings: [
          { Chords: 'Cmaj7' },
          { Chords: 'Am7' },
        ],
      }],
    };
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'G7', 'Cmaj7', 'Am7']);
  });

  it('concatenates multiple sections', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [
        { MainSegment: { Chords: 'Dm7|G7' } },
        { MainSegment: { Chords: 'Cmaj7|Am7' } },
      ],
    };
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'G7', 'Cmaj7', 'Am7']);
  });

  it('skips empty segments from double commas', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{ MainSegment: { Chords: 'Dm7,,G7' } }],
    };
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'G7']);
  });

  it('% across sections carries last chord', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [
        { MainSegment: { Chords: 'Dm7|G7' } },
        { MainSegment: { Chords: '%|Cmaj7' } },
      ],
    };
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'G7', 'G7', 'Cmaj7']);
  });
});

// --- extractStructuredChords ---

describe('extractStructuredChords', () => {
  it('preserves section labels', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [
        { Label: 'A', MainSegment: { Chords: 'Dm7|G7' } },
        { Label: 'B', MainSegment: { Chords: 'Cmaj7' } },
      ],
    };
    const sections = extractStructuredChords(song);
    expect(sections).toHaveLength(2);
    expect(sections[0].label).toBe('A');
    expect(sections[1].label).toBe('B');
  });

  it('separates endings from main measures', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{
        MainSegment: { Chords: 'Dm7|G7' },
        Endings: [
          { Chords: 'Cmaj7' },
          { Chords: 'Am7' },
        ],
      }],
    };
    const sections = extractStructuredChords(song);
    expect(sections[0].measures).toHaveLength(2); // main only
    expect(sections[0].endings).toHaveLength(2);
    expect(sections[0].endings![0]).toEqual([['Cmaj7']]);
    expect(sections[0].endings![1]).toEqual([['Am7']]);
  });

  it('preserves repeats field', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{
        Label: 'A',
        MainSegment: { Chords: 'Dm7|G7' },
        Repeats: 1,
      }],
    };
    const sections = extractStructuredChords(song);
    expect(sections[0].repeats).toBe(1);
  });

  it('no endings field when section has no endings', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{ MainSegment: { Chords: 'Dm7' } }],
    };
    const sections = extractStructuredChords(song);
    expect(sections[0].endings).toBeUndefined();
  });

  it('multi-chord ending measures', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{
        MainSegment: { Chords: 'Dm7' },
        Endings: [{ Chords: 'Cm7,F7|Bbmaj7' }],
      }],
    };
    const sections = extractStructuredChords(song);
    expect(sections[0].endings![0]).toEqual([['Cm7', 'F7'], ['Bbmaj7']]);
  });

  it('auto-labels unlabeled sections sequentially', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [
        { Label: 'A', MainSegment: { Chords: 'Dm7' } },
        { Label: 'B', MainSegment: { Chords: 'G7' } },
        { MainSegment: { Chords: 'Cmaj7' } },
      ],
    };
    const sections = extractStructuredChords(song);
    expect(sections[2].label).toBe('C');
  });

  it('auto-labels all sections when none have labels', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [
        { MainSegment: { Chords: 'Dm7' } },
        { MainSegment: { Chords: 'G7' } },
      ],
    };
    const sections = extractStructuredChords(song);
    expect(sections[0].label).toBe('A');
    expect(sections[1].label).toBe('B');
  });

  it('skips already-used labels when auto-labeling', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [
        { Label: 'A', MainSegment: { Chords: 'Dm7' } },
        { MainSegment: { Chords: 'G7' } },
        { Label: 'B', MainSegment: { Chords: 'Cmaj7' } },
        { MainSegment: { Chords: 'Am7' } },
      ],
    };
    const sections = extractStructuredChords(song);
    expect(sections[1].label).toBe('C');
    expect(sections[3].label).toBe('D');
  });
});

// --- searchSongs ---

describe('searchSongs', () => {
  const songs: RawJazzStandard[] = [
    { Title: 'Autumn Leaves', Sections: [{ MainSegment: { Chords: 'Cm7' } }] },
    { Title: 'All The Things You Are', Sections: [{ MainSegment: { Chords: 'Fm7' } }] },
    { Title: 'Blue Bossa', Sections: [{ MainSegment: { Chords: 'Cm7' } }] },
  ];

  it('matches case-insensitively', () => {
    expect(searchSongs(songs, 'autumn').map(s => s.Title)).toEqual(['Autumn Leaves']);
  });

  it('returns empty for no match', () => {
    expect(searchSongs(songs, 'xyz')).toEqual([]);
  });

  it('returns empty for empty/whitespace query', () => {
    expect(searchSongs(songs, '')).toEqual([]);
    expect(searchSongs(songs, '  ')).toEqual([]);
  });

  it('matches substring', () => {
    expect(searchSongs(songs, 'blue').map(s => s.Title)).toEqual(['Blue Bossa']);
  });

  it('matches multiple results', () => {
    const titles = searchSongs(songs, 'a').map(s => s.Title);
    expect(titles).toContain('Autumn Leaves');
    expect(titles).toContain('All The Things You Are');
  });
});

// --- songToProgression ---

describe('songToProgression', () => {
  it('converts supported chords to ChordSlots', () => {
    const song: RawJazzStandard = {
      Title: 'Test Song',
      Key: 'C',
      Sections: [{ MainSegment: { Chords: 'Dm7|G7|Cmaj7' } }],
    };
    const prog = songToProgression(song);
    expect(prog.name).toBe('Test Song');
    expect(prog.songKey).toEqual({ root: 'C', minor: false });
    expect(prog.chords).toHaveLength(3);
    expect(prog.chords[0].rootName).toBe('D');
    expect(prog.chords[0].quality).toBe('m7');
    expect(prog.chords[1].rootName).toBe('G');
    expect(prog.chords[1].quality).toBe('7');
    expect(prog.chords[2].quality).toBe('maj7');
  });

  it('extended chords are mapped to families', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{ MainSegment: { Chords: 'Dm7|G7#9|Cmaj7' } }],
    };
    const prog = songToProgression(song);
    expect(prog.chords).toHaveLength(3);
    expect(prog.chords[1].quality).toBe('7'); // mapped to dominant family
    expect(prog.chords[1].symbol).toBe('G7#9'); // original symbol preserved
  });

  it('truly unsupported chords become skip slots', () => {
    const song: RawJazzStandard = {
      Title: 'Test',
      Sections: [{ MainSegment: { Chords: 'Dm7|Gadd4|Cmaj7' } }],
    };
    const prog = songToProgression(song);
    expect(prog.chords).toHaveLength(3);
    expect(prog.chords[1].quality).toBe('unknown');
    expect(prog.chords[1].symbol).toBe('Gadd4');
  });

  it('handles missing key gracefully', () => {
    const song: RawJazzStandard = {
      Title: 'No Key',
      Sections: [{ MainSegment: { Chords: 'Dm7' } }],
    };
    const prog = songToProgression(song);
    expect(prog.songKey).toBeUndefined();
    expect(prog.chords).toHaveLength(1);
  });

  it('handles flat-root chords (Bbmaj7)', () => {
    const song: RawJazzStandard = {
      Title: 'Flat test',
      Key: 'Bb',
      Sections: [{ MainSegment: { Chords: 'Bbmaj7|Cm7|F7' } }],
    };
    const prog = songToProgression(song);
    expect(prog.songKey).toEqual({ root: 'B♭', minor: false });
    expect(prog.chords[0].rootName).toBe('B♭');
    expect(prog.chords[0].quality).toBe('maj7');
  });

  it('includes all endings in chords[] and chartLayout', () => {
    const song: RawJazzStandard = {
      Title: 'Ending test',
      Key: 'C',
      Sections: [{
        Label: 'A',
        MainSegment: { Chords: 'Dm7|G7' },
        Endings: [
          { Chords: 'Cmaj7' },
          { Chords: 'Am7' },
        ],
      }],
    };
    const prog = songToProgression(song);
    // Flat chords: main(2) + ending1(1) + ending2(1) = 4
    expect(prog.chords).toHaveLength(4);
    expect(prog.chords[2].quality).toBe('maj7'); // ending 1
    expect(prog.chords[3].quality).toBe('m7');   // ending 2

    // Chart layout
    const sec = prog.chartLayout!.sections[0];
    expect(sec.measures).toHaveLength(2); // main only
    expect(sec.endings).toHaveLength(2);
    expect(sec.endings![0][0].chordIndices).toEqual([2]); // ending 1
    expect(sec.endings![1][0].chordIndices).toEqual([3]); // ending 2
  });

  it('preserves repeats in chartLayout', () => {
    const song: RawJazzStandard = {
      Title: 'Repeat test',
      Sections: [{
        Label: 'A',
        MainSegment: { Chords: 'Dm7|G7' },
        Repeats: 1,
      }],
    };
    const prog = songToProgression(song);
    expect(prog.chartLayout!.sections[0].repeats).toBe(1);
  });
});
