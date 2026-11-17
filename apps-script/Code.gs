// ============================================================
// CYBER HAYAT CONQUER v2 - Google Sheets database + referee (Apps Script)
// Do NOT edit Code.gs directly: edit Code.template.gs / geo.js, then run ./sync.sh
// ============================================================
const CONFIG = {
  SHARED_SECRET: 'CHANGE_THIS_TO_LONG_RANDOM_TEXT',   // must equal SHARED_SECRET in js/config.js
  MAX_ACCOUNTS_PER_DEVICE: 3,
  MAX_PTS: 6000,
  LOGIN_FAILS: 5,                                      // wrong PINs before a 15 minute lock
  MAX_POLYS_PER_VIEW: 400,
  ALERT_FRESH_MS: 90000                                // a breach alert stays alive this long after the last ping
};
const SHEETS = {
  Users:       ['id', 'nick', 'nickLower', 'salt', 'pinHash', 'birthYear', 'deviceHash', 'token', 'status', 'created', 'totalDistM', 'walks', 'parentOk', 'avatar', 'color'],
  Activities:  ['id', 'uid', 'nick', 'group', 'startT', 'endT', 'distM', 'durS', 'claimed', 'areaM2', 'cellsNew', 'cellsStolen', 'cellsRefreshed', 'note'],
  Territories: ['id', 'uid', 'nick', 'group', 'ts', 'areaM2', 'remainingM2', 'minLat', 'minLng', 'maxLat', 'maxLng', 'poly'],
  Audit:       ['ts', 'uid', 'event', 'detail']
};
const TMETA = 11;          // Territories: the first 11 columns are cheap numbers, column 12 is the outline (big text)
const DEFAULT_EM = '🦅', DEFAULT_COL = '#e2645a';

// ---------- entry ----------
function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.secret !== CONFIG.SHARED_SECRET) return out({ ok: false, error: 'forbidden' });
    const fn = ACTIONS[b.action];
    if (!fn) return out({ ok: false, error: 'unknown_action' });
    return out(fn(b));
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}
function doGet() { return out({ ok: true, app: 'Cyber Hayat Conquer v2' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Run once (also safe to run again after an update): creates missing tabs and adds missing header columns. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (n) {
    let s = ss.getSheetByName(n);
    if (!s) s = ss.insertSheet(n);
    s.getRange(1, 1, 1, SHEETS[n].length).setValues([SHEETS[n]]).setFontWeight('bold');
    s.setFrozenRows(1);
  });
  const d = ss.getSheetByName('Sheet1'); if (d && ss.getSheets().length > 1) ss.deleteSheet(d);
}

// ---------- tiny database layer ----------
function sheet(n) { return SpreadsheetApp.getActive().getSheetByName(n); }
function readAll(n, cols) {                             // -> array of arrays, header removed
  const s = sheet(n), last = s.getLastRow();
  if (last < 2) return [];
  return s.getRange(2, 1, last - 1, cols || SHEETS[n].length).getValues();
}
function obj(n, row) { const o = {}; SHEETS[n].forEach(function (k, i) { o[k] = row[i]; }); return o; }
function audit(uid, ev, detail) { sheet('Audit').appendRow([new Date(), uid || '', ev, detail || '']); }
const sha = function (t) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); };
const yearNow = function () { return new Date().getFullYear(); };
const r6 = function (v) { return Math.round(v * 1e6) / 1e6; };

// ---------- accounts ----------
function userRows() { return readAll('Users'); }
function findUserRow(pred) { const r = userRows(); for (let i = 0; i < r.length; i++) if (pred(r[i])) return { i: i + 2, u: obj('Users', r[i]) }; return null; }
function auth(b) {
  if (!b.uid || !b.token) throw new Error('auth');
  const f = findUserRow(function (r) { return r[0] === b.uid; });
  if (!f || f.u.token !== b.token || f.u.status !== 'active') throw new Error('auth');
  f.u.group = Geo.ageGroup(Number(f.u.birthYear), yearNow());
  if (!f.u.group) throw new Error('age');
  f.u.avatar = f.u.avatar || DEFAULT_EM; f.u.color = f.u.color || DEFAULT_COL;
  return f;
}
function pub(u) { return { id: u.id, nick: u.nick, birthYear: u.birthYear, group: u.group.id, groupName: u.group.name, token: u.token, em: u.avatar || DEFAULT_EM, col: u.color || DEFAULT_COL }; }
function cleanAvatar(em, col) {
  em = String(em || DEFAULT_EM).slice(0, 8); col = /^#[0-9a-fA-F]{6}$/.test(String(col || '')) ? String(col) : DEFAULT_COL;
  return { em: em, col: col };
}
function userMap() {                                    // id -> {nick, em, col}
  const m = {}; userRows().forEach(function (r) { m[r[0]] = { nick: r[1], em: r[13] || DEFAULT_EM, col: r[14] || DEFAULT_COL }; }); return m;
}

