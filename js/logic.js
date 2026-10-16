// ふたりの旅：画面に依存しない判断ロジック（テスト対象）

export const STATUSES = ['want', 'visited', 'detour', 'missed'];
export const STATUS_LABEL = { want: '行きたい', visited: '予定通り', detour: '寄り道', missed: '行けなかった' };
export const ALL_FILTER = { trips: 'all', from: '', to: '', statuses: ['want', 'visited', 'detour', 'missed'], colorDetour: true, connect: true };

// ---------- 住所 ----------
function toHalf(s) {
  return String(s || '')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－−‐ー―]/g, (c, i, str) => (/\d/.test(str[i - 1] || '') ? '-' : c))
    .replace(/　/g, ' ');
}

// 住所の表記ゆれをそろえる（1丁目294 / 1-294 / 1丁目294番地）
function kanjiNum(k) {
  const d = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!k.includes('十')) return String(d[k] || k);
  const [a, b] = k.split('十');
  return String((a ? d[a] : 1) * 10 + (b ? d[b] : 0));
}

export function normalizeAddress(s) {
  return toHalf(s).replace(/\s+/g, '')
    .replace(/([一二三四五六七八九十]+)丁目/g, (m, k) => kanjiNum(k) + '丁目')
    .replace(/(\d+)丁目/g, '$1-').replace(/(\d+)番地?/g, '$1-').replace(/(\d+)号/g, '$1')
    .replace(/-+$/, '').replace(/-+/g, '-');
}

// 貼り付けた文から住所を取り出す。住所でなければ null
export function extractAddress(text) {
  const t = toHalf(text).replace(/日本[、,]?/g, '').replace(/〒?\d{3}-?\d{4}/g, ' ');
  const m = t.match(/(北海道|東京都|京都府|大阪府|[^\s、,。]{2,3}県)[^\s、,。]*?(市|郡|区|町|村)[^\n、,。]*/);
  if (!m) return null;
  const a = m[0].trim();
  if (!/\d/.test(a)) return null; // 番地のないものは住所として扱わない
  return a;
}

// 住所検索の結果が、番地まで合っているか（合っていなければ「仮置き」にして指で調整）
export function isApproxMatch(query, resultTitle) {
  const q = normalizeAddress(query);
  const r = normalizeAddress(resultTitle || '');
  const qNums = q.match(/\d+(-\d+)*/g) || [];
  const last = qNums[qNums.length - 1];
  if (!last) return false;
  return !r.includes(last.split('-')[0]) || (last.includes('-') && !r.includes(last));
}

