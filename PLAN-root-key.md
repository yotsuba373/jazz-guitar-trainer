# ルートキー選択機能の追加

## Context

現在すべてのモードが C ルート固定。任意の12キー（C, D♭, D, E♭, E, F, F#, G♭, G, A♭, A, B♭, B）を選択可能にする。
コアアルゴリズム (`buildFretMap`, `generatePositions`) は既にルート非依存のため変更不要。
主な作業はエンハーモニック処理を含むモード動的生成と、ハードコードされた "C" の除去。

## 変更対象ファイル

| ファイル | 操作 | 内容 |
|---------|------|------|
| `src/types/music.ts` | 修正 | `RootName` 型、`ModeTemplate` インターフェース追加 |
| `src/types/index.ts` | 修正 | 再エクスポート追加 |
| `src/utils/noteSpelling.ts` | **新規** | `spellScale()`, `buildDegreeMap()`, `resolveMode()` |
| `src/utils/index.ts` | 修正 | 再エクスポート追加 |
| `src/constants/music.ts` | 修正 | `MODES` → `MODE_TEMPLATES` に置換、`ROOTS` 配列追加 |
| `src/constants/index.ts` | 修正 | エクスポート更新 |
| `src/components/Controls/RootSelector.tsx` | **新規** | ルート選択ボタン行 |
| `src/components/Controls/index.ts` | 修正 | 再エクスポート追加 |
| `src/App.tsx` | 修正 | `rootName` state 追加、`resolveMode` 使用、"C" 除去 |
| `src/components/Controls/ModeSelector.tsx` | 修正 | `rootName` prop 追加、ボタンラベル動的化 |
| `src/components/Fretboard/Fretboard.tsx` | 修正 | `rootNote` prop 追加、`n === 'C'` → 動的比較 |
| `src/components/PositionDetail.tsx` | 修正 | `rootNote` prop 追加、表示テキスト・ルート判定を動的化 |
| `src/components/Footer.tsx` | 修正 | ハードコード "Cmaj7 / C7 / Cm7 / Cm7♭5" をジェネリック表記に |

## 実装ステップ

### Step 1: 型定義の拡張 (`src/types/music.ts`)

```ts
export type RootName =
  | 'C' | 'D♭' | 'D' | 'E♭' | 'E' | 'F'
  | 'F#' | 'G♭' | 'G' | 'A♭' | 'A' | 'B♭' | 'B';

export interface ModeTemplate {
  key: string;
  name: string;
  semi: number[];
  chordSub: string;
  chordDegreesIdx: number[];  // [0,2,4,6] = 1,3,5,7度
  chordQuality: string;       // 'maj7' | 'm7' | '7' | 'm7♭5'
}
```

既存の `Mode` インターフェースはそのまま維持（resolveMode の出力型として使用）。

### Step 2: エンハーモニック処理 (`src/utils/noteSpelling.ts`) — 新規作成

**核心のアルゴリズム: `spellScale(rootName, semiIntervals) → string[]`**

```
LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
LETTER_SEMITONES = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }

1. ルート名をパース → baseLetter + accOffset (例: 'D♭' → D, -1)
2. rootSemitone = (LETTER_SEMITONES[baseLetter] + accOffset + 12) % 12
3. rootLetterIdx = LETTERS.indexOf(baseLetter)
4. 各度数 i (0〜6):
   a. targetSemi = (rootSemitone + interval[i]) % 12
   b. assignedLetter = LETTERS[(rootLetterIdx + i) % 7]
   c. naturalSemi = LETTER_SEMITONES[assignedLetter]
   d. diff = targetSemi - naturalSemi → [-6,+6] に正規化
   e. noteName = assignedLetter + accidentalString(diff)
```

検証例:
- D♭ Ionian → D♭ E♭ F G♭ A♭ B♭ C
- F# Dorian → F# G# A B C# D# E

**`buildDegreeMap(modeSemi, noteNames) → DegreeMap`**
- IONIAN_SEMI = [0,2,4,5,7,9,11] を基準に diff → ♭/# ラベル生成

**`resolveMode(rootName, template) → Mode`**
- spellScale → buildDegreeMap → chord名 (`notes[0] + chordQuality`) → chordTones → Mode 返却