function register(b) {
  const nick = String(b.nick || '').trim(), pin = String(b.pin || ''), by = Number(b.birthYear);
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) throw new Error('bad_nick');
  if (!/^[0-9]{4,6}$/.test(pin)) throw new Error('bad_pin');
  const g = Geo.ageGroup(by, yearNow());
  if (!g) throw new Error('bad_age');
  if (g.id === 'k' && !b.parentOk) throw new Error('parent_needed');
  const av = cleanAvatar(b.em, b.col);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const rows = userRows();
    if (rows.some(function (r) { return r[2] === nick.toLowerCase(); })) throw new Error('nick_taken');
    const dev = String(b.deviceHash || '');
    if (dev && rows.filter(function (r) { return r[6] === dev; }).length >= CONFIG.MAX_ACCOUNTS_PER_DEVICE) throw new Error('device_limit');
    const salt = Utilities.getUuid().slice(0, 8), token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    const id = 'u' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    sheet('Users').appendRow([id, nick, nick.toLowerCase(), salt, sha(salt + pin), by, dev, token, 'active', new Date(), 0, 0, b.parentOk ? 1 : 0, av.em, av.col]);
    audit(id, 'register', g.id);
    return { ok: true, user: { id: id, nick: nick, birthYear: by, group: g.id, groupName: g.name, token: token, em: av.em, col: av.col } };
  } finally { lock.releaseLock(); }
}

function login(b) {
  const nick = String(b.nick || '').trim().toLowerCase(), cache = CacheService.getScriptCache(), key = 'f:' + nick;
  if (Number(cache.get(key) || 0) >= CONFIG.LOGIN_FAILS) throw new Error('locked');
  const f = findUserRow(function (r) { return r[2] === nick; });
  if (!f || sha(f.u.salt + String(b.pin || '')) !== f.u.pinHash || f.u.status !== 'active') {
    cache.put(key, String(Number(cache.get(key) || 0) + 1), 900);
    throw new Error('bad_login');
  }
  cache.remove(key);
  f.u.group = Geo.ageGroup(Number(f.u.birthYear), yearNow());
  return { ok: true, user: pub(f.u) };
}

function setAvatar(b) {
  const f = auth(b), av = cleanAvatar(b.em, b.col);
  sheet('Users').getRange(f.i, 14, 1, 2).setValues([[av.em, av.col]]);
  f.u.avatar = av.em; f.u.color = av.col;
  return { ok: true, user: pub(f.u) };
}

// ---------- territory storage ----------
function terrMeta(group) {                              // cheap read: numbers only
  const s = sheet('Territories'), last = s.getLastRow(), res = [];
  if (last < 2) return res;
  s.getRange(2, 1, last - 1, TMETA).getValues().forEach(function (r, i) {
    if (group && r[3] !== group) return;
    res.push({ row: i + 2, id: r[0], uid: r[1], nick: r[2], group: r[3], ts: Number(r[4]), area: Number(r[5]), rem: Number(r[6]), bbox: { minLat: Number(r[7]), minLng: Number(r[8]), maxLat: Number(r[9]), maxLng: Number(r[10]) } });
  });
  return res;
}
function polyColumn() {                                 // one call for all outlines (index = row - 2)
  const s = sheet('Territories'), last = s.getLastRow();
  return last < 2 ? [] : s.getRange(2, TMETA + 1, last - 1, 1).getValues();
}
/** Recompute how much of each target polygon is still visible under newer polygons (newer always wins). */
function recompute(targets, all, polys, extra) {
  const memo = {}, P = function (m) { return memo[m.row] || (memo[m.row] = JSON.parse(polys[m.row - 2][0])); };
  const deltas = [];
  targets.forEach(function (t) {
    const newer = all.filter(function (j) { return j.group === t.group && j.id !== t.id && j.ts > t.ts && j.rem >= 1 && Geo.overlap(t.bbox, j.bbox); })
      .map(function (j) { return { bbox: j.bbox, poly: P(j) }; });
    if (extra && extra.ts > t.ts) newer.push({ bbox: extra.bbox, poly: extra.poly });
    let rem = Geo.remainingM2(P(t), t.area, newer);
    if (rem < 1) rem = 0;
    rem = Math.round(rem);
    if (rem !== Math.round(t.rem)) sheet('Territories').getRange(t.row, 7).setValue(rem);
    deltas.push({ t: t, before: t.rem, after: rem });
    t.rem = rem;
  });
  return deltas;
}
function areaByUser(group) { const by = {}; terrMeta(group).forEach(function (m) { if (m.rem >= 1) by[m.uid] = (by[m.uid] || 0) + m.rem; }); return by; }

