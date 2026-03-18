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
npm test          # vitest run (800 テスト)
```

Node.js が未インストールの場合は fnm を使用:
```bash
winget install Schniz.fnm   # Windows
fnm install --lts && fnm default lts-latest
```

---

## 作業ルール

- **アプリの機能に変更を加えた場合は、`docs/index.html` のドキュメントも必ず更新すること**
  - 新機能追加 → 該当セクションを追加/更新
  - アルゴリズム変更 → リックエンジン等の該当セクションを更新
  - 定数/型の変更 → Constants / Type Definitions セクションを更新
  - テスト数の変更 → Testing セクションのテスト数を更新
- **レポート・報告は必ず日本語で行うこと**

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
├── App.tsx                          — 状態管理ハブ (UI state + フック統合, ~1270行)
├── types/
│   └── music.ts                     — ChordSlot (lickBeatOffset, lickAnacrusis フィールド含む), Progression (bpm, backingStyle, swingEnabled, swingAmount, loopRange — 曲ごと保存), BackingStyle, ChartMeasure, ChartLayout, ModeTemplate, PoolNote 等
├── constants/
│   └── music.ts                     — MODE_TEMPLATES(18 + description), ROOTS, STRING_DEG_OFFSETS, POS_COLORS, MODE_COLORS
├── utils/
│   ├── fretboard.ts                 — buildFretMap(), generatePositions(), generateDimPositions()
│   ├── noteSpelling.ts              — spellScale(), buildDegreeMap(), resolveMode()
│   ├── progression.ts               — parseChordSymbol(), rankPositionsByProximity(), QUALITY_TO_MODES, PRESET_PROGRESSIONS
│   ├── guideTones.ts                — getGuideTones(), findNoteLocations(), classifyResolution()
│   ├── jazzStandards.ts             — fetchJazzStandards(), extractStructuredChords(), songToProgression()
│   ├── chartLayout.ts               — deriveChartLayout(), getChartLayout(), buildChordRows(), removeChordFromLayout(), insertChordAtBeat(), computeInsertFlatIndex(), insertEmptyMeasure(), splitSection(), mergeSections(), splitEndings(), removeEndings(), findChordMeasure()
│   ├── chordForms.ts                — findVoicingsInPosition(), VOICING_TEMPLATES, formatVoicingLabel()
│   ├── sampler.ts                   — loadSamplers(), getSamplers(), buildJazzPianoVoicing(), playSmplrPianoComp() — smplr SoundFont サンプラー + ジャズピアノボイシング
│   ├── walkingBass.ts               — generateBassLine(), playSmplrBassLine() — ウォーキングベース生成 + smplr acoustic_bass 再生 (スタイル別パターン対応)
│   ├── drumPatterns.ts              — generateSwingDrumPattern(), generateDrumPattern(), playDrumPattern(), loadDrumSampler() — スタイル別ドラムパターン生成 (Swing/Bossa/Ballad/Latin) + Hydrogen GM / カスタム WAV ドラム再生
│   ├── drumPatternDB.ts             — loadDrumPatternDB(), getDrumPatternDB() — MIDI ドラムパターン DB ロード (public/drum-patterns.json)
│   ├── compPatterns.ts              — generateCompPattern() — スタイル別コンピングリズムパターン生成 (Charleston, Bossa, Ballad, Latin)
│   ├── backingStyles.ts             — BACKING_STYLES, BackingStyleDef — バッキングスタイル定義 (swing/bossa/ballad/latin)
│   ├── lickEngine.ts                — absolutePitch(), buildNotePool(), loadLickDB(), transposeLick(), mapLickToFretboard(), lickToGeneratedPhrase(), inferModeFromLick(), inferModeCandidates(), findBestPositionForLick(), selectBestInstance(), buildLickContext(), detectIiVPattern(), isIiVLickId(), buildIiVLickContext(), sliceLick()
│   ├── lickPlayback.ts              — findLickById(), playLickForChord(), buildAnacrusisPhrase(), getStrumNotes(), resolveChordPositions(), computeTransposeSemitones(), isLickOriginator()
│   ├── playbackSeq.ts               — buildPlaybackSeq(), computeCumBeats()
│   ├── phraseAnalysis.ts            — analyzePhrase(), computeSummary()
│   ├── swing.ts                     — swingBeatStart(), swingVolumeMult(), swingDurMult()
│   └── __tests__/
│       ├── fretboard.test.ts        — 388 tests (Pos1リファレンス、度数オフセット不変条件、構造検証)
│       ├── progression.test.ts      — 125 tests (parseChordSymbol、QUALITY_TO_MODES、近接ランキング)
│       ├── jazzStandards.test.ts    — 42 tests (パース、エンディング、リピート、ビート幅、自動ラベル)
│       ├── noteSpelling.test.ts     — 19 tests (スペリング、度数マップ、resolveMode、8音スケール)
│       ├── guideTones.test.ts       — 22 tests (ガイドトーン抽出、解決分類)
│       ├── chordForms.test.ts       — 36 tests (Drop 2/3ボイシング検索、テンプレート構造検証)
│       ├── audioEngine.test.ts      — 14 tests (Karplus-Strong, サクソフォン, エレピ, コードストラム)
│       ├── swing.test.ts            — 25 tests (タイミング/ダイナミクス/アーティキュレーション/テンポ補正)
│       ├── lickEngine.test.ts       — 61 tests (リックDB読込・移調・指板マッピング・モード推定・ポジション選択・インスタンス選択・8音スケール・GeneratedPhrase変換・ii-V検出・sliceLick汎用分割)
│       ├── walkingBass.test.ts      — 15 tests (ベースライン生成、音域検証、拍数別、アプローチノート、スタイル別)
│       ├── drumPatterns.test.ts    — 26 tests (ドラムパターン生成、フェザリング、ゴーストノート、コンピング、スウィング、スタイル別)
│       ├── compPatterns.test.ts    — 10 tests (コンピングパターン生成、Swing Charleston/Bossa/Ballad/Latin)
│       └── backingStyles.test.ts   — 17 tests (バッキングスタイル定数構造、スタイル別統合テスト)
├── hooks/
│   ├── useTimer.ts                  — setTimeout ref管理フック (自動クリア)
│   ├── useAudioContext.ts           — AudioContext共有 + 音量/設定ref同期 + AudioHandle
│   ├── usePreviewPlayback.ts        — リック手動プレビュー再生 (ii-V切替, メトロノーム)
│   ├── useAutoPlay.ts               — 進行モード自動再生 (BPM, カウントイン, ループ, アナクルーシス)
│   └── useUndoRedo.ts               — 汎用 Undo/Redo フック (past/present/future スタック)
└── components/
    ├── Fretboard/                   — SVG指板描画 (Fretboard, FretboardNote, GhostNote, PhrasePath)
    ├── Controls/                    — RootSelector, ModeSelector, PositionSelector, OptionBar, VoicingGrid, PhraseAnalysisPanel, PianoRoll, GlobalAudioControls, LickPanel, ChordAutocomplete
    ├── Footer.tsx
    ├── PositionDetail.tsx           — (未使用: モード説明セクションに置換済み)
    ├── PositionGrid.tsx
    └── Progression/
        ├── ChordChart.tsx           — iReal Pro 風譜面グリッド
        ├── GuideToneLine.tsx        — ガイドトーン (3rd/7th) ボイスリーディング表示
        ├── ProgressionEditor.tsx    — 進行エディタ (chartLayout 保持)
        ├── ProgressionPlayer.tsx    — 進行プレイヤー (ChordChart + モード/ポジション選択)
        └── SongImporter.tsx         — JazzStandards 検索・インポート
scripts/                                 — Python 分析基盤 (ビバップソロ統計)
├── download_omnibook.py                 — Parker Omnibook MusicXML ダウンロード
├── download_wjd.py                      — WJazzD SQLite3 ダウンロード
├── analyze_omnibook.py                  — Omnibook 分析 (50ソロ, コード品質別)
├── analyze_wjd.py                       — WJD 基本分析 (186ソロ, 奏者別)
├── analyze_bebop_deep.py                — 深掘り分析 (スケール検出/アプローチ/フレーズ/イディオム)
├── parse_licks.py                       — MIDI リックパーサー (DAW録音→JSON変換、120グリッド量子化、ルート移調、休符/三連符対応)
├── parse_drum_patterns.py               — MIDI ドラムパターンパーサー (4小節MIDI→JSON、ピッチベース、ロール不要)
├── split_midi.py                        — マルチトラックMIDI分割 (Cubase一括書出し → トラック名別ファイル)
├── data/                                — ダウンロードデータ + リックDB + ドラムパターンDB + export.mid (gitignored)
└── output/
    ├── parker_profiles.json             — Omnibook 分析結果
    ├── wjd_profiles.json                — WJD 分析結果
    └── bebop_deep_profiles.json         — 深掘り分析結果
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
リック選択も `ChordSlot.lickId` + `lickHighOctave` + `lickHighInstance` に保存され、コード切替時に自動復元。進行再生時は保存リックを自動再生。
- **8va**: 同一インスタンス内でオクターブ切替 (デフォルト=低、ON=高)。viable (≥80%カバレッジ) シフトがデフォルトより上に存在しないと disabled。同率カバレッジが複数ある場合は最高シフト=8va、次=デフォルト。オクターブ検証範囲: `OCTAVE_SHIFTS = [0, -12, 12, -24, 24]`
- **Hi**: ハイポジションインスタンスに切替。インスタンスが1つなら disabled。Hi=OFF は最低フレットインスタンスを選択 (カバレッジ>0なら)、Hi=ON は最高フレットインスタンスを選択 (対称設計)

### フレーズ描画 & 分析

**描画**: PhrasePath.tsx — Catmull-Rom → Cubic Bezier 変換, per-beatグラデーション(#FFA0B0→#BBA0FF), ノート形状 (CT=塗り円, アプローチ=ダイヤ, スケール=枠円), 拍番号, 視認性改善。リック表示に使用。`highlightUpTo` prop でステップモード対応 (到達済みノートのみ表示、現在ノートにパルスアニメーション)。

**フレーズ分析**: `phraseAnalysis.ts` — analyzePhrase(), PhraseAnalysisPanel (折りたたみUI, 度数/インターバル/機能ラベル, デバッグコピーボタン)
- 機能ラベル: CT, 半音↑/↓アプローチ, 全音↑/↓アプローチ, ダブルクロマチック, エンクロージャー上/下, dim7構成音, テンション, スケール音

**音声再生** (`audioEngine.ts`): `schedulePhrase()` は各ノートの `beatStart` を使用してタイミング計算 → アニメーション・メトロノームと同期

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
- `ProgressionEditor` が chartLayout を state で保持、差分更新で構造を維持
  - 小節追加: `insertEmptyMeasure()` で空小節追加 → 即座に1拍目挿入モードへ
  - コード挿入: ビートグリッドの「+」で拍位置選択 → `insertChordAtBeat()` / `fillEmptyMeasure()`
  - コード削除: `removeChordFromLayout()` でインデックス調整 (小節は空のまま残る)
  - 空小節削除: 空小節の縦長 × ボタンで明示的に削除
  - コード更新: chartLayout そのまま保持 (同じインデックス)
- 編集モード時、ChordChart が4列ビートグリッド表示 (`+` マークで空き拍クリック→挿入)
- 選択中のビートセルをハイライト: 緑 (挿入) / 黄 (編集)。未選択時はテキストフィールド・ボタンがグレーアウト

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
// { chordIdx: number, beats: number, measureFlatIdx: number }[] — 全リピート/エンディングを展開済み
const seq = buildPlaybackSeq(getChartLayout(activeProg));
```

