import test from 'node:test';
import assert from 'node:assert/strict';
import { hm, fmt, travelMin, simulate, autoOrder, autoAssign, rebalance, replanFrom, bearingText } from '../js/plan.js';
import { DATES, SHIN_KOBE, HOTELS, CANDIDATES, closedDays } from '../lab/kobe.js';
const BASES = { sannomiya: HOTELS[0], arima: HOTELS[1] };
const DEFAULT_TRIP = { nights: ['sannomiya', 'sannomiya', 'sannomiya'] };

function trip(nights = DEFAULT_TRIP.nights) {
  return DATES.map((d, i) => ({
    start: i === 0 ? SHIN_KOBE : BASES[nights[i - 1]], end: i === 3 ? SHIN_KOBE : BASES[nights[i]],
    startTime: i === 0 ? hm('12:15') : hm('9:00'), endTime: i === 3 ? hm('16:45') : hm('21:00'),
  }));
}
const pick = (ids, patch = {}) => ids.map((id) => {
  const c = { ...CANDIDATES.find((x) => x.id === id), ...(patch[id] || {}) };
  return { ...c, at: c.at ? hm(c.at) : null, until: c.until ? hm(c.until) : null, open: c.open ? hm(c.open) : null, closed: closedDays(c.closedRule) };
});
const plan = (days, items) => {
  const as = rebalance(days, items, autoAssign(days, items, {}), {}, 'train');
  return days.map((day, d) => { const { order, skipped } = autoOrder(day, items.filter((p) => as.get(p.id) === d), 'train'); return { order, skipped, sim: simulate(day, order, 'train') }; });
};

test('時間の表記と移動時間', () => {
  assert.equal(hm('12:15'), 735); assert.equal(fmt(735), '12:15');
  const t = travelMin(BASES.sannomiya, CANDIDATES.find((c) => c.id === 'arima'), 'train');
  assert.ok(t > 20 && t < 60, '三宮→有馬 ' + t);
});
test('今回の旅の日程では、3か所とも休みに当たらない（11/3は祝日）', () => {
  for (const id of ['arima', 'sumaura']) assert.deepEqual(closedDays(CANDIDATES.find((c) => c.id === id).closedRule), [], id);
});
test('休みのルール：祝日でない火曜は休み', () => {
  const rule = { weekdays: [1] }; // 月曜休み → 11/2
  assert.deepEqual(closedDays(rule), [2]);
});
test('3か所を未定で登録 → 全部どこかの日に入り、時間内に収まる', () => {
  const r = plan(trip(), pick(['arima', 'tottei', 'sumaura']));
  assert.equal(r.reduce((n, x) => n + x.order.length, 0), 3);
  r.forEach((x, d) => assert.equal(x.sim.over, 0, 'day ' + d));
});
test('須磨浦は10時より前に着いたら開くまで待つ', () => {
  const days = trip();
  const s = simulate({ ...days[1], startTime: hm('8:00') }, pick(['sumaura']), 'train');
  assert.ok(s.rows[0].arrive >= hm('10:00'));
});
test('11/1の夕食予約18:30を守る', () => {
  const r = plan(trip(), pick(['arima', 'tottei', 'sumaura', 'dinner'], { dinner: { day: 1 } }));
  const row = r[1].sim.rows.find((x) => x.id === 'dinner');
  assert.ok(row && Math.abs(row.arrive - hm('18:30')) < 1, row && fmt(row.arrive));
  assert.equal(r[1].sim.late, 0);
});
test('登録時に日を決めた場所は、その日のまま', () => {
  const r = plan(trip(), pick(['arima', 'tottei', 'sumaura'], { sumaura: { day: 3 } }));
  assert.ok(r[3].order.some((p) => p.id === 'sumaura'));
});
test('2泊目を有馬温泉にすると、有馬は11/1か11/2に入る', () => {
  const r = plan(trip(['sannomiya', 'arima', 'sannomiya']), pick(['arima', 'tottei', 'sumaura']));
  const d = r.findIndex((x) => x.order.some((p) => p.id === 'arima'));
  assert.ok(d === 1 || d === 2, 'day ' + d);
});
test('行けたらを多く足すと、時間内に収まり、絶対の場所は全部入る', () => {
  const ids = ['arima', 'tottei', 'sumaura', 'dinner', 'kitano', 'nankinmachi', 'meriken', 'harborland', 'nunobiki', 'rokko'];
  const r = plan(trip(), pick(ids, { dinner: { day: 1 } }));
  const inPlan = new Set(r.flatMap((x) => x.order.map((p) => p.id)));
  ['arima', 'tottei', 'sumaura', 'dinner'].forEach((id) => assert.ok(inPlan.has(id), id));
  r.forEach((x, d) => assert.equal(x.sim.over, 0, 'day ' + d));
});
test('当日：今いる場所から並べ直す', () => {
  const days = trip();
  const items = pick(['tottei', 'kitano', 'nankinmachi', 'dinner'], { dinner: { day: 1 } });
  const { order } = replanFrom(days[1], { lat: 34.6946, lng: 135.1955 }, hm('14:00'), items, 'train');
  const sim = simulate({ ...days[1], start: { lat: 34.6946, lng: 135.1955 }, startTime: hm('14:00') }, order, 'train');
  assert.equal(sim.late, 0);
  assert.equal(order[order.length - 1].id, 'dinner');
});
test('方角と距離', () => { assert.equal(bearingText({ lat: 35, lng: 135 }, { lat: 35.01, lng: 135 }), '北へ1.1km'); });
