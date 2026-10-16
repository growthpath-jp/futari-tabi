// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractAddress, normalizeAddress, isApproxMatch, googleUrl, distanceM, tokyoDate,
  applyFilter, buildRoutes, pickTrip, matchPhoto, earlierIso, closeTripPatches, formatDateRange, describeFilter,
} from '../js/logic.js';

const trips = [
  { id: 'k', title: '京都', start_date: '2026-11-13', end_date: '2026-11-15', created_at: '2026-10-01' },
  { id: 'h', title: '北海道', start_date: '2026-03-01', end_date: '2026-03-04', created_at: '2026-02-01' },
];
const P = (id, trip_id, status, lat, lng, reg, vis) => ({ id, trip_id, status, lat, lng, registered_at: reg, visited_at: vis || null });
const places = [
  P('a', 'k', 'visited', 34.9949, 135.785, '2026-10-02T00:00:00Z', '2026-11-14T03:00:00Z'),
  P('b', 'k', 'detour', 35.0037, 135.776, '2026-11-14T02:00:00Z', '2026-11-14T02:00:00Z'),
  P('c', 'k', 'visited', 34.9671, 135.7727, '2026-10-02T00:01:00Z', '2026-11-15T00:30:00Z'),
  P('d', 'k', 'missed', 35.017, 135.6713, '2026-10-02T00:03:00Z'),
  P('e', 'k', 'missed', 35.0394, 135.7292, '2026-10-02T00:02:00Z'),
  P('f', 'k', 'want', 35.0, 135.7, '2026-10-02T00:05:00Z'),
  P('g', 'h', 'missed', 41.7589, 140.7044, '2026-02-02T00:00:00Z'),
];

