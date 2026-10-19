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

// 名前で探す。near（旅の場所）があれば、まずその近く（約60km四方）だけで探し、なければ全国から探す
export async function searchByName(query, near) {
  const ask = async (bounded) => {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '8', 'accept-language': 'ja', addressdetails: '0' });
    if (near) {
      const d = 0.3;
      params.set('viewbox', [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(','));
      if (bounded) params.set('bounded', '1');
    }
    const res = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString());
    if (!res.ok) throw new Error('名前の検索に失敗しました（少し待ってもう一度）');
    return res.json();
  };
  let list = near ? await ask(true) : [];
  if (!list.length) list = await ask(false);
  return list.map((r) => {
    const parts = r.display_name.split(',').map((x) => x.trim());
    // 住所の部分を「県 市 区 町」の順に（郵便番号と「日本」は省く）
    const area = parts.slice(1).filter((x) => x && x !== '日本' && !/^\d{3}-?\d{4}$/.test(x)).reverse().slice(0, 4).join(' ');
    return { name: (r.name || parts[0]).trim(), area, lat: Number(r.lat), lng: Number(r.lon) };
  });
}