### Step 3: 定数の置き換え (`src/constants/music.ts`)

`MODES: Mode[]` を `MODE_TEMPLATES: ModeTemplate[]` に置換:

```ts
export const MODE_TEMPLATES: ModeTemplate[] = [
  { key: 'ionian', name: 'Ionian', semi: [0,2,4,5,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7' },
  { key: 'dorian', name: 'Dorian', semi: [0,2,3,5,7,9,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7' },
  { key: 'phrygian', name: 'Phrygian', semi: [0,1,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7' },
  { key: 'lydian', name: 'Lydian', semi: [0,2,4,6,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7' },
  { key: 'mixolydian', name: 'Mixolydian', semi: [0,2,4,5,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7' },
  { key: 'aeolian', name: 'Aeolian', semi: [0,2,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7' },
  { key: 'locrian', name: 'Locrian', semi: [0,1,3,5,6,8,10],
    chordSub: '1 ♭3 ♭5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7♭5' },
];

export const ROOTS: { name: RootName; semitone: number }[] = [
  { name: 'C', semitone: 0 }, { name: 'D♭', semitone: 1 }, { name: 'D', semitone: 2 },
  { name: 'E♭', semitone: 3 }, { name: 'E', semitone: 4 }, { name: 'F', semitone: 5 },
  { name: 'F#', semitone: 6 }, { name: 'G♭', semitone: 6 },
  { name: 'G', semitone: 7 }, { name: 'A♭', semitone: 8 }, { name: 'A', semitone: 9 },
  { name: 'B♭', semitone: 10 }, { name: 'B', semitone: 11 },
];
```

### Step 4: RootSelector コンポーネント — 新規作成

ModeSelector と同スタイルのボタン行。白アクセントで選択中キーをハイライト。
ModeSelector の上に配置。13ボタン (F#/G♭ は別ボタン)。

### Step 5: App.tsx の更新

- `rootName` state 追加 (初期値 'C')
- `mode = useMemo(() => resolveMode(rootName, MODE_TEMPLATES[modeIdx]), [rootName, modeIdx])`
- `fretMap`, `allPos`, `ctSet` の依存配列を `[rootName, modeIdx]` に
- `rootNote = mode.notes[0]` → Fretboard, PositionDetail に渡す
- 表示テキスト: `{rootName} {mode.name}`
- RootSelector を JSX に追加

### Step 6: コンポーネントの "C" ハードコード除去

- **ModeSelector**: `rootName` prop → ボタンラベル `{rootName} {m.name}`
- **Fretboard**: `rootNote` prop → `isRoot={n === rootNote}`
- **PositionDetail**: `rootNote` prop → 見出し `{rootNote} {mode.name}`、ルート判定 `n === rootNote`
- **Footer**: `Cmaj7 / C7 / Cm7 / Cm7♭5` → `maj7 / m7 / 7 / m7♭5` (ジェネリック表記)

## 検証

1. **tsc + build**: エラーなし
2. **後方互換**: rootName='C' で全モード・全ポジションが従来と同一出力
3. **スペル検証** (Ionian):
   - C: C D E F G A B
   - D♭: D♭ E♭ F G♭ A♭ B♭ C
   - D: D E F# G A B C#
   - E♭: E♭ F G A♭ B♭ C D
   - E: E F# G# A B C# D#
   - F: F G A B♭ C D E
   - F#: F# G# A# B C# D# E#
   - G♭: G♭ A♭ B♭ C♭ D♭ E♭ F
   - G: G A B C D E F#
   - A♭: A♭ B♭ C D♭ E♭ F G
   - A: A B C# D E F# G#
   - B♭: B♭ C D E♭ F G A
   - B: B C# D# E F# G# A#
4. **UI**: 13キーの選択ボタンが機能、モード・ポジション・CT・ラベルすべて正常
5. **ルートハイライト**: 選択ルートの音が白丸で強調される

## 重要な注意事項

- `buildFretMap()` と `generatePositions()` のロジックは一切変更しない
- `resolveMode('C', template)` の出力が現行の `MODES[i]` と同一であることを必ず確認
- エンハーモニック処理で各スケールは A〜G の各文字を1回ずつ使用する
