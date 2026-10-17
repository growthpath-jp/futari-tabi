// 順番と日割りのテストページ
import { SCENARIOS, METHODS } from './scenarios.js';
import { hm, fmt, MODES, simulate, autoOrder, autoAssign, rebalance, bestInsert, replanFrom, bearingText, travelMin } from '../js/plan.js';

const L = window.L;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYC = ['var(--d0)', 'var(--d1)', 'var(--d2)', 'var(--d3)'];
const DAYHEX = ['#2B5FA6', '#C46A16', '#2E7D4F', '#8E44AD'];
const KEY = 'futari-tabi-lab-v1';

// ---------- 状態 ----------
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
const ui = { sid: saved.sid || SCENARIOS[0].id, method: saved.method || 'A', mode: null };
const runs = saved.runs || {};        // シナリオ×決め方ごとの操作
const feedback = saved.feedback || {}; // シナリオごとの感想
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ sid: ui.sid, method: ui.method, runs, feedback })); } catch { /* 保存できなくても動かす */ } };

const sc = () => SCENARIOS.find((s) => s.id === ui.sid);
function run() {
  const k = ui.sid + ':' + ui.method;
  if (!runs[k]) runs[k] = { pinned: {}, manual: {}, edited: {}, prio: {}, cancel: {}, done: {}, mode: sc().mode, trip: !!sc().trip, today: 0, now: sc().trip ? '13:00' : null, here: null, replan: null, snap: null };
  return runs[k];
}

function prepared() {
  const s = sc(), r = run();
  const days = s.days.map((d) => ({ ...d, startTime: hm(d.startTime), endTime: hm(d.endTime) }));
  const all = s.places.map((p) => ({
    ...p, at: p.at ? hm(p.at) : null, until: p.until ? hm(p.until) : null,
    priority: r.prio[p.id] || p.priority, done: r.done[p.id] ?? !!p.done,
  }));
  return { days, all };
}

// ---------- 計算 ----------
function compute() {
  const r = run();
  const { days, all } = prepared();
  const active = all.filter((p) => !r.cancel[p.id]);
  let assign;
  if (ui.method === 'B') {
    assign = new Map();
    active.forEach((p) => { const d = r.pinned[p.id] ?? p.day; if (d != null) assign.set(p.id, d); });
  } else if (ui.method === 'C') {
    if (!r.snap) {
      const a = rebalance(days, active, autoAssign(days, active, {}), {}, r.mode);
      r.snap = Object.fromEntries(a);
      days.forEach((day, d) => { r.manual[d] = autoOrder(day, active.filter((p) => a.get(p.id) === d), r.mode).order.map((p) => p.id); });
    }
    assign = new Map(active.map((p) => [p.id, r.pinned[p.id] ?? r.snap[p.id] ?? 0]));
  } else {
    assign = rebalance(days, active, autoAssign(days, active, r.pinned), r.pinned, r.mode);
  }

  const out = days.map((day, d) => {
    const items = active.filter((p) => assign.get(p.id) === d);
    let order, skipped = [];
    if (r.manual[d]) {
      order = r.manual[d].map((id) => items.find((p) => p.id === id)).filter(Boolean);
      for (const p of items) {
        if (order.includes(p)) continue;
        const b = bestInsert(day, order, p, r.mode);
        const before = simulate(day, order, r.mode);
        // 「行けたら」は時間に収まる時だけ入れる。収まらなければ見送り候補のまま
        if (p.priority === 'maybe' && (b.sim.over > 0 || b.sim.late > before.late)) skipped.push(p);
        else order = b.order;
      }
      r.manual[d] = order.map((p) => p.id);
    } else {
      ({ order, skipped } = autoOrder(day, items, r.mode));
    }
    let sim = simulate(day, order, r.mode);
    let doneList = [], remaining = order, simDay = day;
    if (r.trip && d === r.today) {
      doneList = order.filter((p) => p.done);
      remaining = order.filter((p) => !p.done);
      if (r.replan) remaining = r.replan.map((id) => remaining.find((p) => p.id === id)).filter(Boolean).concat(remaining.filter((p) => !r.replan.includes(p.id)));
      if (r.here && r.now) { simDay = { ...day, start: r.here, startTime: hm(r.now) }; sim = simulate(simDay, remaining, r.mode); }
    }
    return { day, d, order, skipped, sim, doneList, remaining, simDay };
  });
  const unassigned = ui.method === 'B' ? active.filter((p) => !assign.has(p.id)) : [];
  const cancelled = all.filter((p) => r.cancel[p.id]);
  return { days: out, unassigned, cancelled };
}