- `section.repeats = 1` → そのセクションを2回演奏
- `section.endings[0]` → 1番括弧（1回目の pass に追加）、`[1]` → 2番括弧（2回目の pass）
- `beatWidths` はフレックス比率 → `(bw / bwSum) * 4` で4拍基準の拍数に変換

### ドリフトフリータイミング + Look-ahead スケジューリング

`useAutoPlay` フック内で、コードチェンジ時の音声を Web Audio タイムラインに事前予約 (look-ahead) することで、サンプル精度のタイミングを実現:

```typescript
// useAutoPlay 内部の状態管理
const advanceOriginRef = useRef<'stopped'|'start'|'user-nav'|'auto'>('stopped'); // 明示的状態マシン
const chordStartRef = useRef(0);     // 現コードの「理想開始時刻」
const playPosRef = useRef(0);        // playbackSeq 内の現在位置
const pendingNextRef = useRef(null);  // 事前スケジュール済み次コードの音声ハンドル

// effect 実行時: 次コードの音声を ctx.currentTime + delay/1000 で即座にスケジュール
// setTimeout: React state 更新のみ (コードハイライト、アニメーション)
// pendingNextRef パターン: timeout 発火→ref移管→null化、cleanup時はnullなら何もしない
```

`scheduleChordAudio()` (useAutoPlay 内部関数) がストラム + リック + メトロノームを一括スケジュール。
メトロノームの setInterval は廃止、全て Web Audio タイムラインに事前予約。

