// The map: OpenStreetMap tiles + our own territory layer drawn on a canvas.
// Every conquest is the exact outline the player walked. Newer outlines always sit on top of older ones,
// so when user2 walks over a part of user1's land, that part visibly becomes user2's.
import { CONFIG } from './config.js';
const L = window.L, G = window.Geo;
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

export function createMap(el, { onMoveEnd, onTap }) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, maxZoom: 19, minZoom: 4 }).setView(CONFIG.START_CENTER, 16);
  L.tileLayer(CONFIG.TILE_URL, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const walk = L.layerGroup().addTo(map), intr = L.layerGroup().addTo(map);
  let meMk = null, meCirc = null, line = null, startMk = null, ring = null, prev = null, follow = true, firstFix = false, myCol = '#e2645a';
  let data = { items: [], owners: {}, me: null };

  // ---------- territory canvas
  const cv = L.DomUtil.create('canvas', 'terr-canvas leaflet-zoom-hide');
  map.getPane('overlayPane').appendChild(cv);

  function redraw() {
    const size = map.getSize(), dpr = window.devicePixelRatio || 1;
    cv.width = size.x * dpr; cv.height = size.y * dpr; cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px';
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size.x, size.y);
    const items = data.items, z = map.getZoom();
    if (!items.length) return;
    const P = items.map((it) => it.p.map((q) => { const c = map.latLngToContainerPoint(q); return [c.y, c.x]; }));   // [y,x]
    const glow = z >= 14 && items.length <= 150;
    const trace = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[1], p[0]) : ctx.moveTo(p[1], p[0]))); ctx.closePath(); };

    items.forEach((it, i) => {
      const pts = P[i], o = data.owners[it.uid] || {}, col = o.col || '#e2645a', mine = it.uid === data.me;
      let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
      pts.forEach((p) => { if (p[0] < minY) minY = p[0]; if (p[0] > maxY) maxY = p[0]; if (p[1] < minX) minX = p[1]; if (p[1] > maxX) maxX = p[1]; });
      if (maxX < -50 || minX > size.x + 50 || maxY < -50 || minY > size.y + 50) return;
      trace(pts);
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fill('evenodd');   // whatever was underneath is gone
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(col, mine ? 0.36 : 0.3); ctx.fill('evenodd');
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (glow) { ctx.shadowColor = col; ctx.shadowBlur = mine ? 18 : 12; }
      ctx.strokeStyle = col; ctx.lineWidth = mine ? 4 : 3; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.3; ctx.stroke();
    });

    // owner label: round avatar + name, only where the land is big enough on screen and not covered by newer land
    if (z < 15) return;
    items.forEach((it, i) => {
      const pts = P[i]; let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
      pts.forEach((p) => { if (p[0] < minY) minY = p[0]; if (p[0] > maxY) maxY = p[0]; if (p[1] < minX) minX = p[1]; if (p[1] > maxX) maxX = p[1]; });
      if (Math.min(maxX - minX, maxY - minY) < 70) return;
      let c = G.centroid(pts);
      if (!G.inside(c, pts)) {                                   // concave shape: nearest point inside
        let best = null, bd = 1e12;
        for (let a = 1; a < 12; a++) for (let b = 1; b < 12; b++) {
          const t = [minY + (maxY - minY) * a / 12, minX + (maxX - minX) * b / 12];
          if (G.inside(t, pts)) { const d = (t[0] - c[0]) ** 2 + (t[1] - c[1]) ** 2; if (d < bd) { bd = d; best = t; } }
        }
        if (!best) return; c = best;
      }
      for (let j = i + 1; j < items.length; j++) if (G.inside(c, P[j])) return;   // hidden under newer land
      const o = data.owners[it.uid] || {}, col = o.col || '#e2645a', cx = c[1], cy = c[0];
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx, cy - 6, 19, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.font = '20px "Noto Color Emoji", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText(o.em || '🦅', cx, cy - 5);
      const name = o.nick || '?'; ctx.font = '700 12px Onest, system-ui, sans-serif';
      const w = ctx.measureText(name).width + 14;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - w / 2, cy + 18, w, 20, 10) : ctx.rect(cx - w / 2, cy + 18, w, 20);
      ctx.fillStyle = 'rgba(10,10,10,.85)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(name, cx, cy + 28.5);
      ctx.restore();
    });
  }
  map.on('moveend zoomend resize viewreset', redraw);
  map.on('moveend', () => onMoveEnd && onMoveEnd());
  map.on('dragstart', () => { follow = false; });
  map.on('click', (e) => {
    for (let i = data.items.length - 1; i >= 0; i--) if (G.inside([e.latlng.lat, e.latlng.lng], data.items[i].p)) { onTap && onTap(data.items[i], data.owners[data.items[i].uid] || {}); return; }
  });

  const tolFor = (z) => (z < 12 ? 40 : z < 13 ? 20 : z < 14 ? 10 : z < 15 ? 4 : z < 16 ? 2 : 0);

  return {
    resize() { map.invalidateSize(); redraw(); },
    zoom: () => map.getZoom(),
    tol: () => tolFor(map.getZoom()),
    bbox() { const b = map.getBounds().pad(0.15); return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }; },
    setFollow(v) { follow = v; },
    setColor(c) { myCol = c || '#e2645a'; },
    setMe(lat, lng, acc) {
      const ll = [lat, lng];
      if (!meMk) {
        meMk = L.marker(ll, { icon: L.divIcon({ className: 'me-dot', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
        meCirc = L.circle(ll, { radius: acc || 10, color: '#4c8bf5', weight: 1, fillColor: '#4c8bf5', fillOpacity: .12, interactive: false }).addTo(map);
      } else { meMk.setLatLng(ll); meCirc.setLatLng(ll); meCirc.setRadius(Math.min(acc || 10, 150)); }
      if (!firstFix) { firstFix = true; map.setView(ll, Math.max(map.getZoom(), 17), { animate: false }); }
      else if (follow) map.panTo(ll, { animate: true, duration: .6 });
    },
    centerMe() { follow = true; if (meMk) map.setView(meMk.getLatLng(), Math.max(map.getZoom(), 17)); },
    flyTo(lat, lng, z) { follow = false; map.setView([lat, lng], z || 17, { animate: true }); },
    fitBox(b) { follow = false; map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [50, 50], maxZoom: 17 }); },
    setTrack(pts) {
      const ll = pts.map((p) => [p[0], p[1]]);
      if (!line) line = L.polyline(ll, { color: myCol, weight: 5, opacity: .95, lineJoin: 'round', className: 'glow' }).addTo(walk); else line.setLatLngs(ll);
      if (pts.length && !startMk) {
        startMk = L.circleMarker(ll[0], { radius: 7, color: '#fff', weight: 3, fillColor: myCol, fillOpacity: 1, interactive: false }).addTo(walk);
        ring = L.circle(ll[0], { radius: G.RULES.CLOSE_M, color: '#fff', weight: 1.5, dashArray: '4 6', fillColor: myCol, fillOpacity: .08, interactive: false }).addTo(walk);
      }
    },
    setPreview(pts) {
      if (prev) { walk.removeLayer(prev); prev = null; }
      if (pts) prev = L.polygon(pts.map((p) => [p[0], p[1]]), { color: myCol, weight: 4, fillColor: myCol, fillOpacity: .32, interactive: false, className: 'glow' }).addTo(walk);
    },
    fit(pts) { if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]])), { padding: [60, 60], maxZoom: 19 }); },
    clearWalk() { walk.clearLayers(); line = startMk = ring = prev = null; },
    setTerritory(items, owners, meId) { data = { items, owners, me: meId }; redraw(); },
    clearTerritory() { data = { items: [], owners: {}, me: null }; redraw(); },
    /** live breach markers: avatar + pulsing red ring at the intruder's last known spot */
    setIntruders(list) {
      intr.clearLayers();
      list.forEach((a) => L.marker([a.lat, a.lng], { icon: L.divIcon({ className: 'intruder', html: '<i style="background:' + (a.col || '#e0605a') + '">' + (a.em || '⚠') + '</i><b>' + String(a.by).replace(/</g, '') + '</b>', iconSize: [44, 60], iconAnchor: [22, 22] }), interactive: false, zIndexOffset: 900 }).addTo(intr));
    }
  };
}
