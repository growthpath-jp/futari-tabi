// 地図：国土地理院の淡色地図（日本）＋ OpenStreetMap（海外）を、アプリの色に染めて表示
import { buildRoutes } from './logic.js';

const L = window.L;

export function createMap(el) {
  if (!L) {
    el.innerHTML = '<div class="map-fallback">地図を読み込めませんでした。通信を確認してください。</div>';
    return null;
  }
  const map = L.map(el, { zoomControl: false, attributionControl: true, tap: true });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: 'abc', maxZoom: 19, className: 'tiles-original',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    minZoom: 5, maxZoom: 18, className: 'tiles-original', bounds: [[20, 122], [46, 154]],
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
  }).addTo(map);
  map.setView([36.2, 138.2], 5);
  const layer = L.layerGroup().addTo(map);
  return { map, layer, markers: new Map(), fitted: false };
}

function pinClass(p, colorDetour) {
  if (p.status === 'detour') return colorDetour ? 'pin pin-detour' : 'pin pin-visited';
  return 'pin pin-' + p.status;
}

// places を描く。opts: { colorDetour, connect, selectedId, adjustId, onSelect, onMoved, fit }
export function drawPlaces(m, places, opts) {
  if (!m) return;
  const o = { colorDetour: true, connect: true, ...opts };
  m.layer.clearLayers();
  m.markers.clear();
  const { lines, numbers } = buildRoutes(places);
  if (o.connect) {
    for (const ln of lines) {
      const style = ln.kind === 'visit'
        ? { color: '#2B5FA6', className: 'route route-visit', weight: 3.5, opacity: 0.9 }
        : ln.kind === 'missed'
          ? { color: '#5F656A', className: 'route route-missed', weight: 2.5, dashArray: '6 7', opacity: 0.9 }
          : { color: '#1E6B66', className: 'route route-want', weight: 2.5, dashArray: '2 7', opacity: 0.9, lineCap: 'round' };
      L.polyline(ln.points, { ...style, interactive: false }).addTo(m.layer);
    }
  }
  for (const p of places) {
    const n = numbers.get(p.id);
    const sel = p.id === o.selectedId ? ' is-selected' : '';
    const adj = p.id === o.adjustId ? ' is-adjusting' : '';
    const icon = L.divIcon({
      className: 'pin-wrap',
      html: `<span class="${pinClass(p, o.colorDetour)}${sel}${adj}">${n || ''}</span>`,
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
    const mk = L.marker([p.lat, p.lng], { icon, draggable: p.id === o.adjustId, keyboard: true, title: p.name || '名前なしの場所', autoPan: true })
      .addTo(m.layer);
    mk.on('click', () => o.onSelect && o.onSelect(p));
    mk.on('dragend', () => { const ll = mk.getLatLng(); o.onMoved && o.onMoved(p, ll.lat, ll.lng); });
    m.markers.set(p.id, mk);
  }
  if (o.fit !== false && (!m.fitted || o.fit === true)) {
    if (places.length === 1) m.map.setView([places[0].lat, places[0].lng], 15);
    else if (places.length > 1) m.map.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])).pad(0.18), { maxZoom: 16 });
    if (places.length) m.fitted = true;
  }
}

export function focusPlace(m, p) {
  if (!m || !p) return;
  m.map.setView([p.lat, p.lng], Math.max(m.map.getZoom(), 15), { animate: true });
}

export function onMapTap(m, fn) {
  if (!m) return () => {};
  const h = (e) => fn(e.latlng.lat, e.latlng.lng);
  m.map.on('click', h);
  return () => m.map.off('click', h);
}

export function center(m) {
  if (!m) return null;
  const c = m.map.getCenter();
  return { lat: c.lat, lng: c.lng };
}

export function destroyMap(m) { if (m) m.map.remove(); }
