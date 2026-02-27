# Berklee 7-Position Guitar Trainer

Berklee音楽院の7ポジションシステムに基づくギター指板ビジュアライザー。

## Features

- 7モード (Ionian〜Locrian) の切替表示（ルート: C 固定）
- 7ポジションの個別表示 / 全表示 / オーバーレイ表示
- コードトーン強調 (Cmaj7 / C7 / Cm7 / Cm7♭5)
- ラベル切替（音名 / 度数）
- SVG指板描画 (21フレット)
- ポジション詳細パネル（弦ごとのフレット・音名表示）

## Tech Stack

- [Vite](https://vite.dev/) 7.x + [React](https://react.dev/) 19.x + TypeScript 5.x
- [Tailwind CSS](https://tailwindcss.com/) v4 (CSS-first configuration)

## Setup

### Prerequisites

- **Node.js** v20 以上（v24 LTS 推奨）
- **npm** v10 以上

Node.js がインストールされていない場合は [fnm](https://github.com/Schniz/fnm) を推奨:

```bash
# Windows (winget)
winget install Schniz.fnm

# macOS / Linux
curl -fsSL https://fnm.vercel.app/install | bash
```

fnm インストール後:

```bash
fnm install --lts
fnm default lts-latest
```

### Clone & Install

```bash
git clone https://github.com/yotsuba373/jazz-guitar-trainer.git
cd jazz-guitar-trainer
npm install
```

### Development

```bash
npm run dev
```

http://localhost:5173 で開きます。

### Build

```bash
npm run build     # TypeScript チェック + プロダクションビルド
npm run preview   # ビルド結果のプレビュー
```

### Lint

```bash
npm run lint
```

## Project Structure

```
src/
├── main.tsx                    ← エントリポイント (ReactDOM.createRoot)
├── index.css                   ← Tailwind v4 @theme (カスタムカラー/フォント)
├── App.tsx                     ← 状態管理 + レイアウト
├── types/
│   └── music.ts                ← FretNote, Position, Mode, LabelMode
├── constants/
│   ├── music.ts                ← MODES, POS_COLORS, MODE_COLORS, OPEN_STRINGS, STR_LABELS
│   └── svg.ts                  ← FC, FW, SG, TP, LP, DOTS, SVG_WIDTH, SVG_HEIGHT
├── utils/
│   └── fretboard.ts            ← buildFretMap(), generatePositions()
└── components/
    ├── Fretboard/
    │   ├── Fretboard.tsx       ← SVG指板全体
    │   └── FretboardNote.tsx   ← 1音分の circle+text
    ├── Controls/
    │   ├── ModeSelector.tsx    ← 7モードボタン
    │   ├── PositionSelector.tsx← 全表示/Pos1-7/重ねるボタン
    │   └── OptionBar.tsx       ← CTチェックボックス + ラベル切替 + 凡例
    ├── PositionDetail.tsx      ← 選択中ポジション詳細パネル
    ├── PositionGrid.tsx        ← 7ポジションカードグリッド
    └── Footer.tsx              ← 使い方テキスト
```

## 7ポジションシステムとは

ギターの標準チューニング (EADGBE) では、B弦-G弦間だけが長3度（他は完全4度）のため、7音スケールを弾くと B弦は常に2音、他の弦は3音になります。この特性を利用して、指板全体を7つのポジションに分割するのが Berklee の7ポジションシステムです。

7つのポジション形状は全モード共通。モードが変わると音名とフレット位置は変わりますが、形状は同じ7種が現れます。

## Reference

- `HANDOFF.md` — コアアルゴリズム解説、失敗アプローチ記録、今後の開発予定
- `berklee-positions-v2.jsx` — 移行元の Artifact ファイル（参照用）
