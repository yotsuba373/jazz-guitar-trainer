# CLAUDE.md — Claude Code 向けプロジェクトガイド

## プロジェクト概要

Berklee 7-Position System に基づくギター指板ビジュアライザー。
Vite 7 + React 19 + TypeScript 5 + Tailwind CSS v4。

---

## セットアップ

```bash
npm install
npm run dev       # 開発サーバー起動 → http://localhost:5173
npm run build     # tsc + vite build
npm run lint      # ESLint
npm test          # vitest run (1056 テスト)
```

Node.js が未インストールの場合は fnm を使用:
```bash
winget install Schniz.fnm   # Windows
fnm install --lts && fnm default lts-latest
```

---

## 作業ルール

- プランを作成したら必ず PLAN.md に自動保存すること
- セッション開始時に PLAN.md があればそれを実行するか確認すること
- PLAN.md の作業を終えたら PLAN.md は削除すること

---

## コーディング規約

- 言語: TypeScript (strict)
- スタイル: Tailwind CSS v4 (`src/index.css` の `@theme` でカスタムトークン定義)
  - 構造・レイアウト → Tailwind クラス
  - データ駆動の動的カラー (ポジション色, モード色) → インライン `style`
  - SVG 幾何属性 (cx, cy, r 等) → SVG属性 / インライン `style`
- コンポーネント: 関数コンポーネント + hooks (useState, useMemo)
- barrel export: 各ディレクトリに `index.ts` で re-export

---

## ファイル構成

```
src/
├── App.tsx                          — 状態管理ハブ (通常モード + 進行モード + BPM自動再生)
├── types/
│   └── music.ts                     — ChordSlot, Progression, ChartMeasure, ChartLayout, ModeTemplate (description), VoicingTemplate, FoundVoicing 等
├── constants/
│   └── music.ts                     — MODE_TEMPLATES(18 + description), ROOTS, STRING_DEG_OFFSETS, POS_COLORS, MODE_COLORS
├── utils/
│   ├── fretboard.ts                 — buildFretMap(), generatePositions(), generateDimPositions()
│   ├── noteSpelling.ts              — spellScale(), buildDegreeMap(), resolveMode()
│   ├── progression.ts               — parseChordSymbol(), rankPositionsByProximity(), QUALITY_TO_MODES, PRESET_PROGRESSIONS
│   ├── guideTones.ts                — getGuideTones(), findNoteLocations(), classifyResolution()
│   ├── jazzStandards.ts             — fetchJazzStandards(), extractStructuredChords(), songToProgression()
│   ├── chartLayout.ts               — deriveChartLayout(), getChartLayout(), buildChordRows()
│   ├── chordForms.ts                — findVoicingsInPosition(), VOICING_TEMPLATES, formatVoicingLabel()
│   ├── phraseGenerator.ts           — generatePhrase(), buildNotePool(), planCtSkeleton()
│   ├── phraseAnalysis.ts            — analyzePhrase(), computeSummary()
│   └── __tests__/
│       ├── fretboard.test.ts        — 388 tests (Pos1リファレンス、度数オフセット不変条件、構造検証)
│       ├── progression.test.ts      — 125 tests (parseChordSymbol、QUALITY_TO_MODES、近接ランキング)
│       ├── jazzStandards.test.ts    — 42 tests (パース、エンディング、リピート、ビート幅、自動ラベル)
│       ├── noteSpelling.test.ts     — 19 tests (スペリング、度数マップ、resolveMode、8音スケール)
│       ├── guideTones.test.ts       — 22 tests (ガイドトーン抽出、解決分類)
│       ├── chordForms.test.ts       — 36 tests (Drop 2/3ボイシング検索、テンプレート構造検証)
│       ├── phraseGenerator.test.ts  — 55 tests (構造不変条件、ビバップ統計検証)
│       ├── phraseQualityAudit.test.ts — 338 tests (17条件×19品質アサーション + 3進行コンテキスト)
│       ├── phraseAnalysis.test.ts   — 21 tests (分析・度数・機能ラベル)
│       └── audioEngine.test.ts      — 10 tests (Karplus-Strong, コードストラム)
└── components/
    ├── Fretboard/                   — SVG指板描画 (Fretboard, FretboardNote, GhostNote, PhrasePath)
    ├── Controls/                    — RootSelector, ModeSelector, PositionSelector, OptionBar, VoicingGrid, PhraseControls, PhraseAnalysisPanel
    ├── Footer.tsx
    ├── PositionDetail.tsx           — (未使用: モード説明セクションに置換済み)
    ├── PositionGrid.tsx
    └── Progression/
        ├── ChordChart.tsx           — iReal Pro 風譜面グリッド
        ├── GuideToneLine.tsx        — ガイドトーン (3rd/7th) ボイスリーディング表示
        ├── ProgressionEditor.tsx    — 進行エディタ (chartLayout 保持)
        ├── ProgressionPlayer.tsx    — 進行プレイヤー (BPM コントロール + ChordChart)
        └── SongImporter.tsx         — JazzStandards 検索・インポート
```

