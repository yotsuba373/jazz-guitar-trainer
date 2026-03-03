import type { ModeTemplate, RootName } from '../types';

export const OPEN_STRINGS: number[] = [4, 11, 7, 2, 9, 4]; // 1E, 2B, 3G, 4D, 5A, 6E

export const STR_LABELS: string[] = ['e', 'B', 'G', 'D', 'A', 'E'];

export const MODE_TEMPLATES: ModeTemplate[] = [
  { key: 'ionian', name: 'Ionian', semi: [0,2,4,5,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7',
    description: 'メジャースケールそのもの。明るく安定した響きで、Imaj7 上の最も基本的な選択肢。ジャズではトニックの安定感を出したいときに使う。♯11 のテンションを避けたい場面（4th がアヴォイドノート）では Lydian より安全。4th（11th）はコードの3rd と半音でぶつかるため、経過音として扱うのが鉄則。Bill Evans "Waltz for Debby" のような透明なトニック・サウンドはまさにこのモード。スタンダード曲の多くは Imaj7 で始まり Ionian で「帰ってきた」感覚を演出する。練習では 3rd→5th→7th→9th のアルペジオを各ポジションで弾き、コードトーンの位置を体に染み込ませるのが効果的。' },
  { key: 'dorian', name: 'Dorian', semi: [0,2,3,5,7,9,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: 'ジャズで最も多用されるマイナーモード。♭3 と ♮6 の共存が都会的な哀愁を生む。IIm7 はもちろん、マイナー・トニックにも頻出。Miles Davis "So What" の D Dorian が教科書的名演。Aeolian より明るく、Phrygian より柔らかい。♮6 が Dorian の個性で、この音を意識的にメロディに入れると「ジャズっぽさ」が一気に出る。II-V-I の IIm7 では最初に習得すべきスケール。Herbie Hancock "Maiden Voyage" や John Coltrane "Impressions" も Dorian の名曲。マイナーペンタトニックに ♮6 と 9th を加えた感覚で弾くと、ブルースとジャズの橋渡しになる。' },
  { key: 'phrygian', name: 'Phrygian', semi: [0,1,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: '♭2 が生むエキゾチックで暗い響き。フラメンコやスパニッシュ音楽の基盤。ジャズでは IIIm7 や sus♭9 コード上で使われる。♭2（♭9）がルートの半音上にあるため、強烈な緊張感とミステリアスな色彩が特徴。John Coltrane "Olé" や Chick Corea "Spain"（イントロ）がこのモードの雰囲気を体現。ダイアトニックの中では Locrian に次いで暗いモードだが、♮5 があるため Locrian より安定感がある。♭2 から Root への半音下行モチーフは Phrygian の最も印象的なサウンド。映画やゲーム音楽でも「異国の地」や「古代文明」の表現に頻用される。' },
  { key: 'lydian', name: 'Lydian', semi: [0,2,4,6,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7',
    description: '♯4 が浮遊感と輝きを生むメジャーモード。IVmaj7 の定番だが、Imaj7 でもアヴォイドノートなしで使える万能スケール。♯4（♯11）は maj7 コードの全ての音と協和するため、どこで弾いても美しく響く。George Russell の "Lydian Chromatic Concept" はジャズ理論の金字塔で、Lydian をすべての調性の出発点と位置づけた。Pat Metheny や映画音楽（John Williams "E.T."）でも多用。Ionian の4度が ♯4 に変わっただけで、地に足のついた安定感から空中に浮かぶような開放感に一変する。練習では Root-3rd-♯4-5th の動きを繰り返し弾いて、♯4 の「浮遊感」を耳に覚えさせるのがコツ。' },
  { key: 'mixolydian', name: 'Mixolydian', semi: [0,2,4,5,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7',
    description: 'ドミナント7th の基本スケール。♭7 がブルージーな色を加える。V7 での第一選択肢。ブルース、ファンク、ロックでも頻出。テンションを加えずストレートに弾くと、最もブルース的なドミナントサウンドが出る。Wes Montgomery のオクターブ奏法によるブルースソロはまさに Mixolydian の極致。ドミナント系スケールの中で最もシンプルで「安全」な選択だが、♭9 や ♯9 がない分、モダンジャズでは物足りなく感じることも。ブルーススケールと組み合わせると表現の幅が格段に広がる。Freddie Hubbard や Cannonball Adderley のファンキーなソロを分析すると Mixolydian + ブルーノートの融合が見える。' },
  { key: 'aeolian', name: 'Aeolian', semi: [0,2,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: 'ナチュラルマイナースケール。♭6 が暗く内省的な雰囲気を作る。Dorian より暗い。ポップスやロックのマイナーキーで最も一般的。ジャズでは VIm7 や、♭6 の響きを活かしたいマイナー・トニックで使う。♭6 と ♭7 の全音関係がこのモード特有の「沈み込むような暗さ」を生む。Carlos Santana や Pink Floyd など、ロック寄りのギタリストがよく使う響き。ジャズでは Dorian の方が好まれるが、バラードで深い悲しみを表現したいときは Aeolian が適する。Wayne Shorter の楽曲にはこのモードの色彩が随所に見られる。♭6→5th の半音下行は Aeolian 最大の特徴的モチーフ。' },
  { key: 'locrian', name: 'Locrian', semi: [0,1,3,5,6,8,10],
    chordSub: '1 ♭3 ♭5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7♭5',
    description: '♭2 と ♭5 を持つ最も不安定なダイアトニックモード。m7♭5（ハーフディミニッシュ）コード上で使用。マイナー II-V-I の IIm7♭5 で頻出するが、♭2 がアヴォイドになりやすく、実際は Locrian ♯2 が好まれることも多い。♭5 のトライトーン関係がルートの安定感を奪うため、単体で「Locrian のサウンド」を確立するのが難しい。しかし、コード進行の中で短く使う分には十分機能する。♭2 のテンション感を積極的に活かすなら、♭2→Root の半音解決モチーフが効果的。理論的には全ダイアトニックモードの中で最も暗く不安定だが、だからこそ解決時のカタルシスは最大になる。' },

  // ── Melodic Minor modes ──
  { key: 'melodic-minor', name: 'Melodic Minor', semi: [0,2,3,5,7,9,11],
    chordSub: '1 ♭3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'mMaj7',
    description: 'マイナーでありながら ♮6 と ♮7 を持つ独特のスケール。mMaj7 コードの響きはミステリアスで映画音楽的。ジャズではクラシカルな上行形ではなく、上下行とも同じ音列で使う（ジャズ・メロディックマイナー）。♭3 と ♮7 の組み合わせが「明るいのに悲しい」という矛盾した美しさを生む。このスケールから派生する7つのモードがモダンジャズの語彙の中核を成す。Kurt Rosenwinkel や Pat Martino が好んで使うサウンド。mMaj7 コードは James Bond テーマでもお馴染みの「スパイ映画的」な響き。♮7→Root の半音上行と ♭3 の共存を意識して弾くと、このモードの個性が際立つ。' },
  { key: 'dorian-b2', name: 'Dorian ♭2', semi: [0,1,3,5,7,9,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: 'Phrygian に ♮6 を加えた響き。メロディックマイナーの第2モード。Phrygian のエキゾチックさと Dorian の洗練を併せ持つ。sus♭9 コードや、インドのラーガ的なサウンドにも通じる。別名 Phrygian ♯6。♭2 がスパニッシュ的な緊張を、♮6 がジャズ的な洗練を同時にもたらす絶妙なバランス。John McLaughlin の Mahavishnu Orchestra 時代の楽曲にこのモードの影響が強く聴ける。マイナー系コード上で Phrygian とも Dorian とも違う「第三の選択肢」として、ソロに意外性を加えるのに効果的。♭2→♭3 の全音上行が特徴的なモチーフ。' },
  { key: 'lydian-aug', name: 'Lydian Augmented', semi: [0,2,4,6,8,9,11],
    chordSub: '1 3 #5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'aug',
    description: 'Lydian の5度が ♯5 に。♯4 と ♯5 が極めて浮遊感のある響きを生む。augMaj7 コード上で使用。メロディックマイナーの第3モード。日常的に使う場面は少ないが、独特の色彩が欲しいときに効果的。Root から ♯4 まで全音が4つ連続する「ホールトーン的」な質感が浮遊感の正体。♯5 が加わることで Lydian 以上に現実離れした響きになる。Wayne Shorter "Nefertiti" のようなポスト・バップの楽曲で、通常の maj7 コード上にこのスケールのテンションを乗せる手法がある。3rd→♯4→♯5 のホールトーン・フラグメントを意識すると使いやすい。' },
  { key: 'lydian-dom', name: 'Lydian Dominant', semi: [0,2,4,6,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7#11',
    description: 'Lydian の7度を ♭7 にしたドミナント系スケール。♯11 テンションが特徴で、トライトーン・サブスティテューション（裏コード）の定番。Mixolydian に飽きたドミナントに新鮮な色を加える。Bartók スケールとも呼ばれる。♯11（= ♭5）がトライトーン・サブの本質——元のドミナントの Root を指す。例えば D♭7（G7 の裏コード）上で D♭ Lydian Dominant を弾くと、G7 のテンション（♯11=G）が自然に含まれる。Joe Henderson や McCoy Tyner がこのサウンドを多用。非機能的なドミナント（ブルースの I7 など）でも ♯11 の浮遊感が心地よい。' },
  { key: 'mixolydian-b6', name: 'Mixolydian ♭6', semi: [0,2,4,5,7,8,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7b13',
    description: 'Mixolydian の6度が ♭6 に。メロディックマイナーの第5モード。♭13 テンションを持つドミナントコードに使用。マイナーキーへ解決する V7 で特に有効。Hindu スケールとも呼ばれ、エキゾチックな陰りがある。♭6（♭13）が ♮5 と半音でぶつかることで、明るいドミナントに暗い影を落とす。マイナー II-V-I の V7 で Altered ほど「外れた」感じにしたくないとき、この中間的な色彩が最適。5th→♭6→♭7 の半音-全音の動きが哀愁を帯びた独特のメロディラインを生む。映画音楽でサスペンスやノスタルジーの場面に使われることも多い。' },
  { key: 'locrian-s2', name: 'Locrian ♯2', semi: [0,2,3,5,6,8,10],
    chordSub: '1 ♭3 ♭5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7♭5',
    description: 'Locrian の ♭2 を ♮2 にして安定性を向上。m7♭5 コード上の最も実用的な選択肢。マイナー II-V-I の IIm7♭5 で、Locrian より ♮2 が自然に響く。メロディックマイナーの第6モード。♮2（9th）が使えるだけで Locrian のアヴォイドノート問題が解消され、メロディが格段に歌いやすくなる。Joe Pass や Jim Hall のようなジャズギタリストがマイナー II-V で愛用した。覚え方は「短2度上のメロディックマイナーを弾く」こと。例えば Dm7♭5 上では E♭ メロディックマイナーを弾けばよい。♮2→♭3→4→♭5 のステップワイズな動きが自然で美しい。' },
  { key: 'altered', name: 'Altered', semi: [0,1,3,4,6,8,10],
    chordSub: '1 3 ♭5 ♭7', chordDegreesIdx: [0,3,4,6], chordQuality: '7alt',
    description: '全てのテンションが変化した究極のドミナントスケール（♭9, ♯9, ♭5/♯11, ♯5/♭13）。V7alt で強烈な緊張→解決を作る。メロディックマイナーの第7モード＝半音上のメロディックマイナーを弾くだけ。モダンジャズの必須語彙。Charlie Parker のビバップラインから Coltrane のシーツ・オブ・サウンドまで、ジャズ史を通じて最も重要なドミナント処理法。例えば G7alt 上では A♭ メロディックマイナーを弾く。♭9 と ♯9 を交互に使うと「泣き」のフレーズが作れる。Kurt Rosenwinkel, Mike Stern, John Scofield らモダンジャズギタリストの常套手段。V7→Imaj7 の解決で最大のカタルシスを生む。' },

  // ── Harmonic Minor modes ──
  { key: 'harmonic-minor', name: 'Harmonic Minor', semi: [0,2,3,5,7,8,11],
    chordSub: '1 ♭3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'mMaj7',
    description: 'ナチュラルマイナーの7度を ♯7 にしたスケール。♭6-♮7 間の増2度（1.5音）がアラビック/クラシカルな響きの源。マイナーキーでのドミナントモーション（V7→Im）を可能にするために生まれた、西洋音楽理論の要。バッハからジャズまで、マイナーキーの終止形は必ずこのスケールに立脚する。Django Reinhardt や Paco de Lucía のジプシー/フラメンコギターでもこの増2度が決定的な役割を果たす。♭6→♮7→Root の導音進行がマイナーキーの「解決感」の源泉。練習では ♭6-♮7 の増2度インターバルを各弦で弾き、指に馴染ませるのが先決。Melodic Minor と使い分けることで、マイナートニック上の表現力が倍増する。' },
  { key: 'phrygian-dom', name: 'Phrygian Dominant', semi: [0,1,4,5,7,8,10],
    chordSub: '1 3 5 ♭7 ♭9', chordDegreesIdx: [0,2,4,6,1], chordQuality: '7b9',
    description: 'ハーモニックマイナーの第5モード。♭9 を含むドミナントコード上で使用。マイナー II-V-I の V7♭9 で定番。フラメンコ（スパニッシュ・ジプシー）の響きそのもの。♭2-♮3 間の増2度がエキゾチシズムの核。覚え方は「解決先のマイナーキーのハーモニックマイナーをそのまま弾く」こと。例えば G7♭9→Cm なら C ハーモニックマイナーで OK。♭9→Root の半音解決が強烈なドラマを生む。Al Di Meola "Mediterranean Sundance" やジプシージャズの定番曲 "Minor Swing" にこの響きが満載。Altered スケールより「伝統的」で「地中海的」な色彩が欲しいときの選択肢。♮3 と ♭2 の増2度ジャンプを意識的にフレーズに入れると、一瞬でスパニッシュな空気になる。' },

  // ── Diminished (対称スケール — 8音) ──
  { key: 'dim-wh', name: 'Diminished W-H', semi: [0,2,3,5,6,8,9,11],
    chordSub: '1 ♭3 ♭5 ♭♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'dim',
    customDegrees: ['1','2','♭3','4','♭5','♭6','6','7'],
    description: '全音-半音の繰り返しで構成される8音対称スケール。dim7 コード上で使用。短3度ごとに同じパターンが繰り返されるため、実質3つの調性を同時に含む。パッシングトーンが豊富でクロマチックなラインが作りやすい。対称構造ゆえに、覚えるパターンが通常の1/3で済む——Root で覚えたフレーズは短3度（3フレット）上でそのまま使い回せる。Thelonious Monk がパッシングディミニッシュ（♯I°7, ♯II°7 など）で多用し、独特のアンギュラーなラインを生んだ。dim7→次のコードへのスムーズなボイスリーディングが特徴で、各音が半音か全音で解決できる。練習では3フレットごとの同一パターンのシフトを体に覚えさせると、指板全体を効率的にカバーできる。' },
  { key: 'dim-hw', name: 'Diminished H-W', semi: [0,1,3,4,6,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,3,5,7], chordQuality: '7',
    customDegrees: ['1','♭2','♭3','3','♭5','5','6','♭7'],
    description: '半音-全音の繰り返し。W-H の裏返しで、ドミナント7th コード上で使用。♭9, ♯9, ♯11, ♮13 の全テンションを含む。ビバップ期の Charlie Parker や Dizzy Gillespie が多用。ドミナント上での最も対称的な選択肢。8音スケールなので通常の7音モードより音の選択肢が多く、クロマチックに近い密度のラインが作れる。W-H Diminished と同じ対称性を持ち、3フレットずらすと同じパターンが出現する。Barry Harris メソッドでは dim7 コードとドミナント7th コードの関係性を軸にアドリブを構築する。♭9→♯9→3rd や ♯11→5th→♮13 のようなテンション・エンクロージャーが定番フレーズ。Altered スケールとの使い分けは、♮5 と ♮13 を含む（＝より「インサイド」）のがこちら。' },
];

export const ROOTS: { name: RootName; semitone: number }[] = [
  { name: 'C', semitone: 0 },
  { name: 'D♭', semitone: 1 },
  { name: 'D', semitone: 2 },
  { name: 'E♭', semitone: 3 },
  { name: 'E', semitone: 4 },
  { name: 'F', semitone: 5 },
  { name: 'G♭', semitone: 6 },
  { name: 'G', semitone: 7 },
  { name: 'A♭', semitone: 8 },
  { name: 'A', semitone: 9 },
  { name: 'B♭', semitone: 10 },
  { name: 'B', semitone: 11 },
];

/**
 * Pos 1 における各弦の開始度数 (standard tuning, 7-note diatonic scales).
 * 全 12 キー × 7 モードで不変であることを検証済み。
 */
export const STRING_DEG_OFFSETS = { e: 3, g: 5, d: 2, a: 6 } as const;

/** findClosestTrio でのBペア–トリオ間の最大フレットギャップ許容値 */
export const MAX_TRIO_GAP = 5;

export const POS_COLORS: string[] = [
  '#E74C3C', '#E67E22', '#E8336F', '#27AE60',
  '#6EAC00', '#8E44AD', '#16A085', '#2980B9',
];

export const MODE_COLORS: Record<string, string> = {
  // Diatonic (major scale modes)
  ionian: '#E74C3C', dorian: '#E67E22', phrygian: '#F1C40F', lydian: '#27AE60',
  mixolydian: '#2980B9', aeolian: '#8E44AD', locrian: '#16A085',
  // Melodic Minor modes
  'melodic-minor': '#E91E63', 'dorian-b2': '#FF5722', 'lydian-aug': '#CDDC39',
  'lydian-dom': '#4CAF50', 'mixolydian-b6': '#00BCD4', 'locrian-s2': '#9C27B0',
  'altered': '#FF9800',
  // Harmonic Minor modes
  'phrygian-dom': '#D2691E', 'harmonic-minor': '#D32F2F',
  // Diminished modes
  'dim-wh': '#78909C', 'dim-hw': '#90A4AE',
};