function me(b) {
  const f = auth(b), by = areaByUser(f.u.group.id), mine = by[f.u.id] || 0;
  const rank = Object.keys(by).filter(function (k) { return by[k] > mine; }).length + 1;
  const polys = terrMeta(f.u.group.id).filter(function (m) { return m.uid === f.u.id && m.rem >= 1; }).length;
  return { ok: true, user: pub(f.u), stats: { walks: Number(f.u.walks), distM: Number(f.u.totalDistM), areaM2: Math.round(mine), polys: polys, rank: mine ? rank : 0 } };
}

function deleteAccount(b) {
  const f = auth(b);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const mine = terrMeta().filter(function (m) { return m.uid === f.u.id; });
    const t = sheet('Territories');
    mine.slice().sort(function (a, c) { return c.row - a.row; }).forEach(function (m) { t.deleteRow(m.row); });
    if (mine.length) {                                  // what they had covered becomes visible again for the owners beneath
      const all = terrMeta(), polys = polyColumn();
      const aff = all.filter(function (m) { return m.group === f.u.group.id && mine.some(function (d) { return Geo.overlap(d.bbox, m.bbox); }); });
      recompute(aff, all, polys, null);
    }
    const as = sheet('Activities'), ar = readAll('Activities');
    for (let i = ar.length - 1; i >= 0; i--) if (ar[i][1] === f.u.id) as.deleteRow(i + 2);
    sheet('Users').deleteRow(f.i);
    audit(f.u.id, 'deleted', '');
  } finally { lock.releaseLock(); }
  return { ok: true };
}

// ---------- map ----------
function territories(b) {
  const f = auth(b), g = f.u.group.id;
  const s = Number(b.south), w = Number(b.west), n = Number(b.north), e = Number(b.east), tol = Math.min(Math.max(Number(b.tol) || 0, 0), 60);
  if (![s, w, n, e].every(isFinite) || n - s > 0.8 || e - w > 0.8) throw new Error('bad_bbox');
  const view = { minLat: s, minLng: w, maxLat: n, maxLng: e };
  let list = terrMeta(g).filter(function (m) { return m.rem >= 1 && Geo.overlap(view, m.bbox); });
  list.sort(function (a, c) { return a.ts - c.ts; });
  const more = list.length > CONFIG.MAX_POLYS_PER_VIEW;
  if (more) list = list.slice(list.length - CONFIG.MAX_POLYS_PER_VIEW);
  const polys = list.length ? polyColumn() : [], users = list.length ? userMap() : {}, owners = {};
  const items = list.map(function (m) {
    let p = JSON.parse(polys[m.row - 2][0]);
    if (tol > 0) p = Geo.simplify(p, tol);
    if (!owners[m.uid]) { const u = users[m.uid] || {}; owners[m.uid] = { nick: u.nick || m.nick, em: u.em || DEFAULT_EM, col: u.col || DEFAULT_COL }; }
    return { id: m.id, uid: m.uid, ts: m.ts, rem: Math.round(m.rem), area: Math.round(m.area), p: p.map(function (q) { return [Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5]; }) };
  });
  return { ok: true, items: items, owners: owners, me: f.u.id, more: more };
}

