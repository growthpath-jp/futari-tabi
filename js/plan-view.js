// 旅の画面「予定」タブ：日ごとの予定（到着・出発・場所・宿・帰り）と旅行中モード
import { hm, fmt, MODES, simulate, replanFrom, gapFillFor, bearingText, travelMin, tripDates, normalizePlan, NIGHT_DEFAULT } from './plan.js';
import { DAY_COLORS } from './map.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const TIMES = (from, to, step) => { const a = []; for (let t = hm(from); t <= hm(to); t += step) a.push(fmt(t)); return a; };
const timeSel = (id, cur, from, to, step = 15, label = '') => {
  const opts = TIMES(from, to, step);
  if (cur && !opts.includes(cur)) opts.push(cur);
  opts.sort((a, b) => hm(a) - hm(b));
  return `<select id="${id}" ${label ? `aria-label="${esc(label)}"` : ''}>${opts.map((t) => `<option ${t === cur ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
};
const timeInput = (id, cur, label) => `<input type="time" id="${id}" aria-label="${esc(label)}" value="${cur ? fmt(hm(cur)).padStart(5, '0') : ''}">`;
const span = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return `${h ? h + '時間' : ''}${m ? m + '分' : ''}`; };
const nowHM = () => { const d = new Date(Date.now() + 9 * 3600000); return fmt(Math.floor((d.getUTCHours() * 60 + d.getUTCMinutes()) / 15) * 15); };
const todayISO = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