停止トリガー: 通常モード切替 / 進行モード切替 / 編集ボタン / 進行選択変更

自動再生中の音声: コードストラム + 各コードに保存されたリック (`ChordSlot.lickId`) を自動再生。ルールベースフレーズ生成は削除済み。

### カウントイン

再生開始前にメトロノームクリックでテンポを提示。「停止→再生」時のみ発動 (auto-advance 中は鳴らない)。

- `countInEnabled` / `countInBars` (1 or 2) / `countInVolume` — 全て localStorage 永続化
- ON/OFF + 小節数はミキサー内ボタンのサイクル切替: `2小節 → OFF → 1小節 → 2小節 → ...`
- カウントイン中は `isCountingIn = true` → auto-advance effect 早期リターン + `activePhrase = null` (フレーズ表示抑制)
- `advanceOriginRef === 'stopped'` のときだけカウントインする明確なルール。カウントイン完了後は `advanceOriginRef = 'start'` にセット
- 停止時は useAutoPlay 内の cleanup でクリック音を即座に停止

### 小節ループ

苦手な箇所を繰り返し練習するための小節単位ループ機能。

- `loopRange: { start: number; end: number } | null` — flat measure index (ChordChart と buildPlaybackSeq で一致)
- `loopRangeRef` 経由で auto-advance effect 内から参照
- 次コード計算時にループ範囲チェック: 範囲外なら範囲先頭の seq エントリに戻す
- ChordChart: 各小節右上にホバー表示のループアイコン、ループ範囲はオレンジ下線 + 範囲外 dim
- GlobalAudioControls: ループラベル + 解除ボタン
- 曲ごとに `Progression.loopRange` として localStorage 永続化、進行切替時に復元

