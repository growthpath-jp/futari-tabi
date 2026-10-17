// 神戸旅行（2026/10/31〜11/3）のテスト用データ
// 位置はおおよそ（テスト用）。営業時間は調べた時点の情報で、変わることがあります。

export const DATES = [
  { date: '2026-10-31', label: '10/31(土)', weekday: 6, holiday: false },
  { date: '2026-11-01', label: '11/1(日)', weekday: 0, holiday: false },
  { date: '2026-11-02', label: '11/2(月)', weekday: 1, holiday: false },
  { date: '2026-11-03', label: '11/3(火・祝)', weekday: 2, holiday: true },
];

export const SHIN_KOBE = { name: '新神戸駅', lat: 34.7066, lng: 135.1955 };

export const BASES = {
  sannomiya: { name: '宿（三宮）', lat: 34.6936, lng: 135.1955 },
  arima: { name: '宿（有馬温泉）', lat: 34.7976, lng: 135.2470 },
  shinkobe: { name: '宿（新神戸）', lat: 34.7066, lng: 135.1950 },
  harbor: { name: '宿（ハーバーランド）', lat: 34.6795, lng: 135.1830 },
};

export const DEFAULT_TRIP = { arrive: '12:15', depart: '17:00', nights: ['sannomiya', 'sannomiya', 'sannomiya'], mode: 'train' };

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

// シナリオ：どれも「同じ神戸旅行」で、始める時点の状態が違う
export const SCENARIOS = [
  {
    id: 'k1',
    title: '① 必ず行く3か所を登録する',
    goal: '登録するときに「何日目」「何時」をどこまで決めたいか。決めなかった場所の振り分けが、しっくりくるか。',
    steps: [
      '「有馬温泉」を候補からタップ → 何日目に行きたいか決まっていれば選び、決まっていなければ「未定」のまま登録',
      '「TOTTEI KOBE」「須磨浦山上遊園」も登録（何日目は好きに）',
      '4日間にどう入ったかを地図と一覧で見る',
      '違うと思う所を直す（何日目を変える・↑↓・ドラッグ）',
    ],
    start: () => [],
  },
  {
    id: 'k2',
    title: '② 時間の決まった予定を足す',
    goal: '予約のように時刻が決まった予定を登録したとき、その時刻を中心に1日が組まれるか。',
    steps: [
      '候補の「神戸牛ディナー（予約・三宮）」をタップ',
      '何日目を「11/1(日)」、時刻を18:30にして登録',
      '11/1のほかの場所が、夕食に間に合う順番になっているか見る',
      'わざと夕食の時刻を17:00に変えて、どう変わるか見る',
    ],
    start: () => pick(['arima', 'tottei', 'sumaura']),
  },
  {
    id: 'k3',
    title: '③ 「行けたら」の場所をたくさん足す',
    goal: '回りきれないほど足したとき、「行けたら」の場所がうまく後回し（見送り候補）になるか。',
    steps: [
      '候補の「行けたら」の場所（北野異人館街・南京町など）を5か所以上登録',
      '各日に何が入り、何が「見送り候補」になったか見る',
      '見送り候補を1つ「この日に入れる」で入れてみる',
    ],
    start: () => pick(['arima', 'tottei', 'sumaura', 'dinner'], { dinner: { day: 1 } }),
  },
  {
    id: 'k4',
    title: '④ 宿を変えてみる',
    goal: '2泊目を有馬温泉にしたら、有馬に行く日が自然に変わるか。宿の決め方がしっくりくるか。',
    steps: [
      '「旅の設定」で2泊目の宿を「有馬温泉」に変える',
      '有馬温泉が何日目に入ったか、ほかの場所がどう動いたか見る',
      '1泊目を有馬温泉にした場合とも比べる',
    ],
    start: () => pick(['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken'], { dinner: { day: 1 } }),
  },
  {
    id: 'k5',
    title: '⑤ 旅行当日（11/1）に予定が変わった',
    goal: '旅先で予定がずれたとき、「今いる場所から並べ直す」と次の目的地の表示が役に立つか。',
    steps: [
      '「旅行中モード」をオンにして、今日を11/1、時刻を14:00にする',
      '地図をタップして今いる場所を決める（または「本物の現在地」）',
      '1か所を「中止」にして「今いる場所から並べ直す」を押す',
      '次の目的地の方角・距離と、Googleマップの道案内を確かめる',
    ],
    start: () => pick(['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken', 'harborland'], { dinner: { day: 1 } }),
    tripMode: { today: 1, now: '14:00' },
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
