// ふたりの旅：画面
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createLocalStore } from './store-local.js';
import {
  STATUSES, STATUS_LABEL, ALL_FILTER, extractAddress, googleUrl, applyFilter, buildRoutes,
  closeTripPatches, formatDateRange, describeFilter, tokyoDate,
} from './logic.js';
import { geocodeAddress, searchByName } from './geo.js';
import { createMap, drawPlaces, drawPlan, drawStations, focusPlace, onMapTap, center, destroyMap } from './map.js';
import { planTrip, placePlan, tripDates } from './plan.js';
import { createPlanView, planFields, readPlanFields } from './plan-view.js';
import { showGuide, mountGuide } from './guide.js';

const app = document.getElementById('app');
let store, me;
let data = { trips: [], places: [], drawers: [] };
let view = { name: '', map: null, cleanup: [] };
let unsub = () => {};

// ---------- 小道具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' toast-' + kind : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast(e.message || 'うまくいきませんでした', 'error'); return undefined; }
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch {
    const el = btn && btn.parentElement && btn.parentElement.querySelector('.copy-target');
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    toast('長押しでコピーしてください');
  }
}

const icon = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  drawer: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M10 7.5h4M10 16.5h4"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};

function header(title, sub, opts = {}) {
  return `<header class="bar">
    ${opts.back ? `<a class="icon-btn" href="${opts.back}" aria-label="戻る">${icon.back}</a>` : ''}
    <div class="bar-title"><h1>${esc(title)}</h1>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>
    ${opts.right || ''}
  </header>`;
}

function demoBadge() {
  return store.mode === 'demo'
    ? '<a class="demo-badge" href="#/settings">お試しモード（このスマホだけに保存）</a>'
    : '';
}

function teardown() {
  view.cleanup.forEach((f) => { try { f(); } catch { /* noop */ } });
  view.cleanup = [];
  destroyMap(view.map);
  view.map = null;
}

async function reload() {
  const [trips, places, drawers] = await Promise.all([store.listTrips(), store.listPlaces(), store.listDrawers()]);
  data = { trips, places, drawers };
}

// ---------- ルーター ----------
async function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const q = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  teardown();
  if (!me && parts[0] !== 'login') return renderLogin();
  if (parts[0] === 'login') return renderLogin();
  if (parts[0] === 'trip' && parts[1]) return renderTrip(parts[1], q);
  if (parts[0] === 'drawer' && parts[1] === 'new') return renderDrawerEdit(null, q);
  if (parts[0] === 'drawer' && parts[1] && parts[2] === 'edit') return renderDrawerEdit(parts[1], q);
  if (parts[0] === 'drawer' && parts[1] && parts[2] === 'share') return renderShare(parts[1]);
  if (parts[0] === 'drawer' && parts[1]) return renderDrawer(parts[1]);
  if (parts[0] === 'shared' && parts[1]) return renderShared(parts[1]);
  if (parts[0] === 'settings') return renderSettings();
  return renderHome(q.get('tab') || 'trips');
}

// ---------- ログイン ----------
function renderLogin() {
  view.name = 'login';
  app.innerHTML = `
  <main class="page narrow">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><h1>ふたりの旅</h1></div>
    <p class="lead">ふたりの旅の軌跡を、地図にしまっておくアプリです。</p>
    <form class="card stack" id="login-form">
      <label for="email">メールアドレス</label>
      <input id="email" type="email" autocomplete="email" required>
      <label for="password">パスワード（8文字以上）</label>
      <input id="password" type="password" autocomplete="current-password" minlength="8" required>
      <p class="error" id="login-error" hidden></p>
      <button class="btn primary" type="submit">ログイン</button>
      <button class="btn" type="button" id="signup">はじめて使う（登録）</button>
    </form>
  </main>`;
  const err = $('#login-error');
  const show = (m) => { err.textContent = m; err.hidden = false; };
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await store.signIn($('#email').value.trim(), $('#password').value); await start(); go('#/'); }
    catch (x) { show(x.message.includes('Invalid') ? 'メールアドレスかパスワードが違います' : x.message); }
  });
  $('#signup').addEventListener('click', async () => {
    const email = $('#email').value.trim(), pw = $('#password').value;
    if (!email || pw.length < 8) return show('メールアドレスと、8文字以上のパスワードを入れてください');
    try {
      const r = await store.signUp(email, pw);
      if (r.needsConfirm) show('確認メールを送りました。メールのリンクを開いてから、ここでログインしてください。');
      else { await start(); go('#/'); }
    } catch (x) { show(x.message); }
  });
}