---

## メトロノーム (`App.tsx`)

### 音生成 (`playClick`)

Web Audio API で単発クリック音を生成。外部依存なし。`at` パラメータで Web Audio タイムスタンプ指定可。

```typescript
function playClick(accent: boolean, ctx: AudioContext, volume: number, at?: number): OscillatorNode {
  // accent=true: 1200Hz (小節頭アクセント), false: 800Hz (通常クリック)
  // gain: accent ? volume * 1.5 : volume * 1.0
  // returns OscillatorNode (プレビューメトロノームのクリーンアップ用)
}
```

### メトロノーム自動再生 (ボタン廃止)

`isMetronomeOn` state は廃止。メトロノームは以下の条件で自動的に鳴る:
- **進行モード自動再生中**: `isPlaying && metVolume > 0` → `useAutoPlay` 内の `scheduleChordAudio()` で Web Audio タイムラインに事前予約
- **フレーズプレビュー再生中**: `usePreviewPlayback` 内の phrase-start effect で全クリックを Web Audio タイムラインに一括予約

### フレーズプレビュー同期アーキテクチャ (`usePreviewPlayback`)

フレーズ・コードストラム・メトロノームの完全同期を保証する2段階設計:

1. **`playPhraseAudio()`** — 音声をスケジュールせず `pendingPhraseRef` にパラメータを保存、state 更新のみ
2. **phrase-start effect** — React レンダー完了後に起動、`ctx.currentTime` を1回取得し全音声を同一タイムスタンプで予約:
   - `schedulePhrase(ctx, phrase, startAt, ...)` — フレーズ音声
   - `playChordStrum(ctx, notes, vol, startAt)` — コードストラム (両モード対応、ii-V の V コード切替にも対応)
   - `playClick(accent, ctx, vol, startAt + b * beatSec)` × 全拍 — メトロノーム全クリック一括予約

全て `OscillatorNode.start(t)` で Web Audio スケジューラに予約されるため、JS イベントループや React レンダー遅延に一切依存しない。
停止時は `stopHandle` / `stopHandleArray` (`AudioHandle` インターフェース) で予約済み音声を一括停止。

### ストラム・メトロノーム分離 (フック間)

- `useAutoPlay` 内: `activeStrumRef` / `songMetRef` / `pendingNextRef` — 進行モード自動再生用
- `usePreviewPlayback` 内: `previewStrumRef` / `previewMetRef` — フレーズプレビュー用
- 両フックは互いの refs に干渉せず独立管理。`AudioHandle` + `stopHandle`/`stopHandleArray` で統一的クリーンアップ

### 音量ミキサー (GlobalAudioControls)

🔊ボタンのドロップダウンパネルに3つの音量スライダー (各ミュートボタン付き) + 楽器選択を配置:

| 種別 | state | localStorage | デフォルト | ミュート | 用途 |
|------|-------|-------------|-----------|---------|------|
| メロディ | `noteVolume` | `noteVolume` | 0.4 | `noteAudioOn` | `playNote()` + `schedulePhrase()` |
| コード | `chordVolume` | `chordVolume` | 0.5 | `chordAudioOn` | `playSmplrPianoComp()` |
| ベース | `bassVolume` | `bassVolume` | 0.5 | `bassAudioOn` | `playSmplrBassLine()` |
| リズム | `metVolume` | `metVolume` | 0.5 | `rhythmOn` | メトロノーム: `playClick()` / ドラム: `playDrumPattern()` |
| カウントイン | `countInEnabled` | `countInEnabled` | true | サイクル切替 | ON/OFF + 小節数 |
| カウントイン音量 | `countInVolume` | `countInVolume` | 0.5 | — | `playClick()` |
| カウントイン小節 | `countInBars` | `countInBars` | 2 | — | 1 or 2 |
| 楽器 | `instrument` | `phraseInstrument` | 'guitar' | — | 楽器選択 (guitar/saxophone) |
| リズムモード | `rhythmMode` | `rhythmMode` | 'metronome' | — | 'metronome' \| 'drums' 排他切替 |
| バッキングスタイル | `backingStyle` | `Progression.backingStyle` | 'swing' | — | スタイル選択 (swing/bossa/ballad/latin) — 曲ごと保存 |
| スウィング | `swingEnabled` | `Progression.swingEnabled` | false | — | ON/OFFトグル — 曲ごと保存 |
| スウィング量 | `swingAmount` | `Progression.swingAmount` | 0.2 | — | 0-1 (デフォルト20%) — 曲ごと保存 |

