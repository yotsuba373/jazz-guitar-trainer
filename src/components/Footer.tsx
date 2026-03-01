import type { ChordNotationPrefs } from '../types';
import { formatQuality } from '../utils';

interface FooterProps {
  chordPrefs: ChordNotationPrefs;
}

export function Footer({ chordPrefs }: FooterProps) {
  return (
    <div className="text-[10px] text-text-faint leading-[1.8] border-t border-border-faint pt-2.5">
      <strong className="text-text-muted">使い方:</strong>{' '}
      7つのポジション形状は全モード共通。モード切替で音名・フレット位置が変化し、同じ形が指板上の異なる場所に現れる。
      コードトーン強調で {formatQuality('maj7', chordPrefs)} / {formatQuality('7', chordPrefs)} / {formatQuality('m7', chordPrefs)} / {formatQuality('m7♭5', chordPrefs)} を比較可能。
    </div>
  );
}
