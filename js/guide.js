// お試しモードの「試し方ガイド」：やりたいこと → こう操作する → こうなる を1ステップずつ表示し、
// 操作のしやすさ（迷わずできたか・どこで迷ったか）を聞く。動いたかどうかは自動テストで確認する
// 画面・計算は本番と同じ。ガイドは説明を出すだけで、アプリの動きは変えない
import { GUIDE, KOBE_TRIP_ID } from './demo-kobe.js';

const KEY = 'futari-tabi-guide-v2';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
const keep = (g) => { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* 保存できなくても動かす */ } };

export const showGuide = (store, trip) => store.mode === 'demo' && trip.id === KOBE_TRIP_ID;

// シナリオの最初の状態にする（この旅の場所を入れ替え、旅の予定を戻す）
export async function applyScenario(store, tripId, sc) {
  const { plan, places } = sc.setup();
  const all = await store.listPlaces();
  for (const p of all.filter((x) => x.trip_id === tripId)) await store.deletePlace(p.id);
  for (const p of places) await store.addPlace({ ...p, trip_id: tripId });
  await store.updateTrip(tripId, { plan });
}

// ctx: { el, store, tripId, refresh, toast }
export function mountGuide(ctx) {
  const g = { sid: GUIDE[0].id, step: {}, answers: {}, notes: {}, memo: {}, pending: null, ...load() };
  const OK = '迷わずできた', ASK = ['少し迷った', 'わからなかった'];
  const sc = () => GUIDE.find((x) => x.id === g.sid) || GUIDE[0];
  function render() {
    const s = sc();
    const i = g.step[s.id] || 0;
    const ans = g.answers[s.id] || {};
    const head = `<div class="row-between"><b>試し方ガイド</b><span class="sub">お試しモードだけに出ます</span></div>
      <label class="sr-only" for="gd-sc">シナリオ</label>
      <select id="gd-sc">${GUIDE.map((x) => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>`;
    let body;
    if (i >= s.steps.length) {
      const next = GUIDE[GUIDE.indexOf(s) + 1];
      body = `<p class="gd-do">このシナリオは終わりです。</p>
        <label for="gd-memo">感じたこと（ひとことでOK）</label><textarea id="gd-memo" rows="2">${esc(g.memo[s.id] || '')}</textarea>
        <div class="row-inline wrap">${next ? `<button class="btn primary small" type="button" data-gd-next="${next.id}">次のシナリオへ</button>` : ''}
          <button class="btn small" type="button" data-gd-step="${s.steps.length - 1}">前へ</button>
          <button class="btn small" type="button" id="gd-copy">全シナリオの答えと感想をコピー</button></div>
        <pre class="fb-out copy-target" id="gd-out" hidden></pre>`;
    } else {
      const st = s.steps[i];
      body = `<span class="sub">ステップ ${i + 1} / ${s.steps.length}</span>
        <dl class="gd-steps">
          <dt>やりたいこと</dt><dd>${esc(st.want)}</dd>
          <dt>こう操作する</dt><dd>${esc(st.how)}</dd>
          <dt>こうなる</dt><dd>${esc(st.then)}</dd>
        </dl>
        <span class="label">操作してみて、どうだった？</span>
        <div class="answers" role="group" aria-label="答え">${[OK, ...ASK].map((a) => `<button class="mini ${ans[i] === a ? 'on' : ''}" type="button" data-gd-answer="${a}">${a}</button>`).join('')}</div>
        ${ASK.includes(ans[i]) && g.pending === `${s.id}:${i}` ? `<label for="gd-note">どこで迷った？（ひとことでOK）</label>
          <textarea id="gd-note" rows="2" placeholder="例：宿を選ぶボタンが見つからなかった">${esc(((g.notes[s.id] || {})[i]) || '')}</textarea>
          <button class="btn primary small" type="button" id="gd-note-next">次へ</button>` : ''}
        <div class="row-inline wrap">${i > 0 ? `<button class="btn small" type="button" data-gd-step="${i - 1}">前へ</button>` : ''}<button class="btn small" type="button" id="gd-reset">このシナリオの最初の状態にする</button></div>`;
    }
    ctx.el.innerHTML = head + body;
  }
  async function start(id) {
    g.sid = id; g.step[id] = 0; keep(g);
    await ctx.guard(() => applyScenario(ctx.store, ctx.tripId, sc()));
    await ctx.refresh(true);
    render();
    ctx.toast('シナリオの最初の状態にしました');
  }
  ctx.el.addEventListener('change', (e) => {
    if (e.target.id === 'gd-sc') start(e.target.value);
  });
  ctx.el.addEventListener('input', (e) => {
    if (e.target.id === 'gd-memo') { g.memo[sc().id] = e.target.value; keep(g); }
    if (e.target.id === 'gd-note') { const s = sc(); g.notes[s.id] = { ...(g.notes[s.id] || {}), [g.step[s.id] || 0]: e.target.value }; keep(g); }
  });
  ctx.el.addEventListener('click', async (e) => {
    const t = e.target, s = sc();
    const a = t.closest('[data-gd-answer]');
    if (a) {
      const i = g.step[s.id] || 0, v = a.dataset.gdAnswer;
      g.answers[s.id] = { ...(g.answers[s.id] || {}), [i]: v };
      // 迷ったときは「どこで？」を書いてから次へ
      if (ASK.includes(v)) { g.pending = `${s.id}:${i}`; keep(g); render(); const n = ctx.el.querySelector('#gd-note'); if (n) n.focus(); return; }
      g.pending = null; g.step[s.id] = i + 1; keep(g); return render();
    }
    if (t.id === 'gd-note-next') { g.pending = null; g.step[s.id] = (g.step[s.id] || 0) + 1; keep(g); return render(); }
    const st = t.closest('[data-gd-step]');
    if (st) { g.step[s.id] = Number(st.dataset.gdStep); keep(g); return render(); }
    const nx = t.closest('[data-gd-next]');
    if (nx) return start(nx.dataset.gdNext);
    if (t.id === 'gd-reset') return start(s.id);
    if (t.id === 'gd-copy') {
      const lines = ['【ふたりの旅 操作のしやすさ：答えと感想】'];
      for (const x of GUIDE) {
        const an = g.answers[x.id] || {};
        lines.push('', x.title);
        x.steps.forEach((y, i) => { const n = ((g.notes[x.id] || {})[i] || '').trim(); lines.push(`・${y.want} → ${an[i] || '未回答'}${n && an[i] !== OK ? `（${n}）` : ''}`); });
        lines.push(`感じたこと：${g.memo[x.id] || 'なし'}`);
      }
      const text = lines.join('\n');
      const out = ctx.el.querySelector('#gd-out'); out.textContent = text; out.hidden = false;
      try { await navigator.clipboard.writeText(text); ctx.toast('コピーしました。チャットに貼り付けてください'); }
      catch { const r = document.createRange(); r.selectNodeContents(out); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); ctx.toast('下の文を長押ししてコピーしてください'); }
    }
  });
  // はじめて開いたときは、シナリオ①の状態から始める
  if (!load().sid) start(GUIDE[0].id); else render();
}