// ---------- 地図 ----------
let map, layer, stationLayer, stationKey = '';
function initMap() {
  if (!L) { $('#map').innerHTML = '<div class="map-fallback">地図を読み込めませんでした</div>'; return; }
  map = L.map($('#map'), { zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, className: 'tiles-original', attribution: '© OpenStreetMap' }).addTo(map);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { minZoom: 5, maxZoom: 18, className: 'tiles-original', bounds: [[20, 122], [46, 154]], attribution: '地理院タイル' }).addTo(map);
  layer = L.layerGroup().addTo(map);
  stationLayer = L.layerGroup().addTo(map);
  map.on('click', (e) => {
    const r = run();
    if (!r.trip) return;
    r.here = { lat: e.latlng.lat, lng: e.latlng.lng, name: '今いる場所' };
    save(); render();
  });
  map.on('moveend', () => { if (run().trip) loadStations(); });
}

function pin(html, cls, color) {
  return L.divIcon({ className: 'pin-wrap', html: `<span class="lab-pin ${cls || ''}" style="${color ? 'background:' + color : ''}">${html}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}
function anchorIcon(text) {
  return L.divIcon({ className: 'pin-wrap', html: `<span class="lab-anchor">${esc(text)}</span>`, iconSize: [40, 22], iconAnchor: [20, 11] });
}

let fitted = '';
function drawMap(res) {
  if (!map) return;
  layer.clearLayers();
  const r = run();
  const pts = [];
  const anchors = new Map();
  res.days.forEach(({ day, d, order, skipped, remaining, simDay, doneList }) => {
    const color = DAYHEX[d % 4];
    const isToday = r.trip && d === r.today;
    const seq = isToday && r.here ? [simDay.start, ...remaining, day.end] : [day.start, ...order, day.end];
    L.polyline(seq.map((p) => [p.lat, p.lng]), { color, weight: 3, opacity: isToday || !r.trip ? 0.85 : 0.35, className: 'route' }).addTo(layer);
    [day.start, day.end].forEach((a) => anchors.set(a.name, a));
    let n = 0;
    order.forEach((p) => {
      const idx = isToday ? (doneList.includes(p) ? '✓' : String(remaining.indexOf(p) + 1)) : String(++n);
      L.marker([p.lat, p.lng], { icon: pin(idx, doneList.includes(p) ? 'skip' : '', color), title: p.name }).addTo(layer);
      pts.push([p.lat, p.lng]);
    });
    skipped.forEach((p) => { L.marker([p.lat, p.lng], { icon: pin('?', 'unset skip'), title: p.name + '（見送り候補）' }).addTo(layer); pts.push([p.lat, p.lng]); });
  });
  res.unassigned.forEach((p) => { L.marker([p.lat, p.lng], { icon: pin('?', 'unset'), title: p.name + '（未定）' }).addTo(layer); pts.push([p.lat, p.lng]); });
  res.cancelled.forEach((p) => L.marker([p.lat, p.lng], { icon: pin('×', 'unset skip'), title: p.name + '（中止）' }).addTo(layer));
  anchors.forEach((a) => { L.marker([a.lat, a.lng], { icon: anchorIcon(a.name.includes('宿') ? '宿' : a.name.replace(/（.*）/, '')), title: a.name }).addTo(layer); pts.push([a.lat, a.lng]); });
  if (r.trip && r.here) {
    L.marker([r.here.lat, r.here.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<span class="lab-here"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), title: '今いる場所', zIndexOffset: 1000 }).addTo(layer);
    const today = res.days[r.today];
    const next = today && today.remaining[0];
    if (next) L.polyline([[r.here.lat, r.here.lng], [next.lat, next.lng]], { color: '#1A73E8', weight: 4, dashArray: '2 8', lineCap: 'round', className: 'route-next' }).addTo(layer);
  }
  const key = ui.sid + ui.method;
  if (fitted !== key && pts.length) { map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 15 }); fitted = key; }
}

// 旅行中モード：表示している範囲の駅を目立たせる（OpenStreetMapの駅データ）
async function loadStations() {
  if (!map || map.getZoom() < 13) { stationLayer.clearLayers(); stationKey = ''; return; }
  const b = map.getBounds();
  const key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((x) => x.toFixed(2)).join(',');
  if (key === stationKey) return;
  stationKey = key;
  try {
    const q = `[out:json][timeout:15];node["railway"="station"](${key});out 80;`;
    const res = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
    const js = await res.json();
    stationLayer.clearLayers();
    for (const n of js.elements || []) {
      const name = (n.tags && (n.tags.name || n.tags['name:ja'])) || '駅';
      L.marker([n.lat, n.lon], { icon: L.divIcon({ className: 'pin-wrap', html: `<span class="lab-station">${esc(name)}</span>`, iconSize: [0, 0] }), title: name, interactive: false }).addTo(stationLayer);
    }
  } catch { /* 駅が取れなくても地図はそのまま */ }
}

// ---------- 画面 ----------
function renderTop() {
  const s = sc(), r = run();
  $('#sc').innerHTML = SCENARIOS.map((x) => `<option value="${x.id}" ${x.id === ui.sid ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
  $('#guide-body').innerHTML = `<p class="guide-goal"><b>確かめること：</b>${esc(s.goal)}</p><ol class="guide-steps">${s.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
  $('#methods').innerHTML = Object.entries(METHODS).map(([k, m]) => `<label class="seg"><input type="radio" name="method" value="${k}" ${k === ui.method ? 'checked' : ''}>${m.label}：${esc(m.title)}</label>`).join('');
  $('#method-desc').textContent = METHODS[ui.method].desc;
  $('#modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<label class="seg"><input type="radio" name="mode" value="${k}" ${k === r.mode ? 'checked' : ''}>${m.label}</label>`).join('');
  const tb = $('#trip-toggle');
  tb.setAttribute('aria-pressed', String(r.trip));
  tb.textContent = r.trip ? '旅行中モード：オン' : '旅行中モード：オフ';
  $('#trip-ctrls').hidden = !r.trip;
  $('#today').innerHTML = s.days.map((d, i) => `<option value="${i}" ${i === r.today ? 'selected' : ''}>${esc(d.label)}</option>`).join('');
  const times = []; for (let t = 6 * 60; t <= 21 * 60; t += 30) times.push(fmt(t));
  $('#now').innerHTML = times.map((t) => `<option ${t === (r.now || '13:00') ? 'selected' : ''}>${t}</option>`).join('');
  const hint = $('#map-hint');
  hint.hidden = !(r.trip && !r.here);
  hint.textContent = '地図をタップして「今いる場所」を決めてください';
  const fb = feedback[ui.sid] || {};
  $('#fb-best').innerHTML = [...Object.keys(METHODS), 'どれも違う'].map((k) => `<label class="check card"><input type="radio" name="fb" value="${k}" ${fb.best === k ? 'checked' : ''}>${k.length === 1 ? k + '：' + esc(METHODS[k].title) : k}</label>`).join('');
  $('#fb-memo').value = fb.memo || '';
}

function render() {
  const r = run();
  const res = compute();
  save();
  renderTop();
  const s = sc();
  const nd = s.days.length;

  $('#days').innerHTML = res.days.map(({ day, d, order, skipped, sim, doneList, remaining, simDay }) => {
    const isToday = r.trip && d === r.today;
    const list = isToday ? [...doneList, ...remaining] : order;
    const rowsById = new Map(sim.rows.map((x) => [x.id, x]));
    const head = `<div class="day-head"><h2><span class="day-dot" style="background:${DAYC[d % 4]}"></span>${esc(day.label)}${isToday ? '（今日）' : ''}</h2>
      <span class="day-sum">移動 合計${Math.round(sim.travel)}分 ・ ${fmt(sim.finish)}に${esc(day.end.name)}着</span>
      ${sim.over > 0 ? `<span class="day-warn">予定より${Math.round(sim.over)}分オーバー</span>` : ''}
      ${r.edited[d] ? `<button class="mini" type="button" data-act="auto" data-d="${d}">おまかせの順番に戻す</button>` : ''}</div>`;
    const start = isToday && r.here ? simDay.start : day.start;
    const startT = isToday && r.here ? simDay.startTime : day.startTime;
    const rows = list.map((p) => {
      const isDone = doneList.includes(p);
      const x = rowsById.get(p.id);
      const num = isToday ? (isDone ? '✓' : remaining.indexOf(p) + 1) : order.indexOf(p) + 1;
      const pos = list.indexOf(p);
      const tags = [
        p.at != null ? `<span class="tag tag-time">時刻 ${fmt(p.at)}</span>` : '',
        p.until != null ? `<span class="tag tag-time">〜${fmt(p.until)}</span>` : '',
        p.priority === 'maybe' ? '<span class="tag tag-maybe">行けたら</span>' : '',
        p.day != null && ui.method !== 'B' ? '<span class="tag">日が決まっている</span>' : '',
        r.pinned[p.id] != null && ui.method !== 'B' ? '<span class="tag">手で移した</span>' : '',
      ].join('');
      const dayOpts = s.days.map((dd, i) => `<option value="${i}" ${i === d ? 'selected' : ''}>${esc(dd.label)}</option>`).join('') + (ui.method === 'B' ? '<option value="none">未定に戻す</option>' : '');
      return `<li class="prow ${isDone ? 'is-done' : ''}" data-id="${p.id}" data-d="${d}">
        <button class="handle" type="button" aria-label="${esc(p.name)}を並べ替え（ドラッグ）" ${isDone ? 'disabled' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></button>
        <span class="num" style="background:${DAYC[d % 4]}">${num}</span>
        <div class="pmain"><b>${esc(p.name)}</b>
          <span class="pmeta">${isDone ? '行った' : x ? `${fmt(x.arrive)}着 ・ 滞在${p.stay}分 ・ 移動${Math.round(x.move)}分${x.wait > 1 ? ` ・ 待ち${Math.round(x.wait)}分` : ''}` : ''}</span>
          ${x && x.warn ? `<span class="pwarn">${esc(x.warn)}</span>` : ''}
          ${p.note ? `<span class="pmeta">${esc(p.note)}</span>` : ''}
          <div class="tags">${tags}</div></div>
        <div class="updown"><button type="button" data-act="up" aria-label="上へ" ${pos === 0 || isDone ? 'disabled' : ''}>↑</button><button type="button" data-act="down" aria-label="下へ" ${pos === list.length - 1 || isDone ? 'disabled' : ''}>↓</button></div>
        <div class="pctrl">
          ${nd > 1 ? `<label class="sr-only" for="mv-${p.id}">何日目</label><select id="mv-${p.id}" data-act="move">${dayOpts}</select>` : ''}
          <button class="mini ${p.priority === 'maybe' ? 'on' : ''}" type="button" data-act="prio">行けたら</button>
          ${r.trip && isToday ? `<button class="mini ${isDone ? 'on' : ''}" type="button" data-act="done">済</button><button class="mini" type="button" data-act="cancel">中止</button>` : ''}
        </div></li>`;
    }).join('');
    const skip = skipped.length ? `<div class="stack"><span class="label">見送り候補（時間に収まらない「行けたら」）</span>${skipped.map((p) => `<div class="prow" data-id="${p.id}" data-d="${d}"><span></span><span class="num lab-pin unset">?</span><div class="pmain"><b>${esc(p.name)}</b><span class="pmeta">滞在${p.stay}分</span></div><span></span><div class="pctrl"><button class="mini" type="button" data-act="force">この日に入れる</button><button class="mini on" type="button" data-act="prio">行けたら</button></div></div>`).join('')}</div>` : '';
    return `<section class="day" aria-label="${esc(day.label)}">${head}
      <div class="endpoint"><span class="sq"></span>出発 <b>${esc(start.name)}</b> ${fmt(startT)}</div>
      <ul class="day-list" data-d="${d}">${rows || '<li class="empty">この日の場所はまだありません</li>'}</ul>
      <div class="endpoint"><span class="sq"></span>到着 <b>${esc(day.end.name)}</b> ${fmt(sim.finish)}（目安 ${fmt(day.endTime)}まで）</div>
      ${skip}</section>`;
  }).join('');

  let extra = '';
  if (res.unassigned.length) {
    extra += `<div class="stack"><h2>未定（まだ日を選んでいない場所）</h2>${res.unassigned.map((p) => `<div class="prow" data-id="${p.id}"><span></span><span class="num lab-pin unset">?</span><div class="pmain"><b>${esc(p.name)}</b><span class="pmeta">滞在${p.stay}分${p.priority === 'maybe' ? ' ・ 行けたら' : ''}</span></div><span></span><div class="pctrl daychips">${s.days.map((dd, i) => `<button class="mini" type="button" data-act="pick" data-to="${i}">${esc(dd.label)}</button>`).join('')}</div></div>`).join('')}</div>`;
  }
  if (res.cancelled.length) {
    extra += `<div class="stack"><h2>中止した場所</h2>${res.cancelled.map((p) => `<div class="prow" data-id="${p.id}"><span></span><span class="num lab-pin unset">×</span><div class="pmain"><b>${esc(p.name)}</b></div><span></span><div class="pctrl"><button class="mini" type="button" data-act="uncancel">元に戻す</button></div></div>`).join('')}</div>`;
  }
  $('#extra').innerHTML = extra;

  // 旅行中：次の目的地
  const nextBox = $('#next');
  if (r.trip) {
    const today = res.days[r.today];
    const next = today && today.remaining[0];
    nextBox.hidden = false;
    if (!r.here) nextBox.innerHTML = '<b>旅行中モード</b><span>地図をタップして「今いる場所」を決めるか、「本物の現在地」を押してください。</span>';
    else if (!next) nextBox.innerHTML = '<b>今日の予定はすべて終わりました</b>';
    else {
      const mv = Math.round(travelMin(r.here, next, r.mode));
      const url = `https://www.google.com/maps/dir/?api=1&origin=${r.here.lat},${r.here.lng}&destination=${encodeURIComponent(next.name)}&travelmode=${r.mode === 'car' ? 'driving' : r.mode === 'walk' ? 'walking' : 'transit'}`;
      nextBox.innerHTML = `<b>次は「${esc(next.name)}」</b><span>${bearingText(r.here, next)} ・ 移動の目安 約${mv}分</span>
        <div class="row-inline wrap"><button class="btn primary small" type="button" id="replan">今いる場所から並べ直す</button>
        <a class="btn small" href="${url}" target="_blank" rel="noopener">Googleマップで道案内</a></div>`;
    }
  } else nextBox.hidden = true;

  drawMap(res);
  if (r.trip) loadStations(); else if (stationLayer) stationLayer.clearLayers();
}

// ---------- 操作 ----------
function orderOf(d) {
  const res = compute();
  const x = res.days[d];
  const r = run();
  return (r.trip && d === r.today) ? [...x.doneList, ...x.remaining].map((p) => p.id) : x.order.map((p) => p.id);
}

function setOrder(d, ids) {
  const r = run();
  if (r.trip && d === r.today) {
    const { all } = prepared();
    r.replan = ids.filter((id) => !all.find((p) => p.id === id).done);
  }
  r.manual[d] = ids;
  r.edited[d] = true;
}

function moveToDay(id, from, to) {
  const r = run();
  if (to === 'none') delete r.pinned[id];
  else r.pinned[id] = Number(to);
  if (from != null && r.manual[from]) r.manual[from] = r.manual[from].filter((x) => x !== id);
  // A：移した先以外の日は自動で並び直す。手で並べた日はそのまま差し込み
  if (ui.method === 'A') Object.keys(r.manual).forEach((d) => { if (!r.edited[d]) delete r.manual[d]; });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const r = run();
  const row = b.closest('[data-id]');
  const id = row && row.dataset.id;
  const d = row && row.dataset.d != null ? Number(row.dataset.d) : (b.dataset.d != null ? Number(b.dataset.d) : null);
  const act = b.dataset.act;
  if (act === 'up' || act === 'down') {
    const ids = orderOf(d);
    const i = ids.indexOf(id), j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(d, ids);
  } else if (act === 'auto') {
    delete r.manual[d]; delete r.edited[d]; r.replan = null;
    if (ui.method === 'C') r.snap = null;
  } else if (act === 'prio') {
    const { all } = prepared();
    const p = all.find((x) => x.id === id);
    r.prio[id] = p.priority === 'maybe' ? 'must' : 'maybe';
  } else if (act === 'pick') {
    moveToDay(id, null, b.dataset.to);
  } else if (act === 'force') {
    setOrder(d, orderOf(d)); r.prio[id] = 'must';
  } else if (act === 'done') {
    const { all } = prepared();
    r.done[id] = !all.find((x) => x.id === id).done;
  } else if (act === 'cancel') {
    r.cancel[id] = true;
  } else if (act === 'uncancel') {
    delete r.cancel[id];
  } else return;
  render();
});

document.addEventListener('change', (e) => {
  const t = e.target;
  const r = run();
  if (t.id === 'sc') { ui.sid = t.value; fitted = ''; render(); return; }
  if (t.name === 'method') { ui.method = t.value; fitted = ''; render(); return; }
  if (t.name === 'mode') { r.mode = t.value; if (ui.method === 'C') r.snap = null; render(); return; }
  if (t.id === 'today') { r.today = Number(t.value); r.replan = null; render(); return; }
  if (t.id === 'now') { r.now = t.value; render(); return; }
  if (t.dataset && t.dataset.act === 'move') {
    const row = t.closest('[data-id]');
    moveToDay(row.dataset.id, Number(row.dataset.d), t.value);
    render(); return;
  }
  if (t.name === 'fb') { feedback[ui.sid] = { ...(feedback[ui.sid] || {}), best: t.value }; save(); }
});
$('#fb-memo').addEventListener('input', (e) => { feedback[ui.sid] = { ...(feedback[ui.sid] || {}), memo: e.target.value }; save(); });

$('#reset').addEventListener('click', () => { delete runs[ui.sid + ':' + ui.method]; fitted = ''; render(); });
$('#trip-toggle').addEventListener('click', () => {
  const r = run(); r.trip = !r.trip;
  if (r.trip && !r.now) r.now = '13:00';
  render();
});
$('#gps').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const r = run(); r.here = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: '今いる場所' };
    render(); if (map) map.setView([r.here.lat, r.here.lng], 15);
  }, () => { alertBox('現在地を取得できませんでした。地図をタップして決めてください。'); });
});
document.addEventListener('click', (e) => {
  if (e.target.id !== 'replan') return;
  const r = run();
  const res = compute();
  const today = res.days[r.today];
  const { order } = replanFrom(today.day, r.here, hm(r.now), today.remaining, r.mode);
  r.replan = order.map((p) => p.id);
  r.manual[r.today] = [...today.doneList.map((p) => p.id), ...r.replan];
  render();
});
$('#fb-copy').addEventListener('click', async () => {
  const lines = ['【順番と日割りのテスト 感想】'];
  for (const s of SCENARIOS) {
    const f = feedback[s.id] || {};
    const best = f.best ? (f.best.length === 1 ? `${f.best}（${METHODS[f.best].title}）` : f.best) : '未回答';
    lines.push('', s.title, `しっくりきた決め方：${best}`, `感じたこと：${f.memo || 'なし'}`);
  }
  const text = lines.join('\n');
  const out = $('#fb-out'); out.textContent = text; out.hidden = false;
  try { await navigator.clipboard.writeText(text); alertBox('コピーしました。チャットに貼り付けてください'); }
  catch { const rg = document.createRange(); rg.selectNodeContents(out); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); alertBox('下の文を長押ししてコピーしてください'); }
});

