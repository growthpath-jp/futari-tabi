// お試しモード：このスマホの中だけに保存する（Supabase 未設定のとき）
const KEY = 'futari-tabi-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());

function seed() {
  const g = 'demo-group';
  const kyoto = { id: 'demo-kyoto', group_id: g, title: '京都旅行（例）', start_date: '2026-11-13', end_date: '2026-11-15', closed: true, created_at: '2026-10-01T00:00:00Z' };
  const hokkaido = { id: 'demo-hokkaido', group_id: g, title: '北海道旅行（例）', start_date: '2026-03-01', end_date: '2026-03-04', closed: true, created_at: '2026-02-01T00:00:00Z' };
  const P = (trip, name, lat, lng, status, reg, vis, extra) => ({
    id: uid(), trip_id: trip.id, group_id: g, name, address: '', lat, lng, status, source: 'name', note: '',
    adjusted: false, registered_at: reg, visited_at: vis, ...(extra || {}),
  });
  const places = [
    P(kyoto, '清水寺', 34.9949, 135.7850, 'visited', '2026-10-02T10:00:00Z', '2026-11-14T01:20:00Z', { address: '京都府京都市東山区清水1丁目294', source: 'address', note: '朝いちばんで空いていた' }),
    P(kyoto, '祇園の甘味処', 35.0037, 135.7760, 'detour', '2026-11-14T02:30:00Z', '2026-11-14T02:30:00Z', { source: 'photo' }),
    P(kyoto, '錦市場', 35.0050, 135.7647, 'detour', '2026-11-14T04:00:00Z', '2026-11-14T04:00:00Z', { source: 'photo' }),
    P(kyoto, '鴨川デルタ', 35.0300, 135.7720, 'visited', '2026-10-02T10:01:00Z', '2026-11-14T08:10:00Z'),
    P(kyoto, '伏見稲荷大社', 34.9671, 135.7727, 'visited', '2026-10-02T10:02:00Z', '2026-11-15T00:30:00Z', { address: '京都府京都市伏見区深草藪之内町68', source: 'address' }),
    P(kyoto, '嵐山 竹林の小径', 35.0170, 135.6713, 'missed', '2026-10-02T10:03:00Z', null),
    P(kyoto, '金閣寺', 35.0394, 135.7292, 'missed', '2026-10-02T10:04:00Z', null),
    P(hokkaido, '函館山', 41.7589, 140.7044, 'missed', '2026-02-02T00:00:00Z', null),
    P(hokkaido, '五稜郭タワー', 41.7948, 140.7537, 'visited', '2026-02-02T00:01:00Z', '2026-03-02T02:00:00Z'),
    P(hokkaido, '朝市の食堂', 41.7737, 140.7266, 'detour', '2026-03-02T00:00:00Z', '2026-03-02T00:00:00Z', { source: 'photo' }),
  ];
  const drawers = [
    { id: uid(), group_id: g, name: '次こそ行く場所', filter: { trips: 'all', statuses: ['missed'], colorDetour: true, connect: true }, created_at: '2026-10-03T00:00:00Z' },
    { id: uid(), group_id: g, name: 'ふたりの寄り道コレクション', filter: { trips: 'all', statuses: ['detour'], colorDetour: true, connect: true }, created_at: '2026-10-02T00:00:00Z' },
  ];
  return { trips: [kyoto, hokkaido], places, photos: [], drawers, shares: [], group: { id: g, name: 'ふたりの旅', invite_code: 'OTAMESHI', members: [{ display_name: 'あなた' }] } };
}

export function createLocalStore() {
  let db;
  const load = () => {
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
    if (!db || !db.trips) db = seed();
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 保存できない環境でも動かす */ } };
  load();
  const now = () => new Date().toISOString();
  const demoOnly = () => { throw new Error('お試しモードでは使えません。Supabase をつなぐと使えます。'); };

  return {
    mode: 'demo',
    functionsUrl: '',
    async session() { return { user: { email: 'お試しモード' }, groupId: db.group.id }; },
    async signIn() {}, async signUp() { return { needsConfirm: false }; }, async signOut() {},
    async resetDemo() { db = seed(); save(); },

    async listTrips() { return [...db.trips].sort((a, b) => String(b.start_date || '9').localeCompare(String(a.start_date || '9'))); },
    async createTrip(t) { const r = { id: uid(), group_id: db.group.id, closed: false, created_at: now(), ...t }; db.trips.push(r); save(); return r; },
    async updateTrip(id, patch) { const t = db.trips.find((x) => x.id === id); Object.assign(t, patch); save(); return t; },
    async deleteTrip(id) { db.trips = db.trips.filter((t) => t.id !== id); db.places = db.places.filter((p) => p.trip_id !== id); save(); },

    async listPlaces() { return db.places.map((p) => ({ ...p })); },
    async addPlace(p) { const r = { id: uid(), group_id: db.group.id, registered_at: now(), visited_at: null, adjusted: false, note: '', ...p }; db.places.push(r); save(); return r; },
    async updatePlace(id, patch) { const p = db.places.find((x) => x.id === id); Object.assign(p, patch); save(); return p; },
    async updatePlaces(patches) { for (const { id, ...patch } of patches) Object.assign(db.places.find((x) => x.id === id), patch); save(); },
    async deletePlace(id) { db.places = db.places.filter((p) => p.id !== id); db.photos = db.photos.filter((p) => p.place_id !== id); save(); },

    async listPhotos(placeId) { return db.photos.filter((p) => p.place_id === placeId); },
    async addPhoto(place, file) {
      const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      const r = { id: uid(), place_id: place.id, trip_id: place.trip_id, url, taken_at: now() };
      db.photos.push(r);
      try { save(); } catch { /* 容量オーバーでも画面には出す */ }
      return r;
    },

    async listDrawers() { return [...db.drawers].sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async saveDrawer(d) {
      if (d.id) { const x = db.drawers.find((y) => y.id === d.id); Object.assign(x, { name: d.name, filter: d.filter }); save(); return x; }
      const r = { id: uid(), group_id: db.group.id, name: d.name, filter: d.filter, created_at: now() }; db.drawers.push(r); save(); return r;
    },
    async deleteDrawer(id) { db.drawers = db.drawers.filter((d) => d.id !== id); db.shares = db.shares.filter((s) => s.drawer_id !== id); save(); },

    async listShares(drawerId) { return db.shares.filter((s) => s.drawer_id === drawerId); },
    async createShare(drawerId, opts) {
      const r = { id: uid(), drawer_id: drawerId, code: Math.random().toString(36).slice(2, 12).toUpperCase(), shared_with: null, created_at: now(), ...opts };
      db.shares.push(r); save(); return r;
    },
    async updateShare(id, patch) { const s = db.shares.find((x) => x.id === id); Object.assign(s, patch); save(); return s; },
    async deleteShare(id) { db.shares = db.shares.filter((s) => s.id !== id); save(); },
    async redeemShare() { demoOnly(); },
    async sharedWithMe() { return []; },
    async sharedPlaces() { return []; },
    async sharedPhotos() { return []; },

    async getGroup() { return db.group; },
    async joinGroup() { demoOnly(); },
    async ingestKey() { demoOnly(); },
    subscribe() { return () => {}; },
  };
}