// ---------- ホーム ----------
async function renderHome(tab) {
  view.name = 'home';
  await reload();
  let shared = [];
  if (tab === 'shared') shared = (await guard(() => store.sharedWithMe())) || [];
  const counts = new Map();
  data.places.forEach((p) => counts.set(p.trip_id, (counts.get(p.trip_id) || 0) + 1));
  const tabBtn = (id, label) => `<a class="seg ${tab === id ? 'on' : ''}" href="#/?tab=${id}" ${tab === id ? 'aria-current="page"' : ''}>${label}</a>`;

  let body = '';
  if (tab === 'trips') {
    body = `
      <button class="btn primary block" id="new-trip-open">${icon.plus}新しい旅</button>
      <form class="card stack" id="new-trip" hidden>
        <label for="trip-title">旅の名前</label>
        <input id="trip-title" required placeholder="例：2026年11月 京都旅行">
        <div class="row2">
          <div class="stack"><label for="trip-start">いつから</label><input id="trip-start" type="date"></div>
          <div class="stack"><label for="trip-end">いつまで</label><input id="trip-end" type="date"></div>
        </div>
        <button class="btn primary" type="submit">作る</button>
      </form>
      <ul class="list">${data.trips.map((t) => `
        <li><a class="item" href="#/trip/${t.id}">
          <span class="item-main"><b>${esc(t.title)}</b><small>${esc(formatDateRange(t))}</small></span>
          <span class="item-side">${counts.get(t.id) || 0}か所</span></a></li>`).join('') || '<li class="empty">まだ旅がありません。「新しい旅」から作りましょう。</li>'}
      </ul>`;
  } else if (tab === 'drawers') {
    body = `
      <a class="btn primary block" href="#/drawer/new">${icon.plus}引き出しを作る</a>
      <ul class="list">${data.drawers.map((d) => {
        const n = applyFilter(data.places, data.trips, d.filter).length;
        return `<li><a class="item" href="#/drawer/${d.id}">
          <span class="item-main"><b>${esc(d.name)}</b><small>${esc(describeFilter(d.filter, data.trips))}</small></span>
          <span class="item-side">${n}か所</span></a></li>`;
      }).join('') || '<li class="empty">表示の組み合わせを名前を付けてしまっておけます。</li>'}
      </ul>`;
  } else {
    body = `
      <form class="card stack" id="redeem">
        <label for="share-code">共有コードを受け取る</label>
        <div class="row-inline"><input id="share-code" autocapitalize="characters" placeholder="例：A1B2C3D4E5" required><button class="btn primary" type="submit">受け取る</button></div>
      </form>
      <ul class="list">${shared.map((s) => `
        <li><a class="item" href="#/shared/${s.share_id}">
          <span class="item-main"><b>${esc(s.name)}</b><small>${esc(s.from_group)} から ・ ${s.show_photos ? '写真あり' : '写真なし'}</small></span></a></li>`).join('')
        || `<li class="empty">${store.mode === 'demo' ? 'お試しモードでは、共有の受け取りは使えません。' : 'まだ共有されたものはありません。'}</li>`}
      </ul>`;
  }

  app.innerHTML = `
  ${header('ふたりの旅', `${data.trips.length}つの旅 ・ ${data.places.length}か所`, { right: `<a class="icon-btn" href="#/settings" aria-label="設定">${icon.gear}</a>` })}
  <main class="page stack-lg">
    ${demoBadge()}
    <nav class="segs" aria-label="表示の切り替え">${tabBtn('trips', '旅')}${tabBtn('drawers', '引き出し')}${tabBtn('shared', '共有されたもの')}</nav>
    ${body}
  </main>`;

  const open = $('#new-trip-open');
  if (open) open.addEventListener('click', () => { $('#new-trip').hidden = false; open.hidden = true; $('#trip-title').focus(); });
  const f = $('#new-trip');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = await guard(() => store.createTrip({ title: $('#trip-title').value.trim(), start_date: $('#trip-start').value || null, end_date: $('#trip-end').value || $('#trip-start').value || null }));
    if (t) go('#/trip/' + t.id);
  });
  const r = $('#redeem');
  if (r) r.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sid = await guard(() => store.redeemShare($('#share-code').value), '受け取りました');
    if (sid) go('#/shared/' + sid);
  });
}

