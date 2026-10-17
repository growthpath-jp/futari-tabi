// 神戸旅行テスト：場所の登録 → 日割り・順番（登録時に決めた分だけ固定、残りはおまかせ）
import { DATES, SHIN_KOBE, HOTELS, HOTEL_TBD, DEFAULT_TRIP, CANDIDATES, SCENARIOS, closedDays } from './kobe.js';
import { hm, fmt, MODES, simulate, autoOrder, autoAssign, rebalance, bestInsert, replanFrom, bearingText, travelMin, isClosed } from '../js/plan.js';
import { extractAddress } from '../js/logic.js';
import { geocodeAddress, searchByName } from '../js/geo.js';

const L = window.L;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYC = ['var(--d0)', 'var(--d1)', 'var(--d2)', 'var(--d3)'];
const DAYHEX = ['#2B5FA6', '#C46A16', '#2E7D4F', '#8E44AD'];
const KEY = 'futari-tabi-kobe-v2';
const TIMES = (from, to, step) => { const a = []; for (let t = hm(from); t <= hm(to); t += step) a.push(fmt(t)); return a; };
const KOBE = { lat: 34.6913, lng: 135.1830 };
const LAST = DATES.length - 1;
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- 状態 ----------
let st;
try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { st = null; }
const fresh = () => ({ sid: SCENARIOS[0].id, step: {}, answers: {}, memo: {}, places: [], trip: clone(DEFAULT_TRIP), manual: {}, edited: {}, tm: { on: false, today: 0, now: '13:00', here: null, replan: null }, done: {}, cancel: {} });
if (!st || !st.trip || !st.trip.starts) st = fresh();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 保存できなくても動かす */ } };
const sc = () => SCENARIOS.find((s) => s.id === st.sid) || SCENARIOS[0];
let uidN = Date.now();
const uid = () => 'p' + (uidN++).toString(36);
let fitted = false, hotelPick = null, draft = null;

function loadScenario() {
  const s = sc();
  st.places = s.start().map((p) => ({ ...p, uid: uid(), day: p.day ?? null, at: p.at ?? null }));
  st.manual = {}; st.edited = {}; st.done = {}; st.cancel = {};
  st.trip = clone(DEFAULT_TRIP);
  st.step[s.id] = 0;
  st.tm = s.tripMode ? { on: true, today: s.tripMode.today, now: s.tripMode.now, here: null, replan: null } : { on: false, today: 0, now: '13:00', here: null, replan: null };
  fitted = false; hotelPick = null; draft = null;
}

