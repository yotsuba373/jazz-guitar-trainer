# ビバップフレーズ構造ルール — 裏付けデータ付きカタログ

**目的**: ルールベースフレーズジェネレーター実装のための構造ルール集
**ソース**: ジャズ教育者のコンセンサス (日英 20+ ソース) + リックライブラリ統計分析 + 学術研究

各ルールに **合意度** を付記: ★★★★★ = 全ソース合意, ★★★★ = 広く受容, ★★★ = 高度だが重要

---

## 1. 最小構成単位: 2拍4音音型 (The Four-Note Cell)

ビバップフレーズの基本単位は **8分音符4つ = 2拍**。

### 拍配置ルール

| 位置 | 拍 | 役割 | 使用可能な音 |
|------|-----|------|------------|
| 1番目 | N拍 表 | **アンカー** | コードトーン (CT), テンション |
| 2番目 | N拍 裏 | **装飾** | アプローチノート, スケール音, CT |
| 3番目 | N+1拍 表 | **アンカー** | CT, テンション (必須) |
| 4番目 | N+1拍 裏 | **接続** | アプローチノート (→次セルの1番目へ半音/全音解決), CT |

**原則**: 表拍 (1番目, 3番目) = 和声的に安定した音、裏拍 (2番目, 4番目) = 装飾・接続音

### 補足: Beat 1, 3 にはガイドトーン優先 (★★★★)

Beat 1, 3 には 3rd / 7th (ガイドトーン) を優先配置。Root, 5th は Beat 2, 4 でも可。
- **出典**: 複数の教育者のコンセンサス (David Baker, Jens Larsen 等)
- Hal Galper は「CTを strong beats に配置」と述べているが、GT の拍位置を明示的に指定はしていない
- Galper の "Inner Guide Tone Melodies" は voice leading の概念であり、拍配置ルールとは別

### 裏付け
- David Baker "How to Play Bebop" — 事実上すべてのビバップ教材の基礎 (★★★★★)
- ジャズギター通信講座 ビバップ第2回 (www4.big.or.jp/~jazz)
- music-theory.info ビバップフレーズ構成
- Hal Galper "Forward Motion" — Beat 1,3 がガイドトーン位置
- ビバップスケール理論: 8音スケールを8分音符で弾くと自動的にCTが表拍に配置される設計

### 統計データ (リックライブラリ分析)
- CT on-beat率: 全体 26.9%, Omnibook 32.0% (+3.4pt差)
- 微差だが一貫して CT > non-CT の傾向は存在
- **注**: リックライブラリの統計で微差なのは、抽出リックが「設計されたフレーズ」ではなく「ソロの切り出し断片」だから。教育者のコンセンサスルールはより明確。

### 用語注記: 「表拍」と「強拍」
本ドキュメントでは以下の区別を用いる:
- **表拍 (on-beat/downbeat)**: 各拍の頭 (beat 1, 2, 3, 4) — §1 CT配置、§2 パッシングトーンの文脈
- **強拍 (strong beat)**: Beat 1 と 3 — §1 GT優先、§9 方向転換の文脈
- **裏拍 (off-beat/upbeat)**: 各拍の裏 (1&, 2&, 3&, 4&) — §6 開始拍の文脈
- David Baker / Barry Harris は「strong beats = 全ダウンビート (1,2,3,4)」の意味で使うことがある
- Hal Galper は「strong beats = Beat 1, 3」の意味で使う

---

## 2. ビバップスケール (The Bebop Scale)

通常の7音スケールに1音追加して8音にし、CTが表拍に来ることを保証するスケール。

### 4種のビバップスケール

