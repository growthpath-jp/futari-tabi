// お試しモードの見本：神戸旅行（2026/10/31〜11/3）と、試すためのシナリオ
// 位置はおおよそ。営業時間・チェックイン時刻は調べた時点の目安（実際は公式・予約内容で確認）

export const KOBE_TRIP_ID = 'demo-kobe';

const SHIN_KOBE = { name: '新神戸駅', lat: 34.7066, lng: 135.1955, via: '新幹線' };
export const HOTEL_ERA = { name: 'コンフォートホテルERA神戸三宮', address: '兵庫県神戸市中央区雲井通4丁目2-10', lat: 34.6951, lng: 135.1986 };
export const HOTEL_KOYOKAKU = { name: '兵衛向陽閣', address: '兵庫県神戸市北区有馬町1904', lat: 34.7978, lng: 135.2468 };

export const kobeTrip = (group) => ({
  id: KOBE_TRIP_ID, group_id: group, title: '神戸旅行', start_date: '2026-10-31', end_date: '2026-11-03', closed: false, created_at: '2026-10-17T00:00:00Z',
  plan: basePlan(),
});

// 旅の始まり・終わりだけ決まっている状態（宿はまだ）
export function basePlan() {
  return {
    mode: 'train',
    arrive: { ...SHIN_KOBE, time: '12:29' },
    leave: { ...SHIN_KOBE, time: '17:00' },
    nights: [{ status: 'tbd' }, { status: 'tbd' }, { status: 'tbd' }],
    starts: [null, '9:00', '9:00', '9:00'],
    manual: {},
  };
}
// 実際の予約に近い宿の状態（1泊目ERA、2泊目 兵衛向陽閣、3泊目は当日探す）
export function bookedPlan() {
  const p = basePlan();
  p.nights = [
    { status: 'booked', hotel: { ...HOTEL_ERA }, checkin: '15:00', lastIn: '24:00', checkout: '12:00' },
    { status: 'booked', hotel: { ...HOTEL_KOYOKAKU }, checkin: '15:00', lastIn: '21:00', checkout: '11:00' },
    { status: 'free', hotel: null, checkin: '15:00', lastIn: '22:00', checkout: '11:00' },
  ];
  return p;
}

// 場所の見本（plan は「予定の条件」）
const PLACES = {
  arima: { name: '有馬温泉 金の湯', address: '兵庫県神戸市北区有馬町833', lat: 34.7973, lng: 135.2478, note: '8:00〜22:00（最終入館21:30）・第2/第4火曜休み',
    plan: { stay: 120, open: '8:00', until: '21:30', closed: { weekdays: [2], nth: [2, 4], holidayOpen: true } } },
  tottei: { name: 'TOTTEI KOBE', lat: 34.6860, lng: 135.1985, plan: { stay: 60 } },
  sumaura: { name: '須磨浦山上遊園', lat: 34.6405, lng: 135.1005, note: '10:00〜17:00・火曜休み（祝日は営業）',
    plan: { stay: 120, open: '10:00', until: '16:00', closed: { weekdays: [2], holidayOpen: true } } },
  atoa: { name: 'atoa', lat: 34.6878, lng: 135.1958, note: '10:00〜20:00（最終入館19:00）', plan: { stay: 120, open: '10:00', until: '19:00' } },
  dinner: { name: '神戸牛ディナー（予約）', lat: 34.6930, lng: 135.1940, plan: { stay: 90, at: '18:30', day: 1 } },
  kitano: { name: '北野異人館街', lat: 34.7010, lng: 135.1905, plan: { stay: 90, priority: 'maybe' } },
  nankinmachi: { name: '南京町', lat: 34.6880, lng: 135.1878, plan: { stay: 60, priority: 'maybe' } },
  meriken: { name: 'メリケンパーク', lat: 34.6823, lng: 135.1888, plan: { stay: 40, priority: 'maybe' } },
  harborland: { name: '神戸ハーバーランド umie', lat: 34.6793, lng: 135.1832, plan: { stay: 90, priority: 'maybe' } },
};
export const kobePlaces = (ids) => ids.map((id, i) => ({
  trip_id: KOBE_TRIP_ID, address: '', source: 'name', status: 'want', registered_at: `2026-10-17T00:0${i}:00Z`, ...PLACES[id], plan: { ...PLACES[id].plan },
}));