- 全チャンネルに独立ON/OFFトグル (音量スライダーはOFF時も操作可能)
- smplr 楽器の音量制御は `output.setVolume()` で行い、velocity は演奏表現用の値を保持
- タップテンポ: TAPボタン連続タップでBPM設定 (直近8タップ平均、2秒リセット)
- 全 state は `useAudioContext` フック内の `useRef` 経由でコールバック内から参照 (再レンダリング不要)。ref 同期 + localStorage 永続化を自動実行
- パネル外クリックで自動閉じ (`mousedown` リスナー)

### リック再生 (`playPhraseAudio`)

リック選択時に自動再生。`▶ Play` / `■ Stop` でトグル再生も可能。
- テンポ: 常に BPM 同期 (`(60/bpm)/2`)
- 音量は `noteVolume` (メロディ音量) を使用
- `phraseAnimKey` インクリメントで SVG アニメーションも同時リスタート
- `schedulePhrase()` で Web Audio API スケジューリング → 自動タイマーで再生完了検出
- `chordAudioOn` 時、フレーズ再生開始にコードストラムも同時再生 (辞典/練習モード両対応)

### スウィングモード (`swing.ts`)

再生時に3次元変換を適用 (`beatStart` 生成値はストレートのまま):

| 次元 | 表拍8分 | 裏拍8分 | 4分/3連 |
|------|--------|--------|--------|
| タイミング | 変更なし | +0.17拍 (最大, 3連フィール) | 変更なし |
| ダイナミクス | +15%音量 | -20%音量 | 変更なし |
| アーティキュレーション | +25%延長 (レガート) | -30%短縮 (スタッカート) | 変更なし |

- テンポ補正: BPM>200 でスウィング量が自動減衰 (Friberg & Sundström 2002)
- BPM≥280 でほぼストレート
- 16分音符: 比例的に再配置
- `schedulePhrase()` で音声に適用、`PhrasePath` でアニメーション同期
- PianoRoll はスウィング非適用 (楽譜同様、常にストレート表示)

---

## UIレイアウト (`App.tsx`)

### モード切替ボタン
タブ風トグルボタン: 辞典 (本アイコン + 青 `#3498DB`) / 練習 (音符アイコン + 緑 `#27AE60`)。
12px フォント、30px 高さ。`marginRight: -1` + `zIndex` でアクティブ側ボーダーが重なる。

### 辞典モード
```
RootSelector (12キー)
ModeSelector (18モード)
PositionSelector (Pos 1-7 + 全表示 + 重ねる) ＋ VoicingGrid (◀/▶)
OptionBar (CT, ラベル, 記法, ガイドトーン, コードフォーム)
Fretboard (SVG)
モード説明セクション (スケール音 + コード + フレーバーテキスト)
PositionGrid (ポジション一覧カード)
Footer
```
- 指板クリック音なし、再生バー (GlobalAudioControls) 非表示
- ガイドトーン表示可 (現モードの3rd/7thのみ、次コードなし)