| 名称 | 親スケール | 追加音の位置 | 例 (C) |
|------|-----------|------------|--------|
| Dominant Bebop | Mixolydian | b7-R間 (= M7追加) | C D E F G A Bb **B** |
| Major Bebop | Ionian | 5-6間 (= #5/b6追加) | C D E F G **Ab** A B |
| Dorian Bebop | Dorian | 3-4間 (= M3追加) | C D Eb **E** F G A Bb |
| Harmonic Minor Bebop | Harm. Minor | b7-M7間 | A B C D E F **G** G# |

### 使用ルール
1. **下行8分音符で演奏すると自動的にCTが表拍に配置される**
2. 追加半音は**必ず裏拍**に配置 — 表拍に来ると音外しに聞こえる
3. 開始音はCT (R, 3, 5, b7) のいずれかから
4. 上行時は追加半音の扱いに注意が必要 (下行が基本)

### Barry Harris の「6th Diminished Scale」理論 (★★★★)

ビバップスケールの別解釈。Major 6th コードトーン + Diminished 7th コードトーンの合成:
- **C Major 6th Dim**: C(I6) + D(iidim7) = C D E F G G# A B
- 表拍 = トニック (I) 機能、裏拍 = ドミナント (V) 機能

**Barry Harris Half-Step Rules** (下行ライン用の半音挿入):
ビバップスケールをそのまま使わず、開始音に応じて半音を挿入し、
CTが全てのダウンビート (1,2,3,4) に着地するよう調整するシステム。

- **CT開始 (R/3rd/5th/b7)**: Choice 1 = 1つの半音追加、Choice 2 = 3つの半音追加
- **非CT開始 (2nd/4th/6th)**: Choice 1 = 半音なし (素のスケール)、Choice 2 = 2つの半音追加
- 半音の具体的な挿入位置はコード品質 (Dominant/Major/Minor) と開始音で決まる
- **出典**: Barry Harris ワークショップ, Fertile Minds Jazz Academy, Notes on the Method of Barry Harris

### 裏付け
- David Baker "How to Play Bebop" Vol.1: ビバップスケール体系化の元祖
- Barry Harris メソッド: 「トニック6 + ディミニッシュ」の合成理論
- Learn Jazz Standards, Jens Larsen, jazz-guitar-licks.com: 全サイト共通の基本教材

---

## 3. アプローチノート (Approach Notes)

ターゲット音 (CT) に到達する前の装飾音。ビバップらしさの源泉。

### 5つの基本タイプ

| タイプ | 構成 | 例 (ターゲット=E) | 頻度 |
|--------|------|-----------------|------|
| **Single Chromatic (下)** | 半音下→ターゲット | Eb→E | 高 |
| **Single Chromatic (上)** | 半音上→ターゲット | F→E | 中 |
| **Double Chromatic (下)** | 全音下から半音2つ上行 | D→Eb→E | 高 |
| **Double Chromatic (上)** | 全音上から半音2つ下行 | F#→F→E | 中 |
| **Diatonic (上/下)** | スケール隣接音→ターゲット | D→E or F→E | 単体では低 |

### 方向による音響差 (Anton Schwartz)
Schwartz のキー概念: **ピーク音 (周囲より高い音) は聴衆の注意を強く引く**。
- **下からChromatic**: "casual and colloquial" — 目立たない、安全に使える
- **上からChromatic**: conspicuous (目立つ) — ピーク音として追加の和声が推論される → 慎重に管理
- **上からDiatonic**: chromatic より自然で "more useful" — 上からの場合のデフォルト選択
- **下からDiatonic**: "stiff and less idiomatic" — ジャズ的でない響き
- **要約**: 下からは chromatic が安全、上からは diatonic が安全 (ただし上からの chromatic も意図的に使用可)
- **出典**: Anton Schwartz "Approaches and Enclosures" (antonjazz.com)

### コンビネーション (Parker最頻出)
1. **Chromatic下 → Double Chromatic上**: 最頻出
2. **Chromatic上 → Double Chromatic下**: パーカー好み
3. **Rotation (回転)**: Diatonic + Chromatic の上下交互 → アルペジオ前に頻出

### クロマチックスケールが使える区間 (CT間)
| コード品質 | 区間1 | 区間2 |
|-----------|-------|-------|
| maj7 | R ⇔ 3rd | 5th ⇔ 7th |
| m7 | b3 ⇔ 5th | b7 ⇔ 9th |
| dom7 | R ⇔ 3rd | b7 ⇔ 9th |

### 裏付け
- jazzpianopractice.net (Parker分析): 5タイプ + コンビネーション定義
- Anton Schwartz (antonjazz.com): 方向別音響差、Delayed Resolution
- isseiec.com: 4パターン分類
- リックライブラリ: エンクロージャー含有率 24.9% (dom7)

---

## 4. エンクロージャー (Enclosure)

ターゲット音を上下から囲んで解決するパターン。

### 4タイプ

| タイプ | 構成 | 例 (ターゲット=E) |
|--------|------|-----------------|
| **Diatonic** | スケール上+スケール下→ターゲット | F→D→E |
| **Chromatic** | 半音上+半音下→ターゲット | F→Eb→E |
| **Mixed** (最頻出) | スケール上+半音下→ターゲット | F→Eb→E |
| **3-note** | スケール上+アプローチ+半音下 | G→F→Eb→E |

### ターゲット選択ルール
- **コードチェンジ直後の音** を強調するために使用
- 主なターゲット: **R, 3rd, 5th** (7th, 9thも可)
- Avoid noteはターゲットにしない

### 拍配置ルール
- **ターゲットは表拍 (downbeat)** に着地が基本
- アプローチ音の数を調整して着地タイミングを制御 (**Delayed Resolution**)
- 例外: フレーズ末尾でシンコペーション効果を狙う場合

### 裏付け
- Anton Schwartz: Delayed Resolution理論
- isseiec.com: 4タイプ分類
- jazz-guitar-licks.com: 58パターンのエンクロージャー集
- リックライブラリ: エンクロージャー→CT解決 24.3% (dom7, 6-10音リック)

---

## 5. フレーズの構造テンプレート (Phrase Architecture)

### 最も基本的な構造: CT上行 → スケール下行 (The Arch) (★★★★★)

```
[CT arpeggio ascending] → [scale descending to target CT]
例 (C7): C → E → G → Bb → A → G → F → E
```

- ジャズ教育サイトでほぼ100%紹介される最重要パターン
- 「音楽学者がグレートプレイヤーのソロを分析した結果確認」(Fundamental Changes)

### 構造テンプレート一覧

| テンプレート | 構成 | コンター | 合意度 |
|-------------|------|---------|-------|
| **Arp↑ + Scale↓** | CTアルペジオ上行 → スケール下行 | arch | ★★★★★ |
| **Scale↓ straight** | ビバップスケール下行 (CT開始) | descending | ★★★★★ |
| **Enclosure → Arp** | エンクロージャー → CTアルペジオ | ascending/arch | ★★★★ |
| **1-2-3-5** | R-2-3-5 の4音上行ブロック | ascending | ★★★★★ |
| **Scale↑ + Arp↓** | スケール上行 → アルペジオ下行 | arch | ★★★★ |
| **Approach → CT chain** | アプローチ→CT→アプローチ→CT の交互 | wave | ★★★★ |
| **dim7 from 3rd** | 3rdからdim7アルペジオ (V7b9 only) | ascending | ★★★★★ |
| **Upper structure arp** | 3rdからのm7/maj7アルペジオ | ascending | ★★★★ |
| **Honeysuckle Rose** | R→(下1oct)3rd→上行 (octave displacement) | ascending | ★★★★ |
| **Pivot Arp** (Barry Harris) | アルペジオ最初の音→残りを1oct下に配置 | mixed | ★★★ |

### Jason Lyon の7カテゴリー体系

学術的裏付けのあるビバップ練習分類 (jasonlyonmusic.com):

1. **Bebop Scales up/down** — CTを拍頭に保つクロマティックパッシング
2. **Direction Changes** — フレーズ中の方向転換
3. **Diminished Scale Descending** — H-W dim over dominant
4. **Dim Arpeggio-Scale Figures** — 上行dim arp → 下行スケール → 最近接CTへ解決
5. **Upper Extension Arp-Scale** — 3rdから上行arp → 下行スケール
6. **Chord Tone Enclosures** — scale tone above + semitone below → target
7. **Chromatic Dithering** — CT間を4音パッセージで接続

### 裏付け
- yoshiakinagai.com: 「コードトーン上昇→スケール下降」が最も基本
- jazzguitar.be: 「パーカーはアルペジオ上行後すぐにスケール下行」
- Jens Larsen: 3つのII-V-Iリック全てにアルペジオ+スケールの組み合わせ
- Fundamental Changes: 「音楽学者のソロ分析で確認」
- Jason Lyon (jasonlyonmusic.com): 7カテゴリー体系
- リックライブラリ: Arp→Scale構造 Omnibook 9.0% vs WJD 5.6%

---

## 6. フレーズの開始と終了ルール

### 開始ルール

**開始拍: アップビート開始が標準** (★★★★★)
- 特に "and of 4" (前小節4拍裏→次小節へリードイン) と "and of 2" が多い
- Beat 1 ダウンビート開始は稀
- **出典**: Thomas Owens (Parker分析), Hal Galper, JazzAdvice

**Hal Galper "Forward Motion" の原則** (★★★★):
- ラインはテンション拍 (beat 2裏, 4裏 等) で開始すべき
- **Beat 1 と Beat 3 は resolution points** (到着点・終点) — ここから始めると前進運動が止まる
- Beat 1 は "the strongest beat of the bar and the ultimate resolution beat"
- **出典**: Hal Galper "Forward Motion", halgalper.com

**開始音**: CT (特にR, 3rd, 5th) またはその半音上/下
- Parker統計: b7開始が15.3% (Omnibook)
- リックライブラリ: CT開始率 50.6%

### 終了ルール

**CT終止が基本原則** (★★★★★)
- 統計: ソロの終了69%がCT
- 3rd = 最もメロディック (コード品質を定義)、Root = 最も安定、7th = 次コードへのつなぎ
- **出典**: David Baker, ほぼ全教材

**解決拍**: Beat 1 or 3 で解決 (★★★★)
- 遅延解決: クロマティックアプローチでBeat 1を通過しBeat 2で着地 → より洗練 (★★★)

**次コードへの接続**: 現コードの7th → 次コードの3rd (半音/全音下行)

### 裏付け
- Hal Galper "Forward Motion": アップビート開始 + Beat 1 = 終点
- Thomas Owens: Parker のフレーズ開始位置分析
- jazzguitarlife.net: 「7度→3度の連結がビバップの骨格」
- yoshiakinagai.com: 「下降経過音ラインは7度から開始」
- リックライブラリ: CT終止率 52.2% (dom7)

---

## 7. コード間接続 (Voice Leading)

### 核心: 7th → 3rd 解決

4度進行 (ii→V, V→I) において:
- 前コードの **7th** → 次コードの **3rd** が半音/全音で自然に下行
- この接続がビバップラインの骨格

### 接続パターン

| 進行 | 現7th | 次3rd | 解決 |
|------|-------|-------|------|
| Dm7 → G7 | C | B | 半音下行 |
| G7 → Cmaj7 | F | E | 半音下行 |
| Cm7 → F7 | Bb | A | 半音下行 |
| F7 → Bbmaj7 | Eb | D | 半音下行 |

### フレーズ設計への影響
- フレーズのゴール音は **次コードの3rd** または **現コードの7th** (半音で解決可能な音)
- エンクロージャーのターゲットにこの解決音を選ぶと効果的

### 裏付け
- jazzguitarlife.net: 5ステップ習得法の第3段階
- Jens Larsen: II-V-I リック全例で7th→3rd接続
- 当システム: 既に `chooseGoalNote()` で70%確率の7th→3rd選択を実装済み

---

## 8. 品質別の特有ルール

### dom7 (最重要)
- ビバップDominantスケール使用
- dim7 from 3rd (= V7b9 の3-5-b7-b9) が強力なテンション装置
- クロマチック区間: R⇔3rd, b7⇔9th
- 特性音: b7 (ドミナント感の源泉)

### m7
- Dorian Bebop スケール (b3-4間にM3追加)
- クロマチック区間: b3⇔5th, b7⇔9th
- 上部構造: m7の3rdからmaj7アルペジオ (例: Dm7上でFmaj7)

### maj7
- Major Bebop スケール (5-6間に#5追加)
- クロマチック区間: R⇔3rd, 5th⇔7th
- 上部構造: maj7の3rdからm7アルペジオ (例: Cmaj7上でEm7)
- CT率が最も高い (55.3%)

### m7b5
- Locrian #2 または Locrian ♮2 Bebop
- b5→5の半音動きが特徴的
- リック数が少ない (410本) → ルールベース補強が特に有効

### dim7
- 対称構造 → 短3度ごとに転回
- 4ポジションで完結
- CT率最低 (40.7%) — スケール音の自由度が高い

---

## 9. メロディの物理法則 — Steve Larson "Musical Forces" (★★★★)

ビバップラインのノート選択を支配する3つの力:

| 力 | 定義 | 実装示唆 |
|----|------|---------|
| **重力 (Gravity)** | 高い音は下行する傾向がある | 上行後は下行バイアスをかける |
| **磁力 (Magnetism)** | 不安定音は最近接安定音 (CT) へ引かれる。近いほど強い | 非CTの次のノートはCT方向にバイアス |
| **慣性 (Inertia)** | パターンは一度始まると方向を維持する傾向 | 同方向継続に軽いボーナス |

**方向転換は強拍を避ける** (Barry Harris, ★★★):
- メロディの方向転換を beat 1, 3 (強拍) に集中させない
- 理想的な方向転換位置は 2& や 4& (弱拍の裏)
- 禁止ルールではなく「変化を持たせろ」というニュアンス
- **出典**: Jens Larsen "you don't change direction on beats 1 and 3 all the time"

### インターバルバイグラム — 実データ上位10

リックライブラリ全体で最も頻出する「2つの連続インターバル」:

| 順位 | バイグラム | 意味 | 全体% | Omnibook% |
|------|----------|------|-------|-----------|
| 1 | (-1, -2) | 半音下→全音下 | 5.5% | — |
| 2 | (-2, -1) | 全音下→半音下 | 4.5% | — |
| 3 | (-1, -1) | クロマチック下行 | 4.2% | — |
| 4 | (-2, -2) | 全音下→全音下 | 3.9% | — |
| 5 | (2, -2) | 全音上→全音下 (波型) | — | **3.3% (1位)** |
| 6 | (-2, 2) | 全音下→全音上 | — | — |
| 7 | (1, 1) | クロマチック上行 | — | — |
| 8 | (2, 2) | 全音上→全音上 | — | — |
| 9 | (-4, -3) | 長3度下→短3度下 (下行arp) | — | 1.7% |
| 10 | (1, -2) | 半音上→全音下 (エンクロージャー的) | — | — |

**知見**: 下行stepwiseの連続が支配的。Omnibookでは波型 (2,-2) が最頻出。

**出典**: Steve Larson "Musical Forces" (Indiana UP, 2012), リックライブラリ分析

---

## 10. リズムパターン

### 基本: 8分音符ストレート
- ビバップの基本リズム
- 2拍4音のセルを連結

### バリエーション
| パターン | 記述 | 効果 |
|---------|------|------|
| **3連符** | CTアルペジオに使用 (例: R-3-5 を3連で) | アルペジオの強調 |
| **16分音符** | エンクロージャーやクロマチックランに | 緊張感 |
| **付点4分+8分** | モチーフの反復に | ブルース的 |
| **休符挿入** | フレーズ間のブレス | 自然な呼吸感 |

---

## 11. 学術研究からの知見

### Thomas Owens (1974): Parker の語彙分析 (★★★★★)

Parker の即興は **100以上の有限個のメロディックフォーミュラ** から構成。
異なるソロで同じフォーミュラを再利用し、truncation (切り詰め), extension (拡張),
division (分割), inflection (変形) で変化させる。

**実装示唆**: ルールベースで生成する「テクニック」は有限個でよい。組み合わせと変形で多様性を出す。

### Stefan Love (MTO 2012): ブルーススキーマ (★★★★)

Parker のブルースソロに5つのフレージングスキーマを特定:
- 4/4/4, 8/4, 4/8, 6/6, Through-Composed
- **2つのメロディックゾーン**: Zone 1 (mm.1-7) = 下行、Zone 2 (mm.8-11) = ii-V-I カデンツ

**構築原則**: 「経済的手段」— 小さなパターンレパートリーの柔軟な組合せが複雑なメロディを生む。

### Henry Martin (MTO 2018): 構造的パラフレーズ (★★★★)

Parker は元曲の声部進行構造を抽出し即興的に再実現。
**Formula-Motive Integration**: 機械的パターンとテーマ的アイデアの重複。

### David Baker のパターン体系 (★★★★★)

"How to Play Bebop" Vol.2 で体系化:
- 101 ii-V (major) + 125 ii-V (minor) + 100 iii-vi-ii-V + 100 major + 45 turnarounds
- **Baker の公式**: 7-5-3-(bebop passing) の循環。どのCTから始めても同サイクルに入る。

---

## 12. 実装への変換: フレーズ生成アルゴリズム概要

### ステップ1: 骨格決定
1. 拍数 (2/3/4拍) → 4/6/8 つの8分音符スロット
2. 表拍スロット (1, 3, 5, 7番目) に **CT** を配置
3. 強拍 (Beat 1, 3) にはガイドトーン優先
4. ゴール音決定: 次コード3rd / 現コード7th / ユーザー指定
5. 開始拍: 裏拍 (and of 4, and of 2) にバイアス

### ステップ2: テクニック選択
拍数に応じてテクニックの組み合わせを選択:
- **2拍**: 1テクニック (スケールラン / エンクロージャー+解決 / 1-2-3-5)
- **3拍**: 1-2テクニック (エンクロージャー+スケールラン / アルペジオ+アプローチ)
- **4拍**: 2-3テクニック (アルペジオ↑+スケール↓ / エンクロージャー+アルペジオ+解決)

テクニック組合せは**テンプレート表**から選択 (セクション5参照)。

### ステップ3: 度数列生成
1. 選択したテクニックのルールに従い**度数列** (スケール度数 or 半音値) を生成
2. 表拍位置にCT/テンションが来ることを保証
3. 裏拍にアプローチ音/経過音を配置
4. ビバップスケールの追加半音が裏拍に来ることを確認
5. **Musical Forces** を適用: 重力 (上行後は下行), 磁力 (非CT→最近接CT), 慣性 (方向維持)

### ステップ4: 指板マッピング
1. 度数列をポジション内の具体的フレット位置に変換
2. 弦間の物理的距離を考慮 (隣接弦優先)
3. 音域がポジション範囲内に収まることを確認

### ステップ5: 品質チェック
1. 表拍CT配置の確認
2. 強拍 (Beat 1, 3) にガイドトーン優先
3. 音域 (5-14半音) の確認
4. 連続音間の跳躍制限 (9半音以内)
5. CT終止の確認
6. 方向転換が強拍 (beat 1, 3) に集中していないか

---

## 13. 実装優先度マトリクス

### HIGH — 全ソース合意、即実装

| ルール | セクション | 実装方法 |
|--------|----------|---------|
| CTを表拍配置 | §1 | スロットスケジューリング偶数位置にCT優先 |
| ビバップスケール下行デフォルト | §2 | スケールランのデフォルト方向=下行 |
| 上行arp + 下行scale | §5 | `arch` コンターの基本テンプレート |
| Diatonic above + Chromatic below エンクロージャー | §4 | デフォルトエンクロージャータイプ |
| 7th→3rd 半音解決 | §7 | 既存ガイドトーンロジック強化 |
| アップビート開始 | §6 | 開始位置を拍裏にバイアス |
| CT終了 (3rd/Root優先) | §6 | ゴールノート選択優先順位 |
| 3rdからのdim7 arp (V7上) | §5 | dom7品質のarpパターン |
| 1-2-3-5 パターン | §5 | 4音セルテンプレート |
| 品質別ビバップスケール | §2 | 4種スケール定義 |

### MEDIUM — 広く受容、品質を大きく向上

| ルール | セクション | 実装方法 |
|--------|----------|---------|
| 方向転換は強拍を避ける | §9 | 強拍 (beat 1, 3) に集中させない |
| 下=chromatic, 上=diatonic | §3 | 方向別アプローチタイプ選択 |
| Beat 1,3 にガイドトーン | §1 | 強拍 (Beat 1, 3) にガイドトーン優先 |
| 上部構造アルペジオ | §5 | 3rdからのm7/maj7 arp |
| Delayed Resolution | §4 | 解決位置のバリエーション |
| Musical Forces (重力/磁力/慣性) | §9 | ノート選択確率バイアス |
| Honeysuckle Rose (octave displacement) | §5 | メロディックセルテンプレート |
| Forward Motion (テンション拍開始) | §6 | 開始位置の確率分布 |

### LOW — 上級/文脈依存、将来実装

| ルール | セクション | 実装方法 |
|--------|----------|---------|
| Barry Harris Half-Step Rules (開始音別) | §2 | 品質別半音挿入テーブル |
| 6th Diminished Scale | §2 | 追加スケールタイプ |
| Pivot Arpeggio | §5 | アルペジオバリエーション |
| Parker フレージングスキーマ | §11 | マルチコーラス構造 (将来) |
| Chromatic Dithering | §5 | CT間4音接続パターン |

---

## ソース一覧

### 学術研究
- Thomas Owens (1974): "Charlie Parker: Techniques of Improvisation" (UCLA dissertation)
- Stefan Love (MTO 2012): "An Approach to Phrase Rhythm in Jazz"
- Henry Martin (MTO 2018): "Charlie Parker and 'Honeysuckle Rose'"
- Steve Larson (2012): "Musical Forces: Motion, Metaphor, and Meaning in Music" (Indiana UP)
- 濱瀬元彦: 『チャーリー・パーカーの技法 — インプロヴィゼーションの構造分析』

### 書籍・教則本
- David Baker: "How to Play Bebop" Vol.1-3
- Hal Galper: "Forward Motion"
- Barry Harris: ワークショップノート

### 日本語教育資料
- ジャズギター通信講座 ビバップ (www4.big.or.jp/~jazz)
- 永井義朗 ビバップ語法練習論 (yoshiakinagai.com)
- ジャズピアノの練習 パーカー分析 (jazzpianopractice.net)
- 旅するトロンボーン エンクロージャー (isseiec.com)
- ビバップスケール解説 (ameblo.jp/wapikodon)
- Barry Harris メソッド (jazz.playing.wiki)
- コードトーンでアドリブ5ステップ (jazzguitarlife.net)
- 肉じゃぎ ビバップ入門 (nikujagi.com)

### 英語教育資料
- Anton Schwartz: Approaches and Enclosures (antonjazz.com)
- Jens Larsen: Bebop Concepts, Parker Licks, Barry Harris Approach (jenslarsen.nl)
- Jason Lyon: Bebop Exercises (jasonlyonmusic.com)
- Learn Jazz Standards: Bebop Scales (learnjazzstandards.com)
- jazz-guitar-licks.com: 58 Enclosure Patterns, Bebop Scale Patterns
- jazzguitar.be: 50 Bebop Licks, Charlie Parker Analysis
- Fundamental Changes: Arpeggios with Bebop Scale
- Fertile Minds Jazz Academy: Barry Harris Half-Step Rules
- Piano With Jonny: Bebop Piano in 6 Steps (pianowithjonny.com)
- Guitar9: Double Chromatic Approach
- Muse-Eek: Approach Notes Study

### 統計データ
- リックライブラリ分析 (11,078リック, WJD 186ソロ + Omnibook 50ソロ)
- Parker Profiles (scripts/output/parker_profiles.json)
- Bebop Deep Profiles (scripts/output/bebop_deep_profiles.json)
