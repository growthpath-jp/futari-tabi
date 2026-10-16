// 写真の受け口（Edge Function）を、偽のデータベースで動かして確かめる
// 実行：node --experimental-strip-types --test tests/ingest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- 偽の Supabase（必要な分だけ） ---
function fakeDb(seed) {
  const t = structuredClone(seed);
  let n = 0;
  const id = () => 'new-' + (++n);
  function q(table) {
    const s = { table, filters: [], op: 'select', payload: null };
    const rows = () => (t[table] ||= []).filter((r) => s.filters.every(([k, v]) => r[k] === v));
    const run = () => {
      if (s.op === 'insert') { const r = { id: id(), ...s.payload }; t[table].push(r); return [r]; }
      if (s.op === 'update') { const rs = rows(); rs.forEach((r) => Object.assign(r, s.payload)); return rs; }
      return rows();
    };
    const api = {
      select() { return api; },
      eq(k, v) { s.filters.push([k, v]); return api; },
      insert(p) { s.op = 'insert'; s.payload = p; return api; },
      update(p) { s.op = 'update'; s.payload = p; return api; },
      async single() { const r = run(); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'not single' } }; },
      async maybeSingle() { const r = run(); return { data: r[0] || null, error: null }; },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return api;
  }
  const uploads = [];
  return {
    tables: t, uploads,
    client: {
      from: q,
      storage: { from: () => ({ upload: async (path, bytes) => { uploads.push({ path, size: bytes.length }); return { error: null }; } }) },
    },
  };
}

let handler;
let db;
const seed = {
  ingest_keys: [{ key: 'k'.repeat(48), user_id: 'u1', group_id: 'g1' }],
  trips: [
    { id: 'kyoto', group_id: 'g1', title: '京都旅行', start_date: '2026-11-13', end_date: '2026-11-15', created_at: '2026-10-01' },
    { id: 'other', group_id: 'g2', title: '他人の旅', start_date: '2026-11-13', end_date: '2026-11-15', created_at: '2026-10-01' },
  ],
  places: [
    { id: 'arashiyama', trip_id: 'kyoto', group_id: 'g1', name: '嵐山', lat: 35.017, lng: 135.6713, status: 'want', visited_at: null },
    { id: 'kiyomizu', trip_id: 'kyoto', group_id: 'g1', name: '清水寺', lat: 34.9949, lng: 135.785, status: 'visited', visited_at: '2026-11-14T03:00:00.000Z' },
  ],
  photos: [],
};

test.before(async () => {
  const src = readFileSync(new URL('../supabase/functions/ingest-photo/index.ts', import.meta.url), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__createClient;');
  const dir = mkdtempSync(join(tmpdir(), 'fn-'));
  const file = join(dir, 'fn.ts');
  writeFileSync(file, src);
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's' }[k]) } };
  globalThis.__createClient = () => db.client;
  await import(file);
});

const call = async (body, key = 'k'.repeat(48)) => {
  const res = await handler(new Request('http://x/ingest-photo', { method: 'POST', headers: { 'x-ingest-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const jpeg = Buffer.from('fake-jpeg-bytes'.repeat(20)).toString('base64');

test('記録キーが違うと断る', async () => {
  db = fakeDb(seed);
  const r = await call({ lat: 35, lng: 135 }, 'x'.repeat(48));
  assert.equal(r.status, 401);
});

test('位置のない写真は断る（理由を返す）', async () => {
  db = fakeDb(seed);
  const r = await call({ taken_at: '2026-11-14T10:00:00+09:00' });
  assert.equal(r.status, 422);
  assert.match(r.body.message, /位置情報がありません/);
});

test('予定の場所の近く → 「予定通り」になり、写真が保存され、開く場所が返る', async () => {
  db = fakeDb(seed);
  const r = await call({ lat: '35.0171', lng: '135.6715', taken_at: '2026-11-14T11:00:00+09:00', image: jpeg });
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'visit');
  assert.equal(r.body.open_path, '#/trip/kyoto?focus=arashiyama');
  const p = db.tables.places.find((x) => x.id === 'arashiyama');
  assert.equal(p.status, 'visited');
  assert.equal(p.visited_at, '2026-11-14T02:00:00.000Z');
  assert.equal(db.uploads.length, 1);
  assert.match(db.uploads[0].path, /^g1\/kyoto\/.+\.jpg$/);
  assert.equal(db.tables.photos.length, 1);
});

test('どこにも近くない → 新しい「寄り道」', async () => {
  db = fakeDb(seed);
  const r = await call({ lat: 35.1, lng: 135.9, taken_at: '2026-11-14T15:00:00+09:00', image: jpeg });
  assert.equal(r.body.action, 'detour');
  const np = db.tables.places.find((x) => x.id === r.body.place_id);
  assert.equal(np.status, 'detour');
  assert.equal(np.group_id, 'g1');
});

test('同じ写真を2回送っても二重にならない', async () => {
  db = fakeDb(seed);
  const body = { lat: 35.1, lng: 135.9, taken_at: '2026-11-14T15:00:00+09:00', image: jpeg };
  await call(body);
  const r2 = await call(body);
  assert.equal(r2.body.action, 'duplicate');
  assert.equal(db.tables.places.filter((x) => x.status === 'detour').length, 1);
});

test('すでに行った場所に、もっと早い時刻の写真 → 訪問時刻が早い方に', async () => {
  db = fakeDb(seed);
  const r = await call({ lat: 34.995, lng: 135.7851, taken_at: '2026-11-14T09:00:00+09:00', image: jpeg });
  assert.equal(r.body.action, 'attach');
  assert.equal(db.tables.places.find((x) => x.id === 'kiyomizu').visited_at, '2026-11-14T00:00:00.000Z');
});

test('旅がひとつもない → 撮影日の旅を自動で作る（他人の旅には入れない）', async () => {
  db = fakeDb({ ...seed, trips: seed.trips.filter((t) => t.group_id !== 'g1'), places: [] });
  const r = await call({ lat: 35, lng: 135, taken_at: '2026-12-01T10:00:00+09:00' });
  assert.equal(r.status, 200);
  const trip = db.tables.trips.find((t) => t.id === r.body.trip_id);
  assert.equal(trip.group_id, 'g1');
  assert.equal(trip.title, '2026-12-01 の旅');
});
