# Berklee 7-Position Guitar Visualization — 引き継ぎレポート

## プロジェクト概要

Berklee音楽院の7ポジションシステムに基づくギター指板ビジュアライザー。
Vite 7 + React 19 + TypeScript 5 + Tailwind CSS v4。

---

## 現在の機能

### 基本機能
- 18モード対応:
  - Diatonic 7 (Ionian〜Locrian)
  - Melodic Minor 7 (Melodic Minor, Dorian♭2, Lydian Aug, Lydian Dom, Mixo♭6, Locrian♯2, Altered)
  - Harmonic Minor 2 (Harmonic Minor, Phrygian Dominant)
  - Diminished 2 (W-H, H-W) — 8音対称スケール、4ポジション制
- 7ポジションの個別表示 / 全表示 / オーバーレイ表示
- ルートキー選択 (12キー対応)
- コードトーン強調 (maj7/m7/7/m7♭5/mMaj7/aug/dim/7alt 等)
- ラベル切替（音名 / 度数）
- コード記法プリファレンス (M7/maj7/△7, m7/mi7/-7, m7♭5/ø7)

### コード進行モード
- 進行の作成・編集・保存 (localStorage)
- コード→モード/ポジション提案 (近接順)
- ←→↑↓ キーボードナビゲーション
- プリセット (II-V-I in C/F/B♭)
- ガイドトーン表示 (3rd/7th ボイスリーディング可視化)
- 次コード 3rd ゴーストノート表示 + 解決分類 (half-step-down/up, common-tone)

### JazzStandards インポート (1382曲)
- GitHub JSON からフェッチ・キャッシュ
- タイトル検索 → コード進行に変換
- 拡張コード→ファミリーマッピング (90%+ カバレッジ)

### iReal Pro 風コード譜面 (ChordChart)
- CSS Grid レイアウト (4小節/行、セクションラベル列)
- セクション自動ラベリング (ラベルなし → A, B, C... 自動付与)
- 複数エンディング (1番/2番カッコ) 表示
- リピート記号 (二重線ボーダー + ドットインジケーター)
- ビート比例幅表示 (`Cm7,,Eb7,E7` → Cm7 が2倍幅)
- Diatonic/Non-diatonic カラー区別 (オレンジ)
- アクティブコードのポジション色ハイライト

---

## ファイル構成

```
src/
├── App.tsx                          — 状態管理ハブ (通常モード + 進行モード + ↑↓ナビ)
├── types/
│   └── music.ts                     — ChordSlot, Progression, ChartMeasure, ChartLayout, ModeTemplate 等
├── constants/
│   └── music.ts                     — MODE_TEMPLATES(18), ROOTS, STRING_DEG_OFFSETS, MODE_COLORS
├── utils/
│   ├── fretboard.ts                 — buildFretMap(), generatePositions(), generateDimPositions()
│   ├── noteSpelling.ts              — spellScale(), buildDegreeMap(), resolveMode()
│   ├── progression.ts               — parseChordSymbol(), rankPositionsByProximity(), QUALITY_TO_MODES
│   ├── guideTones.ts                — getGuideTones(), findNoteLocations(), classifyResolution()
│   ├── jazzStandards.ts             — fetchJazzStandards(), extractStructuredChords(), songToProgression()
│   ├── chartLayout.ts               — deriveChartLayout(), getChartLayout(), buildChordRows()
│   └── __tests__/                   — vitest テスト (596 tests)
│       ├── fretboard.test.ts        — 388 tests (Pos1リファレンス、度数オフセット不変条件、構造検証)
│       ├── progression.test.ts      — 125 tests (parseChordSymbol、QUALITY_TO_MODES、近接ランキング)
│       ├── jazzStandards.test.ts    — 42 tests (パース、エンディング、リピート、ビート幅、自動ラベル)
│       ├── noteSpelling.test.ts     — 19 tests (スペリング、度数マップ、resolveMode、8音スケール)
│       └── guideTones.test.ts       — 22 tests (ガイドトーン抽出、解決分類)
├── components/
│   ├── Fretboard/                   — SVG指板描画 (Fretboard, FretboardNote, GhostNote)
│   ├── Controls/                    — RootSelector, ModeSelector, PositionSelector, OptionBar
│   ├── Footer.tsx                   — フッター
│   ├── PositionDetail.tsx           — テキスト詳細 (フレット範囲ラベル)
│   ├── PositionGrid.tsx             — ポジション選択グリッド
│   └── Progression/
│       ├── ChordChart.tsx           — iReal Pro 風譜面グリッド
│       ├── GuideToneLine.tsx        — ガイドトーン (3rd/7th) ボイスリーディング表示
│       ├── ProgressionEditor.tsx    — 進行エディタ (chartLayout 保持)
│       ├── ProgressionPlayer.tsx    — 進行プレイヤー (ChordChart 使用)
│       └── SongImporter.tsx         — JazzStandards 検索・インポート
```

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

