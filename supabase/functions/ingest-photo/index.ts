// @ts-nocheck  ブラウザ用と同じ判断ロジックを共用するため、型チェックは省略
// ふたりの旅：写真の受け口（iPhoneのショートカットから呼ばれる）
// 受け取るもの（JSON）：{ lat, lng, taken_at, image?(base64のJPEG), trip_id?(任意) }
// ヘッダー：x-ingest-key: <設定画面の記録キー>
// やること：記録キーで本人を確認 → 撮影日から旅を選ぶ → 予定の場所の近くなら「予定通り」、
//          なければ「寄り道」として登録 → 写真を保存 → 開くべき画面を返す
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-ingest-key, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

type Place = { id: string; trip_id: string; lat: number; lng: number; status: string; name?: string | null; visited_at?: string | null };
type Trip = { id: string; title: string; start_date: string | null; end_date: string | null; created_at: string };

// ===== app の js/logic.js と同じ判断（テストで一致を確認しています） =====
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
// ===== ここまで =====

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'));
  return null;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, message: 'POST で送ってください' }, 405);

  const key = req.headers.get('x-ingest-key') || '';
  if (key.length < 20) return json({ ok: false, message: '記録キーがありません。ショートカットの設定を確認してください。' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, message: '送られた内容を読めませんでした。' }, 400); }

  const lat = toNumber(body.lat), lng = toNumber(body.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return json({ ok: false, message: 'この写真には位置情報がありません。カメラの位置情報をオンにして撮った写真を選んでください。' }, 422);
  }
  const takenAt = toIso(body.taken_at) || new Date().toISOString();

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: k } = await sb.from('ingest_keys').select('user_id, group_id').eq('key', key).maybeSingle();
  if (!k) return json({ ok: false, message: '記録キーが違います。アプリの設定画面でキーを確認してください。' }, 401);

  // 旅を選ぶ
  const { data: trips } = await sb.from('trips').select('id,title,start_date,end_date,created_at').eq('group_id', k.group_id);
  let trip: Trip | null = null;
  if (body.trip_id) trip = (trips || []).find((t: Trip) => t.id === body.trip_id) || null;
  if (!trip) trip = pickTrip((trips || []) as Trip[], takenAt) as Trip | null;
  if (!trip) {
    const day = tokyoDate(takenAt);
    const { data: created, error } = await sb.from('trips')
      .insert({ group_id: k.group_id, title: `${day} の旅`, start_date: day, end_date: day, created_by: k.user_id })
      .select('id,title,start_date,end_date,created_at').single();
    if (error) return json({ ok: false, message: '旅を作れませんでした：' + error.message }, 500);
    trip = created as Trip;
  }

  // 同じ写真の二重送信を防ぐ
  const { data: dup } = await sb.from('photos').select('id, place_id').eq('trip_id', trip.id).eq('taken_at', takenAt).eq('lat', lat).eq('lng', lng).maybeSingle();
  if (dup) {
    return json({ ok: true, action: 'duplicate', trip_id: trip.id, place_id: dup.place_id, open_path: `#/trip/${trip.id}?focus=${dup.place_id}`, message: 'この写真はもう記録済みです。' });
  }

  // 場所と照らし合わせる
  const { data: places } = await sb.from('places').select('id,trip_id,lat,lng,status,name,visited_at').eq('trip_id', trip.id);
  const m = matchPhoto((places || []) as Place[], { lat, lng });
  let placeId: string;
  let message: string;
  if (m.action === 'detour') {
    const { data: np, error } = await sb.from('places').insert({
      trip_id: trip.id, group_id: k.group_id, lat, lng, status: 'detour', source: 'photo',
      registered_at: takenAt, visited_at: takenAt, created_by: k.user_id,
    }).select('id').single();
    if (error) return json({ ok: false, message: '場所を登録できませんでした：' + error.message }, 500);
    placeId = np.id;
    message = `「${trip.title}」に寄り道として記録しました。`;
  } else {
    const p = m.place as Place;
    placeId = p.id;
    const patch: Record<string, unknown> = { visited_at: earlierIso(p.visited_at || null, takenAt) };
    if (m.action === 'visit') patch.status = 'visited';
    await sb.from('places').update(patch).eq('id', p.id);
    message = m.action === 'visit'
      ? `「${p.name || '予定の場所'}」に行ったと記録しました。`
      : `「${p.name || 'この場所'}」に写真を追加しました。`;
  }

  // 写真を保存（任意）
  if (typeof body.image === 'string' && body.image.length > 100) {
    try {
      const bytes = decodeBase64(body.image);
      if (bytes.length > 8 * 1024 * 1024) throw new Error('写真が大きすぎます（8MBまで）');
      const path = `${k.group_id}/${trip.id}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from('photos').upload(path, bytes, { contentType: 'image/jpeg' });
      if (up.error) throw new Error(up.error.message);
      await sb.from('photos').insert({ place_id: placeId, trip_id: trip.id, group_id: k.group_id, storage_path: path, taken_at: takenAt, lat, lng, created_by: k.user_id });
    } catch (e) {
      message += ' ただし写真は保存できませんでした（' + (e as Error).message + '）。';
    }
  }

  return json({ ok: true, action: m.action, trip_id: trip.id, place_id: placeId, open_path: `#/trip/${trip.id}?focus=${placeId}`, message });
});