// ctx: { el, getTrip, getPlaces, store, guard, toast, refresh, openPlace(id), searchAny(q) }
export function createPlanView(ctx) {
  const ui = { pickFor: null, tm: { on: false, today: 0, now: '9:00', here: null } };
  let res = null;
  const trip = () => ctx.getTrip();
  const place = (id) => ctx.getPlaces().find((p) => p.id === id);

  async function savePlan(mut, msg) {
    const t = trip();
    const plan = normalizePlan(t.plan, tripDates(t).length);
    mut(plan);
    await ctx.guard(() => ctx.store.updateTrip(t.id, { plan }), msg);
    await ctx.refresh();
  }
  async function savePlace(id, patch, msg) {
    const p = place(id);
    await ctx.guard(() => ctx.store.updatePlace(id, patch.plan ? { ...patch, plan: { ...(p.plan || {}), ...patch.plan } } : patch), msg);
  }
  const dropFromManual = (plan, id) => Object.keys(plan.manual).forEach((d) => { plan.manual[d] = plan.manual[d].filter((x) => x !== id); });

  // ---------- 表示 ----------
  function render(r) {
    res = r;
    if (!r) {
      ctx.el.innerHTML = '<div class="notice stack"><b>旅の日付を入れると、日ごとの予定が作れます</b><span>右上の「…」→「旅の名前・日付を変える」から入れてください。</span></div>';
      return;
    }
    const plan = r.plan;
    ctx.el.innerHTML = `
      ${tripModeBox(r)}
      <div class="stack"><span class="label">移動手段</span>
        <div class="segs small" role="radiogroup" aria-label="移動手段">${Object.entries(MODES).map(([k, m]) => `<label class="seg"><input type="radio" name="pv-mode" value="${k}" ${k === plan.mode ? 'checked' : ''}>${m.label}</label>`).join('')}</div></div>
      ${r.days.map((x) => dayHtml(r, x)).join('')}`;
  }

  function tripModeBox(r) {
    const tm = ui.tm;
    if (!tm.on) return '<button class="btn block" type="button" id="pv-tm">旅行中モードにする（今いる場所から次の目的地を案内）</button>';
    const today = r.days[tm.today];
    const next = today && today.order[0];
    let body;
    if (!tm.here) body = '<span>地図をタップして「今いる場所」を決めるか、「本物の現在地」を押してください。</span>';
    else if (!next) body = '<b>今日の予定はすべて終わりました</b>';
    else {
      const travel = r.mode === 'car' ? 'driving' : r.mode === 'walk' ? 'walking' : 'transit';
      const url = `https://www.google.com/maps/dir/?api=1&origin=${tm.here.lat},${tm.here.lng}&destination=${encodeURIComponent(next.name)}&destination_place_id=&travelmode=${travel}`;
      body = `<b class="pv-next">次は「${esc(next.name)}」</b><span>${bearingText(tm.here, next)} ・ 移動の目安 約${Math.round(travelMin(tm.here, next, r.mode))}分</span>
        <div class="row-inline wrap"><button class="btn primary small" type="button" id="pv-replan">今いる場所から並べ直す</button><a class="btn small" href="${url}" target="_blank" rel="noopener">Googleマップで道案内</a></div>`;
    }
    return `<section class="notice stack tm-box" aria-live="polite">
      <div class="row-between"><b>旅行中モード</b><button class="btn small" type="button" id="pv-tm">終える</button></div>
      <div class="row-inline wrap">
        <label for="pv-today">今日</label><select id="pv-today">${r.days.map((d) => `<option value="${d.d}" ${d.d === tm.today ? 'selected' : ''}>${d.label}</option>`).join('')}</select>
        <label for="pv-now">今の時刻</label>${timeSel('pv-now', tm.now, '6:00', '23:00', 15)}
        <button class="btn small" type="button" id="pv-gps">本物の現在地</button></div>
      ${body}</section>`;
  }

  function dayHtml(r, x) {
    const d = x.d, color = DAY_COLORS[d % DAY_COLORS.length];
    const isToday = ui.tm.on && ui.tm.today === d;
    const rows = new Map(x.sim.rows.map((y) => [y.id, y]));
    const list = x.order.map((p, i) => {
      const y = rows.get(p.id);
      const pinnedClosed = p.day != null && p.closed.includes(d);
      const warn = pinnedClosed ? 'この日は休みです' : y && y.warn;
      const tags = [
        p.day != null ? '<span class="tag">日を決めた</span>' : '',
        p.at != null ? `<span class="tag tag-time">${fmt(p.at)}に行く</span>` : '',
        p.until != null ? `<span class="tag tag-time">〜${fmt(p.until)}</span>` : '',
        p.priority === 'maybe' ? '<span class="tag tag-maybe">行けたら</span>' : '',
      ].join('');
      // 予約などの前に60分以上あくときは「空き時間」として見せる
      const gap = y && y.wait >= 60 ? `<li class="gap"><span>空き時間 ${span(y.wait)}<small>${fmt(y.arrive - y.wait)}〜${fmt(y.arrive)}</small></span><button class="mini" type="button" data-act="fill" data-d="${d}">空き時間を埋める</button></li>` : '';
      return `${gap}<li class="prow" data-id="${p.id}" data-d="${d}">
        <button class="handle" type="button" aria-label="${esc(p.name)}を並べ替え（ドラッグ）"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></button>
        <span class="num" style="background:${color}">${i + 1}</span>
        <div class="pmain"><b>${esc(p.name)}</b>
          <span class="pmeta">${y ? `${fmt(y.arrive)}着 ・ ${span(p.stay)} ・ 移動${Math.round(y.move)}分${y.wait > 1 && y.wait < 60 ? ` ・ 待ち${Math.round(y.wait)}分` : ''}` : ''}</span>
          ${warn ? `<span class="pwarn">${esc(warn)}</span>` : ''}
          ${tags ? `<div class="tags">${tags}</div>` : ''}</div>
        <div class="updown"><button type="button" data-act="up" aria-label="上へ" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-act="down" aria-label="下へ" ${i === x.order.length - 1 ? 'disabled' : ''}>↓</button></div>
        <div class="pctrl">
          <label class="sr-only" for="mv-${p.id}">何日目</label>
          <select id="mv-${p.id}" data-act="move"><option value="" ${p.day == null ? 'selected' : ''}>日はおまかせ</option>${r.days.map((dd) => `<option value="${dd.d}" ${p.day === dd.d ? 'selected' : ''}>${dd.label}に決める</option>`).join('')}</select>
          <button class="mini" type="button" data-act="edit">変更</button>
          ${isToday ? '<button class="mini" type="button" data-act="done">行った</button><button class="mini" type="button" data-act="cancel">中止</button>' : ''}
        </div></li>`;
    }).join('');
    const skip = x.skipped.length ? `<div class="stack"><span class="label">見送り候補（時間に収まらない「行けたら」）</span>${x.skipped.map((p) => `<div class="prow" data-id="${p.id}" data-d="${d}"><span></span><span class="num num-skip">?</span><div class="pmain"><b>${esc(p.name)}</b><span class="pmeta">${span(p.stay)}</span></div><span></span><div class="pctrl"><button class="mini" type="button" data-act="force">この日に入れる</button><button class="mini" type="button" data-act="edit">変更</button></div></div>`).join('')}</div>` : '';
    return `<section class="day stack" aria-label="${esc(x.label)}" data-day="${d}">
      <div class="day-head"><h2><span class="day-dot" style="background:${color}"></span>${esc(x.label)}${isToday ? '（今日）' : ''}</h2>
        <span class="day-sum">移動 合計${Math.round(x.sim.travel)}分</span>
        ${x.edited ? `<button class="mini" type="button" data-act="auto" data-d="${d}">おまかせの順番に戻す</button>` : ''}</div>
      ${startRow(r, x)}
      <ul class="day-list" data-d="${d}">${list || '<li class="empty">この日の場所はまだありません</li>'}</ul>
      ${endRow(r, x)}
      ${skip}</section>`;
  }

  function startRow(r, x) {
    const d = x.d, plan = r.plan;
    if (ui.tm.on && ui.tm.today === d && ui.tm.here) return `<div class="terminal"><span class="kind">今</span><span class="tname">今いる場所</span><span class="ttime">${esc(ui.tm.now)}</span></div>`;
    if (d === 0) {
      const a = plan.arrive;
      return `<div class="terminal ${a ? '' : 'tbd'}" data-term="arrive"><span class="kind">到着</span>
        <span class="tname">${a ? esc(a.name) : '着く場所はまだ'}<small>${a ? `${esc(a.via || '')}で着く` : '駅や空港を決めると、そこから1日目が始まります'}</small></span>
        <span class="ttime">${a && a.time ? esc(a.time) + '着' : ''}</span>
        <div class="tctrl"><label for="pv-arr-time">着く時刻</label>${timeInput('pv-arr-time', a && a.time, '着く時刻')}
          <button class="mini" type="button" data-pick-open="arrive">${a ? '着く場所を変える' : '着く場所を決める'}</button></div>
        ${ui.pickFor === 'arrive' ? picker('arrive') : ''}</div>`;
    }
    const n = plan.nights[d - 1];
    const late = n.status === 'booked' && x.startTime > hm(n.checkout);
    const name = x.start ? x.start.name : '前の日の最後の場所の近く';
    const from = n.status === 'free' ? '<small>前の夜は当日探した宿（素泊まり）。その近くから</small>'
      : n.status === 'booked' ? `<small>チェックアウト ${esc(n.checkout)}まで</small>` : '<small>前の夜の宿から</small>';
    return `<div class="terminal ${n.status === 'booked' ? '' : 'tbd'}"><span class="kind">出発</span>
      <span class="tname">${esc(name)}${from}${late ? `<small class="pwarn">チェックアウトの${esc(n.checkout)}を過ぎています</small>` : ''}</span>
      <span class="ttime">${fmt(x.startTime)}</span>
      <div class="tctrl"><label for="pv-ts-${d}">出発する時刻</label>${timeSel('pv-ts-' + d, plan.starts[d], '6:00', '15:00')}</div></div>`;
  }

  function endRow(r, x) {
    const d = x.d, plan = r.plan, last = r.days.length - 1;
    if (d === last) {
      const lv = plan.leave;
      const late = lv && lv.time ? Math.max(0, x.sim.finish - x.endTime) : 0;
      const note = !lv ? '<small>帰る駅や空港を決めると、その時刻に間に合うように組みます</small>'
        : late > 0 ? `<small class="pwarn">${Math.round(late)}分足りません（${fmt(x.sim.finish)}ごろ着）</small>`
        : x.order.length ? `<small>${fmt(x.sim.finish)}ごろ着く見込み（出発の15分前までに着く計算）</small>` : '<small>出発の15分前までに着く計算</small>';
      return `<div class="terminal ${lv ? '' : 'tbd'}" data-term="leave"><span class="kind">帰り</span>
        <span class="tname">${lv ? esc(lv.name) : '帰る場所はまだ'}${lv && lv.via ? `<small>${esc(lv.via)}</small>` : ''}${note}</span>
        <span class="ttime">${lv && lv.time ? esc(lv.time) + '発' : ''}</span>
        <div class="tctrl"><label for="pv-lv-time">出発の時刻</label>${timeInput('pv-lv-time', lv && lv.time, '出発の時刻')}
          <button class="mini" type="button" data-pick-open="leave">${lv ? '帰る場所を変える' : '帰る場所を決める'}</button></div>
        ${ui.pickFor === 'leave' ? picker('leave') : ''}</div>`;
    }
    const n = plan.nights[d];
    const seg = `<div class="segs small nstat" role="radiogroup" aria-label="${esc(x.label)}の宿">${[['booked', '予約済み'], ['tbd', 'まだ'], ['free', '当日探す']].map(([v, l]) => `<label class="seg"><input type="radio" name="pv-ns-${d}" value="${v}" ${n.status === v ? 'checked' : ''}>${l}</label>`).join('')}</div>`;
    if (n.status === 'free') {
      const lastP = x.order[x.order.length - 1];
      const lastRow = lastP && x.sim.rows.find((y) => y.id === lastP.id);
      return `<div class="terminal tbd" data-term="night-${d}"><span class="kind">宿</span>
        <span class="tname">当日探す（素泊まり）<small>${lastP ? `最後の「${esc(lastP.name)}」で1日が終わり。次の日はその近くから出発` : '最後の場所で1日が終わり。次の日はその近くから出発'}</small></span>
        <span class="ttime">${lastRow ? fmt(lastRow.leave) + 'ごろまで' : ''}</span>
        <div class="tctrl">${seg}</div></div>`;
    }
    const booked = n.status === 'booked' && n.hotel;
    const ci = hm(n.checkin), lastIn = hm(n.lastIn), fin = x.sim.finish;
    const note = fin > lastIn ? `<small class="pwarn">チェックインの${esc(n.lastIn)}に${Math.round(fin - lastIn)}分遅れます（${fmt(fin)}ごろ着）</small>`
      : !x.order.length ? '<small>この日の場所はまだありません</small>'
      : fin < ci ? `<small>${fmt(fin)}ごろ着く見込み。チェックインの${esc(n.checkin)}より早いので、荷物を預けるか、もう1か所入れられます</small>`
      : `<small>${fmt(fin)}ごろ着く見込み</small>`;
    return `<div class="terminal ${booked ? '' : 'tbd'}" data-term="night-${d}"><span class="kind">宿</span>
      <span class="tname">${booked ? esc(n.hotel.name) : '宿はまだ（場所の真ん中あたりで仮に計算）'}${note}</span>
      <span class="ttime">${x.order.length ? fmt(fin) + '着' : ''}</span>
      <div class="tctrl">${seg}</div>
      <div class="tctrl"><span>チェックイン</span>${timeSel('pv-ci-' + d, n.checkin, '12:00', '18:00', 30, 'チェックイン（から）')}<span>〜</span>${timeSel('pv-li-' + d, n.lastIn, '16:00', '24:00', 30, 'チェックイン（まで）')}</div>
      <div class="tctrl"><label for="pv-co-${d}">次の朝のチェックアウト</label>${timeSel('pv-co-' + d, n.checkout, '9:00', '13:00', 30)}</div>
      <div class="tctrl"><button class="mini" type="button" data-pick-open="${d}">${booked ? '宿を変える' : '宿を選ぶ'}</button></div>
      ${ui.pickFor === d ? picker(d) : ''}</div>`;
  }

  function picker(key) {
    const isNight = typeof key === 'number';
    const title = isNight ? `${res.days[key].label}の夜に泊まる宿` : key === 'arrive' ? '旅の始まり：どこに着く？' : '旅の終わり：どこから帰る？';
    return `<div class="hotel-pick" data-pick-for="${key}">
      <span class="label">${title}</span>
      <div class="row-inline"><label class="sr-only" for="pv-pq">名前・住所</label><input id="pv-pq" placeholder="${isNight ? '宿' : '駅・空港'}の名前、または住所"><button class="btn small" type="button" data-pick-search>探す</button></div>
      <div class="results" id="pv-pr"></div>
      <button class="btn small" type="button" data-pick-close>閉じる</button></div>`;
  }

  async function setPicked(key, c) {
    ui.pickFor = null;
    const pt = { name: c.name, lat: c.lat, lng: c.lng, ...(c.address ? { address: c.address } : {}) };
    if (typeof key === 'number') {
      await savePlan((plan) => { Object.assign(plan.nights[key], { status: 'booked', hotel: pt }); plan.manual = {}; }, `${res.days[key].label}の宿：${c.name}`);
    } else {
      await savePlan((plan) => { plan[key] = { via: '', time: key === 'arrive' ? '10:00' : '17:00', ...(plan[key] || {}), ...pt }; }, `${key === 'arrive' ? '着く場所' : '帰る場所'}：${c.name}`);
    }
  }

  // ---------- 操作 ----------
  const orderIds = (d) => res.days[d].order.map((p) => p.id);
  const setManual = (d, ids) => savePlan((plan) => { plan.manual[d] = ids; });

  ctx.el.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'pv-tm') {
      ui.tm.on = !ui.tm.on;
      if (ui.tm.on) {
        const i = res ? res.days.findIndex((x) => x.date === todayISO()) : -1;
        ui.tm.today = i >= 0 ? i : 0; ui.tm.now = i >= 0 ? nowHM() : '9:00'; ui.tm.here = null;
      }
      return ctx.repaint(true);
    }
    if (t.id === 'pv-gps') {
      if (!navigator.geolocation) return ctx.toast('この端末では現在地が使えません', 'error');
      return navigator.geolocation.getCurrentPosition((pos) => { ui.tm.here = { lat: pos.coords.latitude, lng: pos.coords.longitude }; ctx.repaint(false, ui.tm.here); },
        () => ctx.toast('現在地を取得できませんでした。地図をタップして決めてください', 'error'));
    }
    if (t.id === 'pv-replan') {
      const today = res.days[ui.tm.today];
      const { order } = replanFrom(today.day, ui.tm.here, hm(ui.tm.now), today.order, res.mode);
      return setManual(ui.tm.today, order.map((p) => p.id));
    }
    const po = t.closest('[data-pick-open]');
    if (po) { const k = po.dataset.pickOpen; ui.pickFor = k === 'arrive' || k === 'leave' ? k : Number(k); ctx.repaint(); const q = document.getElementById('pv-pq'); if (q) q.focus(); return; }
    if (t.closest('[data-pick-close]')) { ui.pickFor = null; return ctx.repaint(); }
    if (t.closest('[data-pick-search]')) {
      const q = document.getElementById('pv-pq').value.trim(), box = document.getElementById('pv-pr');
      if (!q) return;
      box.innerHTML = '<p class="sub">探しています…</p>';
      const key = ui.pickFor;
      const list = await ctx.guard(() => ctx.searchAny(q));
      if (!list) { box.innerHTML = ''; return; }
      box.innerHTML = list.length ? list.map((c, k) => `<button class="item" type="button" data-pick-hit="${k}"><span class="item-main"><b>${esc(c.name)}</b><small>${esc(c.area || c.address || '')}</small></span></button>`).join('') : '<p class="sub">見つかりませんでした。住所でも探せます</p>';
      box.querySelectorAll('[data-pick-hit]').forEach((b) => b.addEventListener('click', () => setPicked(key, list[Number(b.dataset.pickHit)])));
      return;
    }
    const b = t.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const row = b.closest('[data-id]');
    const id = row && row.dataset.id;
    const d = row ? Number(row.dataset.d) : Number(b.dataset.d);
    const act = b.dataset.act;
    if (act === 'up' || act === 'down') {
      const ids = orderIds(d), i = ids.indexOf(id), j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await setManual(d, ids);
    } else if (act === 'auto') await savePlan((plan) => { delete plan.manual[d]; });
    else if (act === 'edit') ctx.openPlace(id);
    else if (act === 'fill') {
      // 押したときだけ：日を決めていない場所から、この空き時間に入るものを探して、この日に決める
      const moves = gapFillFor(trip(), ctx.getPlaces(), d);
      if (!moves.length) return ctx.toast('この空き時間に入れられる場所はありません（日を決めていない場所から探します）');
      // その日にもともとあった場所も、この日に決める（入れたことで別の日へ動かないように）
      const keepIds = res.days[d].order.filter((p) => p.day == null).map((p) => p.id);
      for (const id of [...keepIds, ...moves.map((m) => m.id)]) await ctx.guard(() => ctx.store.updatePlace(id, { plan: { ...(place(id).plan || {}), day: d } }));
      await savePlan((plan) => moves.forEach((m) => dropFromManual(plan, m.id)), `${moves.map((m) => m.name).join('・')}を${res.days[d].label}に入れました`);
    }
    else if (act === 'force') { await savePlace(id, { plan: { priority: 'must', day: d } }, 'この日に入れました'); await ctx.refresh(); }
    else if (act === 'done') { await ctx.guard(() => ctx.store.updatePlace(id, { status: 'visited', visited_at: new Date().toISOString() }), '「予定通り」として記録しました'); await ctx.refresh(); }
    else if (act === 'cancel') { await ctx.guard(() => ctx.store.updatePlace(id, { status: 'missed', visited_at: null }), '「行けなかった」にしました'); await ctx.refresh(); }
  });

  ctx.el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'pv-mode') return savePlan((plan) => { plan.mode = t.value; });
    if (t.id === 'pv-today') { ui.tm.today = Number(t.value); return ctx.repaint(); }
    if (t.id === 'pv-now') { ui.tm.now = t.value; return ctx.repaint(); }
    if (t.id === 'pv-arr-time' || t.id === 'pv-lv-time') {
      if (!t.value) return;
      const key = t.id === 'pv-arr-time' ? 'arrive' : 'leave';
      return savePlan((plan) => { plan[key] = { name: '', via: '', ...(plan[key] || {}), time: fmt(hm(t.value)) }; });
    }
    let m = t.id && t.id.match(/^pv-(ts|ci|li|co)-(\d+)$/);
    if (m) {
      const i = Number(m[2]);
      return savePlan((plan) => { if (m[1] === 'ts') plan.starts[i] = t.value; else plan.nights[i][{ ci: 'checkin', li: 'lastIn', co: 'checkout' }[m[1]]] = t.value; });
    }
    m = t.name && t.name.match(/^pv-ns-(\d+)$/);
    if (m) {
      const i = Number(m[1]);
      const n = res.plan.nights[i];
      if (t.value === 'booked' && !n.hotel) { ui.pickFor = i; ctx.repaint(); ctx.toast('泊まる宿を探して選んでください'); return; }
      return savePlan((plan) => { plan.nights[i].status = t.value; plan.manual = {}; });
    }
    if (t.dataset && t.dataset.act === 'move') {
      const id = t.closest('[data-id]').dataset.id;
      const day = t.value === '' ? null : Number(t.value);
      await ctx.guard(() => ctx.store.updatePlace(id, { plan: { ...(place(id).plan || {}), day } }));
      return savePlan((plan) => dropFromManual(plan, id));
    }
  });

  // ---------- ドラッグで並べ替え（つまみ：すぐ／行全体：長押し） ----------
  let drag = null, pressTimer = null, pressStart = null;
  const startDrag = (row, y) => { drag = { row, list: row.parentElement, d: Number(row.parentElement.dataset.d), offset: y - row.getBoundingClientRect().top }; row.classList.add('is-dragging'); if (navigator.vibrate) navigator.vibrate(10); };
  const moveDrag = (y) => {
    const { row, list } = drag;
    row.style.transform = '';
    const center = y - drag.offset + row.getBoundingClientRect().height / 2;
    const prev = row.previousElementSibling, next = row.nextElementSibling;
    const mid = (el) => { const rc = el.getBoundingClientRect(); return rc.top + rc.height / 2; };
    if (prev && prev.classList.contains('prow') && center < mid(prev)) list.insertBefore(row, prev);
    else if (next && next.classList.contains('prow') && center > mid(next)) list.insertBefore(next, row);
    row.style.transform = `translateY(${y - drag.offset - row.getBoundingClientRect().top}px)`;
  };
  const endDrag = () => {
    if (!drag) return;
    const { row, list, d } = drag;
    row.classList.remove('is-dragging'); row.style.transform = '';
    drag = null;
    const ids = [...list.querySelectorAll('.prow')].map((x) => x.dataset.id);
    if (ids.join() !== orderIds(d).join()) setManual(d, ids);
  };
  const onDown = (e) => {
    const row = e.target.closest('.day-list .prow');
    if (!row || !ctx.el.contains(row)) return;
    if (e.target.closest('.handle')) { e.preventDefault(); startDrag(row, e.clientY); return; }
    if (e.target.closest('button, select, a, input')) return;
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => startDrag(row, pressStart.y), 450);
  };
  const onMove = (e) => {
    if (pressTimer && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) { clearTimeout(pressTimer); pressTimer = null; }
    if (drag) { e.preventDefault(); moveDrag(e.clientY); }
  };
  const onTouch = (e) => { if (drag) e.preventDefault(); };
  const onUp = () => { clearTimeout(pressTimer); pressTimer = null; endDrag(); };
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('touchmove', onTouch, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  const destroy = () => {
    document.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('touchmove', onTouch);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
  };

  return { ui, render, destroy, setHere: (ll) => { ui.tm.here = ll; } };
}

