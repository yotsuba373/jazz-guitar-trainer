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
npm test          # vitest run (806 テスト)
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
  - アルゴリズム変更 → フレーズジェネレーター等の該当セクションを更新
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
├── App.tsx                          — 状態管理ハブ (通常モード + 進行モード + BPM自動再生)
├── types/
│   └── music.ts                     — ChordSlot, Progression, ChartMeasure, ChartLayout, ModeTemplate, PoolNote 等
├── constants/
│   ├── music.ts                     — MODE_TEMPLATES(18 + description), ROOTS, STRING_DEG_OFFSETS, POS_COLORS, MODE_COLORS
│   └── bebopScales.ts              — BEBOP_SCALES, MODE_TO_BEBOP, getBebopScale()
├── utils/
│   ├── fretboard.ts                 — buildFretMap(), generatePositions(), generateDimPositions()
│   ├── noteSpelling.ts              — spellScale(), buildDegreeMap(), resolveMode()
│   ├── progression.ts               — parseChordSymbol(), rankPositionsByProximity(), QUALITY_TO_MODES, PRESET_PROGRESSIONS
│   ├── guideTones.ts                — getGuideTones(), findNoteLocations(), classifyResolution()
│   ├── jazzStandards.ts             — fetchJazzStandards(), extractStructuredChords(), songToProgression()
│   ├── chartLayout.ts               — deriveChartLayout(), getChartLayout(), buildChordRows()
│   ├── chordForms.ts                — findVoicingsInPosition(), VOICING_TEMPLATES, formatVoicingLabel()
│   ├── bebopGenerator.ts            — generatePhraseRule(), buildNotePool(), chooseGoalNote()
│   ├── bebopScheduler.ts            — buildPhrase(), planSegmentRhythms(), absolutePitch(), pickRandom()
│   ├── bebopSegments.ts             — セグメント関数9種 (Arp, ScaleRun, Enclosure, OctaveDisp等)
│   ├── bebopTemplates.ts            — テンプレート定義11種 (日本語label+description) + 選択ロジック + pickWeighted()
│   ├── phraseAnalysis.ts            — analyzePhrase(), computeSummary()
│   ├── swing.ts                     — swingBeatStart(), swingVolumeMult(), swingDurMult()
│   └── __tests__/
│       ├── fretboard.test.ts        — 388 tests (Pos1リファレンス、度数オフセット不変条件、構造検証)
│       ├── progression.test.ts      — 125 tests (parseChordSymbol、QUALITY_TO_MODES、近接ランキング)
│       ├── jazzStandards.test.ts    — 42 tests (パース、エンディング、リピート、ビート幅、自動ラベル)
│       ├── noteSpelling.test.ts     — 19 tests (スペリング、度数マップ、resolveMode、8音スケール)
│       ├── guideTones.test.ts       — 22 tests (ガイドトーン抽出、解決分類)
│       ├── chordForms.test.ts       — 36 tests (Drop 2/3ボイシング検索、テンプレート構造検証)
│       ├── phraseQualityAudit.test.ts — 54 tests (品質監査: 拍位置/ビバップスケール/アプローチ/エンクロージャー/テンプレート構造/開始終了/VL(6)/Musical Forces/全モード網羅/多様性/拍数適合/ポジション/実用性/接合部/リズムR.1-R.5/休符挿入/GAPレポート)
│       ├── phraseAnalysis.test.ts   — 33 tests (分析・度数・機能ラベル・メタデータパススルー・ナラティブ)
│       ├── audioEngine.test.ts      — 14 tests (Karplus-Strong, サクソフォン, エレピ, コードストラム)
│       ├── swing.test.ts            — 25 tests (タイミング/ダイナミクス/アーティキュレーション/テンポ補正)
│       ├── bebopSegments.test.ts    — 11 tests (セグメント関数8種の単体テスト)
│       ├── bebopTemplates.test.ts   — 15 tests (テンプレート選択・品質フィルタ・拍配分・allocateBeats)
│       └── bebopGenerator.test.ts   — 25 tests (ルールベース生成・全モード対応・品質チェック・可変リズム・assignRhythms・planSegmentRhythms)
└── components/
    ├── Fretboard/                   — SVG指板描画 (Fretboard, FretboardNote, GhostNote, PhrasePath)
    ├── Controls/                    — RootSelector, ModeSelector, PositionSelector, OptionBar, VoicingGrid, PhraseControls, PhraseAnalysisPanel, PianoRoll, GlobalAudioControls
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
├── data/                                — ダウンロードデータ (gitignored)
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

