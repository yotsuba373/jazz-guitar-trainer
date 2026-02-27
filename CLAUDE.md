# CLAUDE.md — Claude Code 向けプロジェクトガイド

## プロジェクト概要

Berklee 7-Position System に基づくギター指板ビジュアライザー。
Vite + React + TypeScript + Tailwind CSS v4 で構成。

## セットアップ手順

```bash
npm install
npm run dev       # 開発サーバー起動 → http://localhost:5173
npm run build     # tsc + vite build
npm run lint      # ESLint
```

Node.js が未インストールの場合は fnm を使用:
```bash
# Windows
winget install Schniz.fnm
# macOS/Linux
curl -fsSL https://fnm.vercel.app/install | bash

fnm install --lts
fnm default lts-latest
```

## コーディング規約

- 言語: TypeScript (strict)
- スタイル: Tailwind CSS v4 (`src/index.css` の `@theme` でカスタムトークン定義)
  - 構造・レイアウト → Tailwind クラス
  - データ駆動の動的カラー (ポジション色, モード色) → インライン `style`
  - SVG 幾何属性 (cx, cy, r 等) → SVG属性 / インライン `style`
- コンポーネント: 関数コンポーネント + hooks (useState, useMemo)
- barrel export: 各ディレクトリに `index.ts` で re-export

## アーキテクチャ

- `src/App.tsx` — 唯一の状態管理ハブ (5 useState + 3 useMemo)
- `src/utils/fretboard.ts` — `buildFretMap()`, `generatePositions()` 純粋関数
- `src/constants/` — MODES (7モード定義), カラー, SVG寸法
- `src/components/` — プレゼンテーションコンポーネント (状態を持たない)

## 絶対に守るべきルール

1. **`generatePositions()` のアルゴリズムを変更しない**
   - B弦ペア → 他弦トリオの「1:1順次割当」が正解
   - greedy matcher, ローテート, offset変更は全て失敗済み
   - 詳細は `HANDOFF.md` の「アルゴリズムの経緯と落とし穴」を必読

2. **B弦2音ルールは不変**
   - ギター標準チューニングではB弦は常に2音、他弦は3音
   - これはスケール/モードに関わらず成立する

3. **検証: C Ionian Pos 1 のリファレンス**
   ```
   1E: F(1), G(3), A(5)
   B:  D(3), E(5)
   G:  A(2), B(4), C(5)
   D:  E(2), F(3), G(5)
   A:  B(2), C(3), D(5)
   6E: F(1), G(3), A(5)
   ```

## 次のタスク: ルートキー選択機能

**実装プランは `PLAN-root-key.md` を参照。** このファイルを読んでから作業を開始すること。

要点:
- `buildFretMap` / `generatePositions` は変更不要（既にルート非依存）
- `src/utils/noteSpelling.ts` を新規作成（エンハーモニック処理の核心）
- `MODES` → `MODE_TEMPLATES` に置換、`resolveMode(rootName, template)` で動的生成
- 全コンポーネントからハードコード "C" を除去
- 13キー選択 UI を追加（F#/G♭ 両対応）

## 今後の開発予定 (優先度順)

1. ~~C以外のルート対応~~ → `PLAN-root-key.md` に詳細プランあり
2. コード進行連動表示 (BPM/タイミング制御で自動切替)
3. コード進行プリセット (II-V-I, Blues, Rhythm Changes)
4. ポジション間移動ガイド (共通音ハイライト)
5. 音声再生 (Web Audio API)
6. カスタムスケール (メロディックマイナー, ハーモニックマイナー)

## 参照ドキュメント

- `HANDOFF.md` — コアアルゴリズム詳細、失敗パターン、データ構造
- `PLAN-root-key.md` — ルートキー選択機能の実装プラン（次のタスク）
- `berklee-positions-v2.jsx` — 移行元の Artifact コード (参照用)