### 練習モード
```
GlobalAudioControls (コード編集 + ▶/■ + 音量ミキサー, メトロノーム, BPM, タップテンポ)
ProgressionEditToolbar (編集時: 曲一覧タブ + 名前/Key + コード入力/更新 + プリセット/インポート)
ProgressionPlayer (ChordChart + モード選択 + ポジション選択 + VoicingGrid)
LickPanel (チャート直下, 折りたたみ式, 検索付き)
OptionBar (CT, ラベル, 記法, ガイドトーン, コードフォーム)
Fretboard (SVG + PhrasePath)
モード説明セクション
Footer
```
- ChordChart 編集モード: 各コードに ✕ 削除ボタン表示
- コード編集: チャート上のコードクリック → 入力フィールドにセット → 更新/取消

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
- 2モード: 辞典モード (スケール/ポジション閲覧) + 練習モード (コード進行+リック練習)、モード選択状態を localStorage 永続化
- コード進行: 作成・編集・保存・複製 (localStorage)、近接ポジション提案、キーボードナビ、コードインライン編集、chartLayout差分更新保持、「+ 小節」→ビートグリッド挿入フロー (追加ボタン廃止)、空小節 × 削除、選択ビートハイライト、**コード入力オートコンプリート** (ルート+品質サジェスト、↑↓/Enter/Tab/Esc操作、parseChordSymbol検証)、**Undo/Redo** (Ctrl+Z/Y、↩/↪ボタン、最大50履歴、chords+chartLayoutスナップショット方式)
- ガイドトーン (3rd/7th) 表示: 辞典モード (現モードのみ) + 練習モード (次コード3rd+解決分類)
- JazzStandards インポート (1382曲)
- iReal Pro 風譜面: セクションラベル、エンディング、リピート、ビート比例幅、**リック割り当てインジケーター** (小節下辺にバー+リックID、コードごとクリック選択対応)
- プリセット進行: II-V-I (C/F/B♭)、Blues (B♭/F)、Rhythm Changes (B♭)
- BPM 自動再生: ドリフトフリータイミング、セクションリピート/volta endings 対応、SVG再生ボタン
- メトロノーム: Web Audio API クリック音、小節頭アクセント、両モード対応、リック再生同期
- グローバルオーディオ設定 (GlobalAudioControls): 練習モードのみ表示。コード編集ボタン + 音量ミキサー (各チャンネルミュートボタン付き)/メトロノーム/BPM/タップテンポ/楽器選択/スウィング制御
- コードフォーム表示: Drop 2 / Drop 3 ボイシング (20テンプレート)、指板ハイライト、◀/▶ 切替
- フレーズ分析: analyzePhrase(), PhraseAnalysisPanel (折りたたみUI、度数/インターバル/機能ラベル、ピアノロールSVG、デバッグコピー) — リック表示時に使用
- 楽器選択 (ギター/サックス): Web Audio API リアルタイム合成、フレーズ再生+指板クリック共通、localStorage 永続化
- **SoundFont ピアノコンピング** (smplr): acoustic_grand_piano SoundFont によるリアルなジャズピアノコンピング。`buildJazzPianoVoicing()` でコード品質別に LH(Root+5th) + RH(3rd+7th シェルボイシング) を自動生成。初回アクセス時に非同期ロード、ロード中はスピナー表示、ロード前は既存 EP にフォールバック。`stopId` でコードごとに voice を分離 (同一 MIDI ノート連続の音欠け防止) + 個別 stop 関数で事前スケジュール済みノートの確実なキャンセル
- **ウォーキングベース** (smplr): acoustic_bass SoundFont でコード進行に合わせたベースラインを自動生成。`generateBassLine()` がコード品質・拍数・次コードルートからライン生成 (1拍=ルート、2拍=ルート+アプローチ、3-4拍=ルート→3rd/5th→5th/8va→半音アプローチ)。ミキサーにベースチャンネル (音量+ミュート) 追加
- **ドラムパターン** (smplr Sampler + Hydrogen GM): アコースティックドラム録音 (ライド/HH/キック/スネア、各5段階ベロシティレイヤー) による iReal Pro 風有機的ジャズドラム。Swing: キック全拍フェザリング (vel 35-70) + ライドバックビートアクセント + スネアゴーストノート (確率的, vel 20-50) + スネアコンピング (vel 60-100) + ベロシティヒューマナイゼーション (seeded PRNG で小節ごとバリエーション)。`rhythmMode` でメトロノーム/ドラム排他切替、音量スライダー共用 (`metVolume`)。スウィング量・テンポ補正対応。カウントイン・プレビュー再生は常にメトロノームクリック
- **バッキングスタイル** (4種): Swing / Bossa / Ballad / Latin。スタイルに応じてコンピングリズム・ベースライン・ドラムパターンを一括切替。Swing=Charlestonコンピング+4フィールウォーキングベース+スウィングライド、Bossa=シンコペーションコンピング+2フィールベース+クロススティック、Ballad=全音符コンピング+2フィールベース+ソフトライド、Latin=モントゥーノ風コンピング+トゥンバオベース+ストレート8thライド。`backingStyle` を localStorage 永続化、ミキサーで選択
- コードストラム: エレピ音 (Sine加算合成, 2nd/3rd倍音)
- スウィングモード: 多次元スウィング (タイミング+ダイナミクス+アーティキュレーション)、0-100%連続制御、テンポ補正 (>200BPM)、PhrasePath視覚同期、PianoRollはストレート表示、localStorage永続化
- リック練習UI (練習モード): ChordChart直下の折りたたみパネル (LickPanel) にコード品質に合うリック一覧表示。CSS Grid固定カラムヘッダー付きテーブルレイアウト: ★お気に入り+安定ID(署名ハッシュ)+タイプバッジ(dom7/min7/maj7/m7♭5/ii-V各色)+SVGコンター+音数/拍数+開始音・末尾音(`実音(度数)`形式)+解決音(実音のみ、2小節以上で最終小節1音+末尾休符≥1拍の場合に分離表示)+ソース名+モード候補(最大3, MODE_COLORSカラー)。テキスト検索(モード名・度数も対象)、選択→指板表示+自動再生、モード/ポジション自動推定、分析パネル対応、**リック選択をChordSlotに永続化** (lickId+lickHighOctave+lickHighInstance→コード切替時復元+進行再生時自動再生)、**8va** (同一インスタンス内オクターブ上)・**Hi** (ハイポジションインスタンス切替) 独立トグル。ルールベースフレーズ生成は削除済み (リック練習に一本化)
- **リックオーバーフロー分割**: リックの拍数がコードの拍数を超える場合、`sliceLick()` でコード拍境界で分割し後続コードに連鎖割当 (`ChordSlot.lickBeatOffset`)。ii-V リックも通常リックも同じロジックで処理。3コード以上の跨ぎにも対応。先頭コードクリア時は全継続コードも連動クリア。**アウフタクト対応**: `anacrusis` 拍分をメイン再生から除外し、プレビューではストラム遅延、自動演奏では前コード末尾に look-ahead 再生、カウントインでは終盤に再生
- **ii-V リック対応**: `detectIiVPattern()` で連続コード (m7→7) の ii-V パターンを検出。ii コード選択時に ii-V タイプのリック (`maj-ii-v-short`, `maj-ii-v-long`, `min-ii-v-short`) を表示
- **ステップ再生**: フレーズを1音ずつコマ送り/コマ戻しできるモード。`usePreviewPlayback` の `stepIndex`/`stepForward`/`stepBackward` で管理。各ステップで1音だけ発音、指板上は到達済みノートまで表示 (PhrasePath `highlightUpTo`)。通常再生・コード切替・リッククリアで自動解除。LickPanel に |◀/▶| ボタン + 音数カウンター常時表示
- **カウントイン**: 再生開始前に1-2小節クリック、音量調節可、サイクル切替 (2小節→OFF→1小節→2小節)、localStorage 永続化
- **表示倍率スライダー**: 画面右下固定、CSS `zoom` で100-150% (1%刻み)、localStorage 永続化、リセットボタン付き
- **小節ループ**: コード譜面上で小節を選択してループ再生 (単一小節/範囲指定)、オレンジ下線ハイライト、範囲外dim、GlobalAudioControlsにループ表示+解除ボタン
- **ステップ再生**: フレーズを1音ずつ前進/後退できるコマ送りモード (|◀/▶| ボタン)。各ステップで1音発音、指板上に到達済みノートを累積表示。通常再生と排他動作