### フレーズジェネレーター (`bebopGenerator.ts`)

ビバップ構造ルールに基づくフレーズ生成。指板空間 (PoolNote[]) で直接組み立て。

**ビバップスケール** (`bebopScales.ts`): 4種 (Dominant/Major/Dorian/HarmonicMinor) + モードマッピング (9モード対応)

**セグメント関数** (`bebopSegments.ts`): 9種 (全て `SegmentOpts.beatParity` 対応)
- `segArpeggio`: CTアルペジオ上行/下行
- `segScaleRun`: ビバップスケールラン (parity対応パッシングトーン表拍チェック、表拍GT優先)
- `segEnclosure`: 4タイプエンクロージャー (Mixed w=40, Diatonic w=25, Chromatic w=20, 3-note w=15)、Delayed Resolution 30%
- `seg1235`: 1-2-3-5 パターン
- `segDim7From3rd`: 3rdからdim7アルペジオ (dom7のみ)
- `segUpperStructure`: 3rdからm7/maj7アルペジオ
- `segApproachCT`: 6タイプ多様アプローチ → CT (WJD統計+§3教育ルール重み: dia-above優先, Musical Forcesスコアリング)
- `segChromatic`: クロマチック経過
- `segOctaveDisp`: Honeysuckle Rose (Root→1oct下3rd→上行)

**テンプレート** (`bebopTemplates.ts`): 11種 (各テンプレートに日本語label+descriptionフレーバーテキスト)
品質フィルタ (dim7-from-3rd→dom7 only, upper-structure→m7/maj7)、コンター親和重み (+8)

**スケジューラー** (`bebopScheduler.ts`): リズム先行決定 + テンプレート実行 + セグメント接合部重複除去 + 品質チェック
- `allocateBeats()`: セグメント別ビート予算配分 (拍数ベース)
- `planSegmentRhythms()`: セグメント生成**前**にリズムを決定 (リズム先行決定方式)
  - scaleRun → 8分固定 (§2 ビバップスケール原理)
  - arpeggio/1235/dim7/upper/octaveDisp → 3連符 45%
  - approachCT → 16分 35%
  - chromatic → 16分 55%
  - enclosure → 8分 (ポスト圧縮: 35%で16分に変換)
- ポスト処理: enclosure→16分35%, chromatic→16分45%
- 4分音符昇格: 最終CT 45%, 先頭ダウンビートCT 15%, セグメント境界CT 20%
- `assignRhythms()`: @deprecated (後方互換のため残存)
- セグメント接合部: 前セグメント末尾と次セグメント先頭が同ピッチ・同弦なら先頭をスキップ、多セグメントテンプレートの接合部で15%確率で休符挿入 (70%裏拍開始)
- ビート予算ベーストリミング (RHYTHM_BEATS累算)
- 拍位置ベース品質チェック: CT表拍配置率 ≥ 40%, GT強拍ソフトチェック (強拍2+でGTゼロ→reject), 音域 4-15半音, 跳躍 ≤ 9半音
- CT表拍プロモーション: 表拍の非CT非アプローチスケール音を±2半音・±1弦以内のCTにスワップ
- CT終止試行: 最終音が非CTなら ±3半音・±1弦以内の最近接CTにスワップ (失敗時そのまま通過)
- テンション終止: CT終止の26%を隣接非CTスケール音にスワップ (CT終止率~70%目標)
- 方向転換強拍チェック: 強拍 (beat 1,3) 方向転換率 > 60% なら reject (§9 Barry Harris / Jens Larsen)

**Musical Forces** (§9 Steve Larson): `bestCandidate()` に3つの力を加算
- 重力 (高音→下行バイアス +5/-3)、磁力 (非CT→最近接CT +5)、慣性 (同方向 +3)
- スコアジッター: ±4 (stepwise/approach選択時のみ、ターゲットCT選択には非適用) → ピッチ列多様性確保

