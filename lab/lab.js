// 神戸旅行テスト：場所の登録 → 日割り・順番（案D：登録時に決めた分だけ固定、残りはおまかせ）
import { DATES, SHIN_KOBE, BASES, DEFAULT_TRIP, CANDIDATES, SCENARIOS, closedDays } from './kobe.js';
import { hm, fmt, MODES, simulate, autoOrder, autoAssign, rebalance, bestInsert, replanFrom, bearingText, travelMin, isClosed } from '../js/plan.js';
import { extractAddress } from '../js/logic.js';
import { geocodeAddress, searchByName } from '../js/geo.js';

const L = window.L;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYC = ['var(--d0)', 'var(--d1)', 'var(--d2)', 'var(--d3)'];
const DAYHEX = ['#2B5FA6', '#C46A16', '#2E7D4F', '#8E44AD'];
const KEY = 'futari-tabi-kobe-v1';
const TIMES = (from, to, step) => { const a = []; for (let t = hm(from); t <= hm(to); t += step) a.push(fmt(t)); return a; };
const KOBE = { lat: 34.6913, lng: 135.1830 };

// ---------- 状態 ----------
let st;
try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { st = null; }
if (!st || !st.trip) st = { sid: SCENARIOS[0].id, places: [], trip: { ...DEFAULT_TRIP }, manual: {}, edited: {}, tm: { on: false, today: 0, now: '13:00', here: null, replan: null }, done: {}, cancel: {}, feedback: {} };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 保存できなくても動かす */ } };
const sc = () => SCENARIOS.find((s) => s.id === st.sid) || SCENARIOS[0];
let uidN = Date.now();
const uid = () => 'p' + (uidN++).toString(36);

function loadScenario() {
  const s = sc();
  st.places = s.start().map((p) => ({ ...p, uid: uid(), day: p.day ?? null, at: p.at ?? null }));
  st.manual = {}; st.edited = {}; st.done = {}; st.cancel = {};
  st.trip = { ...DEFAULT_TRIP, nights: [...DEFAULT_TRIP.nights] };
  st.tm = s.tripMode ? { on: true, today: s.tripMode.today, now: s.tripMode.now, here: null, replan: null } : { on: false, today: 0, now: '13:00', here: null, replan: null };
  fitted = false;
}

// ---------- 計算 ----------
function makeDays() {
  const t = st.trip;
  const base = (i) => BASES[t.nights[i]];
  return DATES.map((d, i) => ({
    label: d.label,
    start: i === 0 ? SHIN_KOBE : base(i - 1),
    end: i === DATES.length - 1 ? SHIN_KOBE : base(i),
    startTime: i === 0 ? hm(t.arrive) : hm('9:00'),
    endTime: i === DATES.length - 1 ? hm(t.depart) - 15 : hm('21:00'),
  }));
}
function items() {
  return st.places.map((p) => ({
    ...p, id: p.uid,
    at: p.at ? hm(p.at) : null, until: p.until ? hm(p.until) : null, open: p.open ? hm(p.open) : null,
    closed: closedDays(p.closedRule), done: !!st.done[p.uid],
  }));
}

function compute() {
  const days = makeDays();
  const mode = st.trip.mode;
  const all = items();
  const active = all.filter((p) => !st.cancel[p.id]);
  const assign = rebalance(days, active, autoAssign(days, active, {}, mode), {}, mode);
  const out = days.map((day, d) => {
    const its = active.filter((p) => assign.get(p.id) === d);
    let order, skipped = [];
    if (st.manual[d]) {
      order = st.manual[d].map((id) => its.find((p) => p.id === id)).filter(Boolean);
      for (const p of its) {
        if (order.includes(p)) continue;
        const b = bestInsert(day, order, p, mode);
        if (p.priority === 'maybe' && (b.sim.over > 0 || b.sim.late > simulate(day, order, mode).late)) skipped.push(p);
        else order = b.order;
      }
      st.manual[d] = order.map((p) => p.id);
    } else ({ order, skipped } = autoOrder(day, its, mode));
    let sim = simulate(day, order, mode);
    let doneList = [], remaining = order, simDay = day;
    if (st.tm.on && d === st.tm.today) {
      doneList = order.filter((p) => p.done);
      remaining = order.filter((p) => !p.done);
      if (st.tm.replan) remaining = st.tm.replan.map((id) => remaining.find((p) => p.id === id)).filter(Boolean).concat(remaining.filter((p) => !st.tm.replan.includes(p.id)));
      if (st.tm.here) { simDay = { ...day, start: st.tm.here, startTime: hm(st.tm.now) }; sim = simulate(simDay, remaining, mode); }
    }
    return { day, d, order, skipped, sim, doneList, remaining, simDay };
  });
  return { days: out, cancelled: all.filter((p) => st.cancel[p.id]) };
}