// ---------- 計算 ----------
const hotelOf = (i) => st.trip.hotels[i] || HOTEL_TBD;
function makeDays() {
  return DATES.map((d, i) => ({
    label: d.label,
    start: i === 0 ? SHIN_KOBE : hotelOf(i - 1),
    end: i === LAST ? SHIN_KOBE : hotelOf(i),
    startTime: hm(st.trip.starts[i]),
    endTime: hm(st.trip.ends[i]),
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
let map, layer, stationLayer, stationKey = '';
function initMap() {
  if (!L) { $('#map').innerHTML = '<div class="map-fallback">地図を読み込めませんでした</div>'; return; }
  map = L.map($('#map'), { zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, className: 'tiles-original', attribution: '© OpenStreetMap' }).addTo(map);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { minZoom: 5, maxZoom: 18, className: 'tiles-original', bounds: [[20, 122], [46, 154]], attribution: '地理院タイル' }).addTo(map);
  map.setView([KOBE.lat, KOBE.lng], 12);
  layer = L.layerGroup().addTo(map);
  stationLayer = L.layerGroup().addTo(map);
  map.on('click', (e) => { if (!st.tm.on) return; st.tm.here = { lat: e.latlng.lat, lng: e.latlng.lng, name: '今いる場所' }; render(); });
  map.on('moveend', () => { if (st.tm.on) loadStations(); });
}
const pin = (html, cls, color) => L.divIcon({ className: 'pin-wrap', html: `<span class="lab-pin ${cls || ''}" style="${color ? 'background:' + color : ''}">${html}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
const anchorIcon = (text) => L.divIcon({ className: 'pin-wrap', html: `<span class="lab-anchor">${esc(text)}</span>`, iconSize: [48, 22], iconAnchor: [24, 11] });

function drawMap(res) {
  if (!map) return;
  layer.clearLayers();
  const pts = [], anchors = new Map();
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
  anchors.forEach((a) => { L.marker([a.lat, a.lng], { icon: anchorIcon(a === SHIN_KOBE ? '新神戸' : a.tbd ? '宿?' : '宿'), title: a.name }).addTo(layer); pts.push([a.lat, a.lng]); });
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

// ---------- 検索（場所・宿で共通） ----------
async function findPlaces(q) {
  const addr = extractAddress(q);
  if (addr) {
    const g = await geocodeAddress(addr);
    return g ? [{ name: q, area: addr + (g.approx ? '（番地までは特定できず）' : ''), lat: g.lat, lng: g.lng }] : [];
  }
  return searchByName(q, KOBE);
}

// ---------- 登録フォーム ----------
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
  if (del) del.onclick = () => { st.places = st.places.filter((p) => p.uid !== draft.uid); Object.keys(st.manual).forEach((d) => { st.manual[d] = st.manual[d].filter((x) => x !== draft.uid); }); draft = null; render(); renderForm(); };
}
$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (id) => $(id).value;
  const p = { ...draft, name: v('#f-name').trim() || '名前なしの場所', day: v('#f-day') === '' ? null : Number(v('#f-day')), at: v('#f-at') || null, until: v('#f-until') || null, stay: Number(v('#f-stay')), priority: $('input[name="f-prio"]:checked').value };
  if (p.uid) {
    const old = st.places.find((x) => x.uid === p.uid);
    if (old.day !== p.day) Object.keys(st.manual).forEach((d) => { st.manual[d] = st.manual[d].filter((x) => x !== p.uid); });
    Object.assign(old, p);
  } else st.places.push({ ...p, uid: uid() });
  const wasEdit = !!p.uid;
  draft = null; renderForm();
  $('#results').innerHTML = ''; $('#q').value = '';
  render();
  toast(wasEdit ? '保存しました' : '登録しました');
});
async function doSearch() {
  const q = $('#q').value.trim(), box = $('#results');
  if (!q) return;
  box.innerHTML = '<p class="sub">探しています…</p>';
  try {
    const list = await findPlaces(q);
    if (!list.length) { box.innerHTML = '<p class="sub">見つかりませんでした。住所で探すか、候補から選んでください</p>'; return; }
    box.innerHTML = `<div class="results">${list.map((c, i) => `<button class="item" type="button" data-i="${i}"><span class="item-main"><b>${esc(c.name)}</b><small>${esc(c.area)}</small></span></button>`).join('')}</div>`;
    box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const c = list[Number(b.dataset.i)]; box.innerHTML = ''; openForm({ name: c.name, lat: c.lat, lng: c.lng }); }));
  } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}
$('#search').addEventListener('click', doSearch);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

// ---------- シナリオ（1ステップずつ） ----------
function renderTask() {
  const s = sc();
  $('#sc').innerHTML = SCENARIOS.map((x) => `<option value="${x.id}" ${x.id === st.sid ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
  const i = st.step[s.id] || 0;
  const ans = (st.answers[s.id] || {});
  if (i >= s.steps.length) {
    const nextS = SCENARIOS[SCENARIOS.indexOf(s) + 1];
    $('#task').innerHTML = `<p class="do">このシナリオは終わりです。ありがとうございます。</p>
      <div class="row-inline wrap">${nextS ? `<button class="btn primary small" type="button" data-next-sc="${nextS.id}">次のシナリオへ</button>` : '<span class="hint">全シナリオ終わりです。下の「答えと感想をコピー」からチャットに貼り付けてください。</span>'}
      <button class="btn small" type="button" data-step="${s.steps.length - 1}">前のステップに戻る</button></div>`;
    return;
  }
  const step = s.steps[i];
  $('#task').innerHTML = `<span class="step-no">ステップ ${i + 1} / ${s.steps.length}</span>
    <p class="do">やること：${esc(step.do)}</p>
    <p class="check">確かめたいこと：${esc(step.check)}</p>
    <div class="answers" role="group" aria-label="答え">${['はい', 'どちらとも', 'いいえ'].map((a) => `<button class="mini ${ans[i] === a ? 'on' : ''}" type="button" data-answer="${a}">${a}</button>`).join('')}</div>
    <div class="row-inline wrap">${i > 0 ? `<button class="btn small" type="button" data-step="${i - 1}">前へ</button>` : ''}<button class="btn small" type="button" id="reset-sc">このシナリオを最初からやり直す</button></div>`;
}

// ---------- 画面 ----------
function renderTop() {
  renderTask();
  const added = new Set(st.places.map((p) => p.id));
  $('#cands').innerHTML = CANDIDATES.map((c) => `<button class="mini ${added.has(c.id) ? 'added' : ''}" type="button" data-cand="${c.id}">${added.has(c.id) ? '✓ ' : '＋ '}${esc(c.name)}${c.priority === 'maybe' ? '（行けたら）' : ''}</button>`).join('');
  $('#modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<label class="seg"><input type="radio" name="mode" value="${k}" ${k === st.trip.mode ? 'checked' : ''}>${m.label}</label>`).join('');
  const tb = $('#trip-toggle');
  tb.setAttribute('aria-pressed', String(st.tm.on));
  tb.textContent = st.tm.on ? '旅行中モード：オン' : '旅行中モード：オフ';
  $('#trip-ctrls').hidden = !st.tm.on;
  $('#today').innerHTML = DATES.map((d, i) => `<option value="${i}" ${i === st.tm.today ? 'selected' : ''}>${d.label}</option>`).join('');
  $('#now').innerHTML = TIMES('8:00', '21:00', 30).map((x) => `<option ${x === st.tm.now ? 'selected' : ''}>${x}</option>`).join('');
  const hint = $('#map-hint');
  hint.hidden = !(st.tm.on && !st.tm.here);
  hint.textContent = '地図をタップして「今いる場所」を決めてください';
  const memo = $('#fb-memo');
  if (document.activeElement !== memo) memo.value = st.memo[st.sid] || '';
}

function hotelPicker(i) {
  return `<div class="hotel-pick" data-hotel-day="${i}">
    <span class="label">${DATES[i].label}の夜に泊まる宿</span>
    <div class="cand-chips">${HOTELS.map((h, k) => `<button class="mini" type="button" data-hotel="${k}">${esc(h.name)}</button>`).join('')}<button class="mini" type="button" data-hotel="tbd">未定にする</button></div>
    <div class="row-inline"><label class="sr-only" for="hq-${i}">宿の名前・住所</label><input id="hq-${i}" placeholder="宿の名前・住所で探す"><button class="btn small" type="button" data-hotel-search="${i}">探す</button></div>
    <div class="results" id="hr-${i}"></div>
    <button class="btn small" type="button" data-hotel-close>閉じる</button></div>`;
}

function render() {
  const res = compute();
  save();
  renderTop();
  const mode = st.trip.mode;
  const timeSel = (id, cur, from, to) => `<select id="${id}">${TIMES(from, to, 15).map((t) => `<option ${t === cur ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  $('#days').innerHTML = res.days.map(({ day, d, order, skipped, sim, doneList, remaining, simDay }) => {
    const isToday = st.tm.on && d === st.tm.today;
    const list = isToday ? [...doneList, ...remaining] : order;
    const rows = new Map(sim.rows.map((x) => [x.id, x]));
    const start = isToday && st.tm.here ? simDay.start : day.start;
    const startT = isToday && st.tm.here ? simDay.startTime : day.startTime;
    const startLabel = d === 0 ? '新神戸に着く時刻' : '出発の時刻';
    const endLabel = d === LAST ? '新神戸に着く（新幹線の15分前）' : '宿に着く時刻（これより前に）';
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
          <select id="mv-${p.id}" data-act="move"><option value="" ${p.day == null ? 'selected' : ''}>日はおまかせ</option>${DATES.map((dd, i) => `<option value="${i}" ${p.day === i ? 'selected' : ''}>${dd.label}に決める</option>`).join('')}</select>
          <button class="mini" type="button" data-act="edit">変更</button>
          ${isToday ? `<button class="mini ${isDone ? 'on' : ''}" type="button" data-act="done">済</button><button class="mini" type="button" data-act="cancel">中止</button>` : ''}
        </div></li>`;
    }).join('');
    const skip = skipped.length ? `<div class="stack"><span class="label">見送り候補（時間に収まらない「行けたら」）</span>${skipped.map((p) => `<div class="prow" data-id="${p.id}" data-d="${d}"><span></span><span class="num lab-pin unset">?</span><div class="pmain"><b>${esc(p.name)}</b><span class="pmeta">${p.stay}分</span></div><span></span><div class="pctrl"><button class="mini" type="button" data-act="force">この日に入れる</button><button class="mini" type="button" data-act="edit">変更</button></div></div>`).join('')}</div>` : '';
    const endIsHotel = d !== LAST;
    return `<section class="day" aria-label="${esc(day.label)}">
      <div class="day-head"><h2><span class="day-dot" style="background:${DAYC[d % 4]}"></span>${esc(day.label)}${isToday ? '（今日）' : ''}</h2>
        <span class="day-sum">移動 合計${Math.round(sim.travel)}分</span>
        ${sim.over > 0 ? `<span class="day-warn">時間が${Math.round(sim.over)}分足りません</span>` : ''}
        ${st.edited[d] ? `<button class="mini" type="button" data-act="auto" data-d="${d}">おまかせの順番に戻す</button>` : ''}</div>
      <div class="dayhead-times"><label for="ts-${d}">${startLabel}</label>${timeSel('ts-' + d, st.trip.starts[d], '6:00', '15:00')}
        <label for="te-${d}">${endLabel}</label>${timeSel('te-' + d, st.trip.ends[d], '12:00', '23:00')}</div>
      <div class="terminal ${start.tbd ? 'tbd' : ''}"><span class="kind">出発</span><span class="tname">${esc(start.name)}${d > 0 && !(isToday && st.tm.here) ? '<small>前の夜の宿から</small>' : ''}</span><span class="ttime">${fmt(startT)}</span></div>
      <ul class="day-list" data-d="${d}">${body || '<li class="empty">この日の場所はまだありません</li>'}</ul>
      <div class="terminal ${day.end.tbd ? 'tbd' : ''}"><span class="kind">${endIsHotel ? '宿' : '帰り'}</span>
        <span class="tname">${esc(day.end.name)}<small>${endIsHotel ? `${fmt(day.endTime)}までに着く予定` : '17:00の新幹線'}</small></span>
        <span class="ttime">${fmt(sim.finish)}着</span></div>
      ${endIsHotel ? (hotelPick === d ? hotelPicker(d) : `<button class="btn small" type="button" data-hotel-open="${d}">${day.end.tbd ? '宿を選ぶ' : '宿を変える'}</button>`) : ''}
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
function setHotel(i, h) { st.trip.hotels[i] = h; st.manual = {}; st.edited = {}; hotelPick = null; fitted = false; render(); toast(h ? `${DATES[i].label}の宿：${h.name}` : '宿を未定にしました'); }

document.addEventListener('click', async (e) => {
  const t = e.target;
  const cand = t.closest('[data-cand]');
  if (cand) { const c = CANDIDATES.find((x) => x.id === cand.dataset.cand); openForm({ ...c, uid: undefined }); return; }
  const ansB = t.closest('[data-answer]');
  if (ansB) { const s = sc(); const i = st.step[s.id] || 0; st.answers[s.id] = { ...(st.answers[s.id] || {}), [i]: ansB.dataset.answer }; st.step[s.id] = i + 1; save(); renderTask(); return; }
  const stepB = t.closest('[data-step]');
  if (stepB) { st.step[sc().id] = Number(stepB.dataset.step); save(); renderTask(); return; }
  const nsc = t.closest('[data-next-sc]');
  if (nsc) { st.sid = nsc.dataset.nextSc; loadScenario(); renderForm(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (t.id === 'reset-sc') { loadScenario(); renderForm(); render(); toast('最初の状態に戻しました'); return; }
  const ho = t.closest('[data-hotel-open]');
  if (ho) { hotelPick = Number(ho.dataset.hotelOpen); render(); return; }
  if (t.closest('[data-hotel-close]')) { hotelPick = null; render(); return; }
  const hb = t.closest('[data-hotel]');
  if (hb) { const i = Number(hb.closest('[data-hotel-day]').dataset.hotelDay); setHotel(i, hb.dataset.hotel === 'tbd' ? null : { ...HOTELS[Number(hb.dataset.hotel)] }); return; }
  const hs = t.closest('[data-hotel-search]');
  if (hs) {
    const i = Number(hs.dataset.hotelSearch), q = $('#hq-' + i).value.trim(), box = $('#hr-' + i);
    if (!q) return;
    box.innerHTML = '<p class="sub">探しています…</p>';
    try {
      const list = await findPlaces(q);
      box.innerHTML = list.length ? list.map((c, k) => `<button class="item" type="button" data-hotel-hit="${k}"><span class="item-main"><b>${esc(c.name)}</b><small>${esc(c.area)}</small></span></button>`).join('') : '<p class="sub">見つかりませんでした</p>';
      box.querySelectorAll('[data-hotel-hit]').forEach((b) => b.addEventListener('click', () => { const c = list[Number(b.dataset.hotelHit)]; setHotel(i, { name: c.name, lat: c.lat, lng: c.lng }); }));
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    return;
  }
  const b = t.closest('[data-act]');
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
  if (t.id === 'sc') { st.sid = t.value; loadScenario(); renderForm(); render(); toast('シナリオの最初の状態にしました'); return; }
  if (t.name === 'mode') st.trip.mode = t.value;
  else if (/^ts-\d$/.test(t.id)) st.trip.starts[Number(t.id.slice(3))] = t.value;
  else if (/^te-\d$/.test(t.id)) st.trip.ends[Number(t.id.slice(3))] = t.value;
  else if (t.id === 'today') { st.tm.today = Number(t.value); st.tm.replan = null; }
  else if (t.id === 'now') st.tm.now = t.value;
  else if (t.dataset && t.dataset.act === 'move') {
    const p = place(t.closest('[data-id]').dataset.id);
    p.day = t.value === '' ? null : Number(t.value);
    Object.keys(st.manual).forEach((d) => { st.manual[d] = st.manual[d].filter((x) => x !== p.uid); });
  } else return;
  render();
});
$('#fb-memo').addEventListener('input', (e) => { st.memo[st.sid] = e.target.value; save(); });
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
  const lines = ['【神戸旅行テスト 答えと感想】'];
  for (const s of SCENARIOS) {
    const a = st.answers[s.id] || {};
    lines.push('', s.title);
    s.steps.forEach((step, i) => lines.push(`・${step.check} → ${a[i] || '未回答'}`));
    lines.push(`感じたこと：${st.memo[s.id] || 'なし'}`);
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
