import { describe, it, expect } from 'vitest';
import { parseSongKey, extractChordSymbols, songToProgression, searchSongs } from '../jazzStandards';
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

  it('uses first ending only', () => {
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
    expect(extractChordSymbols(song)).toEqual(['Dm7', 'G7', 'Cmaj7']);
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
});
