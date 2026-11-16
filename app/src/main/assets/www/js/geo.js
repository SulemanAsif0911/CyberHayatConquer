// ============================================================
// GEO: shared by the app (js/geo.js) and the server (Code.gs). Edit apps-script/geo.js only,
// then run  ./sync.sh  to copy it into the app and into Code.gs. This keeps the preview on the
// phone identical to what the server confirms.
// A point is [lat, lng, tSec, accuracyM, mock(0/1)].
// ============================================================
const Geo = (function () {
  const PER_DEG = 5000;                    // territory grid: 1/5000 degree = ~22 m x ~19 m at Lahore
  const R = 6371000, RAD = Math.PI / 180;
  const RULES = {
    MIN_PTS: 20, MIN_DUR_S: 120, MAX_DUR_S: 6 * 3600,
    ACC_MAX: 30, ACC_BAD_FRAC: 0.10,       // fixes worse than 30 m: at most 10 %
    MAX_SEG_MS: 9, BAD_SEG_FRAC: 0.03,     // > 9 m/s between two points = not on foot
    MAX_AVG_MS: 4.2,                       // 15 km/h average: running, not cycling or driving
    CLOSE_M: 40,                           // finish within 40 m of the start to close the loop
    MIN_AREA: 500, MAX_AREA: 3e6,          // m2
    MIN_COMPACT: 0.004,                    // area / perimeter^2: refuses "out and back along one street"
    MAX_CELLS: 12000
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
  const cellOf = (lat, lng) => [Math.floor(lng * PER_DEG), Math.floor(lat * PER_DEG)];     // [cx, cy]
  const cellBounds = (cx, cy) => [[cy / PER_DEG, cx / PER_DEG], [(cy + 1) / PER_DEG, (cx + 1) / PER_DEG]];
  const cellAreaM2 = (cy) => (R * RAD / PER_DEG) ** 2 * Math.cos((cy + 0.5) / PER_DEG * RAD);

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

  /** Cells whose centre lies inside the walked loop (even-odd scanline). Returns null if absurdly large. */
  function rasterize(pts) {
    const n = pts.length; let minLat = 1e9, maxLat = -1e9;
    for (let i = 0; i < n; i++) { if (pts[i][0] < minLat) minLat = pts[i][0]; if (pts[i][0] > maxLat) maxLat = pts[i][0]; }
    const cy0 = Math.floor(minLat * PER_DEG), cy1 = Math.floor(maxLat * PER_DEG);
    if (cy1 - cy0 > 1500) return null;
    const out = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      const y = (cy + 0.5) / PER_DEG, xs = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[j], b = pts[i];
        if ((a[0] <= y && b[0] > y) || (b[0] <= y && a[0] > y)) xs.push(a[1] + (y - a[0]) / (b[0] - a[0]) * (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.ceil(xs[k] * PER_DEG - 0.5), c1 = Math.floor(xs[k + 1] * PER_DEG - 0.5);
        for (let cx = c0; cx <= c1; cx++) { out.push([cx, cy]); if (out.length > RULES.MAX_CELLS) return null; }
      }
    }
    return out;
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
  return { PER_DEG, RULES, GROUPS, ageGroup, hav, cellOf, cellBounds, cellAreaM2, polygonArea, rasterize, analyze };
})();
if (typeof window !== 'undefined') window.Geo = Geo;
