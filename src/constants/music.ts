import type { ModeTemplate, RootName } from '../types';

export const OPEN_STRINGS: number[] = [4, 11, 7, 2, 9, 4]; // 1E, 2B, 3G, 4D, 5A, 6E

export const STR_LABELS: string[] = ['e', 'B', 'G', 'D', 'A', 'E'];

export const MODE_TEMPLATES: ModeTemplate[] = [
  { key: 'ionian', name: 'Ionian', semi: [0,2,4,5,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7',
    description: 'メジャースケールそのもの。明るく安定した響きで、Imaj7 上の最も基本的な選択肢。ジャズではトニックの安定感を出したいときに使う。♯11 のテンションを避けたい場面（4th がアヴォイドノート）では Lydian より安全。' },
  { key: 'dorian', name: 'Dorian', semi: [0,2,3,5,7,9,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: 'ジャズで最も多用されるマイナーモード。♭3 と ♮6 の共存が都会的な哀愁を生む。IIm7 はもちろん、マイナー・トニックにも頻出。Miles Davis "So What" の D Dorian が有名。Aeolian より明るく、Phrygian より柔らかい。' },
  { key: 'phrygian', name: 'Phrygian', semi: [0,1,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: '♭2 が生むエキゾチックで暗い響き。フラメンコやスパニッシュ音楽の基盤。ジャズでは IIIm7 や sus♭9 コード上で使われる。John Coltrane が好んで使った。♭2 のアプローチが独特の緊張感を生む。' },
  { key: 'lydian', name: 'Lydian', semi: [0,2,4,6,7,9,11],
    chordSub: '1 3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'maj7',
    description: '♯4 が浮遊感と輝きを生むメジャーモード。IVmaj7 の定番だが、Imaj7 でもアヴォイドノートなしで使える万能スケール。映画音楽（John Williams）でも多用。Ionian の4度が ♯4 に変わっただけで世界が一変する。' },
  { key: 'mixolydian', name: 'Mixolydian', semi: [0,2,4,5,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7',
    description: 'ドミナント7th の基本スケール。♭7 がブルージーな色を加える。V7 での第一選択肢。ブルース、ファンク、ロックでも頻出。テンションを加えずストレートに弾くと、最もブルース的なドミナントサウンドが出る。' },
  { key: 'aeolian', name: 'Aeolian', semi: [0,2,3,5,7,8,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: 'ナチュラルマイナースケール。♭6 が暗く内省的な雰囲気を作る。Dorian より暗い。ポップスやロックのマイナーキーで最も一般的。ジャズでは VIm7 や、♭6 の響きを活かしたいマイナー・トニックで使う。' },
  { key: 'locrian', name: 'Locrian', semi: [0,1,3,5,6,8,10],
    chordSub: '1 ♭3 ♭5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7♭5',
    description: '♭2 と ♭5 を持つ最も不安定なダイアトニックモード。m7♭5（ハーフディミニッシュ）コード上で使用。マイナー II-V-I の IIm7♭5 で頻出するが、♭2 がアヴォイドになりやすく、実際は Locrian ♯2 が好まれることも多い。' },

  // ── Melodic Minor modes ──
  { key: 'melodic-minor', name: 'Melodic Minor', semi: [0,2,3,5,7,9,11],
    chordSub: '1 ♭3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'mMaj7',
    description: 'マイナーでありながら ♮6 と ♮7 を持つ独特のスケール。mMaj7 コードの響きはミステリアスで映画音楽的。ジャズではクラシカルな上行形ではなく、上下行とも同じ音列で使う（ジャズ・メロディックマイナー）。' },
  { key: 'dorian-b2', name: 'Dorian ♭2', semi: [0,1,3,5,7,9,10],
    chordSub: '1 ♭3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7',
    description: 'Phrygian に ♮6 を加えた響き。メロディックマイナーの第2モード。Phrygian のエキゾチックさと Dorian の洗練を併せ持つ。sus♭9 コードや、インドのラーガ的なサウンドにも通じる。別名 Phrygian ♯6。' },
  { key: 'lydian-aug', name: 'Lydian Augmented', semi: [0,2,4,6,8,9,11],
    chordSub: '1 3 #5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'aug',
    description: 'Lydian の5度が ♯5 に。♯4 と ♯5 が極めて浮遊感のある響きを生む。augMaj7 コード上で使用。メロディックマイナーの第3モード。日常的に使う場面は少ないが、独特の色彩が欲しいときに効果的。' },
  { key: 'lydian-dom', name: 'Lydian Dominant', semi: [0,2,4,6,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7#11',
    description: 'Lydian の7度を ♭7 にしたドミナント系スケール。♯11 テンションが特徴で、トライトーン・サブスティテューション（裏コード）の定番。Mixolydian に飽きたドミナントに新鮮な色を加える。Bartók スケールとも呼ばれる。' },
  { key: 'mixolydian-b6', name: 'Mixolydian ♭6', semi: [0,2,4,5,7,8,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: '7b13',
    description: 'Mixolydian の6度が ♭6 に。メロディックマイナーの第5モード。♭13 テンションを持つドミナントコードに使用。マイナーキーへ解決する V7 で特に有効。Hindu スケールとも呼ばれ、エキゾチックな陰りがある。' },
  { key: 'locrian-s2', name: 'Locrian ♯2', semi: [0,2,3,5,6,8,10],
    chordSub: '1 ♭3 ♭5 ♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'm7♭5',
    description: 'Locrian の ♭2 を ♮2 にして安定性を向上。m7♭5 コード上の最も実用的な選択肢。マイナー II-V-I の IIm7♭5 で、Locrian より ♮2 が自然に響く。メロディックマイナーの第6モード。' },
  { key: 'altered', name: 'Altered', semi: [0,1,3,4,6,8,10],
    chordSub: '1 3 ♭5 ♭7', chordDegreesIdx: [0,3,4,6], chordQuality: '7alt',
    description: '全てのテンションが変化した究極のドミナントスケール（♭9, ♯9, ♭5/♯11, ♯5/♭13）。V7alt で強烈な緊張→解決を作る。メロディックマイナーの第7モード＝半音上のメロディックマイナーを弾くだけ。モダンジャズの必須語彙。' },

  // ── Harmonic Minor modes ──
  { key: 'harmonic-minor', name: 'Harmonic Minor', semi: [0,2,3,5,7,8,11],
    chordSub: '1 ♭3 5 7', chordDegreesIdx: [0,2,4,6], chordQuality: 'mMaj7',
    description: 'ナチュラルマイナーの7度を ♯7 にしたスケール。♭6-♮7 間の増2度（1.5音）がアラビック/クラシカルな響きの源。マイナーキーでのドミナントモーション（V7→Im）を可能にするために生まれた、西洋音楽理論の要。' },
  { key: 'phrygian-dom', name: 'Phrygian Dominant', semi: [0,1,4,5,7,8,10],
    chordSub: '1 3 5 ♭7 ♭9', chordDegreesIdx: [0,2,4,6,1], chordQuality: '7b9',
    description: 'ハーモニックマイナーの第5モード。♭9 を含むドミナントコード上で使用。マイナー II-V-I の V7♭9 で定番。フラメンコ（スパニッシュ・ジプシー）の響きそのもの。♭2-♮3 間の増2度がエキゾチシズムの核。' },

  // ── Diminished (対称スケール — 8音) ──
  { key: 'dim-wh', name: 'Diminished W-H', semi: [0,2,3,5,6,8,9,11],
    chordSub: '1 ♭3 ♭5 ♭♭7', chordDegreesIdx: [0,2,4,6], chordQuality: 'dim',
    customDegrees: ['1','2','♭3','4','♭5','♭6','6','7'],
    description: '全音-半音の繰り返しで構成される8音対称スケール。dim7 コード上で使用。短3度ごとに同じパターンが繰り返されるため、実質3つの調性を同時に含む。パッシングトーンが豊富でクロマチックなラインが作りやすい。' },
  { key: 'dim-hw', name: 'Diminished H-W', semi: [0,1,3,4,6,7,9,10],
    chordSub: '1 3 5 ♭7', chordDegreesIdx: [0,3,5,7], chordQuality: '7',
    customDegrees: ['1','♭2','♭3','3','♭5','5','6','♭7'],
    description: '半音-全音の繰り返し。W-H の裏返しで、ドミナント7th コード上で使用。♭9, ♯9, ♯11, ♮13 の全テンションを含む。ビバップ期の Charlie Parker や Dizzy Gillespie が多用。ドミナント上での最も対称的な選択肢。' },
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
