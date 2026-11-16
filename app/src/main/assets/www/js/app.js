import { CONFIG } from './config.js';
import { Native, call, setCreds, NetError } from './api.js';
import { createMap } from './map.js';

const G = window.Geo;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('cq.' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('cq.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('cq.' + k); } catch (e) {} }
};

// ---------------------------------------------------------------- formatting
const fmtDist = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km');
const fmtArea = (m2) => (m2 < 10000 ? Math.round(m2).toLocaleString() + ' m²' : (m2 / 10000).toFixed(2) + ' ha');
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); };
const fmtPace = (distM, durS) => { if (distM < 30 || durS < 10) return '--'; const p = durS / 60 / (distM / 1000); return p > 60 ? '--' : Math.floor(p) + ':' + String(Math.round(p % 1 * 60) % 60).padStart(2, '0'); };

const ERR = {
  bad_nick: 'Nickname must be 3 to 16 letters, numbers or _ .', bad_pin: 'PIN must be 4 to 6 digits.', bad_age: 'This app is for ages 6 and up.',
  parent_needed: 'Under 13: a parent or guardian must agree.', nick_taken: 'That nickname is taken.', device_limit: 'Too many accounts on this phone.',
  bad_login: 'Wrong nickname or PIN.', locked: 'Too many tries. Wait 15 minutes.', bad_bbox: 'Map area too large.', duplicate: 'This walk was already saved.',
  too_big: 'That loop is too large.', rejected: 'This walk was rejected.', not_claimable: 'This walk cannot claim land.'
};
const WHY = {
  few: 'Too few GPS points were recorded.', short: 'The walk was shorter than 2 minutes.', long: 'The walk was longer than 6 hours.',
  mock: 'A fake-location app was detected.', acc: 'The GPS signal was too weak. Try again in the open.', speed: 'You moved too fast for a walk or run.',
  fast: 'Your average speed is too high for walking or running.', stale: 'This walk is too old to submit.',
  small: 'The loop is too small (minimum 500 m²).', huge: 'The loop is too large (maximum 3 km²).', thin: 'The loop is too narrow. Walk around an area instead of out and back.'
};

// ---------------------------------------------------------------- state
let user = store.get('user');
let map = null, screen = 'auth', rec = null, lastFix = null, gpsOn = null;
let terrKey = '', terrTimer = null, stats = null, busy = false;

function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
function errText(e) { if (e instanceof NetError) return e.message; return ERR[e] || ('Something went wrong (' + e + ').'); }

// ---------------------------------------------------------------- navigation
function show(name) {
  screen = name;
  ['auth', 'perms', 'map', 'rank', 'me'].forEach((n) => ($('#s-' + n).hidden = n !== name));
  const tabs = ['map', 'rank', 'me'].includes(name);
  $('#nav').hidden = !tabs;
  $('#main').classList.toggle('tabs', tabs);
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  $('#main').scrollTop = 0;
  if (name === 'map') { ensureMap(); refreshHeader(); setTimeout(() => { map.resize(); loadTerritory(true); }, 30); }
  if (name === 'rank') loadRank();
  if (name === 'me') loadMe();
}
$$('#nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

window.onBack = () => {
  if (!$('#sheet').hidden && sheetClosable) { closeSheet(); return true; }
  if (['rank', 'me'].includes(screen)) { show('map'); return true; }
  return false;
};

// ---------------------------------------------------------------- sheet
let sheetClosable = true;
function openSheet(html, closable = true) {
  sheetClosable = closable;
  $('#sheet').innerHTML = html; $('#sheet').hidden = false; $('#sheet-bg').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; }
$('#sheet-bg').addEventListener('click', () => { if (sheetClosable) closeSheet(); });

// ---------------------------------------------------------------- auth
$$('#auth-tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#auth-tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('#f-login').hidden = b.dataset.t !== 'login'; $('#f-reg').hidden = b.dataset.t !== 'register'; $('#auth-err').hidden = true;
}));
$('#r-year').addEventListener('input', () => {
  const y = Number($('#r-year').value), g = y > 1900 ? G.ageGroup(y, new Date().getFullYear()) : null;
  $('#r-group').innerHTML = g ? 'Your age group: <b>' + g.name + ' (' + g.range + ')</b>. You compete only with this group.' : (y > 1900 && String(y).length === 4 ? 'This app is for ages 6 and up.' : 'Enter your year of birth to see your age group.');
  $('#r-parent-row').hidden = !(g && g.id === 'k');
});
function authError(e) { const p = $('#auth-err'); p.textContent = errText(e); p.hidden = false; }
async function enter(u) {
  user = u; store.set('user', u); setCreds({ uid: u.id, token: u.token });
  afterLogin();
}
$('#f-login').addEventListener('submit', async (ev) => {
  ev.preventDefault(); if (busy) return; busy = true; $('#auth-err').hidden = true;
  try { const r = await call('login', { nick: $('#l-nick').value, pin: $('#l-pin').value }, { noAuth: true }); if (!r.ok) throw r.error; await enter(r.user); }
  catch (e) { authError(e); } finally { busy = false; }
});
$('#f-reg').addEventListener('submit', async (ev) => {
  ev.preventDefault(); if (busy) return; busy = true; $('#auth-err').hidden = true;
  try {
    const r = await call('register', { nick: $('#r-nick').value, pin: $('#r-pin').value, birthYear: Number($('#r-year').value), parentOk: $('#r-parent').checked, deviceHash: Native.deviceId() }, { noAuth: true });
    if (!r.ok) throw r.error; await enter(r.user);
  } catch (e) { authError(e); } finally { busy = false; }
});
function logout() { store.del('user'); user = null; setCreds(null); stats = null; if (map) map.clearTerritory(); show('auth'); }

