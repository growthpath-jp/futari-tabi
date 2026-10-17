import test from 'node:test';
import assert from 'node:assert/strict';
import { hm, fmt, travelMin, simulate, autoOrder, autoAssign, rebalance, replanFrom, bearingText } from '../js/plan.js';
import { SCENARIOS } from '../lab/scenarios.js';

const prep = (sc) => {
  const days = sc.days.map((d) => ({ ...d, startTime: hm(d.startTime), endTime: hm(d.endTime) }));
  const items = sc.places.map((p) => ({ ...p, at: p.at ? hm(p.at) : null, until: p.until ? hm(p.until) : null }));
  return { days, items };
};

test('時間の表記', () => { assert.equal(hm('9:30'), 570); assert.equal(fmt(570), '9:30'); });
test('移動時間：近い所は歩き、電車は遠いほど有利、長距離は特急想定', () => {
  const a = { lat: 35.0037, lng: 135.7785 }, b = { lat: 35.0058, lng: 135.7745 };
  assert.ok(travelMin(a, b, 'train') < 10);
  const otaru = { lat: 43.1979, lng: 140.9937 }, hako = { lat: 41.7737, lng: 140.7266 };
  const t = travelMin(otaru, hako, 'train');
  assert.ok(t > 180 && t < 330, String(t));
});
test('① 3日に振り分け：全部どこかの日に入り、東山と嵐山が同じ日にならない', () => {
  const { days, items } = prep(SCENARIOS[0]);
  const as = autoAssign(days, items, {});
  assert.equal(as.size, items.length);
  assert.notEqual(as.get('kiyomizu'), as.get('chikurin'));
  assert.equal(as.get('chikurin'), as.get('togetsu'));
  assert.equal(as.get('ginkaku'), as.get('tetsugaku'));
});
test('① 手で移した（固定した）場所は、その日のまま', () => {
  const { days, items } = prep(SCENARIOS[0]);
  const as = autoAssign(days, items, { kinkaku: 2 });
  assert.equal(as.get('kinkaku'), 2);
});
test('② 予約の時刻を守った順番になる', () => {
  const { days, items } = prep(SCENARIOS[1]);
  const as = autoAssign(days, items, {});
  assert.equal(as.get('ponto'), 0); assert.equal(as.get('fushimi'), 1);
  for (let d = 0; d < days.length; d++) {
    const { order } = autoOrder(days[d], items.filter((it) => as.get(it.id) === d), 'train');
    const sim = simulate(days[d], order, 'train');
    const r = sim.rows.find((x) => x.id === 'ponto' || x.id === 'fushimi');
    if (r) assert.ok(Math.abs(r.arrive - (d === 0 ? hm('12:00') : hm('7:00'))) < 1, fmt(r.arrive));
  }
});
test('③ 宿が毎日かわる旅：その日の宿の近くの日に入る', () => {
  const { days, items } = prep(SCENARIOS[2]);
  const as = autoAssign(days, items, {});
  assert.equal(as.get('tokei'), 0);
  assert.equal(as.get('unga'), 1);
  assert.equal(as.get('hakodateyama'), 2);
  const { order } = autoOrder(days[2], items.filter((it) => as.get(it.id) === 2), 'train');
  const sim = simulate(days[2], order, 'train');
  assert.ok(sim.late < 1, '函館山の夜景に間に合う ' + fmt(sim.rows.find((r) => r.id === 'hakodateyama').arrive));
});
test('④ 多すぎる日帰り：絶対の場所は全部入り、行けたらの一部が見送り、時間内に収まる', () => {
  const { days, items } = prep(SCENARIOS[3]);
  const { order, skipped } = autoOrder(days[0], items, 'walk');
  const must = items.filter((x) => x.priority !== 'maybe').map((x) => x.id);
  must.forEach((id) => assert.ok(order.some((o) => o.id === id), id));
  assert.ok(skipped.length >= 1 && skipped.every((x) => x.priority === 'maybe'));
  assert.equal(simulate(days[0], order, 'walk').over, 0);
});
test('⑤ 当日：今いる場所から並べ直すと、中止と済みは除かれ、時刻の制約を守る', () => {
  const { days, items } = prep(SCENARIOS[4]);
  const here = { lat: 35.0050, lng: 135.7647 };
  const remaining = items.filter((x) => !x.done && x.id !== 'chikurin' && x.id !== 'nishiki');
  const { order } = replanFrom(days[0], here, hm('13:00'), remaining, 'train');
  assert.ok(!order.some((x) => x.id === 'chikurin' || x.done));
  const sim = simulate({ ...days[0], start: here, startTime: hm('13:00') }, order, 'train');
  const nijo = sim.rows.find((r) => r.id === 'nijo');
  assert.ok(nijo && nijo.arrive <= hm('16:00'), 'nijo ' + (nijo && fmt(nijo.arrive)));
});
test('方角と距離', () => {
  assert.equal(bearingText({ lat: 35, lng: 135 }, { lat: 35.01, lng: 135 }), '北へ1.1km');
});
test('収まらない日の「絶対」は余裕のある日へ移る', () => {
  const { days, items } = prep(SCENARIOS[0]);
  const pinned = Object.fromEntries(items.map((x) => [x.id, 0]));
  delete pinned.kinkaku; delete pinned.ryoanji;
  const as = autoAssign(days, items, pinned);
  const before = new Map(as);
  rebalance(days, items, as, pinned, 'train');
  assert.deepEqual([...as].filter(([id]) => pinned[id] != null), [...before].filter(([id]) => pinned[id] != null), '固定した場所は動かない');
});
