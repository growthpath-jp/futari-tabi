// 画面テスト用の最小 Leaflet（描いた内容を window.__map に記録する）
(function(){
  const rec = window.__map = { markers: [], lines: [], view: null, clickHandlers: [] };
  function LatLng(a,b){ return {lat:a,lng:b}; }
  function Map(el){ this.el=el; this.zoom=5; this.c=LatLng(36,138); this.h={}; el.classList.add('leaflet-container'); }
  Map.prototype.setView=function(c,z){ this.c=Array.isArray(c)?LatLng(c[0],c[1]):c; this.zoom=z; rec.view={c:this.c,z}; return this; };
  Map.prototype.fitBounds=function(b){ rec.view={bounds:b}; return this; };
  Map.prototype.getCenter=function(){ return this.c; };
  Map.prototype.getZoom=function(){ return this.zoom; };
  Map.prototype.getBounds=function(){ const c=this.c; return {getSouth:()=>c.lat-.01,getWest:()=>c.lng-.01,getNorth:()=>c.lat+.01,getEast:()=>c.lng+.01}; };
  Map.prototype.on=function(e,f){ (this.h[e]=this.h[e]||[]).push(f); if(e==='click') rec.clickHandlers=this.h.click; return this; };
  Map.prototype.off=function(e,f){ this.h[e]=(this.h[e]||[]).filter(x=>x!==f); if(e==='click') rec.clickHandlers=this.h.click; return this; };
  Map.prototype.remove=function(){ rec.markers=[]; rec.lines=[]; };
  window.__tapMap=(lat,lng)=>{ [...(rec.clickHandlers||[])].forEach(f=>f({latlng:LatLng(lat,lng)})); };
  function Layer(){ this.items=[]; }
  Layer.prototype.addTo=function(m){ return this; };
  Layer.prototype.clearLayers=function(){ rec.markers=[]; rec.lines=[]; [...document.querySelectorAll('.stub-marker')].forEach(e=>e.remove()); };
  function Marker(ll,o){ this.ll=LatLng(ll[0],ll[1]); this.o=o; this.h={}; }
  Marker.prototype.addTo=function(layer){ rec.markers.push(this); const host=document.querySelector('#map'); if(host){ const d=document.createElement('div'); d.className='stub-marker'; d.innerHTML=this.o.icon.html; d.title=this.o.title; d.onclick=()=>this.fire('click'); this.el=d; host.appendChild(d);} return this; };
  Marker.prototype.on=function(e,f){ this.h[e]=f; return this; };
  Marker.prototype.fire=function(e){ this.h[e]&&this.h[e](); };
  Marker.prototype.getLatLng=function(){ return this.ll; };
  Marker.prototype.setLatLng=function(ll){ this.ll=ll; };
  window.__dragMarker=(title,lat,lng)=>{ const m=rec.markers.find(x=>x.o.title===title); if(!m||!m.o.draggable) return false; m.ll=LatLng(lat,lng); m.fire('dragend'); return true; };
  function Poly(pts,o){ this.pts=pts; this.o=o; }
  Poly.prototype.addTo=function(){ rec.lines.push({points:this.pts, cls:this.o.className}); return this; };
  window.L={
    map:(el)=>new Map(el), tileLayer:()=>({addTo(){return this;}}), layerGroup:()=>new Layer(),
    control:{ zoom:()=>({addTo(){return this;}}) }, polyline:(p,o)=>new Poly(p,o),
    divIcon:(o)=>o, marker:(ll,o)=>new Marker(ll,o),
    latLngBounds:(pts)=>({ pts, pad(){ return this; } }),
  };
})();