// ---------------------------------------------------------------- permissions
function refreshPerms() {
  const s = Native.permStatus();
  [['loc', 'p-loc'], ['bg', 'p-bg'], ['notif', 'p-notif'], ['battery', 'p-battery']].forEach(([k, id]) => {
    const b = $('#' + id); b.parentElement.classList.toggle('done', !!s[k]); b.textContent = s[k] ? 'Done' : 'Allow';
  });
  $('#p-go').disabled = !s.loc;
}
$$('[data-perm]').forEach((b) => b.addEventListener('click', () => Native.requestPerm(b.dataset.perm)));
$('#p-go').addEventListener('click', () => { store.set('permsSeen', 1); show('map'); resumeIfRecording(); });
window.onPerms = () => refreshPerms();
window.onNativeResume = () => { if (screen === 'perms') refreshPerms(); if (rec) syncRecording(); };

function afterLogin() {
  if (!Native.permStatus().loc || !store.get('permsSeen')) { refreshPerms(); show('perms'); } else { show('map'); resumeIfRecording(); }
}

// ---------------------------------------------------------------- map screen
function ensureMap() {
  if (map) return;
  map = createMap($('#map'), {
    onMoveEnd: () => { clearTimeout(terrTimer); terrTimer = setTimeout(() => loadTerritory(false), 450); }
  });
  Native.viewStart();
}
$('#btn-center').addEventListener('click', () => map && map.centerMe());

async function loadTerritory(force) {
  if (!map || !user || screen !== 'map') return;
  const zoomOk = map.zoom() >= CONFIG.TERRITORY_MIN_ZOOM;
  $('#m-hint').hidden = zoomOk;
  if (!zoomOk) { map.clearTerritory(); terrKey = ''; return; }
  const b = map.bbox(), key = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(4)).join(',');
  if (!force && key === terrKey) return;
  try {
    const r = await call('cells', b);
    if (r.ok) { terrKey = key; map.setTerritory(r.cells, r.owners, r.me); }
    else if (r.error === 'auth') { toast('Session expired. Please sign in again.'); logout(); }
  } catch (e) { /* offline: keep what is shown */ }
}
async function refreshHeader() {
  if (!user) return;
  $('#m-group').textContent = user.groupName + ' · ' + (G.GROUPS.find((g) => g.id === user.group) || {}).range;
  try { const r = await call('me'); if (r.ok) { stats = r.stats; $('#m-area').textContent = 'Yours: ' + fmtArea(stats.areaM2); } } catch (e) {}
}

