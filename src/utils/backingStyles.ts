import type { BackingStyle } from '../types';

export interface BackingStyleDef {
  key: BackingStyle;
  label: string;
  defaultBpm: number;
}

export const BACKING_STYLES: BackingStyleDef[] = [
  { key: 'medium-swing',       label: 'Medium Swing',       defaultBpm: 120 },
  { key: 'medium-up-swing',    label: 'Medium Up Swing',    defaultBpm: 160 },
  { key: 'medium-up-swing-2',  label: 'Medium Up Swing 2',  defaultBpm: 200 },
  { key: 'up-tempo-swing',     label: 'Up-Tempo Swing',     defaultBpm: 282 },
  { key: 'bossa',              label: 'Bossa',              defaultBpm: 140 },
  { key: 'ballad',             label: 'Ballad',             defaultBpm: 72 },
  { key: 'latin',              label: 'Latin',              defaultBpm: 180 },
];