// ---------- walks ----------
function submit(b) {
  const f = auth(b), u = f.u, pts = b.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > CONFIG.MAX_PTS) throw new Error('bad_points');
  const clean = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!Array.isArray(p) || p.length < 4) throw new Error('bad_points');
    const q = [Number(p[0]), Number(p[1]), Number(p[2]), Number(p[3]), p[4] ? 1 : 0];
    if (!isFinite(q[0] + q[1] + q[2] + q[3]) || Math.abs(q[0]) > 90 || Math.abs(q[1]) > 180) throw new Error('bad_points');
    clean.push(q);
  }
  const A = Geo.analyze(clean), startT = clean[0][2], endT = clean[clean.length - 1][2];
  if (!A.integrity) { audit(u.id, 'rejected', A.problems.join(',')); return { ok: false, error: 'rejected', problems: A.problems }; }
  if (Math.abs(Date.now() / 1000 - endT) > 86400) { audit(u.id, 'stale', String(endT)); return { ok: false, error: 'rejected', problems: ['stale'] }; }
  const claim = !!b.claim;
  if (claim && !A.claimable) return { ok: false, error: 'not_claimable', problems: A.problems };

  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (readAll('Activities').some(function (r) { return r[1] === u.id && Number(r[4]) === startT; })) return { ok: false, error: 'duplicate' };
    const res = { areaM2: 0, stolenM2: 0, refreshedM2: 0, rank: 0, enemies: [] };
    if (claim) {
      const poly = Geo.simplify(clean, Geo.RULES.STORE_TOL_M).map(function (p) { return [r6(p[0]), r6(p[1])]; });
      if (poly.length < 3) throw new Error('bad_points');
      const area = Math.round(Geo.polygonArea(poly)), bb = Geo.bboxOf(poly), now = Date.now();
      const all = terrMeta(u.group.id), polys = all.length ? polyColumn() : [];
      const aff = all.filter(function (m) { return m.rem >= 1 && Geo.overlap(bb, m.bbox); });
      const deltas = aff.length ? recompute(aff, all, polys, { ts: now, bbox: bb, poly: poly }) : [];
      const hit = {};
      deltas.forEach(function (d) {
        const lost = Math.max(0, d.before - d.after);
        if (d.t.uid === u.id) res.refreshedM2 += lost; else if (lost > 0) { res.stolenM2 += lost; hit[d.t.nick] = 1; }
      });
      res.enemies = Object.keys(hit);
      const id = 't' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      sheet('Territories').appendRow([id, u.id, u.nick, u.group.id, now, area, area, r6(bb.minLat), r6(bb.minLng), r6(bb.maxLat), r6(bb.maxLng), JSON.stringify(poly)]);
      res.areaM2 = area; res.stolenM2 = Math.round(res.stolenM2); res.refreshedM2 = Math.round(res.refreshedM2);
      const by = areaByUser(u.group.id), mine = by[u.id] || 0;
      res.rank = Object.keys(by).filter(function (k) { return by[k] > mine; }).length + 1;
    }
    sheet('Activities').appendRow(['a' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), u.id, u.nick, u.group.id, startT, endT,
      Math.round(A.distM), Math.round(A.durS), claim ? 1 : 0, res.areaM2, 0, res.stolenM2, res.refreshedM2, '']);
    sheet('Users').getRange(f.i, 11, 1, 2).setValues([[Number(u.totalDistM) + Math.round(A.distM), Number(u.walks) + 1]]);
    return { ok: true, distM: Math.round(A.distM), durS: Math.round(A.durS), claimed: claim, areaM2: res.areaM2, stolenM2: res.stolenM2, refreshedM2: res.refreshedM2, rank: res.rank, enemies: res.enemies };
  } finally { lock.releaseLock(); }
}

function history(b) {
  const f = auth(b);
  const rows = readAll('Activities').filter(function (r) { return r[1] === f.u.id; }).slice(-30).reverse();
  return { ok: true, items: rows.map(function (r) { return { t: Number(r[4]), distM: Number(r[6]), durS: Number(r[7]), claimed: !!Number(r[8]), areaM2: Number(r[9]), stolenM2: Number(r[11]) }; }) };
}

