// ============================================================
// GEO: shared by the app (js/geo.js) and the server (Code.gs). Edit apps-script/geo.js only,
// then run  ./sync.sh  to copy it into the app and into Code.gs. This keeps the preview on the
// phone identical to what the server confirms.
// A track point is [lat, lng, tSec, accuracyM, mock(0/1)].  A polygon is [[lat,lng], ...].
// ============================================================
const Geo = (function () {
  const R = 6371000, RAD = Math.PI / 180;
  const RULES = {
    MIN_PTS: 20, MIN_DUR_S: 120, MAX_DUR_S: 6 * 3600,
    ACC_MAX: 30, ACC_BAD_FRAC: 0.10,       // fixes worse than 30 m: at most 10 %
    MAX_SEG_MS: 9, BAD_SEG_FRAC: 0.03,     // > 9 m/s between two points = not on foot
    MAX_AVG_MS: 4.2,                       // 15 km/h average: running, not cycling or driving
    CLOSE_M: 40,                           // finish within 40 m of the start to close the loop
    MIN_AREA: 500, MAX_AREA: 3e6,          // m2
    MIN_COMPACT: 0.004,                    // area / perimeter^2: refuses "out and back along one street"
    STORE_TOL_M: 1.5                       // stored outline keeps the walked shape within 1.5 m
  };
  const GROUPS = [
    { id: 'k', name: 'Kids', range: '6-12', min: 6, max: 12 },
    { id: 't', name: 'Teens', range: '13-17', min: 13, max: 17 },
    { id: 'y', name: 'Youth', range: '18-29', min: 18, max: 29 },
    { id: 'a', name: 'Adults', range: '30-44', min: 30, max: 44 },
    { id: 'm', name: 'Masters', range: '45-59', min: 45, max: 59 },
    { id: 's', name: 'Seniors', range: '60+', min: 60, max: 130 }
  ];
  function ageGroup(birthYear, year) {
    const age = year - birthYear;
    for (let i = 0; i < GROUPS.length; i++) if (age >= GROUPS[i].min && age <= GROUPS[i].max) return GROUPS[i];
    return null;
  }
  function hav(a, b) {
    const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function polygonArea(pts) {          // m2, local flat projection (fine below ~10 km)
    const n = pts.length; if (n < 3) return 0;
    const lat0 = pts[0][0], k = Math.cos(lat0 * RAD);
    let s = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = (pts[j][1] - pts[0][1]) * k * R * RAD, y1 = (pts[j][0] - lat0) * R * RAD;
      const x2 = (pts[i][1] - pts[0][1]) * k * R * RAD, y2 = (pts[i][0] - lat0) * R * RAD;
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  }
  /** even-odd point in polygon; pt=[lat,lng] */
  function inside(pt, poly) {
    let c = false; const y = pt[0], x = pt[1];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      if ((a[0] > y) !== (b[0] > y) && x < (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]) + a[1]) c = !c;
    }
    return c;
  }
  function bboxOf(poly) {
    let s = 90, w = 180, n = -90, e = -180;
    for (let i = 0; i < poly.length; i++) { const p = poly[i]; if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1]; }
    return { minLat: s, minLng: w, maxLat: n, maxLng: e };
  }
  const overlap = (a, b) => !(a.maxLat < b.minLat || a.minLat > b.maxLat || a.maxLng < b.minLng || a.minLng > b.maxLng);
  function centroid(poly) {            // area-weighted centre [lat,lng]
    const n = poly.length; let a = 0, cx = 0, cy = 0;
    const lat0 = poly[0][0], lng0 = poly[0][1];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = poly[j][1] - lng0, y1 = poly[j][0] - lat0, x2 = poly[i][1] - lng0, y2 = poly[i][0] - lat0, f = x1 * y2 - x2 * y1;
      a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
    if (Math.abs(a) < 1e-18) return [poly[0][0], poly[0][1]];
    return [lat0 + cy / (3 * a), lng0 + cx / (3 * a)];
  }
  /** Douglas-Peucker in metres; keeps the walked shape, drops redundant points. Returns [[lat,lng],...] */
  function simplify(pts, tolM) {
    const n = pts.length; if (n < 4 || !(tolM > 0)) return pts.map((p) => [p[0], p[1]]);
    const k = Math.cos(pts[0][0] * RAD) * R * RAD, m = R * RAD;
    const X = pts.map((p) => p[1] * k), Y = pts.map((p) => p[0] * m);
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [[0, n - 1]];
    while (st.length) {
      const [i, j] = st.pop(); let md = 0, mi = -1;
      const dx = X[j] - X[i], dy = Y[j] - Y[i], L = Math.hypot(dx, dy);
      for (let t = i + 1; t < j; t++) {
        const d = L === 0 ? Math.hypot(X[t] - X[i], Y[t] - Y[i]) : Math.abs(dy * X[t] - dx * Y[t] + X[j] * Y[i] - Y[j] * X[i]) / L;
        if (d > md) { md = d; mi = t; }
      }
      if (md > tolM && mi > 0) { keep[mi] = 1; st.push([i, mi], [mi, j]); }
    }
    const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push([pts[i][0], pts[i][1]]);
    return out;
  }
  /**
   * Visible area of `poly` once newer polygons are painted on top of it (newer always wins).
   * newer = [{bbox, poly}]. Sampled on a grid of at most ~3000 points, so the error is about 1 %.
   */
  function remainingM2(poly, areaM2, newer) {
    const bb = bboxOf(poly), hit = newer.filter((q) => overlap(bb, q.bbox));
    if (!hit.length) return areaM2;
    const step = Math.max(3, Math.sqrt(areaM2 / 3000)), dLat = step / (R * RAD), dLng = step / (R * RAD * Math.cos((bb.minLat + bb.maxLat) / 2 * RAD));
    let total = 0, free = 0;
    for (let la = bb.minLat + dLat / 2; la < bb.maxLat; la += dLat) {
      for (let lo = bb.minLng + dLng / 2; lo < bb.maxLng; lo += dLng) {
        const pt = [la, lo];
        if (!inside(pt, poly)) continue;
        total++;
        let covered = false;
        for (let q = 0; q < hit.length; q++) { const h = hit[q]; if (la >= h.bbox.minLat && la <= h.bbox.maxLat && lo >= h.bbox.minLng && lo <= h.bbox.maxLng && inside(pt, h.poly)) { covered = true; break; } }
        if (!covered) free++;
      }
    }
    return total ? areaM2 * free / total : areaM2;
  }

  /** Judges a recorded walk. integrity=false: not a genuine on-foot recording. claimable=true: may claim land. */
  function analyze(pts) {
    const o = { n: pts.length, distM: 0, durS: 0, avgMs: 0, gapM: 0, areaM2: 0, perimM: 0, problems: [], integrity: false, claimable: false };
    if (o.n < 2) { o.problems.push('few'); return o; }
    let bad = 0, accBad = 0, mock = 0, segs = 0;
    for (let i = 0; i < o.n; i++) {
      const p = pts[i];
      if (p[4]) mock++;
      if (p[3] > RULES.ACC_MAX) accBad++;
      if (i) {
        const d = hav(pts[i - 1], p), dt = p[2] - pts[i - 1][2];
        o.distM += d; segs++;
        if (dt <= 0 ? d > 15 : (d / dt > RULES.MAX_SEG_MS && d > 12)) bad++;
      }
    }
    o.durS = pts[o.n - 1][2] - pts[0][2];
    o.avgMs = o.durS > 0 ? o.distM / o.durS : 99;
    o.gapM = hav(pts[0], pts[o.n - 1]);
    o.perimM = o.distM + o.gapM;
    o.areaM2 = polygonArea(pts);
    const P = o.problems;
    if (o.n < RULES.MIN_PTS) P.push('few');
    if (o.durS < RULES.MIN_DUR_S) P.push('short');
    if (o.durS > RULES.MAX_DUR_S) P.push('long');
    if (mock) P.push('mock');
    if (accBad / o.n > RULES.ACC_BAD_FRAC) P.push('acc');
    if (bad / Math.max(segs, 1) > RULES.BAD_SEG_FRAC) P.push('speed');
    if (o.avgMs > RULES.MAX_AVG_MS) P.push('fast');
    o.integrity = P.length === 0;
    if (o.gapM > RULES.CLOSE_M) P.push('open');
    else {
      if (o.areaM2 < RULES.MIN_AREA) P.push('small');
      if (o.areaM2 > RULES.MAX_AREA) P.push('huge');
      if (o.areaM2 / (o.perimM * o.perimM) < RULES.MIN_COMPACT) P.push('thin');
    }
    o.claimable = P.length === 0;
    return o;
  }
  return { RULES, GROUPS, ageGroup, hav, polygonArea, inside, bboxOf, overlap, centroid, simplify, remainingM2, analyze };
})();
if (typeof window !== 'undefined') window.Geo = Geo;