test('住所：Googleマップからのコピー（日本、〒、全角）', () => {
  assert.equal(extractAddress('日本、〒605-0862 京都府京都市東山区清水１丁目２９４'), '京都府京都市東山区清水1丁目294');
});
test('住所：名前や番地なしは住所扱いしない', () => {
  assert.equal(extractAddress('嵐山'), null);
  assert.equal(extractAddress('京都府京都市'), null);
});
test('住所：表記ゆれをそろえる', () => {
  assert.equal(normalizeAddress('清水1丁目294番地'), normalizeAddress('清水１−２９４'));
});
test('住所：番地まで合わない結果は仮置き扱い', () => {
  assert.equal(isApproxMatch('京都府京都市東山区清水1丁目294', '京都府京都市東山区清水一丁目'), true);
  assert.equal(isApproxMatch('京都府京都市東山区清水1丁目294', '京都府京都市東山区清水1丁目294'), false);
  assert.equal(isApproxMatch('京都府京都市東山区清水1丁目294', '京都府京都市東山区清水一丁目294'), false, '漢数字の丁目');
  assert.equal(normalizeAddress('二十三丁目5'), '23-5');
});
test('Googleリンク：名前あり→施設、なし→位置だけ', () => {
  assert.match(decodeURIComponent(googleUrl({ name: '清水寺', address: '京都府', lat: 1, lng: 2 })), /query=清水寺 京都府$/);
  assert.match(googleUrl({ name: '', lat: 34.9949, lng: 135.785 }), /query=34\.994900%2C135\.785000$/);
});
test('距離：清水寺〜伏見稲荷はおよそ3.2km', () => {
  const d = distanceM(places[0], places[2]);
  assert.ok(d > 3000 && d < 3500, String(d));
});
test('日付：日本時間で日付を出す（UTC 15時以降は翌日）', () => {
  assert.equal(tokyoDate('2026-11-13T16:00:00Z'), '2026-11-14');
});
test('引き出し：旅をまたいで「行けなかった」だけ', () => {
  const r = applyFilter(places, trips, { trips: 'all', statuses: ['missed'] }).map((p) => p.id).sort();
  assert.deepEqual(r, ['d', 'e', 'g']);
});
test('引き出し：旅を選ぶ・期間で選ぶ', () => {
  assert.equal(applyFilter(places, trips, { trips: ['h'], statuses: ['missed'] }).length, 1);
  assert.equal(applyFilter(places, trips, { trips: 'all', from: '2026-06-01', to: '2026-12-31', statuses: ['missed'] }).length, 2);
});
test('線：行った場所（予定通り＋寄り道）は訪問順、行けなかったは登録順、旅ごとに分ける', () => {
  const { lines, numbers } = buildRoutes(applyFilter(places, trips, { trips: 'all', statuses: ['visited', 'detour', 'missed', 'want'] }));
  const visit = lines.find((l) => l.kind === 'visit');
  assert.deepEqual(visit.points, [[35.0037, 135.776], [34.9949, 135.785], [34.9671, 135.7727]]);
  assert.equal(numbers.get('b'), 1); assert.equal(numbers.get('a'), 2); assert.equal(numbers.get('c'), 3);
  const missedK = lines.find((l) => l.kind === 'missed' && l.tripId === 'k');
  assert.deepEqual(missedK.points, [[35.0394, 135.7292], [35.017, 135.6713]]);
  assert.equal(lines.filter((l) => l.tripId === 'h').length, 0, '1か所だけの旅には線を引かない');
});
test('線：寄り道だけを表示すると寄り道同士を訪問順で結ぶ', () => {
  const extra = [...places, P('b2', 'k', 'detour', 35.005, 135.7647, '2026-11-14T04:00:00Z', '2026-11-14T04:00:00Z')];
  const { lines } = buildRoutes(applyFilter(extra, trips, { statuses: ['detour'] }));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].points.length, 2);
});
test('写真の旅選び：期間内→その旅、期間外→一番新しい旅、旅なし→null', () => {
  assert.equal(pickTrip(trips, '2026-03-02T05:00:00Z').id, 'h');
  assert.equal(pickTrip(trips, '2027-01-01T00:00:00Z').id, 'k');
  assert.equal(pickTrip([], '2027-01-01T00:00:00Z'), null);
});
test('写真の照合：予定の場所の近く→予定通りに', () => {
  const kp = places.filter((p) => p.trip_id === 'k');
  const r = matchPhoto(kp, { lat: 35.0171, lng: 135.6715 }); // 嵐山（行けなかった）の近く
  assert.equal(r.action, 'visit'); assert.equal(r.place.id, 'd');
});
test('写真の照合：すでに行った場所の近く→写真を追加', () => {
  const r = matchPhoto(places.filter((p) => p.trip_id === 'k'), { lat: 34.995, lng: 135.7851 });
  assert.equal(r.action, 'attach'); assert.equal(r.place.id, 'a');
});
test('写真の照合：寄り道の近く→その寄り道に追加、どこにも近くない→新しい寄り道', () => {
  const kp = places.filter((p) => p.trip_id === 'k');
  assert.equal(matchPhoto(kp, { lat: 35.0038, lng: 135.7761 }).place.id, 'b');
  assert.equal(matchPhoto(kp, { lat: 35.1, lng: 135.9 }).action, 'detour');
});
test('訪問時刻は早い方', () => {
  assert.equal(earlierIso('2026-11-14T03:00:00Z', '2026-11-14T01:00:00Z'), '2026-11-14T01:00:00Z');
  assert.equal(earlierIso(null, '2026-11-14T01:00:00Z'), '2026-11-14T01:00:00Z');
});
test('旅を終える：「行きたい」だけを「行けなかった」に', () => {
  assert.deepEqual(closeTripPatches(places, 'k'), [{ id: 'f', status: 'missed' }]);
});
test('表示用の文字', () => {
  assert.equal(formatDateRange(trips[0]), '2026年11月13日〜15日');
  assert.equal(describeFilter({ trips: 'all', statuses: ['missed'] }, trips), 'すべての旅 ／ 行けなかった');
});
test('写真の受け口（Edge Function）の判断ロジックがアプリと同じ', () => {
  const re = /\/\/ <shared-match>\n([\s\S]*?)\/\/ <\/shared-match>/;
  const a = readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8').match(re)[1];
  const b = readFileSync(new URL('../supabase/functions/ingest-photo/index.ts', import.meta.url), 'utf8').match(re)[1];
  assert.equal(a, b);
});
