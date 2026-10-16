// 本番：Supabase に保存する
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export function createSupabaseStore(url, anonKey) {
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  let groupId = null;
  const urlCache = new Map();

  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  return {
    mode: 'live',
    functionsUrl: url.replace(/\/$/, '') + '/functions/v1/ingest-photo',

    async session() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      groupId = must(await sb.rpc('ensure_my_group', { p_display_name: data.session.user.email.split('@')[0] }));
      return { user: data.session.user, groupId };
    },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) {
      const data = must(await sb.auth.signUp({ email, password }));
      return { needsConfirm: !data.session };
    },
    async signOut() { await sb.auth.signOut(); groupId = null; },

    // 旅
    async listTrips() { return must(await sb.from('trips').select('*').eq('group_id', groupId).order('start_date', { ascending: false, nullsFirst: true })); },
    async createTrip(t) { return must(await sb.from('trips').insert({ ...t, group_id: groupId }).select().single()); },
    async updateTrip(id, patch) { return must(await sb.from('trips').update(patch).eq('id', id).select().single()); },
    async deleteTrip(id) { must(await sb.from('trips').delete().eq('id', id)); },

    // 場所
    async listPlaces() { return must(await sb.from('places').select('*').eq('group_id', groupId)); },
    async addPlace(p) { return must(await sb.from('places').insert({ ...p, group_id: groupId }).select().single()); },
    async updatePlace(id, patch) { return must(await sb.from('places').update(patch).eq('id', id).select().single()); },
    async updatePlaces(patches) { for (const { id, ...patch } of patches) must(await sb.from('places').update(patch).eq('id', id)); },
    async deletePlace(id) { must(await sb.from('places').delete().eq('id', id)); },

    // 写真
    async listPhotos(placeId) {
      const rows = must(await sb.from('photos').select('*').eq('place_id', placeId).order('taken_at'));
      return this._withUrls(rows);
    },
    async addPhoto(place, file) {
      const path = `${groupId}/${place.trip_id}/${crypto.randomUUID()}.jpg`;
      must(await sb.storage.from('photos').upload(path, file, { contentType: file.type || 'image/jpeg' }));
      return must(await sb.from('photos').insert({ place_id: place.id, trip_id: place.trip_id, group_id: groupId, storage_path: path }).select().single());
    },
    async _withUrls(rows) {
      const need = rows.map((r) => r.storage_path).filter((p) => !urlCache.has(p));
      if (need.length) {
        const signed = must(await sb.storage.from('photos').createSignedUrls(need, 3600));
        signed.forEach((s) => s.signedUrl && urlCache.set(s.path, s.signedUrl));
      }
      return rows.map((r) => ({ ...r, url: urlCache.get(r.storage_path) || '' }));
    },

    // 引き出し
    async listDrawers() { return must(await sb.from('drawers').select('*').eq('group_id', groupId).order('created_at', { ascending: false })); },
    async saveDrawer(d) {
      if (d.id) return must(await sb.from('drawers').update({ name: d.name, filter: d.filter }).eq('id', d.id).select().single());
      return must(await sb.from('drawers').insert({ name: d.name, filter: d.filter, group_id: groupId }).select().single());
    },
    async deleteDrawer(id) { must(await sb.from('drawers').delete().eq('id', id)); },

    // 共有
    async listShares(drawerId) { return must(await sb.from('drawer_shares').select('*').eq('drawer_id', drawerId).order('created_at', { ascending: false })); },
    async createShare(drawerId, opts) { return must(await sb.from('drawer_shares').insert({ drawer_id: drawerId, group_id: groupId, ...opts }).select().single()); },
    async updateShare(id, patch) { return must(await sb.from('drawer_shares').update(patch).eq('id', id).select().single()); },
    async deleteShare(id) { must(await sb.from('drawer_shares').delete().eq('id', id)); },
    async redeemShare(code) { return must(await sb.rpc('redeem_share', { p_code: code })); },
    async sharedWithMe() { return must(await sb.rpc('shared_with_me')); },
    async sharedPlaces(shareId) { return must(await sb.rpc('shared_drawer_places', { p_share_id: shareId })); },
    async sharedPhotos(shareId) { return this._withUrls(must(await sb.rpc('shared_drawer_photos', { p_share_id: shareId }))); },

    // 夫婦グループ
    async getGroup() {
      const g = must(await sb.from('groups').select('*').eq('id', groupId).single());
      const members = must(await sb.from('group_members').select('*').eq('group_id', groupId));
      return { ...g, members };
    },
    async joinGroup(code) { groupId = must(await sb.rpc('join_group', { p_code: code })); return groupId; },
    async ingestKey(renew) { return must(await sb.rpc('my_ingest_key', { p_renew: !!renew })); },

    // 相手の変更をすぐ反映
    subscribe(onChange) {
      const ch = sb.channel('group-' + groupId);
      for (const table of ['trips', 'places', 'photos', 'drawers']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `group_id=eq.${groupId}` }, () => onChange(table));
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