// ---------- 地図 ----------
let map, layer, stationLayer, stationKey = '', fitted = false;
function initMap() {
  if (!L) { $('#map').innerHTML = '<div class="map-fallback">地図を読み込めませんでした</div>'; return; }
  map = L.map($('#map'), { zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, className: 'tiles-original', attribution: '© OpenStreetMap' }).addTo(map);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { minZoom: 5, maxZoom: 18, className: 'tiles-original', bounds: [[20, 122], [46, 154]], attribution: '地理院タイル' }).addTo(map);
  map.setView([KOBE.lat, KOBE.lng], 12);
  layer = L.layerGroup().addTo(map);
  stationLayer = L.layerGroup().addTo(map);
  map.on('click', (e) => {
    if (!st.tm.on) return;
    st.tm.here = { lat: e.latlng.lat, lng: e.latlng.lng, name: '今いる場所' };
    render();
  });
  map.on('moveend', () => { if (st.tm.on) loadStations(); });
}
const pin = (html, cls, color) => L.divIcon({ className: 'pin-wrap', html: `<span class="lab-pin ${cls || ''}" style="${color ? 'background:' + color : ''}">${html}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
const anchorIcon = (text) => L.divIcon({ className: 'pin-wrap', html: `<span class="lab-anchor">${esc(text)}</span>`, iconSize: [48, 22], iconAnchor: [24, 11] });

function drawMap(res) {
  if (!map) return;
  layer.clearLayers();
  const pts = [];
  const anchors = new Map();
  res.days.forEach(({ day, d, order, skipped, remaining, simDay, doneList }) => {
    const color = DAYHEX[d % 4];
    const isToday = st.tm.on && d === st.tm.today;
    const seq = isToday && st.tm.here ? [simDay.start, ...remaining, day.end] : [day.start, ...order, day.end];
    if (order.length) L.polyline(seq.map((p) => [p.lat, p.lng]), { color, weight: 3, opacity: !st.tm.on || isToday ? 0.85 : 0.3, className: 'route' }).addTo(layer);
    [day.start, day.end].forEach((a) => anchors.set(a.name, a));
    order.forEach((p, i) => {
      const label = isToday ? (doneList.includes(p) ? '✓' : String(remaining.indexOf(p) + 1)) : String(i + 1);
      L.marker([p.lat, p.lng], { icon: pin(label, doneList.includes(p) ? 'skip' : '', color), title: p.name }).addTo(layer);
      pts.push([p.lat, p.lng]);
    });
    skipped.forEach((p) => { L.marker([p.lat, p.lng], { icon: pin('?', 'unset skip'), title: p.name + '（見送り候補）' }).addTo(layer); pts.push([p.lat, p.lng]); });
  });
  res.cancelled.forEach((p) => L.marker([p.lat, p.lng], { icon: pin('×', 'unset skip'), title: p.name + '（中止）' }).addTo(layer));
  anchors.forEach((a) => { L.marker([a.lat, a.lng], { icon: anchorIcon(a.name.replace(/^宿（(.*)）$/, '宿:$1').replace('駅', '')), title: a.name }).addTo(layer); pts.push([a.lat, a.lng]); });
  if (st.tm.on && st.tm.here) {
    L.marker([st.tm.here.lat, st.tm.here.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<span class="lab-here"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), title: '今いる場所', zIndexOffset: 1000 }).addTo(layer);
    const next = res.days[st.tm.today] && res.days[st.tm.today].remaining[0];
    if (next) L.polyline([[st.tm.here.lat, st.tm.here.lng], [next.lat, next.lng]], { color: '#1A73E8', weight: 4, dashArray: '2 8', lineCap: 'round', className: 'route-next' }).addTo(layer);
  }
  if (!fitted && pts.length > 1) { map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 14 }); fitted = true; }
}

async function loadStations() {
  if (!map || map.getZoom() < 13) { stationLayer.clearLayers(); stationKey = ''; return; }
  const b = map.getBounds();
  const key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((x) => x.toFixed(2)).join(',');
  if (key === stationKey) return;
  stationKey = key;
  try {
    const q = `[out:json][timeout:15];node["railway"="station"](${key});out 80;`;
    const js = await (await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q))).json();
    stationLayer.clearLayers();
    for (const n of js.elements || []) {
      const name = (n.tags && (n.tags.name || n.tags['name:ja'])) || '駅';
      L.marker([n.lat, n.lon], { icon: L.divIcon({ className: 'pin-wrap', html: `<span class="lab-station">${esc(name)}</span>`, iconSize: [0, 0] }), title: name, interactive: false }).addTo(stationLayer);
    }
  } catch { /* 駅が取れなくても地図はそのまま */ }
}

// ---------- 登録フォーム ----------
let draft = null; // { uid?, name, lat, lng, day, at, until, open, stay, priority, note, closedRule, id }
function openForm(d) {
  draft = { day: null, at: null, until: null, open: null, stay: 60, priority: 'must', note: '', ...d };
  renderForm();
  $('#form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderForm() {
  const f = $('#form');
  if (!draft) { f.hidden = true; f.innerHTML = ''; return; }
  f.hidden = false;
  const editing = !!draft.uid;
  const opt = (v, cur, label) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${label}</option>`;
  const closed = closedDays(draft.closedRule).map((i) => DATES[i].label);
  f.innerHTML = `
    <b>${editing ? '登録内容を変える' : 'この場所を登録'}</b>
    <label for="f-name">名前</label><input id="f-name" value="${esc(draft.name)}" required>
    ${draft.note ? `<p class="hint">${esc(draft.note)}</p>` : ''}
    ${closed.length ? `<p class="pwarn">休み：${closed.join('・')}</p>` : ''}
    <div class="row2">
      <div class="stack"><label for="f-day">何日目</label><select id="f-day">${opt('', draft.day, '未定（おまかせ）')}${DATES.map((d, i) => opt(i, draft.day, d.label)).join('')}</select></div>
      <div class="stack"><label for="f-at">何時に行く</label><select id="f-at">${opt('', draft.at, '未定（おまかせ）')}${TIMES('7:00', '22:00', 30).map((t) => opt(t, draft.at, t)).join('')}</select></div>
      <div class="stack"><label for="f-until">何時までに着く</label><select id="f-until">${opt('', draft.until, 'なし')}${TIMES('9:00', '22:00', 30).map((t) => opt(t, draft.until, t + 'まで')).join('')}</select></div>
      <div class="stack"><label for="f-stay">いる時間</label><select id="f-stay">${[30, 45, 60, 90, 120, 150, 180, 240].map((m) => opt(m, draft.stay, m < 60 ? m + '分' : (m / 60) + '時間')).join('')}</select></div>
    </div>
    <div class="segs" role="radiogroup" aria-label="行きたい度合い">
      <label class="seg"><input type="radio" name="f-prio" value="must" ${draft.priority !== 'maybe' ? 'checked' : ''}>絶対行く</label>
      <label class="seg"><input type="radio" name="f-prio" value="maybe" ${draft.priority === 'maybe' ? 'checked' : ''}>行けたら</label>
    </div>
    <div class="row-inline wrap">
      <button class="btn primary" type="submit">${editing ? '保存' : '登録する'}</button>
      <button class="btn" type="button" id="f-cancel">やめる</button>
      ${editing ? '<button class="btn danger small" type="button" id="f-del">この場所を消す</button>' : ''}
    </div>`;
  $('#f-cancel').onclick = () => { draft = null; renderForm(); };
  const del = $('#f-del');
  if (del) del.onclick = () => { st.places = st.places.filter((p) => p.uid !== draft.uid); Object.keys(st.manual).forEach((d) => { st.manual[d] = st.manual[d].filter((x) => x !== draft.uid); }); draft = null; render(); };
}
$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (id) => $(id).value;
  const p = {
    ...draft, name: v('#f-name').trim() || '名前なしの場所',
    day: v('#f-day') === '' ? null : Number(v('#f-day')),
    at: v('#f-at') || null, until: v('#f-until') || null, stay: Number(v('#f-stay')),
    priority: $('input[name="f-prio"]:checked').value,
  };
  if (p.uid) {
    const old = st.places.find((x) => x.uid === p.uid);
    if (old.day !== p.day) Object.keys(st.manual).forEach((d) => { st.manual[d] = st.manual[d].filter((x) => x !== p.uid); });
    Object.assign(old, p);
  } else st.places.push({ ...p, uid: uid() });
  draft = null;
  $('#results').innerHTML = ''; $('#q').value = '';
  render();
  toast(p.uid ? '保存しました' : '登録しました');
});

