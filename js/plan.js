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
// day: { start, end, startTime, endTime }（end が null の日は最後の場所で終わり）  items: [{ id, lat, lng, stay, at?, until?, priority }]
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
  // 宿を当日探す日は終わりの場所がない（最後の場所で1日が終わる）
  // 始まり・終わりが決まっていない日もある（決まっている方、なければ場所の真ん中を基準に）
  const ends = [day.start, day.end].filter(Boolean);
  const center = ends.length ? { lat: avg(ends, 'lat'), lng: avg(ends, 'lng') } : { lat: avg(items, 'lat'), lng: avg(items, 'lng') };
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

// ======================================================================
// 旅ぜんたいの予定（アプリ本体・お試しモード・テストで共通）
// ======================================================================

// ---------- 日付 ----------
const WD = ['日', '月', '火', '水', '木', '金', '土'];
// 祝日：毎年同じ日＋2026年の動く祝日（2027年以降は必要になったら足す）
const FIXED_HOLIDAYS = ['01-01', '02-11', '02-23', '04-29', '05-03', '05-04', '05-05', '08-11', '11-03', '11-23'];
const MOVING_HOLIDAYS = ['2026-01-12', '2026-03-20', '2026-05-06', '2026-07-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12'];
export const isHoliday = (date) => FIXED_HOLIDAYS.includes(date.slice(5)) || MOVING_HOLIDAYS.includes(date);