// ---------------------------------------------------------------- native events
window.onNative = (m) => {
  if (m.t === 'gps') { gpsOn = m.on; paintGps(); }
  else if (m.t === 'fix') {
    lastFix = m; gpsOn = true;
    if (map) map.setMe(m.lat, m.lng, m.acc);
    paintGps();
  } else if (m.t === 'pt' && rec) {
    if (m.i < rec.pts.length) return;                    // already have it
    if (m.i > rec.pts.length) { syncRecording(); return; } // missed some while paused: pull them all
    addPoint(m.p);
  }
};
function paintGps() {
  const c = $('#chip-gps');
  if (gpsOn === false) { c.textContent = 'GPS off'; c.className = 'chip off'; return; }
  if (!lastFix) { c.textContent = 'GPS…'; c.className = 'chip'; return; }
  c.textContent = 'GPS ±' + Math.round(lastFix.acc) + ' m'; c.className = 'chip' + (lastFix.acc <= 20 ? ' ok' : '');
}
$('#chip-gps').addEventListener('click', () => { if (gpsOn === false) Native.openLocationSettings(); });

// ---------------------------------------------------------------- recording
function addPoint(p, quiet) {
  const last = rec.pts[rec.pts.length - 1];
  if (last) rec.dist += G.hav(last, p);
  rec.pts.push(p); rec.acc = p[3];
  if (quiet) return;
  if (map) { map.setTrack(rec.pts); map.setMe(p[0], p[1], p[3]); }
  paintHud();
}
function addMany(pts) { pts.forEach((p) => addPoint(p, true)); if (map && rec.pts.length) { map.setTrack(rec.pts); const l = rec.pts[rec.pts.length - 1]; map.setMe(l[0], l[1], l[3]); } paintHud(); }
function paintHud() {
  if (!rec) return;
  const dur = Math.floor(Date.now() / 1000) - rec.t0;
  $('#h-dist').textContent = (rec.dist / 1000).toFixed(2);
  $('#h-time').textContent = fmtTime(dur);
  $('#h-pace').textContent = fmtPace(rec.dist, dur);
  const acc = lastFix ? lastFix.acc : rec.acc;
  const a = $('#h-acc'); a.textContent = acc == null ? 'GPS --' : 'GPS ±' + Math.round(acc) + ' m';
  a.className = 'pill gps ' + (acc == null ? '' : acc <= 12 ? 'good' : acc <= 25 ? 'mid' : 'low');
  const c = $('#h-close'), n = rec.pts.length;
  if (n < 2) { c.textContent = 'Start walking…'; c.className = 'pill'; return; }
  const gap = G.hav(rec.pts[0], rec.pts[n - 1]);
  if (gap <= G.RULES.CLOSE_M && n >= 12 && G.polygonArea(rec.pts) >= G.RULES.MIN_AREA) { c.textContent = 'Loop closed. Tap Finish to claim'; c.className = 'pill ready'; }
  else { c.textContent = fmtDist(gap) + ' from start'; c.className = 'pill'; }
}
setInterval(() => { if (rec) paintHud(); }, 1000);

function recUi(on) {
  $('#rec-hud').hidden = !on; $('#idle-bar').hidden = on; $('#map-top').hidden = on;
  $('#btn-center').classList.toggle('up', on);
  Native.keepScreenOn(on);
}
function beginRec(pts) {
  rec = { pts: [], dist: 0, t0: store.get('recT0') || Math.floor(Date.now() / 1000), acc: null };
  recUi(true); if (map) { map.clearWalk(); map.setFollow(true); }
  addMany(pts);
}
function syncRecording() {                   // after the app was in the background: take everything the service recorded
  const all = Native.recPoints(0); if (!rec || !all.length) return;
  rec.pts = []; rec.dist = 0; if (map) map.clearWalk();
  addMany(all);
}
function resumeIfRecording() {
  if (!Native.recActive()) { if (store.get('recT0')) store.del('recT0'); return; }
  const pts = Native.recPoints(0);
  if (!store.get('recT0') && pts.length) store.set('recT0', pts[0][2]);
  beginRec(pts);
}
$('#btn-start').addEventListener('click', () => {
  if (!Native.permStatus().loc) { refreshPerms(); show('perms'); return; }
  if (gpsOn === false) { toast('Turn on GPS first'); Native.openLocationSettings(); return; }
  Native.recClear();
  const t0 = Math.floor(Date.now() / 1000); store.set('recT0', t0);
  if (!Native.recStart()) { toast('Location permission needed'); return; }
  beginRec([]); rec.t0 = t0;
  toast('Walk a loop and return to your start point', 3500);
});

