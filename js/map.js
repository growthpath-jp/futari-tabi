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
        ? { color: '#2F80ED', className: 'route route-visit', weight: 3.5, opacity: 0.9 }
        : ln.kind === 'missed'
          ? { color: '#98A2AC', className: 'route route-missed', weight: 2.5, dashArray: '6 7', opacity: 0.9 }
          : { color: '#13A386', className: 'route route-want', weight: 2.5, dashArray: '2 7', opacity: 0.9, lineCap: 'round' };
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

// ---------- 予定：日ごとの色で、始まり→場所→終わりを線で結ぶ ----------
export const DAY_COLORS = ['#2F80ED', '#FF7A59', '#13A386', '#9B5DE5', '#F2A007', '#E8578A', '#0FA3C7'];
const anchorLabel = (a) => (a.kind === 'station' ? a.name.replace(/駅$/, '').slice(0, 5) : a.kind === 'hotel' ? '宿' : a.kind === 'tbd' ? '宿?' : '');

// res：planTrip の結果。opts：{ tm:{on,today,here}, selectedId, onSelect, fit }
export function drawPlan(m, res, opts = {}) {
  if (!m) return;
  m.layer.clearLayers();
  m.markers.clear();
  const pts = [], anchors = new Map();
  const tm = opts.tm || {};
  for (const x of res.days) {
    const color = DAY_COLORS[x.d % DAY_COLORS.length];
    const isToday = tm.on && tm.today === x.d;
    const start = isToday && tm.here ? x.simDay.start : x.start;
    const seq = [start, ...x.order, x.end].filter(Boolean);
    if (x.order.length && seq.length > 1) {
      L.polyline(seq.map((p) => [p.lat, p.lng]), { color, weight: 3, opacity: !tm.on || isToday ? 0.85 : 0.25, className: 'route route-day', interactive: false }).addTo(m.layer);
    }
    for (const a of [x.start, x.end]) if (a && anchorLabel(a)) anchors.set(`${a.name}|${a.lat}|${a.lng}`, a);
    x.order.forEach((p, i) => {
      const sel = p.id === opts.selectedId ? ' is-selected' : '';
      const mk = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: 'pin-wrap', html: `<span class="pin pin-day${sel}" style="background:${color}">${i + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: p.name, keyboard: true,
      }).addTo(m.layer);
      mk.on('click', () => opts.onSelect && opts.onSelect(p));
      m.markers.set(p.id, mk);
      pts.push([p.lat, p.lng]);
    });
    x.skipped.forEach((p) => {
      const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<span class="pin pin-skip">?</span>', iconSize: [30, 30], iconAnchor: [15, 15] }), title: `${p.name}（見送り候補）` }).addTo(m.layer);
      mk.on('click', () => opts.onSelect && opts.onSelect(p));
      m.markers.set(p.id, mk);
      pts.push([p.lat, p.lng]);
    });
  }
  anchors.forEach((a) => {
    L.marker([a.lat, a.lng], { icon: L.divIcon({ className: 'pin-wrap', html: `<span class="pin-anchor">${anchorLabel(a)}</span>`, iconSize: [48, 22], iconAnchor: [24, 11] }), title: a.name, interactive: false }).addTo(m.layer);
    pts.push([a.lat, a.lng]);
  });
  if (tm.on && tm.here) {
    L.marker([tm.here.lat, tm.here.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<span class="pin-here"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), title: '今いる場所', zIndexOffset: 1000 }).addTo(m.layer);
    const next = res.days[tm.today] && res.days[tm.today].order[0];
    if (next) L.polyline([[tm.here.lat, tm.here.lng], [next.lat, next.lng]], { color: '#1A73E8', weight: 4, dashArray: '2 8', lineCap: 'round', className: 'route-next', interactive: false }).addTo(m.layer);
  }
  if (opts.fit !== false && (!m.fitted || opts.fit === true) && pts.length) {
    if (pts.length === 1) m.map.setView(pts[0], 14);
    else m.map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 15 });
    m.fitted = true;
  }
}

// 候補の確認用ピン（選ぶ前に、どこなのか地図で確かめる）
export function showPreview(m, c) {
  if (!m) return;
  if (!m.preview) m.preview = L.layerGroup().addTo(m.map);
  m.preview.clearLayers();
  L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'pin-wrap', html: `<span class="pin-preview">${String(c.name || '').replace(/[&<>"']/g, '').slice(0, 14)}</span>`, iconSize: [0, 0] }), title: c.name + '（確認中）', zIndexOffset: 2000 }).addTo(m.preview);
  m.map.setView([c.lat, c.lng], 15);
}
export function clearPreview(m) { if (m && m.preview) m.preview.clearLayers(); }

// 旅行中：駅を地図に出す（OpenStreetMap の駅データ）
export async function drawStations(m, on) {
  if (!m) return;
  if (!m.stations) m.stations = L.layerGroup().addTo(m.map);
  if (!on || m.map.getZoom() < 13) { if (m.stationKey) m.stations.clearLayers(); m.stationKey = ''; return; }
  const b = m.map.getBounds();
  const key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((x) => x.toFixed(2)).join(',');
  if (key === m.stationKey) return;
  m.stationKey = key;
  try {
    const q = `[out:json][timeout:15];node["railway"="station"](${key});out 80;`;
    const js = await (await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q))).json();
    m.stations.clearLayers();
    for (const n of js.elements || []) {
      const name = (n.tags && (n.tags.name || n.tags['name:ja'])) || '駅';
      L.marker([n.lat, n.lon], { icon: L.divIcon({ className: 'pin-wrap', html: `<span class="pin-station">${name.replace(/[&<>"']/g, '')}</span>`, iconSize: [0, 0] }), title: name, interactive: false }).addTo(m.stations);
    }
  } catch { /* 駅が取れなくても地図はそのまま */ }
}