async function doSearch() {
  const q = $('#q').value.trim();
  const box = $('#results');
  if (!q) return;
  box.innerHTML = '<p class="sub">探しています…</p>';
  try {
    const addr = extractAddress(q);
    if (addr) {
      const g = await geocodeAddress(addr);
      if (!g) { box.innerHTML = '<p class="sub">見つかりませんでした</p>'; return; }
      box.innerHTML = '';
      openForm({ name: '', lat: g.lat, lng: g.lng, note: addr + (g.approx ? '（番地までは特定できず、近くの位置）' : '') });
      return;
    }
    const list = await searchByName(q, KOBE);
    if (!list.length) { box.innerHTML = '<p class="sub">見つかりませんでした。住所で探すか、候補から選んでください</p>'; return; }
    box.innerHTML = `<div class="results">${list.map((c, i) => `<button class="item" type="button" data-i="${i}"><span class="item-main"><b>${esc(c.name)}</b><small>${esc(c.area)}</small></span></button>`).join('')}</div>`;
    box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const c = list[Number(b.dataset.i)]; box.innerHTML = ''; openForm({ name: c.name, lat: c.lat, lng: c.lng }); }));
  } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}
$('#search').addEventListener('click', doSearch);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

// ---------- 画面 ----------
function renderTop() {
  const s = sc();
  $('#sc').innerHTML = SCENARIOS.map((x) => `<option value="${x.id}" ${x.id === st.sid ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
  $('#guide-body').innerHTML = `<p class="guide-goal"><b>確かめること：</b>${esc(s.goal)}</p><ol class="guide-steps">${s.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
  const t = st.trip;
  const sel = (id, cur, opts) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const baseOpts = Object.entries(BASES).map(([k, b]) => [k, b.name.replace(/^宿（(.*)）$/, '$1')]);
  $('#trip-body').innerHTML = `<div class="trip-grid">
    <div class="stack"><label for="t-arrive">10/31 新神戸に着く</label>${sel('t-arrive', t.arrive, TIMES('10:00', '15:00', 15).map((x) => [x, x]))}</div>
    <div class="stack"><label for="t-depart">11/3 新神戸を出る</label>${sel('t-depart', t.depart, TIMES('13:00', '20:00', 30).map((x) => [x, x]))}</div>
    ${[0, 1, 2].map((i) => `<div class="stack"><label for="t-n${i}">${i + 1}泊目（${DATES[i].label}）の宿</label>${sel('t-n' + i, t.nights[i], baseOpts)}</div>`).join('')}
    <div class="stack"><label for="t-mode">移動手段</label>${sel('t-mode', t.mode, Object.entries(MODES).map(([k, m]) => [k, m.label]))}</div>
  </div>`;
  const added = new Set(st.places.map((p) => p.id));
  $('#cands').innerHTML = CANDIDATES.map((c) => `<button class="mini ${added.has(c.id) ? 'added' : ''}" type="button" data-cand="${c.id}">${added.has(c.id) ? '✓ ' : '＋ '}${esc(c.name)}${c.priority === 'maybe' ? '（行けたら）' : ''}</button>`).join('');
  const tb = $('#trip-toggle');
  tb.setAttribute('aria-pressed', String(st.tm.on));
  tb.textContent = st.tm.on ? '旅行中モード：オン' : '旅行中モード：オフ';
  $('#trip-ctrls').hidden = !st.tm.on;
  $('#today').innerHTML = DATES.map((d, i) => `<option value="${i}" ${i === st.tm.today ? 'selected' : ''}>${d.label}</option>`).join('');
  $('#now').innerHTML = TIMES('8:00', '21:00', 30).map((x) => `<option ${x === st.tm.now ? 'selected' : ''}>${x}</option>`).join('');
  const hint = $('#map-hint');
  hint.hidden = !(st.tm.on && !st.tm.here);
  hint.textContent = '地図をタップして「今いる場所」を決めてください';
  const fb = st.feedback[st.sid] || {};
  $('#fb-fit').innerHTML = ['◎ しっくり', '○ だいたい', '△ いまいち', '× 違う'].map((k) => `<label class="check card"><input type="radio" name="fb-fit" value="${k}" ${fb.fit === k ? 'checked' : ''}>${k}</label>`).join('');
  $('#fb-want').innerHTML = ['何日目', '何時に行くか', 'いる時間', '絶対／行けたら', '何も決めたくない（おまかせでいい）'].map((k) => `<label class="check"><input type="checkbox" name="fb-want" value="${k}" ${(fb.want || []).includes(k) ? 'checked' : ''}>${k}</label>`).join('');
  $('#fb-memo').value = fb.memo || '';
}

function render() {
  const res = compute();
  save();
  renderTop();
  const mode = st.trip.mode;
  $('#days').innerHTML = res.days.map(({ day, d, order, skipped, sim, doneList, remaining, simDay }) => {
    const isToday = st.tm.on && d === st.tm.today;
    const list = isToday ? [...doneList, ...remaining] : order;
    const rows = new Map(sim.rows.map((x) => [x.id, x]));
    const start = isToday && st.tm.here ? simDay.start : day.start;
    const startT = isToday && st.tm.here ? simDay.startTime : day.startTime;
    const body = list.map((p) => {
      const isDone = doneList.includes(p);
      const x = rows.get(p.id);
      const num = isToday ? (isDone ? '✓' : remaining.indexOf(p) + 1) : order.indexOf(p) + 1;
      const pos = list.indexOf(p);
      const warn = (p.day != null && isClosed(p, d)) ? 'この日は休みです' : x && x.warn;
      const tags = [
        p.day != null ? '<span class="tag">日を決めた</span>' : '<span class="tag">日はおまかせ</span>',
        p.at != null ? `<span class="tag tag-time">${fmt(p.at)}に行く</span>` : '',
        p.until != null ? `<span class="tag tag-time">〜${fmt(p.until)}</span>` : '',
        p.priority === 'maybe' ? '<span class="tag tag-maybe">行けたら</span>' : '',
      ].join('');
      return `<li class="prow ${isDone ? 'is-done' : ''}" data-id="${p.id}" data-d="${d}">
        <button class="handle" type="button" aria-label="${esc(p.name)}を並べ替え（ドラッグ）" ${isDone ? 'disabled' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></button>
        <span class="num" style="background:${DAYC[d % 4]}">${num}</span>
        <div class="pmain"><b>${esc(p.name)}</b>
          <span class="pmeta">${isDone ? '行った' : x ? `${fmt(x.arrive)}着 ・ ${p.stay}分 ・ 移動${Math.round(x.move)}分${x.wait > 1 ? ` ・ 待ち${Math.round(x.wait)}分` : ''}` : ''}</span>
          ${warn ? `<span class="pwarn">${esc(warn)}</span>` : ''}
          <div class="tags">${tags}</div></div>
        <div class="updown"><button type="button" data-act="up" aria-label="上へ" ${pos === 0 || isDone ? 'disabled' : ''}>↑</button><button type="button" data-act="down" aria-label="下へ" ${pos === list.length - 1 || isDone ? 'disabled' : ''}>↓</button></div>
        <div class="pctrl">
          <label class="sr-only" for="mv-${p.id}">何日目</label>
          <select id="mv-${p.id}" data-act="move">${`<option value="" ${p.day == null ? 'selected' : ''}>おまかせ（${esc(day.label)}）</option>`}${DATES.map((dd, i) => `<option value="${i}" ${p.day === i ? 'selected' : ''}>${dd.label}に決める</option>`).join('')}</select>
          <button class="mini" type="button" data-act="edit">変更</button>
          ${st.tm.on && isToday ? `<button class="mini ${isDone ? 'on' : ''}" type="button" data-act="done">済</button><button class="mini" type="button" data-act="cancel">中止</button>` : ''}
        </div></li>`;
    }).join('');
    const skip = skipped.length ? `<div class="stack"><span class="label">見送り候補（時間に収まらない「行けたら」）</span>${skipped.map((p) => `<div class="prow" data-id="${p.id}" data-d="${d}"><span></span><span class="num lab-pin unset">?</span><div class="pmain"><b>${esc(p.name)}</b><span class="pmeta">${p.stay}分</span></div><span></span><div class="pctrl"><button class="mini" type="button" data-act="force">この日に入れる</button><button class="mini" type="button" data-act="edit">変更</button></div></div>`).join('')}</div>` : '';
    return `<section class="day" aria-label="${esc(day.label)}">
      <div class="day-head"><h2><span class="day-dot" style="background:${DAYC[d % 4]}"></span>${esc(day.label)}${isToday ? '（今日）' : ''}</h2>
        <span class="day-sum">移動 合計${Math.round(sim.travel)}分 ・ ${fmt(sim.finish)}に${esc(day.end.name)}</span>
        ${sim.over > 0 ? `<span class="day-warn">予定より${Math.round(sim.over)}分オーバー</span>` : ''}
        ${st.edited[d] ? `<button class="mini" type="button" data-act="auto" data-d="${d}">おまかせの順番に戻す</button>` : ''}</div>
      <div class="endpoint"><span class="sq"></span>出発 <b>${esc(start.name)}</b> ${fmt(startT)}</div>
      <ul class="day-list" data-d="${d}">${body || '<li class="empty">この日の場所はまだありません</li>'}</ul>
      <div class="endpoint"><span class="sq"></span>到着 <b>${esc(day.end.name)}</b> ${order.length ? fmt(sim.finish) : ''}（${d === DATES.length - 1 ? '新幹線に乗る15分前 ' : '目安 '}${fmt(day.endTime)}まで）</div>
      ${skip}</section>`;
  }).join('');

  $('#extra').innerHTML = res.cancelled.length ? `<div class="stack"><h2>中止した場所</h2>${res.cancelled.map((p) => `<div class="prow" data-id="${p.id}"><span></span><span class="num lab-pin unset">×</span><div class="pmain"><b>${esc(p.name)}</b></div><span></span><div class="pctrl"><button class="mini" type="button" data-act="uncancel">元に戻す</button></div></div>`).join('')}</div>` : '';

  const nextBox = $('#next');
  if (st.tm.on) {
    const next = res.days[st.tm.today] && res.days[st.tm.today].remaining[0];
    nextBox.hidden = false;
    if (!st.tm.here) nextBox.innerHTML = '<b>旅行中モード</b><span>地図をタップして「今いる場所」を決めるか、「本物の現在地」を押してください。</span>';
    else if (!next) nextBox.innerHTML = '<b>今日の予定はすべて終わりました</b>';
    else {
      const url = `https://www.google.com/maps/dir/?api=1&origin=${st.tm.here.lat},${st.tm.here.lng}&destination=${encodeURIComponent(next.name)}&travelmode=${mode === 'car' ? 'driving' : mode === 'walk' ? 'walking' : 'transit'}`;
      nextBox.innerHTML = `<b>次は「${esc(next.name)}」</b><span>${bearingText(st.tm.here, next)} ・ 移動の目安 約${Math.round(travelMin(st.tm.here, next, mode))}分</span>
        <div class="row-inline wrap"><button class="btn primary small" type="button" id="replan">今いる場所から並べ直す</button><a class="btn small" href="${url}" target="_blank" rel="noopener">Googleマップで道案内</a></div>`;
    }
  } else nextBox.hidden = true;

  drawMap(res);
  if (st.tm.on) loadStations(); else if (stationLayer) stationLayer.clearLayers();
}

// ---------- 操作 ----------
function orderOf(d) {
  const x = compute().days[d];
  return (st.tm.on && d === st.tm.today) ? [...x.doneList, ...x.remaining].map((p) => p.id) : x.order.map((p) => p.id);
}
function setOrder(d, ids) {
  if (st.tm.on && d === st.tm.today) st.tm.replan = ids.filter((id) => !st.done[id]);
  st.manual[d] = ids; st.edited[d] = true;
}
const place = (id) => st.places.find((p) => p.uid === id);

document.addEventListener('click', (e) => {
  const cand = e.target.closest('[data-cand]');
  if (cand) { const c = CANDIDATES.find((x) => x.id === cand.dataset.cand); openForm({ ...c, uid: undefined }); return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const row = b.closest('[data-id]');
  const id = row && row.dataset.id;
  const d = row && row.dataset.d != null ? Number(row.dataset.d) : (b.dataset.d != null ? Number(b.dataset.d) : null);
  const act = b.dataset.act;
  if (act === 'up' || act === 'down') {
    const ids = orderOf(d); const i = ids.indexOf(id), j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; setOrder(d, ids);
  } else if (act === 'auto') { delete st.manual[d]; delete st.edited[d]; st.tm.replan = null; }
  else if (act === 'edit') { openForm({ ...place(id) }); return; }
  else if (act === 'force') { setOrder(d, orderOf(d)); place(id).priority = 'must'; }
  else if (act === 'done') st.done[id] = !st.done[id];
  else if (act === 'cancel') st.cancel[id] = true;
  else if (act === 'uncancel') delete st.cancel[id];
  else return;
  render();
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'sc') { st.sid = t.value; loadScenario(); draft = null; renderForm(); render(); toast('シナリオの最初の状態にしました'); return; }
  if (t.id === 't-arrive') st.trip.arrive = t.value;
  else if (t.id === 't-depart') st.trip.depart = t.value;
  else if (/^t-n\d$/.test(t.id)) { st.trip.nights[Number(t.id.slice(3))] = t.value; st.manual = {}; st.edited = {}; }
  else if (t.id === 't-mode') st.trip.mode = t.value;
  else if (t.id === 'today') { st.tm.today = Number(t.value); st.tm.replan = null; }
  else if (t.id === 'now') st.tm.now = t.value;
  else if (t.dataset && t.dataset.act === 'move') {
    const row = t.closest('[data-id]');
    const p = place(row.dataset.id);
    p.day = t.value === '' ? null : Number(t.value);
    Object.keys(st.manual).forEach((d) => { st.manual[d] = st.manual[d].filter((x) => x !== p.uid); });
  } else if (t.name === 'fb-fit') { st.feedback[st.sid] = { ...(st.feedback[st.sid] || {}), fit: t.value }; save(); return; }
  else if (t.name === 'fb-want') { st.feedback[st.sid] = { ...(st.feedback[st.sid] || {}), want: [...document.querySelectorAll('input[name="fb-want"]:checked')].map((x) => x.value) }; save(); return; }
  else return;
  render();
});
$('#fb-memo').addEventListener('input', (e) => { st.feedback[st.sid] = { ...(st.feedback[st.sid] || {}), memo: e.target.value }; save(); });
$('#load').addEventListener('click', () => { loadScenario(); render(); toast('シナリオの最初の状態にしました'); });
$('#trip-toggle').addEventListener('click', () => { st.tm.on = !st.tm.on; render(); });
$('#gps').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    st.tm.here = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: '今いる場所' };
    render(); if (map) map.setView([st.tm.here.lat, st.tm.here.lng], 15);
  }, () => toast('現在地を取得できませんでした。地図をタップして決めてください'));
});
document.addEventListener('click', (e) => {
  if (e.target.id !== 'replan') return;
  const today = compute().days[st.tm.today];
  const { order } = replanFrom(today.day, st.tm.here, hm(st.tm.now), today.remaining, st.trip.mode);
  st.tm.replan = order.map((p) => p.id);
  st.manual[st.tm.today] = [...today.doneList.map((p) => p.id), ...st.tm.replan];
  render();
});
$('#fb-copy').addEventListener('click', async () => {
  const lines = ['【神戸旅行テスト 感想】'];
  for (const s of SCENARIOS) {
    const f = st.feedback[s.id] || {};
    lines.push('', s.title, `しっくり：${f.fit || '未回答'}`, `登録時に決めたかったこと：${(f.want || []).join('、') || '未回答'}`, `感じたこと：${f.memo || 'なし'}`);
  }
  const text = lines.join('\n');
  const out = $('#fb-out'); out.textContent = text; out.hidden = false;
  try { await navigator.clipboard.writeText(text); toast('コピーしました。チャットに貼り付けてください'); }
  catch { const rg = document.createRange(); rg.selectNodeContents(out); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); toast('下の文を長押ししてコピーしてください'); }
});

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// ---------- ドラッグで並べ替え（つまみ：すぐ／行全体：長押し） ----------
let drag = null;
function startDrag(row, y) {
  drag = { row, list: row.parentElement, d: Number(row.parentElement.dataset.d), offset: y - row.getBoundingClientRect().top };
  row.classList.add('is-dragging');
  if (navigator.vibrate) navigator.vibrate(10);
}
function moveDrag(y) {
  const { row, list } = drag;
  row.style.transform = '';
  const center = y - drag.offset + row.getBoundingClientRect().height / 2;
  const prev = row.previousElementSibling, next = row.nextElementSibling;
  const mid = (el) => { const rc = el.getBoundingClientRect(); return rc.top + rc.height / 2; };
  if (prev && prev.classList.contains('prow') && !prev.classList.contains('is-done') && center < mid(prev)) list.insertBefore(row, prev);
  else if (next && next.classList.contains('prow') && center > mid(next)) list.insertBefore(next, row);
  row.style.transform = `translateY(${y - drag.offset - row.getBoundingClientRect().top}px)`;
}
function endDrag() {
  if (!drag) return;
  const { row, list, d } = drag;
  row.classList.remove('is-dragging'); row.style.transform = '';
  drag = null;
  setOrder(d, [...list.querySelectorAll('.prow')].map((x) => x.dataset.id));
  render();
}
let pressTimer = null, pressStart = null;
document.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.day-list .prow');
  if (!row || row.classList.contains('is-done')) return;
  if (e.target.closest('.handle')) { e.preventDefault(); startDrag(row, e.clientY); return; }
  if (e.target.closest('button, select, a, input')) return;
  pressStart = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => startDrag(row, pressStart.y), 450);
});
document.addEventListener('pointermove', (e) => {
  if (pressTimer && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) { clearTimeout(pressTimer); pressTimer = null; }
  if (drag) { e.preventDefault(); moveDrag(e.clientY); }
}, { passive: false });
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
const finish = () => { clearTimeout(pressTimer); pressTimer = null; endDrag(); };
document.addEventListener('pointerup', finish);
document.addEventListener('pointercancel', finish);

initMap();
if (!st.places.length && st.sid !== 'k1') loadScenario();
render();