$('#btn-finish').addEventListener('click', () => {
  if (!rec) return;
  syncRecording();
  const A = G.analyze(rec.pts);
  if (A.claimable) map.setPreview(rec.pts); else map.setPreview(null);
  map.fit(rec.pts);
  openSheet(reviewHtml(A), false);
  wireReview(A);
});

function kv(A) { return '<div class="kv"><div><b>' + fmtDist(A.distM) + '</b><span>distance</span></div><div><b>' + fmtTime(A.durS) + '</b><span>time</span></div><div><b>' + fmtPace(A.distM, A.durS) + '</b><span>min/km</span></div></div>'; }
function reasons(A) {
  return A.problems.filter((p) => p !== 'open').map((p) => '<li>' + WHY[p] + '</li>').join('');
}
function reviewHtml(A) {
  if (A.claimable) {
    return '<div class="eyebrow"><span class="eyebrow-dot"></span>Loop closed</div><div class="big-num">' + fmtArea(A.areaM2) + '</div>' +
      '<p class="muted">Confirm to claim every square inside your loop. Squares held by people in your age group become yours.</p>' + kv(A) +
      '<button class="btn primary big" id="rv-claim">Confirm and conquer</button><button class="btn" id="rv-save">Save as a walk only</button>' +
      '<button class="btn" id="rv-more">Keep walking</button><button class="btn danger" id="rv-drop">Discard</button>';
  }
  if (A.integrity && A.problems.includes('open')) {
    return '<h2>Not a closed loop yet</h2><p class="muted">You are <b>' + fmtDist(A.gapM) + '</b> from your start point. Walk back to within ' + G.RULES.CLOSE_M + ' m of it to claim the area.</p>' + kv(A) +
      '<button class="btn primary big" id="rv-more">Keep walking</button><button class="btn" id="rv-save">Save as a walk only</button><button class="btn danger" id="rv-drop">Discard</button>';
  }
  if (A.integrity) {
    return '<h2>This loop cannot claim land</h2><ul>' + reasons(A) + '</ul>' + kv(A) +
      '<button class="btn primary big" id="rv-more">Keep walking</button><button class="btn" id="rv-save">Save as a walk only</button><button class="btn danger" id="rv-drop">Discard</button>';
  }
  return '<h2>This walk cannot be saved</h2><ul>' + reasons(A) + '</ul>' +
    '<button class="btn primary big" id="rv-more">Keep walking</button><button class="btn danger" id="rv-drop">Discard</button>';
}
function wireReview(A) {
  const on = (id, fn) => { const b = $('#' + id); if (b) b.addEventListener('click', fn); };
  on('rv-more', () => { closeSheet(); map.setPreview(null); });
  on('rv-drop', () => { closeSheet(); endRec(); toast('Walk discarded'); });
  on('rv-claim', () => submitWalk(true));
  on('rv-save', () => submitWalk(false));
}
function thin(pts, max) { if (pts.length <= max) return pts; const k = pts.length / max, out = []; for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * k)]); out.push(pts[pts.length - 1]); return out; }

async function submitWalk(claim) {
  if (busy) return; busy = true;
  $$('#sheet .btn').forEach((b) => (b.disabled = true));
  const pts = thin(rec.pts, 3000).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6), p[2], p[3], p[4] || 0]);
  try {
    const r = await call('submit', { points: pts, claim });
    if (!r.ok) {
      if (r.error === 'auth') { toast('Session expired. Please sign in again.'); logout(); return; }
      const why = (r.problems || []).map((p) => WHY[p] || p).join(' ');
      openSheet('<h2>Not accepted</h2><p class="muted">' + esc(why || errText(r.error)) + '</p><button class="btn primary big" id="rv-ok">OK</button>', false);
      $('#rv-ok').addEventListener('click', () => { closeSheet(); endRec(); });
      return;
    }
    const wasClaim = r.claimed;
    endRec();
    openSheet(wasClaim
      ? '<div class="eyebrow"><span class="eyebrow-dot"></span>Conquered</div><div class="big-num">' + fmtArea(r.areaM2) + '</div>' +
        '<p class="muted">' + (r.newCells ? r.newCells + ' new squares. ' : '') + (r.stolen ? r.stolen + ' taken from rivals. ' : '') + (r.refreshed ? r.refreshed + ' already yours.' : '') + '</p>' +
        '<button class="btn primary big" id="rv-ok">Great</button>'
      : '<h2>Walk saved</h2><p class="muted">' + fmtDist(r.distM) + ' in ' + fmtTime(r.durS) + '.</p><button class="btn primary big" id="rv-ok">OK</button>');
    $('#rv-ok').addEventListener('click', closeSheet);
    refreshHeader(); loadTerritory(true);
  } catch (e) {
    openSheet('<h2>' + esc(e instanceof NetError ? e.message : 'Could not reach the server') + '</h2><p class="muted">Your walk is still saved on this phone. Try again when you are back online.</p>' +
      '<button class="btn primary big" id="rv-retry">Try again</button><button class="btn" id="rv-more">Back to the walk</button>', false);
    $('#rv-retry').addEventListener('click', () => { closeSheet(); $('#btn-finish').click(); });
    $('#rv-more').addEventListener('click', closeSheet);
  } finally { busy = false; }
}
function endRec() {
  Native.recClear(); store.del('recT0'); rec = null;
  if (map) map.clearWalk();
  recUi(false);
}