// 試すためのシナリオ。各ステップ：やりたいこと → こう操作する → こうなる（確かめる）
export const GUIDE = [
  {
    id: 'g1', title: '① 行きたい場所を登録する',
    setup: () => ({ plan: basePlan(), places: [] }),
    steps: [
      { want: '行きたい場所を、日を決めずに登録したい', how: '「場所を登録」に「有馬温泉」と入れて「探す」→ 候補を選ぶ →「何日目」は未定のまま「登録する」', then: '「予定」に有馬温泉が出て、アプリが日と時刻を入れる' },
      { want: 'ほかの場所も登録したい', how: '同じように「TOTTEI KOBE」「須磨浦山上遊園」を登録する', then: '移動が少なくなるように、日と順番が自動で決まる' },
      { want: '日を自分で決めたい', how: '場所の行の「何日目」を変える', then: 'その日に移り、その日の順番が組み直される' },
    ],
  },
  {
    id: 'g2', title: '② 宿を決める',
    setup: () => ({ plan: basePlan(), places: kobePlaces(['arima', 'tottei', 'sumaura']) }),
    steps: [
      { want: '予約した宿を入れたい', how: '10/31の一番下「宿」で「予約済み」を押す → 宿の名前（見つからなければ住所「兵庫県神戸市中央区雲井通4丁目2-10」）で探して選ぶ', then: '宿の行に宿の名前と「チェックイン 15:00〜」が出る。11/1の「出発」にチェックアウトの時刻が出る' },
      { want: '有馬の旅館に泊まる日に、有馬温泉を回したい', how: '11/1の宿を「兵衛向陽閣」（住所「兵庫県神戸市北区有馬町1904」）にする →「おまかせの日を組み直す」を押す', then: '宿を変えただけでは日は変わらない。押すと有馬温泉が11/1か11/2に移る' },
      { want: '11/2の夜は宿を予約せず、当日探したい', how: '11/2の「宿」で「当日探す」を押す', then: '11/2は最後の場所で1日が終わり、11/3はその近くから始まる' },
    ],
  },
  {
    id: 'g3', title: '③ 旅の始まり・宿の時間を変える',
    setup: () => ({ plan: bookedPlan(), places: kobePlaces(['arima', 'tottei', 'sumaura']) }),
    steps: [
      { want: '着く時刻を変えたい（新幹線を変えた）', how: '10/31の「到着」の時刻を変える', then: '10/31の予定がその時刻から組み直される' },
      { want: '宿に早めに着きたい', how: '11/1の宿（兵衛向陽閣）の「チェックイン 〜まで」を18:00にする', then: '18:00までに着けるように組み直される。無理なときは赤字で知らせる' },
      { want: '朝ゆっくりしたい', how: '11/2の「出発」をチェックアウト（11:00）より遅くする', then: '「チェックアウトを過ぎています」と注意が出る' },
    ],
  },
  {
    id: 'g4', title: '④ 時間の決まった予定・行けたらの場所',
    setup: () => ({ plan: bookedPlan(), places: kobePlaces(['arima', 'tottei', 'sumaura']) }),
    steps: [
      { want: 'ライブの時間に合わせたい', how: '「GLION ARENA KOBE」を探して、何日目「10/31」、何時に行く「18:00」、いる時間「3時間」で登録', then: '10/31の宿に着く見込みが、ライブの後（21時以降）になる' },
      { want: '行けたら行きたい場所もたくさん入れたい', how: '「北野異人館」「南京町」などを「行けたら」で5か所以上登録する', then: '回りきれない場所は「見送り候補」に分かれる' },
    ],
  },
  {
    id: 'g5', title: '⑤ 旅行当日（11/1）に予定が変わった',
    setup: () => ({ plan: bookedPlan(), places: kobePlaces(['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken', 'harborland']) }),
    steps: [
      { want: '今どこへ向かえばいいか知りたい', how: '「旅行中モード」を押す →「今日」を11/1、「今の時刻」を14:00にする → 地図をタップして今いる場所を決める', then: '次の目的地・方角・距離と、Googleマップの道案内ボタンが出る' },
      { want: '1か所あきらめたい', how: '行の「中止」を押す →「今いる場所から並べ直す」を押す', then: '中止した場所は「行けなかった」になり、残りが並べ直される' },
      { want: '行った場所を記録したい', how: '行の「行った」を押す →「記録」タブを開く', then: 'その場所が「予定通り」として記録されている' },
    ],
  },
];