export function tripDates(trip) {
  if (!trip || !trip.start_date) return [];
  const out = [];
  const end = trip.end_date || trip.start_date;
  for (let t = Date.parse(trip.start_date + 'T00:00:00Z'); out.length < 14; t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date > end) break;
    const weekday = new Date(t).getUTCDay(), holiday = isHoliday(date);
    out.push({ date, weekday, holiday, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8))}(${WD[weekday]}${holiday ? '・祝' : ''})` });
  }
  return out;
}

// 休みのルール { weekdays:[0-6], nth:[第何週], holidayOpen:祝日は開いている }
export function closedOn(rule, d) {
  if (!rule || !Array.isArray(rule.weekdays) || !rule.weekdays.includes(d.weekday)) return false;
  if (rule.nth && rule.nth.length && !rule.nth.includes(Math.floor((Number(d.date.slice(8)) - 1) / 7) + 1)) return false;
  if (rule.holidayOpen && d.holiday) return false;
  return true;
}

// ---------- 旅の予定の形 ----------
// trip.plan = {
//   mode: 'train'|'walk'|'car',
//   arrive: { name, lat, lng, via, time } | null   旅の始まり（どこに・何時に着く）
//   leave:  { name, lat, lng, via, time } | null   旅の終わり（どこから・何時に出る）
//   nights: [{ status:'booked'|'tbd'|'free', hotel:{name,lat,lng}|null, checkin, lastIn, checkout }]  泊ごと
//   starts: [null, '9:00', ...]                     2日目からの出発時刻
//   manual: { '日の番号': [場所id...] }              手で直した順番
// }
export const NIGHT_DEFAULT = { checkin: '15:00', lastIn: '22:00', checkout: '11:00' };
export function normalizePlan(plan, nDays) {
  const p = plan || {};
  const nights = Array.from({ length: Math.max(0, nDays - 1) }, (_, i) => ({ status: 'tbd', hotel: null, ...NIGHT_DEFAULT, ...((p.nights || [])[i] || {}) }));
  const starts = Array.from({ length: nDays }, (_, i) => (i === 0 ? null : (p.starts || [])[i] || '9:00'));
  return { mode: p.mode || 'train', arrive: p.arrive || null, leave: p.leave || null, nights, starts, manual: { ...(p.manual || {}) } };
}
// place.plan = { day, at, until, open, stay, priority:'must'|'maybe', closed:{weekdays,nth,holidayOpen} }
export function placePlan(p) {
  const x = (p && p.plan) || {};
  return { day: x.day ?? null, at: x.at || null, until: x.until || null, open: x.open || null, stay: x.stay || 60, priority: x.priority === 'maybe' ? 'maybe' : 'must', closed: x.closed || null };
}

// 宿を当日探す日は、仮に三宮…ではなく「その旅の場所の真ん中あたり」に置いて日割りだけ計算する
const middle = (list) => (list.length ? { lat: list.reduce((s, x) => s + x.lat, 0) / list.length, lng: list.reduce((s, x) => s + x.lng, 0) / list.length } : null);

function nightPoint(n, fallback) {
  if (n.status === 'booked' && n.hotel) return { ...n.hotel, kind: 'hotel' };
  return { name: n.status === 'free' ? '当日探す' : '宿（まだ）', ...fallback, kind: n.status === 'free' ? 'free' : 'tbd', tbd: true };
}

export function makeDays(dates, plan, around) {
  const last = dates.length - 1;
  const fb = around || { lat: 0, lng: 0 };
  return dates.map((d, i) => {
    const cur = i < last ? plan.nights[i] : null;
    const leaveT = plan.leave && plan.leave.time ? hm(plan.leave.time) - 15 : hm('21:00');
    return {
      ...d,
      start: i === 0 ? (plan.arrive && plan.arrive.lat != null ? { ...plan.arrive, kind: 'station' } : null) : nightPoint(plan.nights[i - 1], fb),
      startTime: hm(i === 0 ? (plan.arrive && plan.arrive.time) || '9:00' : plan.starts[i]),
      end: i === last ? (plan.leave && plan.leave.lat != null ? { ...plan.leave, kind: 'station' } : null) : cur.status === 'free' ? null : nightPoint(cur, fb),
      endTime: i === last ? leaveT : hm(cur.status === 'free' ? '23:00' : cur.lastIn),
    };
  });
}

// 予定を組む。行きたい（want）の場所だけを使う
// tm（旅行中）：{ today: 日の番号, now: 'H:MM', here: {lat,lng} | null }
export function planTrip(trip, places, tm) {
  const dates = tripDates(trip);
  if (!dates.length) return null;
  const plan = normalizePlan(trip.plan, dates.length);
  const mode = plan.mode;
  const wants = places.filter((p) => p.trip_id === trip.id && p.status === 'want');
  const items = wants.map((p) => {
    const x = placePlan(p);
    return {
      ...p, id: p.id, name: p.name || '名前なしの場所', stay: x.stay, priority: x.priority,
      day: x.day != null && x.day < dates.length ? x.day : null,
      at: x.at ? hm(x.at) : null, until: x.until ? hm(x.until) : null, open: x.open ? hm(x.open) : null,
      closed: dates.map((d, i) => (closedOn(x.closed, d) ? i : -1)).filter((i) => i >= 0),
    };
  });
  const days = makeDays(dates, plan, middle(items));
  const assign = rebalance(days, items, autoAssign(days, items, {}, mode), {}, mode);
  const out = [];
  days.forEach((day0, d) => {
    let day = day0;
    // 前の夜が「当日探す」なら、前の日の最後の場所の近くから出発
    const prevLast = d > 0 && out[d - 1].order[out[d - 1].order.length - 1];
    if (d > 0 && plan.nights[d - 1].status === 'free') {
      day = { ...day, start: prevLast ? { name: `${prevLast.name}の近く`, lat: prevLast.lat, lng: prevLast.lng, kind: 'near' } : null };
    }
    const its = items.filter((p) => assign.get(p.id) === d);
    let order, skipped = [];
    const manual = plan.manual[d];
    if (manual && manual.length) {
      order = manual.map((id) => its.find((p) => p.id === id)).filter(Boolean);
      for (const p of its) {
        if (order.includes(p)) continue;
        const b = bestInsert(day, order, p, mode);
        if (p.priority === 'maybe' && (b.sim.over > 0 || b.sim.late > simulate(day, order, mode).late)) skipped.push(p);
        else order = b.order;
      }
    } else ({ order, skipped } = autoOrder(day, its, mode));
    let sim = simulate(day, order, mode), simDay = day;
    if (tm && tm.today === d && tm.here) {
      simDay = { ...day, start: { ...tm.here, name: '今いる場所', kind: 'here' }, startTime: hm(tm.now) };
      sim = simulate(simDay, order, mode);
    }
    out.push({ ...day, d, day, simDay, order, skipped, sim, edited: !!(manual && manual.length) });
  });
  return { dates, plan, mode, days: out };
}