// ---------- live breach alerts ----------
/** Called by a walker's phone every ~20 s while recording. If the walker stands inside someone else's land, that owner is alerted. */
function ping(b) {
  const f = auth(b), u = f.u, cache = CacheService.getScriptCache();
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!isFinite(lat + lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('bad_points');
  if (cache.get('pg|' + u.id)) return { ok: true, skipped: true };
  cache.put('pg|' + u.id, '1', 10);
  const pt = [lat, lng];
  const cand = terrMeta(u.group.id).filter(function (m) { return m.rem >= 1 && lat >= m.bbox.minLat && lat <= m.bbox.maxLat && lng >= m.bbox.minLng && lng <= m.bbox.maxLng; })
    .sort(function (a, c) { return c.ts - a.ts; });
  let owner = null;
  if (cand.length) {
    const polys = polyColumn();
    for (let i = 0; i < cand.length; i++) { if (Geo.inside(pt, JSON.parse(polys[cand[i].row - 2][0]))) { owner = cand[i]; break; } }
  }
  if (!owner) return { ok: true, inside: null };
  if (owner.uid === u.id) return { ok: true, inside: { mine: true } };
  const minor = u.group.id === 'k' || u.group.id === 't';          // children: share only an approximate spot (~100 m)
  const key = 'al|' + owner.uid, cur = JSON.parse(cache.get(key) || '{}');
  cur[u.id] = { by: u.nick, em: u.avatar, col: u.color, lat: minor ? Math.round(lat * 1000) / 1000 : r6(lat), lng: minor ? Math.round(lng * 1000) / 1000 : r6(lng), ts: Date.now(), approx: minor ? 1 : 0 };
  cache.put(key, JSON.stringify(cur), 180);
  return { ok: true, inside: { nick: owner.nick, mine: false } };
}
function alerts(b) {
  const f = auth(b), raw = CacheService.getScriptCache().get('al|' + f.u.id), now = Date.now();
  const cur = raw ? JSON.parse(raw) : {};
  const items = Object.keys(cur).map(function (k) { return Object.assign({ id: k }, cur[k]); })
    .filter(function (a) { return now - a.ts <= CONFIG.ALERT_FRESH_MS; }).map(function (a) { a.ago = Math.round((now - a.ts) / 1000); return a; });
  return { ok: true, items: items };
}

// ---------- ranking (always inside your own age group) ----------
function leaderboard(b) {
  const f = auth(b), g = f.u.group.id, mode = b.mode === 'distance' ? 'distance' : 'area', users = userMap();
  let rows = [], all = null;
  if (mode === 'area') {
    const by = {};
    terrMeta(g).forEach(function (m) {
      if (m.rem < 1) return;
      const o = by[m.uid] || (by[m.uid] = { id: m.uid, v: 0, n: 0, bbox: Object.assign({}, m.bbox) });
      o.v += m.rem; o.n++;
      o.bbox.minLat = Math.min(o.bbox.minLat, m.bbox.minLat); o.bbox.minLng = Math.min(o.bbox.minLng, m.bbox.minLng);
      o.bbox.maxLat = Math.max(o.bbox.maxLat, m.bbox.maxLat); o.bbox.maxLng = Math.max(o.bbox.maxLng, m.bbox.maxLng);
    });
    rows = Object.keys(by).map(function (k) { const o = by[k], us = users[k] || {}; return { id: k, nick: us.nick || '?', em: us.em || DEFAULT_EM, col: us.col || DEFAULT_COL, v: Math.round(o.v), polys: o.n, bbox: [o.bbox.minLat, o.bbox.minLng, o.bbox.maxLat, o.bbox.maxLng] }; });
    if (rows.length) all = [Math.min.apply(null, rows.map(function (r) { return r.bbox[0]; })), Math.min.apply(null, rows.map(function (r) { return r.bbox[1]; })), Math.max.apply(null, rows.map(function (r) { return r.bbox[2]; })), Math.max.apply(null, rows.map(function (r) { return r.bbox[3]; }))];
  } else {
    userRows().forEach(function (r) {
      const gr = Geo.ageGroup(Number(r[5]), yearNow());
      if (gr && gr.id === g && r[8] === 'active' && Number(r[10]) > 0) rows.push({ id: r[0], nick: r[1], em: r[13] || DEFAULT_EM, col: r[14] || DEFAULT_COL, v: Math.round(Number(r[10])) });
    });
  }
  rows.sort(function (a, c) { return c.v - a.v; });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  const mine = rows.filter(function (r) { return r.id === f.u.id; })[0] || null;
  return { ok: true, group: f.u.group.id, groupName: f.u.group.name, mode: mode, top: rows.slice(0, 50), me: mine, total: rows.length, all: all };
}

const ACTIONS = { register: register, login: login, setAvatar: setAvatar, me: me, territories: territories, submit: submit, history: history, ping: ping, alerts: alerts, leaderboard: leaderboard, deleteAccount: deleteAccount };

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