### 重要な設計判断
- `chords: ChordSlot[]` フラット配列が全ロジックのソース (指板同期、ナビ等)
- `chartLayout?: ChartLayout` は表示用メタデータ (chords[] へのインデックス参照)
- ユーザー作成の進行 (chartLayout なし) → `deriveChartLayout()` で1コード/小節に自動生成
- `ProgressionEditor` が chartLayout を state で保持、コード追加/削除時に invalidate

### MeasureChord とビート幅
- JSON の空カンマスロット (`Cm7,,Eb7,E7`) → 直前コードの `beats++`
- `MeasureChord = { chord: string, beats: number }`
- `ChartMeasure = { chordIndices: number[], beatWidths?: number[] }`
- ChordChart で `flex: beats` により比例幅表示

### 自動ラベリング
- `extractStructuredChords()` で既存の1文字ラベル (A-Z) を収集
- ラベルなしセクションに未使用の次のアルファベットを順に割り当て

---

## コアアルゴリズム解説

### 7音スケール: ポジション生成 (`generatePositions`)

Berklee 7ポジションシステムの核心は **B弦（2弦）が各ポジションで2音のみ** という点。
他の弦はすべて3音。これはB-G弦間の長3度チューニングに起因する。

#### ステップ1: フレットマップ生成 (`buildFretMap`)
- 6弦すべてについて、フレット1〜21のどこにスケール音があるかをマッピング
- 開放弦チューニング: `[4, 11, 7, 2, 9, 4]` = E B G D A E (半音値)

#### ステップ2: ポジション生成 (`generatePositions`)
- B弦: ルートペアをスキップ、2度ペアから7つ取得
- 他弦: 最低フレットからトリオを昇順列挙
- 割当: `trio[i]` → `pair[i]` の単純な1:1マッピング
- **greedy matcherは使わない** (失敗済み — 下記参照)

### ⚠️ アルゴリズムの経緯と落とし穴

| 試行 | 方法 | 結果 | 失敗理由 |
|------|------|------|----------|
| ❌ 1 | Greedy matcher | Pos1の1E弦がG,A,Bに | ルートペアC,DがF,G,Aトリオを先取り |
| ❌ 2 | B弦ペアをローテート | 13シェイプ | トリオ割当がペア順序に依存 |
| ❌ 3 | 生成offset変更 | 12シェイプ | 開始フレットが変わりトリオ選択が変化 |
| ✅ | **1:1順次割当** | 7シェイプ、正確 | シンプルが最強 |

### 8音対称スケール: ディミニッシュポジション (`generateDimPositions`)

ディミニッシュ (W-H / H-W) は対称スケールのため **4ポジション** を生成。
dim7 の構成音 (Root, ♭3, ♭5, 6) は短3度ずつ等間隔 → 12フレットを4分割。

- 各弦で隣接フレットペアが3フレットごとに繰り返し
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

---

## 検証

```bash
npm test          # 596 tests (vitest)
npm run build     # tsc + vite build
npm run dev       # localhost:5173
```

C Ionian Pos 1 リファレンス:
```
1E: F(1), G(3), A(5)
B:  D(3), E(5)
G:  A(2), B(4), C(5)
D:  E(2), F(3), G(5)
A:  B(2), C(3), D(5)
6E: F(1), G(3), A(5)
```

---

## 今後の開発予定

1. BPM/タイミング制御で自動切替
2. コード進行プリセット拡充 (Blues, Rhythm Changes)
3. ポジション間移動ガイド（共通音ハイライト）
4. 音声再生 (Web Audio API)

### 実装済み (参考)
- ~~カスタムスケール (メロディックマイナー, ハーモニックマイナー)~~ → 実装済み (18モード対応)
- ~~コード進行連動表示~~ → 実装済み (進行モード)
- ~~ガイドトーン表示~~ → 実装済み (ボイスリーディング可視化)
- ~~ディミニッシュスケール~~ → 実装済み (W-H/H-W、4ポジション制)