---

## 絶対に守るべきルール

### 1. `generatePositions()` のアルゴリズムを変更しない

- B弦ペア → 他弦トリオの「**1:1順次割当**」が正解
- greedy matcher, ローテート, offset変更は全て失敗済み

| 試行 | 方法 | 結果 | 失敗理由 |
|------|------|------|----------|
| ❌ 1 | Greedy matcher | Pos1の1E弦がG,A,Bに | ルートペアC,DがF,G,Aトリオを先取り |
| ❌ 2 | B弦ペアをローテート | 13シェイプ | トリオ割当がペア順序に依存 |
| ❌ 3 | 生成offset変更 | 12シェイプ | 開始フレットが変わりトリオ選択が変化 |
| ✅ | **1:1順次割当** | 7シェイプ、正確 | シンプルが最強 |

### 2. B弦2音ルールは不変

ギター標準チューニングではB弦は常に2音、他弦は3音。スケール/モードに関わらず成立。

### 3. 検証: C Ionian Pos 1 のリファレンス

```
1E: F(1), G(3), A(5)
B:  D(3), E(5)
G:  A(2), B(4), C(5)
D:  E(2), F(3), G(5)
A:  B(2), C(3), D(5)
6E: F(1), G(3), A(5)
```

### 4. `STRING_DEG_OFFSETS` 定数は変更しないこと

`src/constants/music.ts` に定義: `{ e: 3, g: 5, d: 2, a: 6 }`
全 12 キー × 7 モード (84パターン) で不変であることを vitest で検証済み。
`npm test` で `degree offset invariant` テストが通らなくなったらバグ。

---

## コアアルゴリズム

### 7音スケール: ポジション生成 (`generatePositions`)

Berklee 7ポジションシステムの核心は **B弦（2弦）が各ポジションで2音のみ** という点。
他の弦はすべて3音。これはB-G弦間の長3度チューニングに起因する。

**ステップ1: フレットマップ生成 (`buildFretMap`)**
- 6弦すべてについて、フレット1〜21のどこにスケール音があるかをマッピング
- 開放弦チューニング: `[4, 11, 7, 2, 9, 4]` = E B G D A E (半音値)

**ステップ2: ポジション生成 (`generatePositions`)**
- B弦: ルートペアをスキップ、2度ペアから7つ取得
- 他弦: 最低フレットからトリオを昇順列挙
- 割当: `trio[i]` → `pair[i]` の単純な1:1マッピング

### 8音対称スケール: ディミニッシュポジション (`generateDimPositions`)

ディミニッシュ (W-H / H-W) は対称スケールのため **4ポジション** を生成。
dim7 の構成音 (Root, ♭3, ♭5, 6) は短3度ずつ等間隔 → 12フレットを4分割。

- 各ポジションは5フレット幅、3フレット間隔
- ポジション順: Pos 1=Root, Pos 2=♭3, Pos 3=♭5, Pos 4=6
- 6弦のみ4音 (xx-xx)、他弦は3音

### ガイドトーン & ボイスリーディング (`guideTones.ts`)

進行モードで次のコードへの声部進行を可視化:
- `getGuideTones(mode)`: コードの3rd/7th を抽出
- `findNoteLocations()`: 指板上の全出現位置を検索
- `classifyResolution()`: 現コード7th → 次コード3rd の解決タイプ分類
  - `half-step-down` (理想的), `half-step-up`, `common-tone`, `other`
- dim7 はスキップ (対称構造のため3rd/7th が不定)

### コードフォーム: Drop 2 / Drop 3 ボイシング (`chordForms.ts`)

