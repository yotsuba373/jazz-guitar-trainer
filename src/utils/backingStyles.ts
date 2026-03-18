import type { BackingStyle } from '../types';

export interface BackingStyleDef {
  key: BackingStyle;
  label: string;
}

export const BACKING_STYLES: BackingStyleDef[] = [
  { key: 'medium-swing',  label: 'Swing' },
  { key: 'bossa',  label: 'Bossa' },
  { key: 'ballad', label: 'Ballad' },
  { key: 'latin',  label: 'Latin' },
];
