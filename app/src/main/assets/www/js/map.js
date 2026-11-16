// The map: OpenStreetMap tiles + our own territory layer (grid cells coloured by owner) + live walk.
import { CONFIG } from './config.js';
const L = window.L, G = window.Geo;
const MINE = '#e2645a';
const PALETTE = ['#4c8bf5', '#2fb67c', '#e0a82e', '#a56cf0', '#33b8c9', '#d1648a'];
const hue = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; };

export function createMap(el, { onMoveEnd, onUserMove }) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true, zoomSnap: 0.5, maxZoom: 19, minZoom: 4 })
    .setView(CONFIG.START_CENTER, 16);
  L.tileLayer(CONFIG.TILE_URL, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const canvas = L.canvas({ padding: 0.4 });
  const terr = L.layerGroup().addTo(map), walk = L.layerGroup().addTo(map);
  let meMk = null, meCirc = null, line = null, startMk = null, ring = null, prev = null, follow = true, firstFix = false;

  map.on('dragstart', () => { follow = false; onUserMove && onUserMove(); });
  map.on('moveend', () => onMoveEnd && onMoveEnd());

  return {
    resize() { map.invalidateSize(); },
    zoom: () => map.getZoom(),
    bbox() { const b = map.getBounds().pad(0.15); return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }; },
    setFollow(v) { follow = v; },
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
    setTrack(pts) {
      const ll = pts.map((p) => [p[0], p[1]]);
      if (!line) line = L.polyline(ll, { color: MINE, weight: 5, opacity: .95, lineJoin: 'round' }).addTo(walk); else line.setLatLngs(ll);
      if (pts.length && !startMk) {
        startMk = L.circleMarker(ll[0], { radius: 7, color: '#fff', weight: 3, fillColor: MINE, fillOpacity: 1, interactive: false }).addTo(walk);
        ring = L.circle(ll[0], { radius: G.RULES.CLOSE_M, color: '#fff', weight: 1.5, dashArray: '4 6', fillColor: MINE, fillOpacity: .08, interactive: false }).addTo(walk);
      }
    },
    setPreview(pts) {
      if (prev) { walk.removeLayer(prev); prev = null; }
      if (pts) prev = L.polygon(pts.map((p) => [p[0], p[1]]), { color: '#fff', weight: 2, dashArray: '6 6', fillColor: MINE, fillOpacity: .3, interactive: false }).addTo(walk);
    },
    fit(pts) { if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]])), { padding: [60, 60], maxZoom: 19 }); },
    clearWalk() { walk.clearLayers(); line = startMk = ring = prev = null; },
    /** cells [[cx,cy,ownerIdx]], owners [{id,nick}] -> rectangles, neighbouring cells of one owner merged into one rectangle */
    setTerritory(cells, owners, meId) {
      terr.clearLayers();
      const list = cells.slice().sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
      let i = 0;
      while (i < list.length) {
        const c = list[i]; let j = i;
        while (j + 1 < list.length && list[j + 1][2] === c[2] && list[j + 1][1] === c[1] && list[j + 1][0] === list[j][0] + 1) j++;
        const o = owners[c[2]], col = o && o.id === meId ? MINE : hue(o ? o.id : 'x');
        const a = G.cellBounds(c[0], c[1]), b = G.cellBounds(list[j][0], c[1]);
        L.rectangle([a[0], b[1]], { renderer: canvas, color: col, weight: 1, opacity: .85, fillColor: col, fillOpacity: o && o.id === meId ? .5 : .38, interactive: false }).addTo(terr);
        i = j + 1;
      }
    },
    clearTerritory() { terr.clearLayers(); }
  };
}