// ---------- Googleマップ ----------
export function googleUrl(place) {
  const q = place.name
    ? place.name + (place.address ? ' ' + place.address : '')
    : Number(place.lat).toFixed(6) + ',' + Number(place.lng).toFixed(6);
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

// ---------- 引き出し（表示条件） ----------
export function tripIncluded(filter, trip) {
  const f = { ...ALL_FILTER, ...(filter || {}) };
  if (f.trips !== 'all' && Array.isArray(f.trips) && !f.trips.includes(trip.id)) return false;
  const s = trip.start_date || trip.end_date, e = trip.end_date || trip.start_date;
  if (f.from && (!e || e < f.from)) return false;
  if (f.to && (!s || s > f.to)) return false;
  return true;
}

export function applyFilter(places, trips, filter) {
  const f = { ...ALL_FILTER, ...(filter || {}) };
  const ok = new Set(trips.filter((t) => tripIncluded(f, t)).map((t) => t.id));
  return places.filter((p) => ok.has(p.trip_id) && f.statuses.includes(p.status));
}

function byTime(key) {
  return (a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) || String(a.id).localeCompare(String(b.id));
}

// 線と番号：旅ごとに、行った場所（予定通り＋寄り道）は訪問順、行けなかった・行きたいは登録順
export function buildRoutes(places) {
  const byTrip = new Map();
  for (const p of places) {
    if (!byTrip.has(p.trip_id)) byTrip.set(p.trip_id, []);
    byTrip.get(p.trip_id).push(p);
  }
  const lines = [];
  const numbers = new Map();
  for (const [tripId, list] of byTrip) {
    const visits = list.filter((p) => p.status === 'visited' || p.status === 'detour').sort(byTime('visited_at'));
    visits.forEach((p, i) => numbers.set(p.id, i + 1));
    const missed = list.filter((p) => p.status === 'missed').sort(byTime('registered_at'));
    const want = list.filter((p) => p.status === 'want').sort(byTime('registered_at'));
    if (visits.length > 1) lines.push({ tripId, kind: 'visit', points: visits.map((p) => [p.lat, p.lng]) });
    if (missed.length > 1) lines.push({ tripId, kind: 'missed', points: missed.map((p) => [p.lat, p.lng]) });
    if (want.length > 1) lines.push({ tripId, kind: 'want', points: want.map((p) => [p.lat, p.lng]) });
  }
  return { lines, numbers };
}

// <shared-match>
// ---------- 距離・日付 ----------
export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function tokyoDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// 写真の撮影日から旅を選ぶ：日付が旅の期間内 → その旅。なければ一番新しい旅
export function pickTrip(trips, takenAtIso) {
  const day = takenAtIso ? tokyoDate(takenAtIso) : null;
  if (day) {
    const hit = trips.find((t) => (t.start_date || t.end_date) && (t.start_date || t.end_date) <= day && day <= (t.end_date || t.start_date));
    if (hit) return hit;
  }
  const sorted = [...trips].sort((a, b) =>
    String(b.start_date || b.created_at || '').localeCompare(String(a.start_date || a.created_at || '')));
  return sorted[0] || null;
}

// 写真の位置を旅の場所と照らし合わせる
//  ・予定の場所（行きたい／行けなかった／予定通り）の 200m 以内 → その場所を「予定通り」に
//  ・すでにある寄り道の 100m 以内 → その寄り道に写真を追加
//  ・どれにも当たらない → 新しい「寄り道」
export function matchPhoto(places, photo, opts) {
  const planR = (opts && opts.planRadius) || 200;
  const detourR = (opts && opts.detourRadius) || 100;
  let best = null, bestD = Infinity;
  for (const p of places) {
    if (p.status === 'detour') continue;
    const d = distanceM(p, photo);
    if (d <= planR && d < bestD) { best = p; bestD = d; }
  }
  if (best) return { action: best.status === 'visited' ? 'attach' : 'visit', place: best, distance: Math.round(bestD) };
  best = null; bestD = Infinity;
  for (const p of places) {
    if (p.status !== 'detour') continue;
    const d = distanceM(p, photo);
    if (d <= detourR && d < bestD) { best = p; bestD = d; }
  }
  if (best) return { action: 'attach', place: best, distance: Math.round(bestD) };
  return { action: 'detour', place: null, distance: null };
}

// 訪問時刻は「その場所で一番早く撮った写真」の時刻
export function earlierIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
}
// </shared-match>

// 旅を終える：まだ結果の出ていない「行きたい」を「行けなかった」に
export function closeTripPatches(places, tripId) {
  return places.filter((p) => p.trip_id === tripId && p.status === 'want').map((p) => ({ id: p.id, status: 'missed' }));
}

export function formatDateRange(t) {
  if (!t.start_date) return '日付未定';
  const f = (s) => { const [y, m, d] = s.split('-'); return `${y}年${Number(m)}月${Number(d)}日`; };
  if (!t.end_date || t.end_date === t.start_date) return f(t.start_date);
  const [y1, m1] = t.start_date.split('-'), [y2, m2, d2] = t.end_date.split('-');
  if (y1 === y2 && m1 === m2) return `${f(t.start_date)}〜${Number(d2)}日`;
  if (y1 === y2) return `${f(t.start_date)}〜${Number(m2)}月${Number(d2)}日`;
  return `${f(t.start_date)}〜${f(t.end_date)}`;
}

export function describeFilter(f, trips) {
  const x = { ...ALL_FILTER, ...(f || {}) };
  let which = 'すべての旅';
  if (Array.isArray(x.trips)) {
    const names = trips.filter((t) => x.trips.includes(t.id)).map((t) => t.title);
    which = names.length ? names.join('・') : '旅を選択';
  }
  if (x.from || x.to) which += `（${x.from || '…'}〜${x.to || '…'}）`;
  const st = x.statuses.length === 4 ? '全部' : x.statuses.map((s) => STATUS_LABEL[s]).join('・') || 'なし';
  return `${which} ／ ${st}`;
}
