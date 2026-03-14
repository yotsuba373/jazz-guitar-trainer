import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { ROOTS } from '../../constants';
import { parseChordSymbol } from '../../utils';
import type { RootName } from '../../types';

/** Quality suffixes to suggest, ordered by frequency of use */
const QUALITY_SUFFIXES = [
  'maj7', 'm7', '7', 'm7b5', 'dim7', 'mMaj7',
  '7alt', '7b9', '7#11', '7b13',
  '6', 'm6', 'm',
  'sus4', '7sus4',
  '9', 'm9', 'maj9',
  '',  // bare triad
];

interface ChordAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * Try to extract a root from partial input.
 * Returns { root, rest } if a root is found, null otherwise.
 */
function extractRoot(input: string): { root: RootName; rest: string } | null {
  if (!input) return null;
  const m = input.match(/^([A-G])([♭♯#b]?)/i);
  if (!m) return null;

  // Capitalize the letter
  const letter = m[1].toUpperCase();
  const acc = m[2];
  const rootStr = letter + acc;
  const rest = input.slice(m[0].length);

  // Find matching root
  for (const r of ROOTS) {
    // Match unicode (D♭) and ASCII (Db) accidentals
    const nameAscii = r.name.replace('♭', 'b').replace('♯', '#');
    if (rootStr === r.name || rootStr === nameAscii ||
        rootStr.replace('b', '♭').replace('#', '♯') === r.name) {
      return { root: r.name, rest };
    }
  }

  // Just a letter with no accidental — check if valid root
  if (!acc) {
    const found = ROOTS.find(r => r.name === letter);
    if (found) return { root: found.name, rest };
  }

  return null;
}

export function ChordAutocomplete({
  value, onChange, onSubmit, onCancel,
  disabled, placeholder, className, style, inputRef,
}: ChordAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selIdx, setSelIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const computeSuggestions = useCallback((input: string): string[] => {
    if (!input || input.length === 0) return [];

    const parsed = extractRoot(input);
    if (!parsed) {
      // Input doesn't start with a valid root letter — suggest roots
      const upper = input.toUpperCase();
      return ROOTS
        .filter(r => r.name.toUpperCase().startsWith(upper))
        .map(r => r.name)
        .slice(0, 8);
    }

    const { root, rest } = parsed;

    // Filter quality suffixes by prefix match
    const candidates = QUALITY_SUFFIXES
      .filter(q => {
        if (rest === '') return true; // show all when just root typed
        return q.toLowerCase().startsWith(rest.toLowerCase());
      })
      .map(q => root + q)
      .filter(chord => {
        // Validate via parseChordSymbol
        return parseChordSymbol(chord) !== null;
      });

    // Don't suggest if input exactly matches the only candidate
    if (candidates.length === 1 && candidates[0] === input) return [];

    // Also check if input with accidental variants could match more roots
    // e.g. "D" should suggest "D♭" chords too
    const rootVariants: string[] = [];
    if (!parsed.rest && input.length === 1) {
      for (const r of ROOTS) {
        if (r.name.startsWith(input.toUpperCase()) && r.name !== root) {
          // Add a few suggestions for this variant root
          for (const q of ['maj7', 'm7', '7']) {
            const chord = r.name + q;
            if (parseChordSymbol(chord) !== null) {
              rootVariants.push(chord);
            }
          }
        }
      }
    }

    return [...candidates, ...rootVariants].slice(0, 8);
  }, []);

  useEffect(() => {
    const s = computeSuggestions(value);
    setSuggestions(s);
    setSelIdx(-1);
    setOpen(s.length > 0);
  }, [value, computeSuggestions]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (selIdx >= 0 && listRef.current) {
      const item = listRef.current.children[selIdx] as HTMLElement;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [selIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') { onSubmit(); return; }
      if (e.key === 'Escape') { onCancel(); return; }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelIdx(prev => (prev + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelIdx(prev => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selIdx >= 0 && selIdx < suggestions.length) {
          onChange(suggestions[selIdx]);
          setOpen(false);
          // Submit on next tick so the value update propagates
          setTimeout(() => onSubmit(), 0);
        } else {
          onSubmit();
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          onCancel();
        }
        break;
      case 'Tab':
        if (selIdx >= 0 && selIdx < suggestions.length) {
          e.preventDefault();
          onChange(suggestions[selIdx]);
          setOpen(false);
        }
        break;
    }
  }

  function handleSelect(chord: string) {
    onChange(chord);
    setOpen(false);
    inputRef?.current?.focus();
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        style={style}
        autoComplete="off"
        spellCheck={false}
      />
      {open && suggestions.length > 0 && !disabled && (
        <ul
          ref={listRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            margin: 0,
            padding: '2px 0',
            listStyle: 'none',
            background: '#222',
            border: '1px solid #555',
            borderRadius: '4px',
            maxHeight: '160px',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              onMouseDown={e => { e.preventDefault(); handleSelect(s); }}
              onMouseEnter={() => setSelIdx(i)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontFamily: 'monospace',
                cursor: 'pointer',
                background: i === selIdx ? '#3a3a3a' : 'transparent',
                color: i === selIdx ? '#FFF' : '#CCC',
              }}
            >
              <span style={{ color: '#F1C40F' }}>{s.match(/^[A-G][♭♯]?/)?.[0]}</span>
              <span>{s.slice((s.match(/^[A-G][♭♯]?/)?.[0] ?? '').length)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