// 登録・変更フォームで使う「予定の条件」の入力欄
export function planFields(prefix, x, dates) {
  const opt = (v, cur, label) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${label}</option>`;
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  const closed = x.closed || {};
  return `<div class="row2">
      <div class="stack"><label for="${prefix}-day">何日目</label><select id="${prefix}-day">${opt('', x.day, '未定（おまかせ）')}${dates.map((d, i) => opt(i, x.day, d.label)).join('')}</select></div>
      <div class="stack"><label for="${prefix}-at">何時に行く</label><select id="${prefix}-at">${opt('', x.at, '未定（おまかせ）')}${TIMES('6:00', '23:00', 30).map((t) => opt(t, x.at, t)).join('')}</select></div>
      <div class="stack"><label for="${prefix}-stay">いる時間</label><select id="${prefix}-stay">${[30, 45, 60, 90, 120, 150, 180, 240].map((m) => opt(m, x.stay, m < 60 ? m + '分' : span(m))).join('')}</select></div>
      <div class="stack"><label for="${prefix}-until">何時までに着く</label><select id="${prefix}-until">${opt('', x.until, 'なし')}${TIMES('9:00', '23:00', 30).map((t) => opt(t, x.until, t + 'まで')).join('')}</select></div>
      <div class="stack"><label for="${prefix}-open">開く時刻</label><select id="${prefix}-open">${opt('', x.open, 'なし')}${TIMES('6:00', '14:00', 30).map((t) => opt(t, x.open, t)).join('')}</select></div>
    </div>
    <div class="segs" role="radiogroup" aria-label="行きたい度合い">
      <label class="seg"><input type="radio" name="${prefix}-prio" value="must" ${x.priority !== 'maybe' ? 'checked' : ''}>絶対行く</label>
      <label class="seg"><input type="radio" name="${prefix}-prio" value="maybe" ${x.priority === 'maybe' ? 'checked' : ''}>行けたら</label>
    </div>
    <fieldset class="stack"><legend class="label">休みの曜日</legend>
      <div class="cand-chips">${wd.map((w, i) => `<label class="check-chip"><input type="checkbox" name="${prefix}-closed" value="${i}" ${(closed.weekdays || []).includes(i) ? 'checked' : ''}>${w}</label>`).join('')}
        <label class="check-chip"><input type="checkbox" id="${prefix}-hopen" ${closed.holidayOpen ? 'checked' : ''}>祝日は開いている</label></div>
    </fieldset>`;
}
// 入力欄から予定の条件を読む（第◯週などの細かいルールは元のまま残す）
export function readPlanFields(prefix, root, prev) {
  const v = (s) => root.querySelector('#' + prefix + '-' + s).value;
  const weekdays = [...root.querySelectorAll(`input[name="${prefix}-closed"]:checked`)].map((i) => Number(i.value));
  const old = (prev && prev.closed) || {};
  return {
    day: v('day') === '' ? null : Number(v('day')), at: v('at') || null, stay: Number(v('stay')),
    until: v('until') || null, open: v('open') || null,
    priority: root.querySelector(`input[name="${prefix}-prio"]:checked`).value,
    closed: weekdays.length ? { ...old, weekdays, holidayOpen: root.querySelector('#' + prefix + '-hopen').checked } : null,
  };
}
export { NIGHT_DEFAULT };