// ---------------------------------------------------------------- ranking
let rkMode = 'area';
$$('#rk-tabs button').forEach((b) => b.addEventListener('click', () => {
  rkMode = b.dataset.m; $$('#rk-tabs button').forEach((x) => x.classList.toggle('on', x === b)); loadRank();
}));
async function loadRank() {
  const box = $('#rk-list'); box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await call('leaderboard', { mode: rkMode });
    if (!r.ok) { box.innerHTML = '<p class="err">' + esc(errText(r.error)) + '</p>'; return; }
    const g = G.GROUPS.find((x) => x.id === r.group);
    $('#rk-title').textContent = r.groupName + ' · ' + (g ? g.range : '');
    const val = (x) => (rkMode === 'area' ? fmtArea(x.v) : fmtDist(x.v));
    let html = r.top.map((x) => '<div class="row' + (x.id === user.id ? ' me' : '') + '"><span class="rk">' + x.rank + '</span><span class="nm">' + esc(x.nick) + '</span><span class="vl">' + val(x) + '</span></div>').join('');
    if (r.me && r.me.rank > r.top.length) html += '<div class="row me"><span class="rk">' + r.me.rank + '</span><span class="nm">' + esc(r.me.nick) + ' (you)</span><span class="vl">' + val(r.me) + '</span></div>';
    box.innerHTML = html || '<p class="muted">Nobody here yet. Walk a loop and be first.</p>';
  } catch (e) { box.innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; }
}

// ---------------------------------------------------------------- profile
async function loadMe() {
  $('#me-nick').textContent = user.nick; $('#me-group').textContent = user.groupName;
  try {
    const [m, h] = await Promise.all([call('me'), call('history')]);
    if (m.ok) {
      const s = m.stats;
      $('#me-stats').innerHTML = [[fmtArea(s.areaM2), 'territory'], [s.cells.toLocaleString(), 'squares'], [fmtDist(s.distM), 'walked'], [s.walks, 'walks']].map((x) => '<div class="stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>').join('');
    }
    if (h.ok) $('#me-hist').innerHTML = h.items.map((i) => '<div class="row"><span class="nm">' + new Date(i.t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '<small>' + fmtDist(i.distM) + ' · ' + fmtTime(i.durS) + '</small></span><span class="vl">' + (i.claimed ? '+' + fmtArea(i.areaM2) : '') + '</span></div>').join('') || '<p class="muted">No walks yet.</p>';
  } catch (e) { $('#me-hist').innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; }
}
$('#btn-logout').addEventListener('click', () => { if (!rec) logout(); else toast('Finish your walk first'); });
$('#btn-delete').addEventListener('click', () => {
  openSheet('<h2>Delete your account?</h2><p class="muted">Your account, walks and conquered squares are erased for good.</p><button class="btn danger big" id="dl-yes">Delete everything</button><button class="btn" id="dl-no">Cancel</button>');
  $('#dl-no').addEventListener('click', closeSheet);
  $('#dl-yes').addEventListener('click', async () => {
    try { const r = await call('deleteAccount'); if (r.ok) { closeSheet(); logout(); toast('Account deleted'); } else toast(errText(r.error)); } catch (e) { toast(errText(e)); }
  });
});

// ---------------------------------------------------------------- boot
if (user) { setCreds({ uid: user.id, token: user.token }); afterLogin(); refreshHeader(); } else show('auth');
