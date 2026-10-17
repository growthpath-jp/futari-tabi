// テスト用のシナリオ（場所の位置は実在のおおよその位置）
const P = (id, name, lat, lng, extra) => ({ id, name, lat, lng, stay: 60, priority: 'must', ...(extra || {}) });

const KYOTO_STATION = { name: '京都駅', lat: 34.9858, lng: 135.7588 };
const KYOTO_HOTEL = { name: '宿（四条烏丸）', lat: 35.0037, lng: 135.7597 };

export const SCENARIOS = [
  {
    id: 's1',
    title: '① 京都2泊3日・ふつうの旅',
    mode: 'train',
    goal: '行きたい場所を15か所ためただけの状態で、3日間にどう振り分けられると「しっくり」くるか。',
    steps: [
      '決め方A・B・Cを切り替えて、3日間の分かれ方を見比べる',
      '「この場所は2日目がいい」と思う場所を1つ、別の日へ移す',
      '移したあと、ほかの場所がどう動いたか（動かなかったか）を見る',
      '1日の中の順番を、長押しドラッグか↑↓で1か所入れ替えてみる',
    ],
    days: [
      { label: '1日目', start: KYOTO_STATION, end: KYOTO_HOTEL, startTime: '10:00', endTime: '19:00' },
      { label: '2日目', start: KYOTO_HOTEL, end: KYOTO_HOTEL, startTime: '9:00', endTime: '19:00' },
      { label: '3日目', start: KYOTO_HOTEL, end: KYOTO_STATION, startTime: '9:00', endTime: '17:00' },
    ],
    places: [
      P('kiyomizu', '清水寺', 34.9949, 135.7850, { stay: 75 }),
      P('yasaka', '八坂神社', 35.0037, 135.7785, { stay: 30 }),
      P('gion', '祇園白川', 35.0058, 135.7745, { stay: 30 }),
      P('nishiki', '錦市場', 35.0050, 135.7647, { stay: 60 }),
      P('fushimi', '伏見稲荷大社', 34.9671, 135.7727, { stay: 90 }),
      P('tofukuji', '東福寺', 34.9767, 135.7738, { stay: 45 }),
      P('sanjusan', '三十三間堂', 34.9879, 135.7718, { stay: 45 }),
      P('ginkaku', '銀閣寺', 35.0270, 135.7982, { stay: 50 }),
      P('tetsugaku', '哲学の道', 35.0230, 135.7940, { stay: 40 }),
      P('nanzenji', '南禅寺', 35.0113, 135.7944, { stay: 50 }),
      P('kinkaku', '金閣寺', 35.0394, 135.7292, { stay: 50 }),
      P('ryoanji', '龍安寺', 35.0345, 135.7183, { stay: 40 }),
      P('chikurin', '嵐山 竹林の小径', 35.0170, 135.6713, { stay: 40 }),
      P('togetsu', '渡月橋', 35.0129, 135.6778, { stay: 30 }),
      P('nijo', '二条城', 35.0142, 135.7481, { stay: 70 }),
    ],
  },
  {
    id: 's2',
    title: '② 予約や時間の決まった予定がある',
    mode: 'train',
    goal: '「12時ランチ予約」「伏見稲荷は朝7時（混む前）」「金閣寺は17時まで」があるとき、その時刻を守った順番になっているか。',
    steps: [
      '時刻つきの場所（🕐の印）が、その時刻に合う位置に来ているか見る',
      '予約のある日に、ほかの場所を2か所移して、予約に遅れる表示が出るか見る',
      '「遅れます」が出たとき、どう直したくなるかを感じる',
    ],
    days: [
      { label: '1日目', start: KYOTO_STATION, end: KYOTO_HOTEL, startTime: '9:30', endTime: '19:00' },
      { label: '2日目', start: KYOTO_HOTEL, end: KYOTO_STATION, startTime: '6:30', endTime: '17:00' },
    ],
    places: [
      P('ponto', '先斗町ランチ（予約）', 35.0067, 135.7707, { stay: 75, day: 0, at: '12:00' }),
      P('fushimi', '伏見稲荷大社（朝の空いている時間）', 34.9671, 135.7727, { stay: 90, day: 1, at: '7:00' }),
      P('kinkaku', '金閣寺', 35.0394, 135.7292, { stay: 50, until: '16:30', note: '17:00閉門・最終受付16:30' }),
      P('kiyomizu', '清水寺', 34.9949, 135.7850, { stay: 75 }),
      P('yasaka', '八坂神社', 35.0037, 135.7785, { stay: 30 }),
      P('nishiki', '錦市場', 35.0050, 135.7647, { stay: 60, until: '17:00', note: '夕方に閉まる店が多い' }),
      P('tofukuji', '東福寺', 34.9767, 135.7738, { stay: 45 }),
      P('ryoanji', '龍安寺', 35.0345, 135.7183, { stay: 40 }),
      P('nijo', '二条城', 35.0142, 135.7481, { stay: 70, until: '16:00', note: '最終入城16:00' }),
      P('kamo', '鴨川デルタ', 35.0300, 135.7720, { stay: 30 }),
    ],
  },
  {
    id: 's3',
    title: '③ 宿が毎日かわる旅（北海道）',
    mode: 'train',
    goal: '札幌→小樽→函館と宿が移るとき、その日の宿の近くの場所が、その日に入るか。',
    steps: [
      '各日に、その日の宿の近くの場所が入っているか地図で見る',
      '函館の場所を1つ、わざと1日目に移してみる（無理な予定になる表示を見る）',
      '移動手段を「車」に変えて、回れる量が変わるか見る',
    ],
    days: [
      { label: '1日目', start: { name: '札幌駅', lat: 43.0687, lng: 141.3508 }, end: { name: '宿（札幌）', lat: 43.0556, lng: 141.3526 }, startTime: '11:00', endTime: '20:00' },
      { label: '2日目', start: { name: '宿（札幌）', lat: 43.0556, lng: 141.3526 }, end: { name: '宿（小樽）', lat: 43.1979, lng: 140.9937 }, startTime: '9:00', endTime: '20:00' },
      { label: '3日目', start: { name: '宿（小樽）', lat: 43.1979, lng: 140.9937 }, end: { name: '宿（函館）', lat: 41.7737, lng: 140.7266 }, startTime: '8:00', endTime: '21:00' },
    ],
    places: [
      P('odori', '大通公園', 43.0598, 141.3462, { stay: 40 }),
      P('tokei', '札幌市時計台', 43.0626, 141.3536, { stay: 25 }),
      P('nijo-ichiba', '二条市場', 43.0570, 141.3590, { stay: 45 }),
      P('hokudai', '北海道大学', 43.0718, 141.3410, { stay: 60 }),
      P('unga', '小樽運河', 43.1990, 141.0010, { stay: 40 }),
      P('sakaimachi', '堺町通り', 43.1919, 141.0051, { stay: 60 }),
      P('tengu', '天狗山', 43.1757, 140.9807, { stay: 60, priority: 'maybe' }),
      P('hakodateyama', '函館山（夜景）', 41.7589, 140.7044, { stay: 60, at: '19:30' }),
      P('goryokaku', '五稜郭', 41.7969, 140.7570, { stay: 60, priority: 'maybe' }),
      P('akarenga', '金森赤レンガ倉庫', 41.7676, 140.7172, { stay: 45 }),
    ],
  },
  {
    id: 's4',
    title: '④ 行きたい場所が多すぎる（日帰り）',
    mode: 'walk',
    goal: '1日で回りきれない量のとき、「行けたら」の場所がうまく見送られるか。見送りの見せ方がしっくりくるか。',
    steps: [
      '「見送り候補」に何が入ったか見る',
      '見送り候補を1つ、手で1日の中に入れてみる（何が押し出されるか見る）',
      '「絶対」と「行けたら」を切り替えてみる',
    ],
    days: [
      { label: '日帰り', start: KYOTO_STATION, end: KYOTO_STATION, startTime: '9:00', endTime: '18:00' },
    ],
    places: [
      P('kiyomizu', '清水寺', 34.9949, 135.7850, { stay: 75 }),
      P('ninenzaka', '二年坂・三年坂', 34.9978, 135.7808, { stay: 40 }),
      P('yasaka', '八坂神社', 35.0037, 135.7785, { stay: 30 }),
      P('gion', '祇園白川', 35.0058, 135.7745, { stay: 30, priority: 'maybe' }),
      P('kenninji', '建仁寺', 35.0005, 135.7738, { stay: 45, priority: 'maybe' }),
      P('nishiki', '錦市場', 35.0050, 135.7647, { stay: 60 }),
      P('sanjusan', '三十三間堂', 34.9879, 135.7718, { stay: 45 }),
      P('nanzenji', '南禅寺', 35.0113, 135.7944, { stay: 50, priority: 'maybe' }),
      P('heian', '平安神宮', 35.0160, 135.7824, { stay: 40, priority: 'maybe' }),
      P('chionin', '知恩院', 35.0057, 135.7832, { stay: 40, priority: 'maybe' }),
      P('kodaiji', '高台寺', 35.0005, 135.7810, { stay: 45, priority: 'maybe' }),
      P('pontocho', '先斗町を散歩', 35.0067, 135.7707, { stay: 30, priority: 'maybe' }),
    ],
  },
  {
    id: 's5',
    title: '⑤ 旅行当日・予定が変わった',
    mode: 'train',
    goal: '雨で嵐山をやめた／思ったより時間がかかった時に、「今いる場所から並べ直す」で納得できる順番になるか。旅行中モードの表示が役に立つか。',
    steps: [
      '「旅行中モード」をオンにする（現在地は地図をタップして決められます）',
      '時刻を13:00にし、錦市場あたりをタップして「ここにいる」にする',
      '「嵐山 竹林の小径」を「中止」にする',
      '「今いる場所から並べ直す」を押して、残りの順番と次の目的地を見る',
    ],
    trip: true,
    days: [
      { label: '今日', start: KYOTO_HOTEL, end: KYOTO_STATION, startTime: '9:00', endTime: '18:30' },
    ],
    places: [
      P('kiyomizu', '清水寺', 34.9949, 135.7850, { stay: 75, done: true }),
      P('yasaka', '八坂神社', 35.0037, 135.7785, { stay: 30, done: true }),
      P('nishiki', '錦市場', 35.0050, 135.7647, { stay: 60 }),
      P('chikurin', '嵐山 竹林の小径', 35.0170, 135.6713, { stay: 40 }),
      P('togetsu', '渡月橋', 35.0129, 135.6778, { stay: 30 }),
      P('kinkaku', '金閣寺', 35.0394, 135.7292, { stay: 50, until: '16:30' }),
      P('nijo', '二条城', 35.0142, 135.7481, { stay: 70, until: '16:00' }),
      P('kamo', '鴨川デルタ', 35.0300, 135.7720, { stay: 30, priority: 'maybe' }),
    ],
  },
];

export const METHODS = {
  A: { label: 'A', title: 'おまかせ＋移した場所は固定', desc: '自動で日に振り分け。手で別の日へ移した場所はその日に固定し、ほかの場所は自動で並び直す。' },
  B: { label: 'B', title: '自分で日を選ぶ', desc: '場所ごとに自分で「何日目」を選ぶ。日の中の順番は自動。まだ選んでいない場所は「未定」に残る。' },
  C: { label: 'C', title: 'おまかせ＋ほかは動かさない', desc: '最初に自動で振り分けたら、あとは手で移した場所だけが動く。ほかの場所の日と順番はそのまま。' },
};
