// 神戸旅行（2026/10/31〜11/3）のテスト用データ
// 位置はおおよそ（テスト用）。営業時間は調べた時点の情報で、変わることがあります。

export const DATES = [
  { date: '2026-10-31', label: '10/31(土)', weekday: 6, holiday: false },
  { date: '2026-11-01', label: '11/1(日)', weekday: 0, holiday: false },
  { date: '2026-11-02', label: '11/2(月)', weekday: 1, holiday: false },
  { date: '2026-11-03', label: '11/3(火・祝)', weekday: 2, holiday: true },
];

export const SHIN_KOBE = { name: '新神戸駅', lat: 34.7066, lng: 135.1955 };

// 宿の候補（タップで選べる。検索で好きな宿も選べる）
export const HOTELS = [
  { name: '三宮のホテル', lat: 34.6936, lng: 135.1955 },
  { name: '有馬温泉の旅館', lat: 34.7976, lng: 135.2470 },
  { name: '新神戸のホテル', lat: 34.7066, lng: 135.1950 },
  { name: 'ハーバーランドのホテル', lat: 34.6795, lng: 135.1830 },
];
// 宿が未定の日は、三宮あたりに仮置きして計算する
export const HOTEL_TBD = { name: '宿（未定・三宮あたりで仮置き）', lat: 34.6936, lng: 135.1955, tbd: true };

export const DEFAULT_TRIP = {
  mode: 'train',
  hotels: [null, null, null],          // 1泊目〜3泊目
  starts: ['12:15', '9:00', '9:00', '9:00'],  // 各日の出発時刻（10/31は新神戸着）
  ends: ['21:00', '21:00', '21:00', '16:45'], // 各日の終わり（11/3は新幹線の15分前）
};

// 候補（タップで登録フォームに入る）
const C = (id, name, lat, lng, extra) => ({ id, name, lat, lng, stay: 60, priority: 'must', ...(extra || {}) });
export const CANDIDATES = [
  C('arima', '有馬温泉（金の湯）', 34.7973, 135.2478, {
    stay: 120, open: '8:00', until: '21:30', closedRule: { weekdays: [2], nth: [2, 4], holidayShift: true },
    note: '金の湯 8:00〜22:00（最終入館21:30）・第2/第4火曜休み。三宮から神戸電鉄で約30分',
  }),
  C('tottei', 'TOTTEI KOBE（新港第2突堤）', 34.6860, 135.1985, {
    stay: 60, note: '公園・散策は無料。アリーナや飲食は店・イベントごとに時間が違う。三宮から徒歩約20分',
  }),
  C('sumaura', '須磨浦山上遊園', 34.6405, 135.1005, {
    stay: 120, open: '10:00', until: '16:00', closedRule: { weekdays: [2], holidayOpen: true },
    note: '10:00〜17:00・火曜休み（祝日は営業）。山陽電鉄 須磨浦公園駅からロープウェイ',
  }),
  C('dinner', '神戸牛ディナー（予約・三宮）', 34.6930, 135.1940, { stay: 90, at: '18:30', note: '例：予約の時間が決まっている夕食' }),
  C('kitano', '北野異人館街', 34.7010, 135.1905, { stay: 90, priority: 'maybe' }),
  C('nankinmachi', '南京町', 34.6880, 135.1878, { stay: 60, priority: 'maybe' }),
  C('meriken', 'メリケンパーク（BE KOBE）', 34.6823, 135.1888, { stay: 40, priority: 'maybe' }),
  C('harborland', '神戸ハーバーランド umie', 34.6793, 135.1832, { stay: 90, priority: 'maybe' }),
  C('nunobiki', '布引ハーブ園', 34.7083, 135.1924, { stay: 90, priority: 'maybe' }),
  C('rokko', '六甲ガーデンテラス', 34.7613, 135.2463, { stay: 90, priority: 'maybe' }),
];

const pick = (ids, patch) => ids.map((id) => ({ ...CANDIDATES.find((c) => c.id === id), ...((patch && patch[id]) || {}) }));

// シナリオ：どれも「同じ神戸旅行」。ステップごとに「やること」と「確かめたいこと」
export const SCENARIOS = [
  {
    id: 'k1', title: '① 行きたい場所を登録する',
    start: () => [],
    steps: [
      { do: '「場所を登録」の候補から「有馬温泉」をタップして登録する。何日目は決めても、未定のままでもOK', check: '登録の画面は分かりやすかった？' },
      { do: '「TOTTEI KOBE」と「須磨浦山上遊園」も登録する', check: 'アプリが自動で入れた日に、納得できる？' },
      { do: '違うと思った場所の「何日目」を、一覧の中で変える', check: '直し方は分かりやすかった？' },
    ],
  },
  {
    id: 'k2', title: '② 宿を決める',
    start: () => pick(['arima', 'tottei', 'sumaura']),
    steps: [
      { do: '各日の一番下にある「宿」の行で、「宿を選ぶ」から1泊目・2泊目・3泊目の宿を選ぶ（検索でもOK）', check: '宿の選び方は分かりやすかった？' },
      { do: '11/1(日)の宿を「有馬温泉の旅館」にする', check: '有馬温泉に行く日が、宿に合わせて変わった？' },
    ],
  },
  {
    id: 'k3', title: '③ 1日の始まりと終わりを変える',
    start: () => pick(['arima', 'tottei', 'sumaura']),
    steps: [
      { do: '各日の「出発」と「宿に着く」の行を見る', check: 'その日がいつ・どこから始まって、いつ・どこで終わるか分かる？' },
      { do: '11/1(日)の出発を10:30に、宿に着く時刻を18:00に変える', check: '予定がその時間の中に収まるように組み直された？' },
    ],
  },
  {
    id: 'k4', title: '④ 時間の決まった予定・行けたらの場所を足す',
    start: () => pick(['arima', 'tottei', 'sumaura']),
    steps: [
      { do: '候補の「神戸牛ディナー（予約・三宮）」を、11/1(日)・18:30で登録する', check: '11/1のほかの場所が、夕食の前にうまく収まった？' },
      { do: '「行けたら」の候補（北野異人館街・南京町など）を5か所以上登録する', check: '回りきれない場所が「見送り候補」に分かれた？分かれ方は納得できる？' },
    ],
  },
  {
    id: 'k5', title: '⑤ 旅行当日（11/1）に予定が変わった',
    start: () => pick(['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken', 'harborland'], { dinner: { day: 1 } }),
    tripMode: { today: 1, now: '14:00' },
    steps: [
      { do: '地図をタップして「今いる場所」を決める（または「本物の現在地」）', check: '次の目的地・方角・距離の表示は役に立ちそう？' },
      { do: '1か所を「中止」にして、「今いる場所から並べ直す」を押す', check: '残りの順番に納得できる？' },
    ],
  },
];

// 定休日のルールから、旅の何日目が休みかを出す
export function closedDays(rule) {
  if (!rule) return [];
  const out = [];
  DATES.forEach((d, i) => {
    if (!rule.weekdays.includes(d.weekday)) return;
    const nth = Math.floor((Number(d.date.slice(8)) - 1) / 7) + 1;
    if (rule.nth && !rule.nth.includes(nth)) return;
    if ((rule.holidayOpen || rule.holidayShift) && d.holiday) return;
    out.push(i);
  });
  return out;
}