各ポジション内で押さえられる Drop 2 / Drop 3 ボイシングを指板上にハイライト表示。
対象: Diatonic 7モード (Ionian〜Locrian, modeIdx 0-6) のみ。

**ボイシング理論** (参考: https://jazzguitarlife.net/drop2/):
- Drop 2: 4-way close voicing の上から2番目の音を1オクターブ下げる → 4連続弦
- Drop 3: 上から3番目の音を1オクターブ下げる → 1弦スキップの4弦
- 転回形はベース音で命名 (ジャズ標準): Root=Rがベース, 1st=3rdがベース, 2nd=5thがベース, 3rd=7thがベース

**テンプレート定義** (CT index: 0=R, 1=3rd, 2=5th, 3=7th):

| Drop 2 (底→top) | Drop 3 (底→top) |
|------------------|------------------|
| Root: [0,2,3,1] R-5-7-3 | Root: [0,3,1,2] R-7-3-5 |
| 1st:  [1,3,0,2] 3-7-R-5 | 1st:  [1,0,2,3] 3-R-5-7 |
| 2nd:  [2,0,1,3] 5-R-3-7 | 2nd:  [2,1,3,0] 5-3-7-R |
| 3rd:  [3,1,2,0] 7-3-5-R | 3rd:  [3,2,0,1] 7-5-R-3 |

Drop 2 弦セット: [5,4,3,2], [4,3,2,1], [3,2,1,0] → 12パターン
Drop 3 弦セット: [5,3,2,1], [4,2,1,0] → 8パターン → 合計20テンプレート

**アルゴリズム** (`findVoicingsInPosition`):
1. ポジションinstance内で弦ごとにコードトーンの位置を特定
2. 20テンプレートそれぞれについて4弦の必要CTがあるか確認
3. 組合せのフレット幅 ≤ 5 のものを記録 (最小幅の組合せを選択)

**表示**: シアン (`#00E5FF`) の角丸矩形で指板上にハイライト。
ポジション1つ選択時のみ有効。◀/▶ でボイシング切替 (VoicingGrid コンポーネント)。
進行モードではボイシング選択が `ChordSlot.voicingKey` に保存され、コード切替時に復元。

### フレーズジェネレーター (`phraseGenerator.ts`)

ビバップスタイルの8分音符8音フレーズを指板座標ベースで生成し、SVG Catmull-Rom 曲線で描画。

**アルゴリズム概要**:
1. `buildNotePool()`: ポジション内の全スケール音 + クロマチックアプローチ音を収集
2. インスタンススコープ (`activePool`): 第1インスタンスの fretMin-1 ~ fretMax+1 に制限（音域コンパクト化）
3. ゴール音 (beat 8) 決定: 進行モードは次コード3rd、通常モードは強進行マッピングで推定
4. **ハーモニック・スケルトン**: `planCtSkeleton()` で ARPEGGIO_PATTERNS からコンター親和パターンを選択、beat 1,3,5,8 の強拍CTをアルペジオ方向性に基づき事前決定
5. **デジタルパターン試行**: beat 1 確定後 + 強拍でパーカー語彙パターンを35%確率で一括コミット (1フレーズ1回)
6. 逐次生成 (beats 2-7): 候補スコアリング (インターバル分布, 輪郭一致, 方向転換, ゴール近接, **骨格追従**, **アルペジオ断片**)
7. アプローチパターン挿入: 弱拍で tryApproachCommitment() → 複数音一括確定、**ガイドトーン優先ターゲティング**
8. ポスト処理: 同音反復修正、beat 8 距離ガード (>5st でフォールバック)

**ハーモニック・スケルトン**:
- `ARPEGGIO_PATTERNS`: 9パターン (asc/desc/mixed) — R-3-5-7, 7-5-3-R, R-5-3-7 等
- `CONTOUR_PATTERN_AFFINITY`: コンター方向とパターン方向の親和マッピング
- `planCtSkeleton()`: mode 受取、パターン選択(方向親和+ゴールCT一致+ガイドトーン重み+startHint近接)、`resolveSkeletonBeat()` で物理位置解決

**デジタルパターン (Digital Patterns)**:
- 13パターン: 上行4 (1-2-3-5, 3-5-7-9, 5-7-R-2, 7-R-2-3), 下行4 (7-5-3-R, 5-3-R-7, R-7-5-3, 9-7-5-3), スカラー2 (asc/desc), ハイブリッド3 (R-3-5-step-down等)
- `tryDigitalPattern()`: 35%発火率、1フレーズ1回、強拍CT一致+到達可能性チェック
- `pickByDirection()`: 方向に応じた最寄りインスタンス選択
- `findScaleDegreeNeighbor()`: スケール度数オフセットでの隣接音検索

**デジタルパターン**: 21パターン (上行4+下行4+スカラー2+ハイブリッド3 = 4音パターン13個 + 5音パターン6個 + 6音パターン2個)

**アプローチタイプ**: Single↓/↑ (1音), Enclosure (2音), Parker Enclosure (3音), b9 Arpeggio (4音, Dom7のみ)
- コンテキスト依存確率: ゴール拍100%, beat 5前50%, beat 3前35%, デフォルト45%

**エクステンション音 (9th/13th)**: `EXTENSION_DEGREES` マップで定義、強拍での使用を許容
- 対象: maj7 [9th,13th], 7 [9th,13th], m7 [9th], mMaj7 [9th]
- スコアリング: CT より低い優先度 (-10) で自然な出現頻度を維持
- `PhraseNote.isExtension` フラグで識別

**ビバップスケール経過音**: `BEBOP_PASSING` マップ (Mixolydian: nat7, Dorian: nat3, Ionian: ♭7)
- 弱拍+スカラーパッセージ中に +20 ボーナス

**コード間ボイスリーディング**: `PhraseConfig.nextChordContext` で次コード情報を受取
- `chooseGoalNote()`: 現7th→次3rd半音解決時に70%確率でゴール選択
- 後半ビート (goalBeat-2～): 次コード3rdへの半音接近 +20, 共通音 +10

**モチーフ記憶**: `GeneratedPhrase.motif` (開始2音のインターバル列) を抽出
- 次フレーズの beats 2-4 で `PhraseConfig.prevMotif` との類似度ボーナス (完全一致 +12, 近似 +6)

**スコアリング重み**:
- 順次進行 (1-2半音): 60, 3度 (3-4半音): 25, 4度 (5半音): 10, 5度+: 5
- 弦距離: -15/弦, 大跳躍: -25 (≥6半音), -35 (≥8半音)
- 方向転換ボーナス: +15, 同方向3+連続: -25
- **ガイドトーン階層**: 強拍3rd/7th +25, beat1/3追加 +10, エクステンション-10, エンクロージャー3rd/7thターゲット +12
- **ビバップ経過音**: Mixolydian/Dorian/Ionian のビバップスケール音 +20 (弱拍+スカラー時)
- **コード間VL**: 次3rdへ半音+20/共通音+10 (後半ビート), 7th→3rd解決70%優先
- **モチーフ類似**: 完全一致+12, 近似+6 (beats 2-4)
- **骨格追従**: +50 (CT名一致), +25 (同インスタンス近接), 大跳躍時は半減
- **アルペジオ断片**: 3連続異名CT +18, 方向連続 +8
- 往復ペナルティ: -90 (2-back), -45 (3-back)
- CTアウトライン進行: +12 (隣接CT), +6 (スキップ)
- パッシングトーン品質: +18 (骨格ピッチに向かう動き), 半音接近 +10, 逆行 -10
- スカラーラン継続: +14
- 停滞ペナルティ: -55 (≤2st), -35 (≤3st)
- contourScore: max 22, 半音解決ボーナス: +15

**強拍/弱拍制約**: 拍 1,3,5,8 = CT 必須 (isStrong=true), 拍 2,4,6,7 = スケール/クロマチック可

**描画**: PhrasePath.tsx — Catmull-Rom → Cubic Bezier 変換, per-beatグラデーション(#FFA0B0→#BBA0FF), 矢印マーカー, ノート形状 (CT=塗り円, アプローチ=ダイヤ, スケール=枠円), 拍番号

**フレーズ分析**: `phraseAnalysis.ts` — analyzePhrase(), 度数/インターバル/機能ラベル, PhraseAnalysisPanel (折りたたみUI)

**UI**: OptionBar「フレーズ」チェックボックス → PhraseControls (ソース/アプローチ/Generate/◀▶履歴)
有効条件: `selPosIds.length === 1 && !overlay && !is8Note`

**テスト**: 55テスト (構造不変条件 + N=100 ビバップ統計検証) + 338テスト (品質監査: 17条件×19アサーション + 3進行コンテキスト) + 21テスト (分析)

---

## コード譜面のアーキテクチャ

### データフロー

```
JazzStandards.json
    ↓ fetchJazzStandards()
RawJazzStandard { Sections: RawSection[] }
    ↓ extractStructuredChords()
StructuredSection { measures: MeasureChord[][], endings?, repeats? }
    ↓ songToProgression()
Progression { chords: ChordSlot[], chartLayout: ChartLayout }
    ↓ ChordChart component
CSS Grid 描画
```

### 設計判断

- `chords: ChordSlot[]` フラット配列が全ロジックのソース (指板同期、ナビ等)
- `chartLayout?: ChartLayout` は表示用メタデータ (chords[] へのインデックス参照)
- ユーザー作成の進行 (chartLayout なし) → `deriveChartLayout()` で1コード/小節に自動生成
- `ProgressionEditor` が chartLayout を state で保持、コード追加/削除時に invalidate

### beatWidths の扱い

- JSON の空カンマスロット (`Cm7,,Eb7,E7`) → 直前コードの `beats++`
- `MeasureChord = { chord: string, beats: number }`
- `ChartMeasure = { chordIndices: number[], beatWidths?: number[] }`
- `beatWidths` はフレックス比率 (表示幅・タイミングを小節内で正規化して使う)
  - ChordChart: `flex: beats` により比例幅表示
  - BPM 自動再生: `(bw / bwSum) * 4` で4拍基準の実際の拍数に変換
- セクションラベル列: `hasLabels = sections.some(s => s.label || s.endings)` が true の場合のみ表示
  - ラベルなしの単一セクション (Blues 等) は `label: ''` にして列を非表示

---

## BPM 自動再生 (`App.tsx`)

### 再生シーケンス生成 (`buildPlaybackSeq`)

`ChartLayout` から section repeats と volta endings を展開したフラットな再生順リストを生成:

```typescript
// { chordIdx: number, beats: number }[] — 全リピート/エンディングを展開済み
const seq = buildPlaybackSeq(getChartLayout(activeProg));
```

- `section.repeats = 1` → そのセクションを2回演奏
- `section.endings[0]` → 1番括弧（1回目の pass に追加）、`[1]` → 2番括弧（2回目の pass）
- `beatWidths` はフレックス比率 → `(bw / bwSum) * 4` で4拍基準の拍数に変換

### ドリフトフリータイミング

`setTimeout` の遅延は実際の発火時刻から次を計算するとイベントループ遅延が累積する問題を修正:

```typescript
const chordStartRef = useRef(0);     // 現コードの「理想開始時刻」
const wasAutoAdvanceRef = useRef(false); // 自動進行か手動ナビかを区別
const playPosRef = useRef(0);        // playbackSeq 内の現在位置

// 自動進行時: targetAt (理想時刻) を次コードの anchor に
// 手動ナビ / BPM変更 / 再生開始時: performance.now() に再アンカー
```

停止トリガー: 通常モード切替 / 進行モード切替 / 編集ボタン / 進行選択変更

---

## メトロノーム (`App.tsx`)

### 音生成 (`playClick`)

Web Audio API で単発クリック音を生成。外部依存なし。

```typescript
function playClick(accent: boolean, ctx: AudioContext, volume: number) {
  // accent=true: 1200Hz (小節頭アクセント), false: 800Hz (通常クリック)
  // gain: accent ? volume * 3 : volume * 1.5  (gain > 1.0 で十分な音量)
}
```

### タイミング

- `setInterval(60000 / bpm)` — コード進行タイマーとは独立
- `metBeatRef.current % 4 === 0` でアクセント判定 (小節頭 = 4拍ごと)
- `metVolumeRef` (useRef) を通じて volume 変更を setInterval 再起動なしに反映

### 音量ミキサー (ProgressionPlayer)

🔊ボタンのドロップダウンパネルに3つの音量スライダーを配置:

| 種別 | state | localStorage | デフォルト | 用途 |
|------|-------|-------------|-----------|------|
| メトロノーム | `metVolume` | `metVolume` | 0.5 | `playClick()` |
| コード | `chordVolume` | `chordVolume` | 0.5 | `playChordStrum()` |
| 単音 | `noteVolume` | `noteVolume` | 0.4 | `playKSNote()` (指板クリック) + `schedulePhrase()` (フレーズ再生) |

- 全 state は `useRef` 経由でコールバック内から参照 (再レンダリング不要)
- パネル外クリックで自動閉じ (`mousedown` リスナー)

### フレーズ単体再生 (`handlePlayPhrase`)

PhraseControls の `▶ Play` / `■ Stop` ボタンで、進行モード再生なしにフレーズを聴ける。
- テンポは「速度」スライダー (`phraseAnimSpeed`) に連動
- 音量は `noteVolume` (単音音量) を使用
- `phraseAnimKey` インクリメントで SVG アニメーションも同時リスタート
- `schedulePhrase()` で Web Audio API スケジューリング → 自動タイマーで再生完了検出

---

## UIレイアウト (`App.tsx`)

### 通常モード
```
RootSelector (12キー)
ModeSelector (18モード)
PositionSelector (Pos 1-7 + 全表示 + 重ねる) ＋ VoicingGrid (◀/▶)
OptionBar (CT, ラベル, 記法, ガイドトーン, コードフォーム, フレーズ)
PhraseControls (フレーズON時: ソース/アプローチ/Generate/履歴ナビ)
Fretboard (SVG + PhrasePath)
モード説明セクション (スケール音 + コード + フレーバーテキスト)
PositionGrid (ポジション一覧カード)
Footer
```

### 進行モード
```
ProgressionEditor (編集時のみ)
ProgressionPlayer (BPM + ChordChart + モード選択 + ポジション選択 + VoicingGrid)
OptionBar (フレーズ含む)
PhraseControls (フレーズON時)
Fretboard (SVG + PhrasePath)
モード説明セクション
Footer
```

### ポジション選択
- `selPosIds: number[]` — 複数選択対応 (Shift+click でトグル)
- 通常クリック: 単一選択に切替
- 進行モード Shift+click: 表示のみトグル (コードデータには保存しない)

---

## 実装済み機能

- 18モード: Diatonic 7, Melodic Minor 7, Harmonic Minor 2, Diminished 2 (W-H/H-W)
- 7ポジション個別/複数選択(Shift+click)/全表示/オーバーレイ、12キー対応、コードトーン強調
- ラベル切替（音名/度数）、コード記法プリファレンス (M7/maj7/△7 等)
- モード説明セクション: スケール音・コード構成音・フレーバーテキスト（常時表示、Fretboard 下）
- コード進行モード: 作成・編集・保存 (localStorage)、近接ポジション提案、キーボードナビ
- ガイドトーン (3rd/7th) 表示、次コード3rdゴーストノート、解決分類
- JazzStandards インポート (1382曲)
- iReal Pro 風譜面: セクションラベル、エンディング、リピート、ビート比例幅
- プリセット進行: II-V-I (C/F/B♭)、Blues (B♭/F)、Rhythm Changes (B♭)
- BPM 自動再生: ドリフトフリータイミング、セクションリピート/volta endings 対応、SVG再生ボタン
- メトロノーム: Web Audio API クリック音、小節頭アクセント
- 音量ミキサー: メトロノーム/コード/単音の3系統、ドロップダウンUI (localStorage 永続化)
- コードフォーム表示: Drop 2 / Drop 3 ボイシング (20テンプレート)、指板ハイライト、◀/▶ 切替
- フレーズジェネレーター: ビバップライン自動生成 (ハーモニック・スケルトン+デジタルパターン21個+ガイドトーン階層+エクステンション音+ビバップスケール+コード間VL+モチーフ記憶)、SVG曲線表示、アプローチパターン、品質監査・統計検証済、単体再生 (▶ Play)
- フレーズ分析: analyzePhrase(), PhraseAnalysisPanel (折りたたみUI、度数/インターバル/機能ラベル)

---

## 今後の開発予定

1. ポジション間移動ガイド (共通音ハイライト)

---

## 参考

- `berklee-positions-v2.jsx` — 移行元の Artifact コード (参照用)
- POS_COLORS: `['#E74C3C', '#E67E22', '#E8336F', '#27AE60', '#6EAC00', '#8E44AD', '#16A085']`
  - ガイドトーン色と被らないよう調整済み: 3rd=#F1C40F(黄), 7th=#3498DB(青)
  - コードフォーム色: #00E5FF(シアン) — ポジション色・ガイドトーン色と被らない
  - フレーズ色: #FF6B9D(ピンクマゼンタ) — 全既存色と被らない