---

## リック練習UI (`lickEngine.ts` + `LickPanel.tsx` サイドパネル)

練習モード専用。コード品質に合うリックを一覧表示し、選択→指板表示→再生する練習機能。

### データフロー

```
public/licks.json → loadLickDB() → LickDB
    ↓ QUALITY_TO_LICK_TYPE[chord.quality]
filteredLicks: LickEntry[]
    ↓ buildLickContext() → { modeIdx, posId, pool, phrase }
GeneratedPhrase → PhrasePath / PianoRoll / PhraseAnalysisPanel
```

### リックタイプマッピング

- `7|7alt|7b9|7#11|7b13` → `dom7` (G root)
- `m7` → `min7` (D root)
- `maj7` → `maj7` (C root)
- `m7♭5` → `m7b5` (D root)
- ii-V パターン検出: `detectIiVPattern(chords, idx)` — `chords[idx]` が m7 かつ `chords[idx+1]` が 7 の場合に `'major'|'minor'` を返す。LickPanel で ii コード選択時に ii-V タイプのリックを追加表示
- リックオーバーフロー: リック拍数 > コード拍数の場合、`sliceLick()` でコード拍境界で分割し後続コードに `lickBeatOffset` 付きで連鎖割当。ii-V・通常リック共通ロジック。アウフタクト付きリックは `effectiveBeats = beats - anacrusis` でオーバーフロー判定

### 自動推定

- **モード推定**: `inferModeFromLick()` — リックのピッチクラスを候補モードのスケール音と照合、一致率最大を選択
- **モード候補**: `inferModeCandidates()` — 重み付きスコアリング (表拍×2, 長音×2) で最大3件のモード候補を返す (LickPanel 表示用)
- **ポジション選択**: `findBestPositionForLick()` — インスタンス単位でカバー率を評価 (音域包含ボーナス+2)、最良インスタンスのスコアでポジション選択
- **インスタンス選択**: `selectBestInstance()` — Hi=OFF: 最低フレットインスタンス優先 (カバレッジ>0)、Hi=ON: 最高フレットインスタンス。1音目はプールのフレット重心にバイアスして位置外飛びを防止
- ユーザーは既存UIで手動変更可能

### UIフロー

1. 進行モードでコード選択 → ChordChart 直下の折りたたみパネル (LickPanel) にリック一覧表示
2. カラムヘッダー付きテーブル: ★ + 安定ID + タイプバッジ + SVGコンター + 音数/拍数 + 開始音・末尾音・解決音 + ソース名 + モード候補
3. テキスト検索でID・アーティスト名・音数等でフィルタリング可能
4. リッククリック → モード/ポジション自動推定 → 指板表示 + 自動再生
5. Play/Stop ボタンで再生制御、✕ でクリア
6. 折りたたみ時も選択中リックのID + 再生ボタンをインライン表示
7. 編集モード → パネル非表示

