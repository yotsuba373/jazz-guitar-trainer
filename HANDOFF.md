# Berklee 7-Position Guitar Visualization — 引き継ぎレポート

## プロジェクト概要

Berklee音楽院の7ポジションシステムに基づくギター指板ビジュアライザー。
Vite 7 + React 19 + TypeScript 5 + Tailwind CSS v4。

---

## 現在の機能

### 基本機能
- 7モード (Ionian〜Locrian) の切替表示
- 7ポジションの個別表示 / 全表示 / オーバーレイ表示
- ルートキー選択 (12キー対応)
- コードトーン強調 (maj7/m7/7/m7♭5)
- ラベル切替（音名 / 度数）
- コード記法プリファレンス (M7/maj7/△7, m7/mi7/-7, m7♭5/ø7)

### コード進行モード
- 進行の作成・編集・保存 (localStorage)
- コード→モード/ポジション提案 (近接順)
- ←→↑↓ キーボードナビゲーション
- プリセット (II-V-I in C/F/B♭)

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
│   └── music.ts                     — ChordSlot, Progression, ChartMeasure, ChartLayout 等
├── constants/
│   └── music.ts                     — MODE_TEMPLATES, ROOTS, STRING_DEG_OFFSETS
├── utils/
│   ├── fretboard.ts                 — buildFretMap(), generatePositions()
│   ├── noteSpelling.ts              — spellScale(), buildDegreeMap(), resolveMode()
│   ├── progression.ts               — parseChordSymbol(), rankPositionsByProximity()
│   ├── jazzStandards.ts             — fetchJazzStandards(), extractStructuredChords(), songToProgression()
│   ├── chartLayout.ts               — deriveChartLayout(), getChartLayout(), buildChordRows()
│   └── __tests__/                   — vitest テスト (313 tests)
│       ├── fretboard.test.ts        — 172 tests (Pos1リファレンス、度数オフセット不変条件)
│       ├── progression.test.ts      — 95 tests (parseChordSymbol、近接ランキング)
│       ├── jazzStandards.test.ts    — 37 tests (パース、エンディング、リピート、ビート幅、自動ラベル)
│       └── noteSpelling.test.ts     — 9 tests
├── components/
│   ├── Fretboard/                   — SVG指板描画
│   ├── Controls/                    — RootSelector, ModeSelector, PositionSelector
│   └── Progression/
│       ├── ChordChart.tsx           — iReal Pro 風譜面グリッド
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

### ポジション生成の仕組み

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

---

## 検証

```bash
npm test          # 313 tests (vitest)
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
5. カスタムスケール (メロディックマイナー, ハーモニックマイナー)
