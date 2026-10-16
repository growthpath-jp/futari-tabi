// 住所 → 位置（国土地理院）、名前 → 候補（OpenStreetMap）
import { isApproxMatch } from './logic.js';

export async function geocodeAddress(address) {
  const res = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(address));
  if (!res.ok) throw new Error('住所の検索に失敗しました（通信を確認してください）');
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return null;
  const top = list[0];
  const [lng, lat] = top.geometry.coordinates;
  const title = top.properties && top.properties.title;
  return { lat, lng, title, approx: isApproxMatch(address, title) };
}

export async function searchByName(query, near) {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', 'accept-language': 'ja', addressdetails: '0' });
  if (near) {
    const d = 0.6;
    params.set('viewbox', [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(','));
  }
  const res = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString());
  if (!res.ok) throw new Error('名前の検索に失敗しました（少し待ってもう一度）');
  const list = await res.json();
  return list.map((r) => ({
    name: (r.name || r.display_name.split(',')[0]).trim(),
    area: r.display_name.split(',').slice(1, 3).join(' ').trim(),
    lat: Number(r.lat), lng: Number(r.lon),
  }));
}
