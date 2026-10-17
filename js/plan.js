// ふたりの旅：回る順番と日割りの計算（AIは使わない、決まったルールの計算だけ）
//
// 考える要因（Notion「順番を決める要因」）
//  ①出発・到着の場所（日ごと）  ②動かせない時刻（予約など）  ③〜時まで（営業時間）
//  ④滞在時間  ⑤移動手段  ⑥行きたい度合い（絶対／行けたら）

import { distanceM } from './logic.js';

// ---------- 時間 ----------
export const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
export const fmt = (min) => { const m = Math.round(min); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

export const MODES = {
  walk: { label: '徒歩', speedKmh: 4.5, overheadMin: 0 },
  train: { label: '電車・バス', speedKmh: 22, longKmh: 75, overheadMin: 12 },
  car: { label: '車', speedKmh: 28, longKmh: 65, overheadMin: 6 },
};

// 移動時間（分）：道のりは直線の1.3倍として計算。電車でも近ければ歩く
export function travelMin(a, b, mode) {
  if (!a || !b) return 0;
  const km = (distanceM(a, b) / 1000) * 1.3;
  const walk = (km / MODES.walk.speedKmh) * 60;
  if (mode === 'walk') return walk;
  const m = MODES[mode] || MODES.train;
  // 30kmを超える移動は特急・高速道路を想定して速くする
  const ride = m.overheadMin + (km <= 30 ? (km / m.speedKmh) * 60 : (30 / m.speedKmh) * 60 + ((km - 30) / m.longKmh) * 60);
  return Math.min(walk, ride);
}

// ---------- 1日の流れを計算 ----------
// day: { start, end, startTime, endTime }  items: [{ id, lat, lng, stay, at?, until?, priority }]
export function simulate(day, items, mode) {
  let t = day.startTime, pos = day.start, travel = 0, late = 0;
  const rows = [];
  for (const it of items) {
    const mv = travelMin(pos, it, mode);
    travel += mv; t += mv;
    let wait = 0, warn = null;
    if (it.open != null && it.at == null && t < it.open) { wait = it.open - t; t = it.open; }
    if (it.at != null) {
      if (t < it.at) { wait = it.at - t; t = it.at; }
      else if (t > it.at + 1) { late += t - it.at; warn = `予約の${fmt(it.at)}に${Math.round(t - it.at)}分遅れます`; }
    }
    if (it.until != null && t > it.until) { late += t - it.until; warn = `${fmt(it.until)}までに着けません`; }
    rows.push({ id: it.id, arrive: t, leave: t + (it.stay || 0), move: mv, wait, warn });
    t += it.stay || 0;
    pos = it;
  }
  const back = travelMin(pos, day.end, mode);
  travel += back; t += back;
  const over = Math.max(0, t - day.endTime);
  return { rows, finish: t, travel, late, over, cost: travel + (late + over) * 50 };
}

// 一番よい位置に1か所差し込む（予約の時刻に間に合うか、帰りの時刻に収まるかも見る）
export function bestInsert(day, order, item, mode) {
  let best = null;
  for (let i = 0; i <= order.length; i++) {
    const trial = [...order.slice(0, i), item, ...order.slice(i)];
    if (!respectsFixedOrder(trial)) continue;
    const s = simulate(day, trial, mode);
    if (!best || s.cost < best.sim.cost) best = { order: trial, sim: s };
  }
  return best;
}

function respectsFixedOrder(list) {
  let last = -Infinity;
  for (const it of list) if (it.at != null) { if (it.at < last) return false; last = it.at; }
  return true;
}

// おまかせの順番：時刻の決まった場所を先に置き、あとは遠い場所から順に一番よい位置へ差し込む
// 「行けたら」は時間に収まらなければ見送り候補にする
export function autoOrder(day, items, mode) {
  const fixed = items.filter((x) => x.at != null).sort((a, b) => a.at - b.at);
  const free = items.filter((x) => x.at == null);
  const center = { lat: (day.start.lat + day.end.lat) / 2, lng: (day.start.lng + day.end.lng) / 2 };
  const byFar = (a, b) => distanceM(center, b) - distanceM(center, a);
  const must = free.filter((x) => x.priority !== 'maybe').sort(byFar);
  const maybe = free.filter((x) => x.priority === 'maybe').sort(byFar);
  let order = [...fixed];
  for (const it of must) order = bestInsert(day, order, it, mode).order;
  const skipped = [];
  for (const it of maybe) {
    const before = simulate(day, order, mode);
    const b = bestInsert(day, order, it, mode);
    if (b.sim.over > 0 || b.sim.late > before.late) skipped.push(it);
    else order = b.order;
  }
  return { order, skipped };
}

// ---------- 日への振り分け ----------
// 1か所ずつ「その日に入れたら移動がどれだけ増えるか」＋「その日の混み具合」が一番小さい日へ入れる
// （宿や出発・到着の場所が日ごとに違っても、その位置からの移動で自然に判断される）
export function autoAssign(days, items, pinned, mode = 'train') {
  const res = new Map();
  const orders = days.map(() => []);
  const put = (it, d) => { res.set(it.id, d); orders[d] = bestInsert(days[d], orders[d], it, mode).order; };
  const fixedDay = (it) => (pinned && pinned[it.id] != null ? pinned[it.id] : it.day != null ? it.day : null);
  // 日が決まっている場所 → 時刻が決まっている場所 → 絶対 → 行けたら の順に置く
  const fixed = items.filter((it) => fixedDay(it) != null);
  fixed.forEach((it) => put(it, fixedDay(it)));
  if (days.length === 1) { items.forEach((it) => { if (!res.has(it.id)) put(it, 0); }); return res; }
  const center = { lat: avg(items, 'lat') || 0, lng: avg(items, 'lng') || 0 };
  const rest = items.filter((it) => fixedDay(it) == null).sort((a, b) =>
    (a.at != null ? 0 : 1) - (b.at != null ? 0 : 1)
    || (a.priority === 'maybe' ? 1 : 0) - (b.priority === 'maybe' ? 1 : 0)
    || distanceM(center, b) - distanceM(center, a));
  for (const it of rest) {
    let best = -1, bestScore = Infinity;
    days.forEach((day, d) => {
      if (isClosed(it, d)) return;
      const before = simulate(day, orders[d], mode);
      const b = bestInsert(day, orders[d], it, mode);
      // 混み具合＝移動と滞在の合計（予約までの待ち時間は空いている時間として数える）
      const busy = b.sim.travel + b.order.reduce((m, x) => m + (x.stay || 0), 0);
      const load = busy / Math.max(60, day.endTime - day.startTime);
      const score = (b.sim.cost - before.cost) + 90 * load;
      if (score < bestScore) { bestScore = score; best = d; }
    });
    put(it, best < 0 ? 0 : best);
  }
  return res;
}

const avg = (list, key) => (list.length ? list.reduce((s, x) => s + x[key], 0) / list.length : 0);
// その日が休み（定休日など）か
export const isClosed = (it, dayIndex) => Array.isArray(it.closed) && it.closed.includes(dayIndex);

// 1日に収まらない、または時刻に間に合わない「絶対」の場所を、余裕のある日へ移してみる
export function rebalance(days, items, assign, pinned, mode) {
  const byDay = (d) => items.filter((it) => assign.get(it.id) === d);
  for (let d = 0; d < days.length; d++) {
    let { order } = autoOrder(days[d], byDay(d), mode);
    let sim = simulate(days[d], order, mode);
    if (sim.over <= 0 && sim.late <= 0) continue;
    const late = new Set(sim.rows.filter((r) => r.warn).map((r) => r.id));
    const movable = order.filter((it) => it.at == null && !(pinned && pinned[it.id] != null) && it.day == null && it.priority !== 'maybe')
      .sort((a, b) => (late.has(b.id) ? 1 : 0) - (late.has(a.id) ? 1 : 0));
    for (const it of movable) {
      let target = -1, bestCost = Infinity;
      for (let e = 0; e < days.length; e++) {
        if (e === d || isClosed(it, e)) continue;
        const cur = autoOrder(days[e], byDay(e), mode).order;
        const b = bestInsert(days[e], cur, it, mode);
        if (b.sim.over <= 0 && b.sim.late <= simulate(days[e], cur, mode).late && b.sim.cost < bestCost) { bestCost = b.sim.cost; target = e; }
      }
      if (target >= 0) {
        assign.set(it.id, target);
        order = autoOrder(days[d], byDay(d), mode).order;
        sim = simulate(days[d], order, mode);
        if (sim.over <= 0 && sim.late <= 0) break;
      }
    }
  }
  return assign;
}

// ---------- 旅行当日：今いる場所から並べ直す ----------
export function replanFrom(day, here, nowMin, remaining, mode) {
  const d = { ...day, start: here, startTime: nowMin };
  return autoOrder(d, remaining, mode);
}

// 方角と距離（例：北東へ1.2km）
export function bearingText(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  const deg = (Math.atan2(y, x) / rad + 360) % 360;
  const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const m = distanceM(a, b);
  const dist = m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
  return `${dirs[Math.round(deg / 45) % 8]}へ${dist}`;
}