// ---------- 旅の地図 ----------
async function renderTrip(tripId, q) {
  view.name = 'trip';
  await reload();
  let trip = data.trips.find((t) => t.id === tripId);
  if (!trip) { toast('旅が見つかりません', 'error'); return go('#/'); }
  const today = tokyoDate(new Date().toISOString());
  const st = {
    // 予定：これからの旅を組む ／ 記録：行った・行けなかった・寄り道を地図で見る
    tab: q.get('tab') || (trip.start_date && !trip.closed && (trip.end_date || trip.start_date) >= today ? 'plan' : 'record'),
    statuses: q.get('st') ? q.get('st').split(',') : [...STATUSES],
    colorDetour: true, connect: true,
    selectedId: q.get('focus') || null, adjustId: null, tapToPlace: null,
  };

  app.innerHTML = `
  ${header(trip.title, formatDateRange(trip), { back: '#/', right: `<button class="icon-btn" id="trip-menu-btn" aria-label="旅のメニュー" aria-expanded="false">${icon.more}</button>` })}
  <div class="menu" id="trip-menu" hidden>
    <button class="menu-item" id="trip-edit">旅の名前・日付を変える</button>
    <button class="menu-item" id="trip-close">旅を終える（行かなかった場所を「行けなかった」に）</button>
    <button class="menu-item danger" id="trip-delete">この旅を削除</button>
  </div>
  <form class="card stack edit-trip" id="trip-form" hidden>
    <label for="et-title">旅の名前</label><input id="et-title" value="${esc(trip.title)}" required>
    <div class="row2">
      <div class="stack"><label for="et-start">いつから</label><input id="et-start" type="date" value="${esc(trip.start_date || '')}"></div>
      <div class="stack"><label for="et-end">いつまで</label><input id="et-end" type="date" value="${esc(trip.end_date || '')}"></div>
    </div>
    <div class="row-inline"><button class="btn primary" type="submit">保存</button><button class="btn" type="button" id="et-cancel">やめる</button></div>
  </form>
  <nav class="segs trip-tabs" aria-label="表示の切り替え">
    <a class="seg ${st.tab === 'plan' ? 'on' : ''}" href="#/trip/${tripId}?tab=plan" ${st.tab === 'plan' ? 'aria-current="page"' : ''}>予定</a>
    <a class="seg ${st.tab === 'record' ? 'on' : ''}" href="#/trip/${tripId}?tab=record" ${st.tab === 'record' ? 'aria-current="page"' : ''}>記録</a>
  </nav>
  <div class="chips" id="chips" role="group" aria-label="表示する場所" ${st.tab === 'plan' ? 'hidden' : ''}></div>
  <div class="map-wrap"><div id="map" class="map ${st.tab === 'plan' ? 'map-plan' : ''}" role="region" aria-label="旅の地図"></div><div class="map-hint" id="map-hint" hidden></div></div>
  <main class="page stack-lg">
    ${showGuide(store, trip) ? '<section class="card stack guide" id="guide" aria-live="polite"></section>' : ''}
    <div id="close-banner"></div>
    <section class="card stack" id="sheet" hidden aria-live="polite"></section>
    ${st.tab === 'plan' ? `<button class="btn primary block" id="add-open" type="button">${icon.plus}行きたい場所を登録</button>` : ''}
    <section class="card stack" id="add-card" aria-labelledby="add-h" ${st.tab === 'plan' ? 'hidden' : ''}>
      <div class="row-between"><h2 id="add-h">場所を登録</h2>${st.tab === 'plan' ? '<button class="btn small" type="button" id="add-close">閉じる</button>' : ''}</div>
      <p class="hint">Googleマップで調べた住所をコピーして「貼り付けて探す」。住所のない場所は名前でも探せます。</p>
      <div class="row-inline">
        <button class="btn primary" id="paste-btn" type="button">貼り付けて探す</button>
        <button class="btn" id="tap-btn" type="button">地図をタップして置く</button>
      </div>
      <label class="sr-only" for="add-text">住所または名前</label>
      <div class="row-inline"><input id="add-text" placeholder="住所または名前（例：嵐山 竹林）"><button class="btn" id="add-go" type="button">探す</button></div>
      <div id="add-result" aria-live="polite"></div>
    </section>
    ${st.tab === 'plan' ? '<section class="stack-lg" id="plan-area" aria-live="polite"></section>' : `
    <section class="stack">
      <div class="row-between"><h2>表示中の場所</h2><span class="sub" id="count"></span></div>
      <ul class="list" id="place-list"></ul>
    </section>
    <a class="btn block" id="to-drawer" href="#">${icon.drawer}この表示を引き出しにしまう</a>`}
  </main>`;

  view.map = createMap($('#map'));
  const tripPlaces = () => data.places.filter((p) => p.trip_id === tripId);
  const visible = () => tripPlaces().filter((p) => st.statuses.includes(p.status));

  function renderChips() {
    const chip = (key, label, on, cls) => `<button type="button" class="chip ${cls || ''} ${on ? 'on' : ''}" data-k="${key}" aria-pressed="${on}"><span class="dot" aria-hidden="true"></span>${label}</button>`;
    $('#chips').innerHTML =
      STATUSES.map((s) => chip(s, STATUS_LABEL[s], st.statuses.includes(s), 'chip-' + s)).join('') +
      chip('colorDetour', '寄り道を色分け', st.colorDetour, 'chip-opt') +
      chip('connect', '線で結ぶ', st.connect, 'chip-opt');
  }
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'colorDetour' || k === 'connect') st[k] = !st[k];
    else st.statuses = st.statuses.includes(k) ? st.statuses.filter((x) => x !== k) : STATUSES.filter((x) => x === k || st.statuses.includes(x));
    paint();
  });

  // --- 予定タブ ---
  const refresh = async (fit) => { await reload(); trip = data.trips.find((t) => t.id === tripId) || trip; paint(fit); };
  const pv = st.tab === 'plan' ? createPlanView({
    el: $('#plan-area'), getTrip: () => trip, getPlaces: () => data.places, store, guard, toast,
    refresh: () => refresh(false), repaint: (fit, at) => { paint(fit); if (at) focusPlace(view.map, at); },
    openPlace: (id) => { st.selectedId = id; st.adjustId = null; paint(false); $('#sheet').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    searchAny,
  }) : null;
  if (pv) view.cleanup.push(pv.destroy);
  // 旅行中モード：地図をタップして「今いる場所」
  view.cleanup.push(onMapTap(view.map, (lat, lng) => { if (pv && pv.ui.tm.on && !st.tapToPlace) { pv.setHere({ lat, lng }); paint(false); } }));
  if (showGuide(store, trip)) mountGuide({ el: $('#guide'), store, tripId, guard, toast, refresh });

  function paintPlan(fit) {
    const res = planTrip(trip, data.places, pv.ui.tm.on ? { today: pv.ui.tm.today, now: pv.ui.tm.now, here: pv.ui.tm.here } : null);
    pv.render(res);
    if (res) drawPlan(view.map, res, { tm: pv.ui.tm, selectedId: st.selectedId, fit, onSelect: (p) => { st.selectedId = p.id; paint(false); } });
    else drawPlaces(view.map, [], { fit });
    drawStations(view.map, pv.ui.tm.on);
    const hint = $('#map-hint');
    if (!st.tapToPlace) { hint.hidden = !(pv.ui.tm.on && !pv.ui.tm.here); hint.textContent = '地図をタップして「今いる場所」を決めてください'; }
    renderSheet();
    renderCloseBanner();
  }

  function paint(fit) {
    if (st.tab === 'plan') return paintPlan(fit);
    renderChips();
    const vis = visible();
    drawPlaces(view.map, vis, {
      colorDetour: st.colorDetour, connect: st.connect, selectedId: st.selectedId, adjustId: st.adjustId, fit,
      onSelect: (p) => { if (st.tapToPlace) return; st.selectedId = p.id; st.adjustId = null; paint(false); },
      onMoved: async (p, lat, lng) => { await guard(() => store.updatePlace(p.id, { lat, lng, adjusted: true }), '位置を直しました'); await reload(); paint(false); },
    });
    const { numbers } = buildRoutes(vis);
    $('#count').textContent = `${vis.length}か所`;
    $('#place-list').innerHTML = vis
      .sort((a, b) => (numbers.get(a.id) || 999) - (numbers.get(b.id) || 999) || String(a.registered_at).localeCompare(String(b.registered_at)))
      .map((p) => `<li><button class="item" data-id="${p.id}" type="button">
        <span class="badge badge-${p.status === 'detour' && !st.colorDetour ? 'visited' : p.status}" aria-hidden="true">${numbers.get(p.id) || ''}</span>
        <span class="item-main"><b>${esc(p.name || '名前なしの場所')}</b><small>${STATUS_LABEL[p.status]}${p.visited_at ? ' ・ ' + esc(fmtTime(p.visited_at)) : ''}</small></span></button></li>`)
      .join('') || '<li class="empty">この表示に入る場所はありません。</li>';
    renderSheet();
    renderCloseBanner();
    const stq = st.statuses.join(',');
    $('#to-drawer').href = `#/drawer/new?trip=${tripId}&st=${stq}&cd=${st.colorDetour ? 1 : 0}&cn=${st.connect ? 1 : 0}`;
  }

  if ($('#place-list')) $('#place-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    st.selectedId = b.dataset.id; st.adjustId = null; paint(false);
    focusPlace(view.map, data.places.find((p) => p.id === st.selectedId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function renderCloseBanner() {
    const today = tokyoDate(new Date().toISOString());
    const wants = tripPlaces().filter((p) => p.status === 'want').length;
    const el = $('#close-banner');
    if (trip.end_date && trip.end_date < today && wants) {
      el.innerHTML = `<div class="notice stack"><b>旅は終わりましたか？</b><span>まだ「行きたい」のままの場所が${wants}か所あります。</span>
        <button class="btn primary" type="button" id="close-now">「行けなかった」にまとめて変える</button></div>`;
      $('#close-now').addEventListener('click', closeTrip);
    } else el.innerHTML = '';
  }

  async function closeTrip() {
    const patches = closeTripPatches(data.places, tripId);
    if (!patches.length) return toast('「行きたい」のままの場所はありません');
    await guard(async () => { await store.updatePlaces(patches); await store.updateTrip(tripId, { closed: true }); }, `${patches.length}か所を「行けなかった」にしました`);
    await reload(); paint(false);
  }

  async function renderSheet() {
    const sheet = $('#sheet');
    const p = data.places.find((x) => x.id === st.selectedId && x.trip_id === tripId);
    if (!p) { sheet.hidden = true; sheet.innerHTML = ''; return; }
    const dates = tripDates(trip);
    sheet.hidden = false;
    sheet.innerHTML = `
      <div class="row-between"><h2>${esc(p.name || '名前なしの場所')}</h2><button class="btn small" type="button" id="sh-close">閉じる</button></div>
      <div class="statuses" role="radiogroup" aria-label="状態">
        ${STATUSES.map((s) => `<label class="radio radio-${s}"><input type="radio" name="sh-status" value="${s}" ${p.status === s ? 'checked' : ''}>${STATUS_LABEL[s]}</label>`).join('')}
      </div>
      <label for="sh-name">名前（入れると、Googleマップで施設のページが開きます）</label>
      <input id="sh-name" value="${esc(p.name || '')}" placeholder="例：清水寺">
      <dl class="facts">
        <dt>住所</dt><dd>${esc(p.address || '—')}</dd>
        <dt>行った時刻</dt><dd>${esc(p.visited_at ? fmtTime(p.visited_at) : '—')}</dd>
        <dt>位置</dt><dd>${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}${p.adjusted ? '（指で調整済み）' : ''}</dd>
      </dl>
      ${p.status === 'want' && dates.length ? `<details class="plan-box" ${st.tab === 'plan' ? 'open' : ''}><summary>予定の条件（何日目・時刻・いる時間など）</summary>
        <form class="stack" id="sh-plan">${planFields('sp', placePlan(p), dates)}<button class="btn primary" type="submit">予定の条件を保存</button></form></details>` : ''}
      <label for="sh-note">ひとことメモ</label>
      <textarea id="sh-note" rows="2" placeholder="共有するとき、見せるかどうか選べます">${esc(p.note || '')}</textarea>
      <div class="photos" id="sh-photos"><span class="sub">写真を読み込み中…</span></div>
      <div class="row-inline wrap">
        <a class="btn primary" href="${googleUrl(p)}" target="_blank" rel="noopener">${p.name ? 'Googleマップで施設を見る' : 'Googleマップで位置を見る'}</a>
        <button class="btn" type="button" id="sh-adjust">${st.adjustId === p.id ? '調整を終える' : 'ピンの位置を調整'}</button>
        <label class="btn" for="sh-photo-in">写真を追加</label><input id="sh-photo-in" type="file" accept="image/*" multiple class="sr-only">
        <button class="btn danger small" type="button" id="sh-del">削除</button>
      </div>
      ${st.adjustId === p.id ? '<p class="notice">地図のピンを指で動かして、正しい位置に置いてください。Googleマップで確かめながら直せます。</p>' : ''}
      <p class="error" id="sh-del-confirm" hidden></p>`;

    $('#sh-close').onclick = () => { st.selectedId = null; st.adjustId = null; paint(false); };
    $$('input[name="sh-status"]', sheet).forEach((r) => r.addEventListener('change', async () => {
      const patch = { status: r.value };
      if ((r.value === 'visited' || r.value === 'detour') && !p.visited_at) patch.visited_at = new Date().toISOString();
      if (r.value === 'want' || r.value === 'missed') patch.visited_at = null;
      await guard(() => store.updatePlace(p.id, patch)); await reload(); paint(false);
    }));
    $('#sh-name').addEventListener('change', async (e) => { await guard(() => store.updatePlace(p.id, { name: e.target.value.trim() || null }), '名前を保存しました'); await reload(); paint(false); });
    $('#sh-note').addEventListener('change', async (e) => { await guard(() => store.updatePlace(p.id, { note: e.target.value }), 'メモを保存しました'); await reload(); });
    $('#sh-adjust').onclick = () => { st.adjustId = st.adjustId === p.id ? null : p.id; paint(false); };
    const spf = $('#sh-plan');
    if (spf) spf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const old = placePlan(p);
      const next = readPlanFields('sp', spf, old);
      // 「未定（おまかせ）」のままなら、おまかせで決めた日をそのまま使う（勝手に動かさない）
      if (next.day == null && old.auto) { next.day = old.day; next.auto = true; } else next.auto = false;
      await guard(() => store.updatePlace(p.id, { plan: { ...(p.plan || {}), ...next } }), '予定の条件を保存しました');
      if ((p.plan || {}).day !== next.day) {
        const plan = { ...(trip.plan || {}), manual: { ...((trip.plan || {}).manual || {}) } };
        Object.keys(plan.manual).forEach((d) => { plan.manual[d] = plan.manual[d].filter((x) => x !== p.id); });
        await guard(() => store.updateTrip(tripId, { plan }));
      }
      await refresh(false);
    });
    $('#sh-photo-in').addEventListener('change', async (e) => {
      for (const file of e.target.files) await guard(() => store.addPhoto(p, file));
      toast('写真を追加しました'); renderSheet();
    });
    let armed = false;
    $('#sh-del').onclick = async () => {
      if (!armed) { armed = true; const c = $('#sh-del-confirm'); c.hidden = false; c.textContent = 'もう一度「削除」を押すと消えます（写真も消えます）'; return; }
      await guard(() => store.deletePlace(p.id), '削除しました'); st.selectedId = null; await reload(); paint(false);
    };
    const photos = (await guard(() => store.listPhotos(p.id))) || [];
    const box = $('#sh-photos');
    if (box) box.innerHTML = photos.length
      ? photos.map((ph) => `<a href="${esc(ph.url)}" target="_blank" rel="noopener"><img src="${esc(ph.url)}" alt="${esc(p.name || '場所')}の写真" loading="lazy"></a>`).join('')
      : '<span class="sub">写真はまだありません</span>';
  }

  // --- 登録 ---
  // 住所なら住所で、それ以外は名前で探す（宿・駅を選ぶときも同じ）
  async function searchAny(text) {
    const addr = extractAddress(text);
    if (addr) {
      const g = await geocodeAddress(addr);
      return g ? [{ name: text, address: addr, area: addr + (g.approx ? '（番地までは特定できず）' : ''), lat: g.lat, lng: g.lng }] : [];
    }
    return searchByName(text, tripPlaces()[0] || center(view.map));
  }
  const result = $('#add-result');
  async function handleText(text) {
    text = (text || '').trim();
    if (!text) return;
    $('#add-text').value = text;
    const addr = extractAddress(text);
    result.innerHTML = '<p class="sub">探しています…</p>';
    if (addr) {
      const g = await guard(() => geocodeAddress(addr));
      if (g === undefined) { result.innerHTML = ''; return; }
      if (!g) return notFound(text, `「${addr}」の位置が見つかりませんでした。`);
      return confirmBox({ name: '', address: addr, lat: g.lat, lng: g.lng, source: 'address', approx: g.approx },
        g.approx ? '番地までは特定できなかったので、近くに仮置きします。登録後にピンを指で調整してください。' : '');
    }
    const list = await guard(() => searchAny(text));
    if (list === undefined) { result.innerHTML = ''; return; }
    if (!list.length) return notFound(text, `「${text}」は見つかりませんでした。`);
    result.innerHTML = `<div class="stack"><b>名前で探しました。近いものを選んでください</b>
      <div class="cands">${list.map((c, i) => `<button class="item" type="button" data-i="${i}"><span class="item-main"><b>${esc(c.name)}</b><small>${esc(c.area)}</small></span></button>`).join('')}</div></div>`;
    $$('.cands [data-i]', result).forEach((b) => b.addEventListener('click', () => {
      const c = list[Number(b.dataset.i)];
      confirmBox({ name: c.name, address: '', lat: c.lat, lng: c.lng, source: 'name', approx: false }, '');
    }));
  }

  function notFound(text, msg) {
    result.innerHTML = `<div class="notice stack"><b>${esc(msg)}</b>
      <span>近くの住所を貼り付けて登録し、ピンを指で動かして調整できます。または地図をタップして置けます。</span>
      <button class="btn" type="button" id="nf-tap">地図をタップして置く</button></div>`;
    $('#nf-tap').onclick = () => startTapToPlace(text.length < 40 ? text : '');
  }

  function confirmBox(cand, warn) {
    const defStatus = st.tab === 'plan' ? 'want' : trip.end_date && trip.end_date < tokyoDate(new Date().toISOString()) ? 'visited' : 'want';
    const dates = tripDates(trip);
    result.innerHTML = `<div class="notice stack ${warn ? 'warn' : ''}">
      <b>${cand.address ? '住所を見つけました' : '場所を選びました'}</b>
      ${cand.address ? `<span>${esc(cand.address)}</span>` : ''}
      ${warn ? `<span>${esc(warn)}</span>` : ''}
      <label for="cf-name">名前（任意）</label><input id="cf-name" value="${esc(cand.name)}" placeholder="例：清水寺">
      <label for="cf-status">状態</label>
      <select id="cf-status">${STATUSES.map((s) => `<option value="${s}" ${s === defStatus ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
      ${dates.length ? `<div class="stack" id="cf-plan" ${defStatus === 'want' ? '' : 'hidden'}>${planFields('cp', placePlan({}), dates)}</div>` : ''}
      <div class="row-inline"><button class="btn primary" type="button" id="cf-ok">この場所を登録する</button><button class="btn" type="button" id="cf-no">やめる</button></div></div>`;
    $('#cf-no').onclick = () => { result.innerHTML = ''; };
    $('#cf-status').onchange = (e) => { const b = $('#cf-plan'); if (b) b.hidden = e.target.value !== 'want'; };
    $('#cf-ok').onclick = async () => {
      const status = $('#cf-status').value;
      const p = await guard(() => store.addPlace({
        trip_id: tripId, name: $('#cf-name').value.trim() || null, address: cand.address || null,
        lat: cand.lat, lng: cand.lng, status, source: cand.source,
        visited_at: status === 'visited' || status === 'detour' ? new Date().toISOString() : null,
        plan: status === 'want' && $('#cf-plan') ? readPlanFields('cp', $('#cf-plan')) : {},
      }), '登録しました');
      if (!p) return;
      result.innerHTML = ''; $('#add-text').value = '';
      if (addOpen) showAdd(false);
      if (!st.statuses.includes(status)) st.statuses = STATUSES.filter((x) => x === status || st.statuses.includes(x));
      st.selectedId = st.tab === 'plan' && !cand.approx ? null : p.id; st.adjustId = cand.approx ? p.id : null;
      await refresh(false); focusPlace(view.map, p);
    };
  }

  function startTapToPlace(name) {
    st.tapToPlace = { name };
    const hint = $('#map-hint'); hint.hidden = false; hint.textContent = '地図の置きたい場所をタップしてください';
    $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const off = onMapTap(view.map, (lat, lng) => {
      off(); hint.hidden = true; st.tapToPlace = null;
      confirmBox({ name, address: '', lat, lng, source: 'manual', approx: true }, '置いた位置はあとから指で調整できます。');
    });
    view.cleanup.push(off);
  }

  $('#tap-btn').onclick = () => startTapToPlace('');
  // 予定タブ：登録欄はボタンで開く（予定を上に見せるため）
  const addOpen = $('#add-open'), addCard = $('#add-card');
  const showAdd = (on) => { if (!addOpen) return; addOpen.hidden = on; addCard.hidden = !on; if (on) $('#add-text').focus(); };
  if (addOpen) { addOpen.onclick = () => showAdd(true); $('#add-close').onclick = () => { result.innerHTML = ''; showAdd(false); }; }
  $('#add-go').onclick = () => handleText($('#add-text').value);
  $('#add-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleText(e.target.value); } });
  $('#add-text').addEventListener('paste', () => setTimeout(() => handleText($('#add-text').value), 0));
  $('#paste-btn').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) handleText(t); else toast('コピーされた文字がありません'); }
    catch { $('#add-text').focus(); toast('入力欄を長押しして「ペースト」してください'); }
  };

  // アプリに戻ってきたとき、コピーした住所を見つけて「登録しますか？」（ブラウザが許可している場合）
  let lastClip = '';
  const onVisible = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const perm = navigator.permissions && (await navigator.permissions.query({ name: 'clipboard-read' }));
      if (!perm || perm.state !== 'granted') return;
      const t = await navigator.clipboard.readText();
      if (t && t !== lastClip && extractAddress(t)) { lastClip = t; handleText(t); }
    } catch { /* iPhone では「貼り付けて探す」を使う */ }
  };
  document.addEventListener('visibilitychange', onVisible);
  view.cleanup.push(() => document.removeEventListener('visibilitychange', onVisible));

  // メニュー
  const menu = $('#trip-menu'), mbtn = $('#trip-menu-btn');
  mbtn.onclick = () => { menu.hidden = !menu.hidden; mbtn.setAttribute('aria-expanded', String(!menu.hidden)); };
  $('#trip-edit').onclick = () => { menu.hidden = true; $('#trip-form').hidden = false; };
  $('#et-cancel').onclick = () => { $('#trip-form').hidden = true; };
  $('#trip-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await guard(() => store.updateTrip(tripId, { title: $('#et-title').value.trim(), start_date: $('#et-start').value || null, end_date: $('#et-end').value || null }), '保存しました');
    route();
  });
  $('#trip-close').onclick = () => { menu.hidden = true; closeTrip(); };
  let delArmed = false;
  $('#trip-delete').onclick = async () => {
    if (!delArmed) { delArmed = true; $('#trip-delete').textContent = 'もう一度押すと、旅と場所・写真がすべて消えます'; return; }
    await guard(() => store.deleteTrip(tripId), '削除しました'); go('#/');
  };

  view.cleanup.push(store.subscribe(() => refresh(false)));
  paint(true);
  if (st.selectedId) focusPlace(view.map, data.places.find((p) => p.id === st.selectedId));
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

// ---------- 引き出しを作る・編集 ----------
async function renderDrawerEdit(drawerId, q) {
  view.name = 'drawer-edit';
  await reload();
  const existing = drawerId ? data.drawers.find((d) => d.id === drawerId) : null;
  const f = existing ? { ...ALL_FILTER, ...existing.filter } : {
    ...ALL_FILTER,
    trips: q.get('trip') ? [q.get('trip')] : 'all',
    statuses: q.get('st') ? q.get('st').split(',').filter((s) => STATUSES.includes(s)) : [...STATUSES],
    colorDetour: q.get('cd') !== '0', connect: q.get('cn') !== '0',
  };
  const mode = Array.isArray(f.trips) ? 'select' : (f.from || f.to) ? 'period' : 'all';
  app.innerHTML = `
  ${header(existing ? '引き出しを編集' : '引き出しを作る', '', { back: existing ? `#/drawer/${existing.id}` : '#/?tab=drawers' })}
  <main class="page narrow">
    <form class="stack-lg" id="dform">
      <div class="stack"><label for="d-name">引き出しの名前</label>
        <input id="d-name" required value="${esc(existing ? existing.name : '')}" placeholder="例：次こそ行く場所"></div>
      <fieldset class="stack"><legend>① どの旅から？</legend>
        <div class="segs" role="radiogroup">
          ${[['all', 'すべての旅'], ['select', '旅を選ぶ'], ['period', '期間で選ぶ']].map(([v, l]) => `<label class="seg"><input type="radio" name="d-mode" value="${v}" ${mode === v ? 'checked' : ''}>${l}</label>`).join('')}
        </div>
        <div class="card stack" id="d-trips" ${mode === 'select' ? '' : 'hidden'}>
          ${data.trips.map((t) => `<label class="check"><input type="checkbox" name="d-trip" value="${t.id}" ${Array.isArray(f.trips) && f.trips.includes(t.id) ? 'checked' : ''}>${esc(t.title)}<small>${esc(formatDateRange(t))}</small></label>`).join('') || '<span class="sub">旅がまだありません</span>'}
        </div>
        <div class="row2" id="d-period" ${mode === 'period' ? '' : 'hidden'}>
          <div class="stack"><label for="d-from">この日から</label><input id="d-from" type="date" value="${esc(f.from || '')}"></div>
          <div class="stack"><label for="d-to">この日まで</label><input id="d-to" type="date" value="${esc(f.to || '')}"></div>
        </div>
      </fieldset>
      <fieldset class="stack"><legend>② どの場所を？（複数OK）</legend>
        <div class="grid2">${STATUSES.map((s) => `<label class="check card"><input type="checkbox" name="d-st" value="${s}" ${f.statuses.includes(s) ? 'checked' : ''}>${STATUS_LABEL[s]}</label>`).join('')}</div>
      </fieldset>
      <fieldset class="stack"><legend>③ 見た目</legend>
        <label class="check card"><input type="checkbox" id="d-cd" ${f.colorDetour ? 'checked' : ''}>寄り道を色分けする</label>
        <label class="check card"><input type="checkbox" id="d-cn" ${f.connect ? 'checked' : ''}>ピンを線で結ぶ</label>
      </fieldset>
      <p class="sub center" id="d-count"></p>
      <button class="btn primary block" type="submit">引き出しにしまう</button>
      ${existing ? '<button class="btn danger block" type="button" id="d-del">この引き出しを削除</button>' : ''}
    </form>
  </main>`;

  const read = () => {
    const m = $('input[name="d-mode"]:checked').value;
    return {
      trips: m === 'select' ? $$('input[name="d-trip"]:checked').map((i) => i.value) : 'all',
      from: m === 'period' ? $('#d-from').value : '',
      to: m === 'period' ? $('#d-to').value : '',
      statuses: $$('input[name="d-st"]:checked').map((i) => i.value),
      colorDetour: $('#d-cd').checked, connect: $('#d-cn').checked,
    };
  };
  const update = () => {
    const m = $('input[name="d-mode"]:checked').value;
    $('#d-trips').hidden = m !== 'select'; $('#d-period').hidden = m !== 'period';
    $('#d-count').textContent = `この条件で ${applyFilter(data.places, data.trips, read()).length}か所 が表示されます`;
  };
  $('#dform').addEventListener('change', update);
  update();
  $('#dform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const filter = read();
    if (!filter.statuses.length) return toast('「どの場所を？」を1つ以上選んでください', 'error');
    if (Array.isArray(filter.trips) && !filter.trips.length) return toast('旅を1つ以上選んでください', 'error');
    const d = await guard(() => store.saveDrawer({ id: existing && existing.id, name: $('#d-name').value.trim(), filter }), '引き出しにしまいました');
    if (d) go('#/drawer/' + d.id);
  });
  const del = $('#d-del');
  if (del) { let armed = false; del.onclick = async () => {
    if (!armed) { armed = true; del.textContent = 'もう一度押すと削除します（共有も止まります）'; return; }
    await guard(() => store.deleteDrawer(existing.id), '削除しました'); go('#/?tab=drawers');
  }; }
}

// ---------- 引き出しを開く ----------
async function renderDrawer(drawerId) {
  view.name = 'drawer';
  await reload();
  const d = data.drawers.find((x) => x.id === drawerId);
  if (!d) { toast('引き出しが見つかりません', 'error'); return go('#/?tab=drawers'); }
  const f = { ...ALL_FILTER, ...d.filter };
  app.innerHTML = `
  ${header(d.name, describeFilter(f, data.trips), { back: '#/?tab=drawers' })}
  <div class="map-wrap"><div id="map" class="map" role="region" aria-label="引き出しの地図"></div></div>
  <main class="page stack-lg">
    <section class="card stack" id="sheet" hidden></section>
    <div class="row-inline wrap">
      <a class="btn primary" href="#/drawer/${d.id}/share">この引き出しを共有</a>
      <a class="btn" href="#/drawer/${d.id}/edit">条件を変える</a>
    </div>
    <section class="stack"><div class="row-between"><h2>入っている場所</h2><span class="sub" id="count"></span></div><ul class="list" id="place-list"></ul></section>
  </main>`;
  view.map = createMap($('#map'));
  let selected = null;
  const paint = (fit) => {
    const vis = applyFilter(data.places, data.trips, f);
    drawPlaces(view.map, vis, { colorDetour: f.colorDetour, connect: f.connect, selectedId: selected, fit, onSelect: (p) => { selected = p.id; paint(false); } });
    const tripName = new Map(data.trips.map((t) => [t.id, t.title]));
    $('#count').textContent = `${vis.length}か所`;
    $('#place-list').innerHTML = vis.map((p) => `<li><a class="item" href="#/trip/${p.trip_id}?focus=${p.id}">
      <span class="badge badge-${p.status === 'detour' && !f.colorDetour ? 'visited' : p.status}" aria-hidden="true"></span>
      <span class="item-main"><b>${esc(p.name || '名前なしの場所')}</b><small>${esc(tripName.get(p.trip_id) || '')} ・ ${STATUS_LABEL[p.status]}</small></span></a></li>`).join('')
      || '<li class="empty">この条件に入る場所はまだありません。</li>';
    const p = data.places.find((x) => x.id === selected);
    const sheet = $('#sheet');
    if (p) {
      sheet.hidden = false;
      sheet.innerHTML = `<div class="row-between"><h2>${esc(p.name || '名前なしの場所')}</h2><button class="btn small" type="button" id="sh-close">閉じる</button></div>
        <span class="sub">${esc(tripName.get(p.trip_id) || '')} ・ ${STATUS_LABEL[p.status]}</span>
        <div class="row-inline wrap"><a class="btn primary" href="${googleUrl(p)}" target="_blank" rel="noopener">${p.name ? 'Googleマップで施設を見る' : 'Googleマップで位置を見る'}</a>
        <a class="btn" href="#/trip/${p.trip_id}?focus=${p.id}">旅の地図で開く</a></div>`;
      $('#sh-close').onclick = () => { selected = null; paint(false); };
    } else sheet.hidden = true;
  };
  view.cleanup.push(store.subscribe(async () => { await reload(); paint(false); }));
  paint(true);
}

// ---------- 共有 ----------
async function renderShare(drawerId) {
  view.name = 'share';
  await reload();
  const d = data.drawers.find((x) => x.id === drawerId);
  if (!d) return go('#/?tab=drawers');
  const shares = (await guard(() => store.listShares(drawerId))) || [];
  app.innerHTML = `
  ${header('引き出しを共有', d.name, { back: `#/drawer/${d.id}` })}
  <main class="page narrow stack-lg">
    <section class="card stack">
      <h2>新しく共有する</h2>
      <p class="hint">アプリを入れている人だけが見られます。相手に「共有コード」を送り、アプリの「共有されたもの」で入力してもらいます。旅の記録を変えると、相手の画面にも反映されます。</p>
      <label class="check"><input type="checkbox" id="s-photos">写真も見せる</label>
      <label class="check"><input type="checkbox" id="s-notes">ひとことメモも見せる</label>
      <button class="btn primary" type="button" id="s-create">共有コードを作る</button>
      <div id="s-new"></div>
    </section>
    <section class="stack"><h2>共有中</h2>
      <ul class="list">${shares.map((s) => `<li class="card stack" data-id="${s.id}">
        <div class="row-between"><span class="code copy-target">${esc(s.code)}</span><span class="pill ${s.shared_with ? 'pill-ok' : ''}">${s.shared_with ? '受け取り済み' : 'まだ受け取られていません'}</span></div>
        <label class="check"><input type="checkbox" class="sx-photos" ${s.show_photos ? 'checked' : ''}>写真も見せる</label>
        <label class="check"><input type="checkbox" class="sx-notes" ${s.show_notes ? 'checked' : ''}>ひとことメモも見せる</label>
        <div class="row-inline"><button class="btn small sx-copy" type="button">コードをコピー</button><button class="btn small danger sx-del" type="button">共有をやめる</button></div>
      </li>`).join('') || '<li class="empty">まだ共有していません。</li>'}</ul>
    </section>
  </main>`;

  $('#s-create').onclick = async () => {
    const s = await guard(() => store.createShare(drawerId, { show_photos: $('#s-photos').checked, show_notes: $('#s-notes').checked }));
    if (!s) return;
    $('#s-new').innerHTML = `<div class="notice stack"><b>共有コードを作りました</b><span class="code big copy-target">${esc(s.code)}</span>
      <span>このコードを相手に送ってください（1人1コード。使えるのは1回です）。</span>
      <button class="btn" type="button" id="s-copy">コピー</button></div>`;
    $('#s-copy').onclick = (e) => copyText(`ふたりの旅の共有コード：${s.code}`, e.currentTarget);
  };
  $$('li[data-id]').forEach((li) => {
    const id = li.dataset.id;
    const s = shares.find((x) => x.id === id);
    $('.sx-photos', li).onchange = (e) => guard(() => store.updateShare(id, { show_photos: e.target.checked }), '変更しました');
    $('.sx-notes', li).onchange = (e) => guard(() => store.updateShare(id, { show_notes: e.target.checked }), '変更しました');
    $('.sx-copy', li).onclick = (e) => copyText(`ふたりの旅の共有コード：${s.code}`, e.currentTarget);
    let armed = false;
    $('.sx-del', li).onclick = async (e) => {
      if (!armed) { armed = true; e.currentTarget.textContent = 'もう一度押すと、相手から見えなくなります'; return; }
      await guard(() => store.deleteShare(id), '共有をやめました'); route();
    };
  });
}

// ---------- 共有されたものを見る ----------
async function renderShared(shareId) {
  view.name = 'shared';
  const list = (await guard(() => store.sharedWithMe())) || [];
  const s = list.find((x) => x.share_id === shareId);
  if (!s) { toast('見られなくなっています', 'error'); return go('#/?tab=shared'); }
  const f = { ...ALL_FILTER, ...s.filter };
  app.innerHTML = `
  ${header(s.name, `${s.from_group} から`, { back: '#/?tab=shared' })}
  <div class="map-wrap"><div id="map" class="map" role="region" aria-label="共有された地図"></div></div>
  <main class="page stack-lg">
    <section class="card stack" id="sheet" hidden></section>
    <section class="stack"><div class="row-between"><h2>入っている場所</h2><span class="sub" id="count"></span></div><ul class="list" id="place-list"></ul></section>
    <p class="sub">相手が記録を変えると、ここにも反映されます。</p>
  </main>`;
  view.map = createMap($('#map'));
  let places = [], photos = [], selected = null, first = true;
  const load = async () => {
    places = (await guard(() => store.sharedPlaces(shareId))) || [];
    photos = s.show_photos ? ((await guard(() => store.sharedPhotos(shareId))) || []) : [];
    paint();
  };
  const paint = () => {
    drawPlaces(view.map, places, { colorDetour: f.colorDetour, connect: f.connect, selectedId: selected, fit: first, onSelect: (p) => { selected = p.id; paint(); } });
    first = false;
    $('#count').textContent = `${places.length}か所`;
    $('#place-list').innerHTML = places.map((p) => `<li><button class="item" type="button" data-id="${p.id}">
      <span class="badge badge-${p.status === 'detour' && !f.colorDetour ? 'visited' : p.status}" aria-hidden="true"></span>
      <span class="item-main"><b>${esc(p.name || '名前なしの場所')}</b><small>${esc(p.trip_title)} ・ ${STATUS_LABEL[p.status]}</small></span></button></li>`).join('')
      || '<li class="empty">まだ場所がありません。</li>';
    const p = places.find((x) => x.id === selected);
    const sheet = $('#sheet');
    if (!p) { sheet.hidden = true; return; }
    const ph = photos.filter((x) => x.place_id === p.id);
    sheet.hidden = false;
    sheet.innerHTML = `<div class="row-between"><h2>${esc(p.name || '名前なしの場所')}</h2><button class="btn small" type="button" id="sh-close">閉じる</button></div>
      <span class="sub">${esc(p.trip_title)} ・ ${STATUS_LABEL[p.status]}</span>
      ${p.note ? `<p>${esc(p.note)}</p>` : ''}
      ${ph.length ? `<div class="photos">${ph.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt="写真" loading="lazy"></a>`).join('')}</div>` : ''}
      <a class="btn primary" href="${googleUrl(p)}" target="_blank" rel="noopener">${p.name ? 'Googleマップで施設を見る' : 'Googleマップで位置を見る'}</a>`;
    $('#sh-close').onclick = () => { selected = null; paint(); };
  };
  $('#place-list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; selected = b.dataset.id; paint(); focusPlace(view.map, places.find((x) => x.id === selected)); });
  const onVis = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVis);
  const timer = setInterval(load, 60000);
  view.cleanup.push(() => { document.removeEventListener('visibilitychange', onVis); clearInterval(timer); });
  await load();
}

// ---------- 設定 ----------
async function renderSettings() {
  view.name = 'settings';
  const g = (await guard(() => store.getGroup())) || { members: [] };
  const demo = store.mode === 'demo';
  app.innerHTML = `
  ${header('設定', me.user.email, { back: '#/' })}
  <main class="page narrow stack-lg">
    ${demo ? `<section class="notice stack"><b>いまは「お試しモード」です</b>
      <span>記録はこのスマホの中だけに保存されます。Supabase をつなぐと、夫婦での共有・写真の自動記録・引き出しの共有が使えます（手順書「SETUP」を見てください）。</span>
      <button class="btn" type="button" id="demo-reset">見本データに戻す</button></section>` : ''}
    <section class="card stack"><h2>夫婦でつながる</h2>
      <p class="hint">相手にこの「招待コード」を伝え、相手の設定画面の「相手の招待コードを入れる」に入力してもらいます。</p>
      <div class="row-between"><span class="code big copy-target">${esc(g.invite_code || '')}</span><button class="btn small" type="button" id="inv-copy">コピー</button></div>
      <span class="sub">メンバー：${esc((g.members || []).map((m) => m.display_name || 'メンバー').join('・'))}</span>
      <form class="row-inline" id="join"><label class="sr-only" for="join-code">相手の招待コード</label><input id="join-code" placeholder="相手の招待コードを入れる" autocapitalize="characters" required><button class="btn" type="submit">参加</button></form>
    </section>
    <section class="card stack"><h2>写真で自動記録（ショートカット）</h2>
      <p class="hint">iPhoneの「ショートカット」に入れる、あなた専用の「記録キー」です。人に見せないでください。</p>
      <button class="btn" type="button" id="key-show">記録キーを表示</button>
      <div id="key-box"></div>
      <a class="btn" href="docs/shortcut.html" target="_blank" rel="noopener">ショートカットの作り方を見る</a>
    </section>
    <section class="card stack"><h2>アカウント</h2>
      <span>${esc(me.user.email)}</span>
      ${demo ? '' : '<button class="btn danger" type="button" id="logout">ログアウト</button>'}
    </section>
    <p class="sub center">地図データ：国土地理院・OpenStreetMap ／ 住所検索：国土地理院 ／ 名前検索：OpenStreetMap Nominatim</p>
  </main>`;
  $('#inv-copy').onclick = (e) => copyText(g.invite_code, e.currentTarget);
  $('#join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await guard(() => store.joinGroup($('#join-code').value), '参加しました。ふたりの記録がまとまります');
    if (ok) { me.groupId = ok; unsub(); unsub = store.subscribe(() => {}); go('#/'); }
  });
  $('#key-show').onclick = async () => {
    const key = await guard(() => store.ingestKey(false));
    if (!key) return;
    $('#key-box').innerHTML = `<div class="stack"><span class="label">送り先のURL</span><code class="copy-target">${esc(store.functionsUrl)}</code><button class="btn small" type="button" id="url-copy">URLをコピー</button>
      <span class="label">記録キー</span><code class="copy-target">${esc(key)}</code><div class="row-inline"><button class="btn small" type="button" id="key-copy">キーをコピー</button><button class="btn small danger" type="button" id="key-renew">キーを作り直す</button></div></div>`;
    $('#url-copy').onclick = (e) => copyText(store.functionsUrl, e.currentTarget);
    $('#key-copy').onclick = (e) => copyText(key, e.currentTarget);
    let armed = false;
    $('#key-renew').onclick = async (e) => {
      if (!armed) { armed = true; e.currentTarget.textContent = 'もう一度押すと、今のショートカットは使えなくなります'; return; }
      await guard(() => store.ingestKey(true), '作り直しました。ショートカットのキーも入れ直してください'); $('#key-show').click();
    };
  };
  const lo = $('#logout');
  if (lo) lo.onclick = async () => { await store.signOut(); me = null; go('#/login'); };
  const dr = $('#demo-reset');
  if (dr) dr.onclick = async () => { await store.resetDemo(); toast('見本データに戻しました'); go('#/'); };
}

// ---------- 起動 ----------
async function start() {
  me = await store.session();
  unsub();
  unsub = () => {};
}

async function boot() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const { createSupabaseStore } = await import('./store-supabase.js');
      store = createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error(e);
      app.innerHTML = '<main class="page narrow"><p class="error">サーバーにつながりませんでした。通信を確認して、もう一度開いてください。</p></main>';
      return;
    }
  } else {
    store = createLocalStore();
  }
  try { await start(); } catch (e) { console.error(e); me = null; }
  window.addEventListener('hashchange', route);
  route();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