---

## ビバップソロ統計分析 (`scripts/`)

Parker Omnibook (50ソロ, MusicXML) + Weimar Jazz Database (456ソロ, SQLite3) を Python (music21) で分析。
コード品質別のインターバル分布・CT率・アプローチパターン・スケール使用・フレーズ構造を JSON 出力。

- `scripts/output/parker_profiles.json` — Omnibook コード品質別統計
- `scripts/output/wjd_profiles.json` — WJD 奏者別・スタイル別統計
- `scripts/output/bebop_deep_profiles.json` — スケール検出・詳細アプローチ・フレーズ分析・ビバップイディオム

主要知見: stepwise~54%, thirds~27%, 強拍CT~53%, GT~32%, 下行~52%, ビバップスケールが全品質で最高カバー率

---

## リックパーサー (`scripts/parse_licks.py`)

DAWで録音したMIDIファイルをリックタイプ別に分割し、リック練習用DB (JSON) を生成。

- 入力: BPM 120, 4/4, DAWクオンタイズ済みMIDI
- 演奏キー: dom7=G7, min7=Dm7, maj7=Cmaj7, m7b5=Dm7b5, ii-V=Cメジャー/マイナー基準 (自動的にCルートに移調して保存)
- ファイル名規約: `{ソース}_{タイプ}_b{小節数}[_a{アウフタクト}].mid` (例: `parker_dom7_b1.mid`, `cannonball_maj-ii-v-long_b3_a1.mid`)
- 有効タイプ: dom7, min7, maj7, m7b5, maj-ii-v-short, maj-ii-v-long, min-ii-v-short
- 出力: `scripts/data/licks.json` — `{ type: [{ notes, noteCount, beats, source?, anacrusis? }] }`
- 120グリッド量子化 (lcm(8,3,5)): 8分/16分/三連符/5連符/32分を正確表現
- マルチ小節リック対応 (最大3小節)、音域正規化 (最低音C4付近)、ルート移調 (TYPE_ROOT_OFFSET)
- 休符検出 (先頭/末尾含む)、重複排除、毎回全置き換え (MIDIがマスターデータ)
- マスターデータ: `scripts/data/export.mid` (Cubase一括書出し) → `split_midi.py` で分割 → `parse_licks.py` でパース
- 依存: `pip install pretty_midi`

---

## ドラムパターンパーサー (`scripts/parse_drum_patterns.py`)

DAWで打ち込んだ4小節MIDIドラムパターンをJSON DBに変換。ランタイムで4小節単位でランダム選択して再生。

- 入力: `scripts/data/midi/drums/{style}_{番号}.mid` (4小節=16拍, 4/4, 任意BPM)
- 出力: `scripts/data/drum-patterns.json` → `public/drum-patterns.json` にコピー
- ピッチベース: MIDI ノート番号をそのまま保存 (ロール不要、mapping.json 不要)
- 120グリッド量子化、ベロシティ保持 (0-127)、小節ごとに beatStart を 0-based に正規化
- 4小節ごとにパターンをランダム選択、小節内インデックスで該当小節を取得
- DB + カスタム WAV なしの場合はアルゴリズム生成にフォールバック
- パーサー実行時に必要な WAV ファイル一覧を自動出力
- 依存: `pip install pretty_midi`

## カスタム WAV ドラムサンプル

DAW の VSTi ドラム音源から書き出した WAV を使用可能。ピッチベース命名でロール不要。

- 配置: `public/drums/{noteName}_v{velocity}.wav` (例: `d#2_v25.wav`, `c2_v127.wav`)
- ノート名表記: C3=60 convention (Cubase 等標準)。パーサーが必要ファイル一覧を出力
- ベロシティ値: 25 (pp) / 50 (mp) / 80 (mf) / 105 (f) / 127 (ff) — `velocityToLayer()` の閾値に対応
- ドラムパターン DB のピッチから自動検出、WAV なしなら Hydrogen GM にフォールバック
- カスタム WAV 使用時は detune/LPF 加工なし (ユーザーが音作り済み前提)

---

## 今後の開発予定

1. 密度フェーダーUI (noteCount/beats でフィルタ)
2. アーティスト別フィルタ
3. ポジション間移動ガイド (共通音ハイライト)

---

## 参考

- `berklee-positions-v2.jsx` — 移行元の Artifact コード (参照用)
- POS_COLORS: `['#E74C3C', '#E67E22', '#E8336F', '#27AE60', '#6EAC00', '#8E44AD', '#16A085']`
  - ガイドトーン色と被らないよう調整済み: 3rd=#F1C40F(黄), 7th=#3498DB(青)
  - コードフォーム色: #00E5FF(シアン) — ポジション色・ガイドトーン色と被らない
  - フレーズ色: #FF6B9D(ピンクマゼンタ) — 全既存色と被らない
