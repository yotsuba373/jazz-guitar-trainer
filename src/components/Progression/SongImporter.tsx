import { useState, useEffect, useRef } from 'react';
import type { Progression, RawJazzStandard } from '../../types';
import { fetchJazzStandards, searchSongs, songToProgression } from '../../utils';

interface SongImporterProps {
  onImport: (prog: Progression) => void;
  onClose: () => void;
}

const btnBase = 'rounded cursor-pointer text-[10px] font-mono px-2.5 py-[5px]';
const MAX_RESULTS = 20;

export function SongImporter({ onImport, onClose }: SongImporterProps) {
  const [songs, setSongs] = useState<RawJazzStandard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetchJazzStandards()
      .then(data => { setSongs(data); setLoading(false); })
      .catch(() => { setError('データの取得に失敗しました'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (songs && inputRef.current) inputRef.current.focus();
  }, [songs]);

  const results = songs && query.trim()
    ? searchSongs(songs, query).slice(0, MAX_RESULTS)
    : [];

  function handleSelect(song: RawJazzStandard) {
    onImport(songToProgression(song));
  }

  return (
    <div className="bg-[#111] border border-[#555] rounded p-2 mb-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold text-text-primary">
          スタンダード曲インポート
        </span>
        <button onClick={onClose} className={btnBase}
          style={{ border: '1px solid #666', background: '#1a1a1a', color: '#CCC' }}>
          閉じる
        </button>
      </div>

      {loading && <p className="text-[10px] text-text-dim">読み込み中...</p>}
      {error && <p className="text-[9px] text-[#E74C3C]">{error}</p>}

      {songs && (
        <>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="曲名で検索 (例: Autumn Leaves)"
            className="bg-[#0a0a0a] border border-[#444] rounded text-[11px] text-text-primary font-mono px-2 py-1 w-full mb-1.5"
          />

          {query.trim() && results.length === 0 && (
            <p className="text-[9px] text-text-dim">一致する曲がありません</p>
          )}

          {results.length > 0 && (
            <div className="max-h-[200px] overflow-y-auto">
              {results.map((song, i) => (
                <button
                  key={i}
                  onClick={() => handleSelect(song)}
                  className="block w-full text-left px-2 py-1 rounded cursor-pointer hover:bg-[#222]"
                  style={{ border: 'none', background: 'transparent' }}>
                  <span className="text-[11px] text-text-primary font-mono">
                    {song.Title}
                  </span>
                  {song.Composer && (
                    <span className="text-[9px] text-text-dim ml-2">{song.Composer}</span>
                  )}
                  {song.Key && (
                    <span className="text-[9px] text-[#2980B9] ml-2">{song.Key}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <p className="text-[8px] text-text-dim mt-1">
            {songs.length} 曲 · 対応: M7/m7/7/m7♭5 (他はSkip表示)
          </p>
        </>
      )}
    </div>
  );
}