**生成フロー**: buildNotePool → インスタンススコープ → コンター選択 (重み付き: arch33/desc28/wave18/rev-arch13/asc8) → ゴール音 → beatOffset選択 (単体70%裏拍) → GT優先開始音 (3rd/7th 2倍重み) → テンプレート選択 → スケジューラー → 5リトライ → フォールバック (ScaleRun↓)

**コード間ボイスリーディング**: `PhraseConfig.nextChordContext` + `nextChordPool` で次コード情報を受取
- `chooseGoalNote()`: 現7th→次3rd半音解決時に70%確率でゴール選択 + `resolvedNextStart` (次コードプールから解決先確定)
- `resolvedStart`: 前フレーズからのVL意図を受取。`inPosition=true` → 直接開始、`inPosition=false` → 解決音+休符+ポジション内本体
- `goalIsVL`: VL解決ゴール時にCT終止/テンション終止のスワップを抑制

**描画**: PhrasePath.tsx — Catmull-Rom → Cubic Bezier 変換, per-beatグラデーション(#FFA0B0→#BBA0FF), ノート形状 (CT=塗り円, アプローチ=ダイヤ, スケール=枠円), 拍番号, 視認性改善

**フレーズ分析**: `phraseAnalysis.ts` — analyzePhrase(), PhraseAnalysisPanel (折りたたみUI, 度数/インターバル/機能ラベル, セグメント境界表示, テンプレート詳細表示+フレーバーテキストtooltip, デバッグコピーボタン)
- 機能ラベル: CT, 半音↑/↓アプローチ, 全音↑/↓アプローチ, ダブルクロマチック, エンクロージャー上/下, dim7構成音, ビバップ経過音, テンション, スケール音
- approachCT/enclosureセグメントのノートにApproachGroupInfoメタデータを自動付与 (スケジューラー内で推定)

**UI**: OptionBar「フレーズ」チェックボックス → PhraseControls (Generate/◀▶履歴)
有効条件: `selPosIds.length === 1 && !overlay && !is8Note`

**音声再生** (`audioEngine.ts`): `schedulePhrase()` は各ノートの `beatStart` を使用してタイミング計算 → アニメーション・メトロノームと同期

**テスト**: 54テスト (品質監査) + 51テスト (segments 11 + templates 15 + generator 25) + 33テスト (分析) + 25テスト (スウィング)

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

- 進行モード再生中: ビートグリッド同期 (累積拍から次拍を計算)
- 通常モード / 非再生時: 単純な `setInterval(60000 / bpm)` でクリック
- `metBeatRef.current % 4 === 0` でアクセント判定 (小節頭 = 4拍ごと)
- `metSyncKey` インクリメントで effect 再起動 → フレーズ再生開始と同期
- `metVolumeRef` (useRef) を通じて volume 変更を setInterval 再起動なしに反映

### 音量ミキサー (GlobalAudioControls)

🔊ボタンのドロップダウンパネルに3つの音量スライダー (各ミュートボタン付き) + 楽器選択を配置:

| 種別 | state | localStorage | デフォルト | ミュート | 用途 |
|------|-------|-------------|-----------|---------|------|
| メトロノーム | `metVolume` | `metVolume` | 0.5 | volume=0 | `playClick()` |
| コード | `chordVolume` | `chordVolume` | 0.5 | `chordAudioOn` | `playChordStrum()` |
| 単音 | `noteVolume` | `noteVolume` | 0.4 | volume=0 | `playNote()` + `schedulePhrase()` |
| 楽器 | `instrument` | `phraseInstrument` | 'guitar' | — | 楽器選択 (guitar/saxophone) |
| スウィング | `swingEnabled` | `swingEnabled` | false | — | ON/OFFトグル |
| スウィング量 | `swingAmount` | `swingAmount` | 0.2 | — | 0-1 (デフォルト20%) |

- 各チャンネルにミュートボタン: メトロノーム/単音は volume 0⇔復元、コードは `chordAudioOn` トグル
- メトロノームミュート時はメトロノームボタンもグレーアウト (操作不可)
- タップテンポ: TAPボタン連続タップでBPM設定 (直近8タップ平均、2秒リセット)
- 全 state は `useRef` 経由でコールバック内から参照 (再レンダリング不要)
- パネル外クリックで自動閉じ (`mousedown` リスナー)

### フレーズ単体再生 (`handlePlayPhrase` / `playPhraseAudio`)

Generate ボタン押下で自動再生。`▶ Play` / `■ Stop` でトグル再生も可能。
- テンポ: メトロノーム ON 時は BPM 同期 (`(60/bpm)/2`)、OFF 時は速度スライダー
- 音量は `noteVolume` (単音音量) を使用
- `phraseAnimKey` インクリメントで SVG アニメーションも同時リスタート
- `schedulePhrase()` で Web Audio API スケジューリング → 自動タイマーで再生完了検出
- 通常モードで `chordAudioOn` 時、フレーズ再生開始にコードストラムも同時再生

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
- `schedulePhrase()` で音声に適用、`PhrasePath` でアニメーション同期、`PianoRoll` で可視化同期

---

## UIレイアウト (`App.tsx`)

### 通常モード
```
RootSelector (12キー)
ModeSelector (18モード)
GlobalAudioControls (音量ミキサー, メトロノーム, BPM, タップテンポ)
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
GlobalAudioControls (▶/■ + 音量ミキサー, メトロノーム, BPM, タップテンポ)
ProgressionPlayer (ChordChart + モード選択 + ポジション選択 + VoicingGrid)
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
- メトロノーム: Web Audio API クリック音、小節頭アクセント、両モード対応、フレーズ再生同期
- グローバルオーディオ設定 (GlobalAudioControls): 音量ミキサー (各チャンネルミュートボタン付き)/メトロノーム/BPM/タップテンポ/楽器選択/スウィング制御を両モード共通で表示
- コードフォーム表示: Drop 2 / Drop 3 ボイシング (20テンプレート)、指板ハイライト、◀/▶ 切替
- フレーズジェネレーター: ビバップ構造ルールに基づくフレーズ生成 (11テンプレート、9セグメント関数、4種ビバップスケール、Musical Forces、4タイプエンクロージャー、Delayed Resolution、方向転換強拍チェック、CT表拍プロモーション、テンション終止~30%、休符/ブレス挿入、スコアジッター多様性)、可変リズム (4分/3連/8分/16分)、拍数選択 (2/3/4拍)、ゴールノート選択 (指板クリック)、コード間VL+モチーフ記憶、SVG曲線表示、Generate時自動再生、進行モードではオンザフライ生成 (リピート時も毎回異なるフレーズ)
- フレーズ分析: analyzePhrase(), PhraseAnalysisPanel (折りたたみUI、度数/インターバル/機能ラベル、生成メタデータ可視化、ナラティブ、ピアノロールSVG、セグメント境界表示、テンプレート詳細+フレーバーテキストtooltip、デバッグコピー)
- 楽器選択 (ギター/サックス): Web Audio API リアルタイム合成、フレーズ再生+指板クリック共通、localStorage 永続化
- コードストラム: エレピ音 (Sine加算合成, 2nd/3rd倍音)
- スウィングモード: 多次元スウィング (タイミング+ダイナミクス+アーティキュレーション)、0-100%連続制御、テンポ補正 (>200BPM)、PhrasePath/PianoRoll視覚同期、localStorage永続化

---

## ビバップソロ統計分析 (`scripts/`)

Parker Omnibook (50ソロ, MusicXML) + Weimar Jazz Database (456ソロ, SQLite3) を Python (music21) で分析。
コード品質別のインターバル分布・CT率・アプローチパターン・スケール使用・フレーズ構造を JSON 出力。

- `scripts/output/parker_profiles.json` — Omnibook コード品質別統計
- `scripts/output/wjd_profiles.json` — WJD 奏者別・スタイル別統計
- `scripts/output/bebop_deep_profiles.json` — スケール検出・詳細アプローチ・フレーズ分析・ビバップイディオム

主要知見: stepwise~54%, thirds~27%, 強拍CT~53%, GT~32%, 下行~52%, ビバップスケールが全品質で最高カバー率

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
