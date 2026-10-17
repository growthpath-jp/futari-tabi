// 予定の計算（アプリ本体と同じ planTrip を通す）。データはお試しモードの神戸旅行
import test from 'node:test';
import assert from 'node:assert/strict';
import { hm, fmt, travelMin, simulate, planTrip, gapFillFor, reassignDays, tripDates, closedOn, normalizePlan, replanFrom, bearingText } from '../js/plan.js';
import { kobeTrip, kobePlaces, basePlan, bookedPlan, HOTEL_KOYOKAKU } from '../js/demo-kobe.js';

const trip = (plan) => ({ ...kobeTrip('g'), plan: plan || basePlan() });
const places = (ids, patch = {}) => kobePlaces(ids).map((p, i) => ({ ...p, id: ids[i], plan: { ...p.plan, ...(patch[ids[i]] || {}) } }));
const dayOf = (r, id) => r.days.findIndex((x) => x.order.some((p) => p.id === id));
const row = (r, id) => { const d = dayOf(r, id); return d < 0 ? null : r.days[d].sim.rows.find((x) => x.id === id); };

test('旅の日付：4日間、11/3は祝日', () => {
  const ds = tripDates(trip());
  assert.deepEqual(ds.map((d) => d.label), ['10/31(土)', '11/1(日)', '11/2(月)', '11/3(火・祝)']);
});
test('休みのルール：有馬・須磨浦は今回の日程で休みに当たらない（11/3は祝日で営業）', () => {
  const ds = tripDates(trip());
  for (const id of ['arima', 'sumaura']) assert.deepEqual(ds.filter((d) => closedOn(kobePlaces([id])[0].plan.closed, d)), [], id);
  assert.ok(closedOn({ weekdays: [1] }, ds[2]), '月曜休みなら11/2は休み');
});
test('3か所を日を決めずに登録 → すべてどこかの日に入り、時間内に収まる', () => {
  const r = planTrip(trip(), places(['arima', 'tottei', 'sumaura']));
  assert.equal(r.days.reduce((n, x) => n + x.order.length, 0), 3);
  r.days.forEach((x) => assert.equal(x.sim.over, 0, x.label));
});
test('1日目は到着（新神戸 12:29）から始まる', () => {
  const r = planTrip(trip(), places(['tottei']));
  assert.equal(r.days[0].start.name, '新神戸駅');
  assert.equal(fmt(r.days[0].startTime), '12:29');
});
test('最終日は帰り（17:00発）の15分前までに着く', () => {
  const r = planTrip(trip(), places(['arima', 'tottei', 'sumaura']));
  const last = r.days[3];
  assert.equal(fmt(last.endTime), '16:45');
  assert.ok(last.sim.finish <= hm('16:45'));
});
test('開く前に着いたら待つ（須磨浦は10:00から）', () => {
  const r = planTrip(trip(), places(['sumaura']));
  assert.ok(row(r, 'sumaura').arrive >= hm('10:00'));
});
test('時刻を決めた予定（11/1 18:30の夕食）を守る', () => {
  const r = planTrip(trip(), places(['arima', 'tottei', 'sumaura', 'dinner']));
  assert.equal(dayOf(r, 'dinner'), 1);
  assert.ok(Math.abs(row(r, 'dinner').arrive - hm('18:30')) < 1);
  assert.equal(r.days[1].sim.late, 0);
});
test('日を決めた場所は、その日のまま', () => {
  const r = planTrip(trip(), places(['arima', 'tottei', 'sumaura'], { sumaura: { day: 2 } }));
  assert.equal(dayOf(r, 'sumaura'), 2);
});
test('宿：予約済みの宿で1日が終わり、翌朝はその宿から出発', () => {
  const r = planTrip(trip(bookedPlan()), places(['tottei']));
  assert.equal(r.days[0].end.name, 'コンフォートホテルERA神戸三宮');
  assert.equal(r.days[1].start.name, 'コンフォートホテルERA神戸三宮');
});
test('宿：2泊目を有馬の旅館にすると、有馬温泉は11/1か11/2に入る', () => {
  const p = basePlan(); p.nights[1] = { status: 'booked', hotel: HOTEL_KOYOKAKU };
  const r = planTrip(trip(p), places(['arima', 'tottei', 'sumaura']));
  assert.ok([1, 2].includes(dayOf(r, 'arima')), String(dayOf(r, 'arima')));
});
test('宿：チェックインの「〜まで」に間に合うように組む（行けたらは見送る）', () => {
  const p = bookedPlan(); p.nights[0].lastIn = '17:00';
  const r = planTrip(trip(p), places(['tottei', 'kitano', 'nankinmachi', 'meriken', 'harborland'], { tottei: { day: 0 } }));
  assert.ok(r.days[0].sim.finish <= hm('17:00'), fmt(r.days[0].sim.finish));
});
test('宿：当日探す日は、最後の場所で終わり、次の日はその近くから出発', () => {
  const p = bookedPlan(); // 3泊目（11/2の夜）が当日探す
  const r = planTrip(trip(p), places(['arima', 'tottei', 'sumaura'], { sumaura: { day: 2 } }));
  assert.equal(r.days[2].end, null);
  const last = r.days[2].order[r.days[2].order.length - 1];
  assert.equal(r.days[3].start.name, `${last.name}の近く`);
});
test('ライブ（10/31 18:00・3時間）を入れると、宿に着くのは21時以降', () => {
  const live = { id: 'live', trip_id: 'demo-kobe', status: 'want', name: 'GLION ARENA KOBE', lat: 34.6858, lng: 135.1992, plan: { day: 0, at: '18:00', stay: 180 } };
  const r = planTrip(trip(bookedPlan()), [...places(['arima', 'tottei', 'sumaura']), live]);
  assert.ok(r.days[0].sim.finish >= hm('21:00'), fmt(r.days[0].sim.finish));
});
test('行けたらを多く足しても、時間内に収まり、絶対の場所は全部入る', () => {
  const r = planTrip(trip(bookedPlan()), places(['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken', 'harborland']));
  for (const id of ['arima', 'tottei', 'sumaura', 'dinner']) assert.ok(dayOf(r, id) >= 0, id);
  r.days.forEach((x) => assert.equal(x.sim.over, 0, x.label));
});
test('手で直した順番は、そのまま使う', () => {
  const p = basePlan();
  const r0 = planTrip(trip(p), places(['tottei', 'kitano', 'nankinmachi'], { tottei: { day: 0 }, kitano: { day: 0, priority: 'must' }, nankinmachi: { day: 0, priority: 'must' } }));
  const rev = r0.days[0].order.map((x) => x.id).reverse();
  p.manual = { 0: rev };
  const r1 = planTrip(trip(p), places(['tottei', 'kitano', 'nankinmachi'], { tottei: { day: 0 }, kitano: { day: 0, priority: 'must' }, nankinmachi: { day: 0, priority: 'must' } }));
  assert.deepEqual(r1.days[0].order.map((x) => x.id), rev);
  assert.ok(r1.days[0].edited);
});
test('行きたい以外（行った・行けなかった）は予定に入らない', () => {
  const ps = places(['arima', 'tottei']); ps[1].status = 'missed';
  const r = planTrip(trip(), ps);
  assert.equal(dayOf(r, 'tottei'), -1);
});
test('旅行中：今いる場所から並べ直す', () => {
  const r = planTrip(trip(bookedPlan()), places(['kitano', 'nankinmachi', 'meriken'], { kitano: { day: 1 }, nankinmachi: { day: 1 }, meriken: { day: 1 } }), { today: 1, now: '14:00', here: { lat: 34.6823, lng: 135.1888 } });
  const { order } = replanFrom(r.days[1].day, { lat: 34.6823, lng: 135.1888 }, hm('14:00'), r.days[1].order, 'train');
  assert.equal(order[0].id, 'meriken', '今いるメリケンパークから回る');
  assert.match(bearingText({ lat: 34.6823, lng: 135.1888 }, { lat: 34.7010, lng: 135.1905 }), /^北へ/);
});
test('日付がない旅は予定を組まない', () => {
  assert.equal(planTrip({ id: 'x', start_date: null }, []), null);
  assert.equal(normalizePlan({}, 3).nights.length, 2);
  assert.ok(travelMin({ lat: 34.69, lng: 135.19 }, { lat: 34.79, lng: 135.24 }, 'train') < 60);
  assert.equal(simulate({ start: null, end: null, startTime: 540, endTime: 600 }, [], 'train').finish, 540);
});
test('空き時間：自動では埋めない（夕食18:30の前に空き時間が残る）', () => {
  const ids = ['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken', 'harborland'];
  const r = planTrip(trip(bookedPlan()), places(ids));
  assert.ok(r.days[1].sim.rows.some((x) => x.wait >= 60));
});
test('空き時間を埋める（押したとき）：日を決めていない場所を、その日に入れる候補として返す', () => {
  const ids = ['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken', 'harborland'];
  const ps = places(ids);
  const moves = gapFillFor(trip(bookedPlan()), ps, 1);
  assert.ok(moves.length > 0);
  // 返ってきた場所を11/1に決めると、待ちが減り、どの日も時間内に収まる
  const r0 = planTrip(trip(bookedPlan()), ps);
  const keep = r0.days[1].order.map((p) => p.id);
  const fixed = ps.map((p) => (moves.some((m) => m.id === p.id) || keep.includes(p.id) ? { ...p, plan: { ...p.plan, day: 1 } } : p));
  const before = r0.days[1].sim.rows.reduce((m, x) => m + x.wait, 0);
  const r = planTrip(trip(bookedPlan()), fixed);
  assert.ok(r.days[1].sim.rows.reduce((m, x) => m + x.wait, 0) < before);
  r.days.forEach((x) => assert.equal(x.sim.over, 0, x.label));
  for (const id of keep) assert.equal(dayOf(r, id), 1, id + 'は11/1のまま');
});
test('空き時間を埋める：日を決めた場所は動かさない', () => {
  const moves = gapFillFor(trip(bookedPlan()), places(['tottei', 'dinner'], { tottei: { day: 3 } }), 1);
  assert.ok(!moves.some((m) => m.id === 'tottei'));
});
test('日の組み直し：おまかせで決めた日は、宿を変えても勝手には動かない', () => {
  const ps = places(['arima', 'tottei', 'sumaura']);
  const r0 = planTrip(trip(), ps);
  const saved = ps.map((p) => ({ ...p, plan: { ...p.plan, day: dayOf(r0, p.id), auto: true } }));
  const p2 = basePlan(); p2.nights[1] = { status: 'booked', hotel: HOTEL_KOYOKAKU };
  const r1 = planTrip(trip(p2), saved);
  for (const p of saved) assert.equal(dayOf(r1, p.id), p.plan.day, p.id);
});
test('日の組み直し：押すと、おまかせの場所だけ決め直す（自分で決めた日は動かさない）', () => {
  const ps = places(['arima', 'tottei', 'sumaura']).map((p) => ({ ...p, plan: { ...p.plan, day: 0, auto: p.id !== 'tottei' } }));
  const p2 = basePlan(); p2.nights[1] = { status: 'booked', hotel: HOTEL_KOYOKAKU };
  const list = reassignDays(trip(p2), ps);
  assert.ok(!list.some((m) => m.id === 'tottei'), '自分で決めた日は対象外');
  assert.ok([1, 2].includes(list.find((m) => m.id === 'arima').day), '有馬は旅館の日に');
});