function alertBox(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// ---------- ドラッグで並べ替え（つまみ：すぐ／行全体：長押し） ----------
let drag = null;
function startDrag(row, y) {
  const list = row.parentElement;
  drag = { row, list, d: Number(list.dataset.d), offset: y - row.getBoundingClientRect().top };
  row.classList.add('is-dragging');
  if (navigator.vibrate) navigator.vibrate(10);
}
function moveDrag(y) {
  if (!drag) return;
  const { row, list } = drag;
  row.style.transform = '';
  const h = row.getBoundingClientRect().height;
  const center = y - drag.offset + h / 2;
  const prev = row.previousElementSibling, next = row.nextElementSibling;
  const mid = (el) => { const rc = el.getBoundingClientRect(); return rc.top + rc.height / 2; };
  if (prev && prev.classList.contains('prow') && !prev.classList.contains('is-done') && center < mid(prev)) list.insertBefore(row, prev);
  else if (next && next.classList.contains('prow') && center > mid(next)) list.insertBefore(next, row);
  const natural = row.getBoundingClientRect().top;
  row.style.transform = `translateY(${y - drag.offset - natural}px)`;
}
function endDrag() {
  if (!drag) return;
  const { row, list, d } = drag;
  row.classList.remove('is-dragging'); row.style.transform = '';
  const ids = [...list.querySelectorAll('.prow')].map((x) => x.dataset.id);
  drag = null;
  setOrder(d, ids);
  render();
}
let pressTimer = null, pressStart = null;
document.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.day-list .prow');
  if (!row || row.classList.contains('is-done')) return;
  if (e.target.closest('.handle')) { e.preventDefault(); startDrag(row, e.clientY); return; }
  if (e.target.closest('button, select, a, input')) return;
  pressStart = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => { startDrag(row, pressStart.y); }, 450);
});
document.addEventListener('pointermove', (e) => {
  if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) { clearTimeout(pressTimer); pressTimer = null; }
  if (drag) { e.preventDefault(); moveDrag(e.clientY); }
}, { passive: false });
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
const finish = () => { clearTimeout(pressTimer); pressTimer = null; endDrag(); };
document.addEventListener('pointerup', finish);
document.addEventListener('pointercancel', finish);

initMap();
render();
