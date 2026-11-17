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
const MIN_ZOOM = CONFIG.MAP_MIN_ZOOM || 11;

// ---------------------------------------------------------------- formatting
// 1 hectare (ha) = 10,000 m2 = a square of 100 m x 100 m. A football pitch is about 0.7 ha.
const fmtDist = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km');
const fmtArea = (m2) => (m2 < 10000 ? Math.round(m2).toLocaleString() + ' m²' : (m2 / 10000).toFixed(2) + ' ha');
const pitches = (m2) => { const n = m2 / 7140; return n >= 0.5 ? '≈ ' + (n < 10 ? n.toFixed(1) : Math.round(n)) + ' football pitch' + (Math.round(n) === 1 && n < 1.5 ? '' : 'es') : ''; };
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); };
const fmtPace = (distM, durS) => { if (distM < 30 || durS < 10) return '--'; const p = durS / 60 / (distM / 1000); return p > 60 ? '--' : Math.floor(p) + ':' + String(Math.round(p % 1 * 60) % 60).padStart(2, '0'); };
const titleOf = (m2) => (m2 <= 0 ? 'Recruit' : m2 < 10000 ? 'Scout' : m2 < 50000 ? 'Explorer' : m2 < 200000 ? 'Commander' : m2 < 1000000 ? 'Warlord' : 'Emperor');
const avatarHtml = (em, col, cls) => '<div class="avatar ' + (cls || '') + '" style="background:' + esc(col || '#e2645a') + '">' + esc(em || '🦅') + '</div>';

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
const EMOJI = ['🦅', '🐯', '🦁', '🐺', '🦊', '🐻', '🐼', '🦈', '🐉', '🦂', '🔥', '⚡', '🚀', '👑', '🛡️', '⚔️', '🏹', '🎯', '🌟', '💎', '🥷', '🤖', '👻', '🏆'];
const COLORS = ['#e2645a', '#4c8bf5', '#2fb67c', '#e0a82e', '#a56cf0', '#33b8c9', '#d1648a', '#8bc34a'];

// ---------------------------------------------------------------- state
let user = store.get('user');
let map = null, screen = 'auth', rec = null, lastFix = null, gpsOn = null;
let terrKey = '', terrTimer = null, stats = null, busy = false, regAv = { em: EMOJI[0], col: COLORS[0] };

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
$('#btn-players').addEventListener('click', () => show('rank'));

window.onBack = () => {
  if (!$('#sheet').hidden && sheetClosable) { closeSheet(); return true; }
  if (['rank', 'me'].includes(screen)) { show('map'); return true; }
  return false;
};

// ---------------------------------------------------------------- sheet
let sheetClosable = true;
function openSheet(html, closable = true) { sheetClosable = closable; $('#sheet').innerHTML = html; $('#sheet').hidden = false; $('#sheet-bg').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; }
$('#sheet-bg').addEventListener('click', () => { if (sheetClosable) closeSheet(); });

// ---------------------------------------------------------------- emblem picker
function pickerInto(box, state, onChange) {
  const draw = () => {
    box.innerHTML = '<div class="emo">' + EMOJI.map((e) => '<button type="button" data-e="' + e + '" class="' + (e === state.em ? 'on' : '') + '">' + e + '</button>').join('') + '</div>' +
      '<div class="cols">' + COLORS.map((c) => '<button type="button" data-c="' + c + '" class="swatch' + (c === state.col ? ' on' : '') + '" style="background:' + c + '" aria-label="colour"></button>').join('') + '</div>';
    box.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => { state.em = b.dataset.e; draw(); onChange && onChange(); }));
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { state.col = b.dataset.c; draw(); onChange && onChange(); }));
  };
  draw();
}
pickerInto($('#r-avatar'), regAv);

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
async function enter(u) { user = u; store.set('user', u); setCreds({ uid: u.id, token: u.token }); Native.setSession(u.id, u.token); afterLogin(); }
$('#f-login').addEventListener('submit', async (ev) => {
  ev.preventDefault(); if (busy) return; busy = true; $('#auth-err').hidden = true;
  try { const r = await call('login', { nick: $('#l-nick').value, pin: $('#l-pin').value }, { noAuth: true }); if (!r.ok) throw r.error; await enter(r.user); }
  catch (e) { authError(e); } finally { busy = false; }
});
$('#f-reg').addEventListener('submit', async (ev) => {
  ev.preventDefault(); if (busy) return; busy = true; $('#auth-err').hidden = true;
  try {
    const r = await call('register', { nick: $('#r-nick').value, pin: $('#r-pin').value, birthYear: Number($('#r-year').value), parentOk: $('#r-parent').checked, deviceHash: Native.deviceId(), em: regAv.em, col: regAv.col }, { noAuth: true });
    if (!r.ok) throw r.error; await enter(r.user);
  } catch (e) { authError(e); } finally { busy = false; }
});
function logout() { Native.guard(false); Native.setSession('', ''); store.del('user'); user = null; setCreds(null); stats = null; if (map) map.clearTerritory(); show('auth'); }

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
window.onNativeResume = () => { if (screen === 'perms') refreshPerms(); if (rec) syncRecording(); pollAlerts(); paintGuard(); };

function afterLogin() {
  if (!Native.permStatus().loc || !store.get('permsSeen')) { refreshPerms(); show('perms'); } else { show('map'); resumeIfRecording(); }
}

// ---------------------------------------------------------------- map screen
function ensureMap() {
  if (map) return;
  map = createMap($('#map'), {
    onMoveEnd: () => { clearTimeout(terrTimer); terrTimer = setTimeout(() => loadTerritory(false), 450); },
    onTap: (it, o) => territorySheet(it, o)
  });
  if (user) map.setColor(user.col);
  Native.viewStart();
}
$('#btn-center').addEventListener('click', () => map && map.centerMe());

async function loadTerritory(force) {
  if (!map || !user || screen !== 'map') return;
  const zoomOk = map.zoom() >= MIN_ZOOM;
  $('#m-hint').hidden = zoomOk;
  if (!zoomOk) { map.clearTerritory(); terrKey = ''; return; }
  const b = map.bbox(), tol = map.tol(), key = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(4)).join(',') + '|' + tol;
  if (!force && key === terrKey) return;
  try {
    const r = await call('territories', Object.assign({ tol }, b));
    if (r.ok) { terrKey = key; map.setTerritory(r.items, r.owners, r.me); if (r.more) toast('Many territories here. Zoom in to see all.'); }
    else if (r.error === 'auth') { toast('Session expired. Please sign in again.'); logout(); }
  } catch (e) { /* offline: keep what is shown */ }
}
async function refreshHeader() {
  if (!user) return;
  $('#m-group').textContent = user.groupName + ' · ' + (G.GROUPS.find((g) => g.id === user.group) || {}).range;
  try { const r = await call('me'); if (r.ok) { stats = r.stats; user = Object.assign(user, { em: r.user.em, col: r.user.col }); store.set('user', user); if (map) map.setColor(user.col); $('#m-area').textContent = 'Yours: ' + fmtArea(stats.areaM2); } } catch (e) {}
}
function territorySheet(it, o) {
  const mine = user && it.uid === user.id, when = new Date(it.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  openSheet('<div class="who">' + avatarHtml(o.em, o.col, 'big') + '<div><h2>' + esc(o.nick || '?') + (mine ? ' (you)' : '') + '</h2><div class="sub">Conquered ' + when + '</div></div></div>' +
    '<div class="kv"><div><b>' + fmtArea(it.rem) + '</b><span>held now</span></div><div><b>' + fmtArea(it.area) + '</b><span>first claimed</span></div><div><b>' + (it.area ? Math.round(it.rem / it.area * 100) : 0) + '%</b><span>still intact</span></div></div>' +
    '<p class="muted">' + (mine ? 'This land is yours. Rivals can take it by walking a loop over it, so keep an eye out.' : 'Walk a closed loop that covers part of this land and that part becomes yours.') + '</p>' +
    '<button class="btn" id="ts-ok">Close</button>');
  $('#ts-ok').addEventListener('click', closeSheet);
}

// ---------------------------------------------------------------- breach alerts
const seen = {};
function showAlerts(items) {
  items = (items || []).filter((a) => a && isFinite(a.lat));
  if (map) map.setIntruders(items);
  const b = $('#alert-banner');
  if (!items.length) { b.hidden = true; return; }
  const a = items[0];
  b.innerHTML = '⚠ <b>' + esc(a.by) + '</b> is inside your territory' + (items.length > 1 ? ' (+' + (items.length - 1) + ' more)' : '') + ' · ' + a.ago + 's ago' + (a.approx ? ' (approximate spot)' : '') + '<br><small>Tap to see where. Walk a loop over them to take it back.</small>';
  b.hidden = false; b.onclick = () => { show('map'); setTimeout(() => map.flyTo(a.lat, a.lng, 17), 80); };
  const fresh = items.some((x) => seen[x.id] !== x.by + ':' + (x.lat + ',' + x.lng));
  items.forEach((x) => { seen[x.id] = x.by + ':' + (x.lat + ',' + x.lng); });
  if (fresh && navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
async function pollAlerts() {
  if (!user || !stats || !stats.areaM2) return;
  try { const r = await call('alerts'); if (r.ok) showAlerts(r.items); } catch (e) {}
}
setInterval(() => { if (document.visibilityState === 'visible') pollAlerts(); }, 20000);

// ---------------------------------------------------------------- native events
window.onNative = (m) => {
  if (m.t === 'gps') { gpsOn = m.on; paintGps(); }
  else if (m.t === 'fix') { lastFix = m; gpsOn = true; if (map) map.setMe(m.lat, m.lng, m.acc); paintGps(); }
  else if (m.t === 'pt' && rec) {
    if (m.i < rec.pts.length) return;
    if (m.i > rec.pts.length) { syncRecording(); return; }
    addPoint(m.p);
  } else if (m.t === 'ping' && rec) { rec.zone = m.owner ? { nick: m.owner, until: Date.now() + 25000 } : null; paintHud(); }
  else if (m.t === 'alerts') showAlerts(m.items);
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
  if (rec.zone && rec.zone.until > Date.now()) { c.textContent = '⚔ You are in ' + rec.zone.nick + '’s land. Close a loop to take it'; c.className = 'pill ready'; return; }
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
  rec = { pts: [], dist: 0, t0: store.get('recT0') || Math.floor(Date.now() / 1000), acc: null, zone: null };
  recUi(true); if (map) { map.clearWalk(); map.setFollow(true); }
  addMany(pts);
}
function syncRecording() {
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
  Native.setSession(user.id, user.token);
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
function reasons(A) { return A.problems.filter((p) => p !== 'open').map((p) => '<li>' + WHY[p] + '</li>').join(''); }
function reviewHtml(A) {
  if (A.claimable) {
    return '<div class="eyebrow"><span class="eyebrow-dot"></span>Loop closed</div><div class="big-num">' + fmtArea(A.areaM2) + '</div><div class="pitch">' + (pitches(A.areaM2) || 'a small patch') + '</div>' +
      '<p class="muted">Confirm to claim everything inside the line you walked. Any part held by someone in your age group becomes yours.</p>' + kv(A) +
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
function wireReview() {
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
    endRec();
    if (r.claimed) {
      const took = r.stolenM2 > 0 ? '<p class="muted">You took <b>' + fmtArea(r.stolenM2) + '</b> from ' + esc((r.enemies || []).join(', ')) + '.</p>' : '';
      openSheet('<div class="eyebrow"><span class="eyebrow-dot"></span>Conquered</div><div class="big-num">' + fmtArea(r.areaM2) + '</div><div class="pitch">' + (pitches(r.areaM2) || 'a small patch') + '</div>' + took +
        '<p class="muted">You are now <b>#' + r.rank + '</b> in ' + esc(user.groupName) + '.</p><button class="btn primary big" id="rv-ok">Great</button>' +
        (Native.guardOn() ? '' : '<button class="btn" id="rv-guard">Turn on Guard mode (alerts if someone enters)</button>'));
      const g = $('#rv-guard'); if (g) g.addEventListener('click', () => { setGuard(true); closeSheet(); });
    } else openSheet('<h2>Walk saved</h2><p class="muted">' + fmtDist(r.distM) + ' in ' + fmtTime(r.durS) + '.</p><button class="btn primary big" id="rv-ok">OK</button>');
    $('#rv-ok').addEventListener('click', closeSheet);
    refreshHeader(); loadTerritory(true);
  } catch (e) {
    openSheet('<h2>' + esc(e instanceof NetError ? e.message : 'Could not reach the server') + '</h2><p class="muted">Your walk is still saved on this phone. Try again when you are back online.</p>' +
      '<button class="btn primary big" id="rv-retry">Try again</button><button class="btn" id="rv-more">Back to the walk</button>', false);
    $('#rv-retry').addEventListener('click', () => { closeSheet(); $('#btn-finish').click(); });
    $('#rv-more').addEventListener('click', closeSheet);
  } finally { busy = false; }
}
function endRec() { Native.recClear(); store.del('recT0'); rec = null; if (map) map.clearWalk(); recUi(false); }

// ---------------------------------------------------------------- ranking + all players
let rkMode = 'area', rkAll = null;
$$('#rk-tabs button').forEach((b) => b.addEventListener('click', () => {
  rkMode = b.dataset.m; $$('#rk-tabs button').forEach((x) => x.classList.toggle('on', x === b)); loadRank();
}));
function locate(box) { show('map'); setTimeout(() => { map.fitBox(box); setTimeout(() => loadTerritory(true), 400); }, 120); }
$('#btn-all').addEventListener('click', () => { if (rkAll) locate(rkAll); else toast('Nobody has conquered land yet'); });
async function loadRank() {
  const box = $('#rk-list'); box.innerHTML = '<p class="muted">Loading…</p>';
  $('#btn-all').hidden = rkMode !== 'area';
  try {
    const r = await call('leaderboard', { mode: rkMode });
    if (!r.ok) { box.innerHTML = '<p class="err">' + esc(errText(r.error)) + '</p>'; return; }
    rkAll = r.all;
    const g = G.GROUPS.find((x) => x.id === r.group);
    $('#rk-title').textContent = r.groupName + ' · ' + (g ? g.range : '');
    const val = (x) => (rkMode === 'area' ? fmtArea(x.v) : fmtDist(x.v));
    const row = (x, extra) => '<div class="row' + (x.id === user.id ? ' me' : '') + (x.bbox ? ' tap' : '') + '" data-b="' + (x.bbox ? x.bbox.join(',') : '') + '"><span class="rk">' + x.rank + '</span>' + avatarHtml(x.em, x.col) +
      '<span class="nm">' + esc(x.nick) + (extra || '') + '<small>' + (rkMode === 'area' ? titleOf(x.v) : '') + '</small></span><span class="vl">' + val(x) + '</span></div>';
    let html = r.top.map((x) => row(x)).join('');
    if (r.me && r.me.rank > r.top.length) html += row(r.me, ' (you)');
    box.innerHTML = html || '<p class="muted">Nobody here yet. Walk a loop and be first.</p>';
    box.querySelectorAll('.row.tap').forEach((el) => el.addEventListener('click', () => locate(el.dataset.b.split(',').map(Number))));
  } catch (e) { box.innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; }
}

// ---------------------------------------------------------------- profile
function paintGuard() { const s = $('#sw-guard'); if (s) s.setAttribute('aria-checked', String(Native.guardOn())); }
function setGuard(on) {
  if (on && !Native.permStatus().notif) { Native.requestPerm('notif'); toast('Allow notifications, then switch Guard on again'); return; }
  Native.setSession(user.id, user.token); Native.guard(on); paintGuard();
  toast(on ? 'Guard mode on. You will be alerted.' : 'Guard mode off');
}
$('#sw-guard').addEventListener('click', () => setGuard(!Native.guardOn()));

async function loadMe() {
  $('#me-nick').textContent = user.nick; $('#me-group').textContent = user.groupName;
  $('#me-avatar').style.background = user.col || '#e2645a'; $('#me-avatar').textContent = user.em || '🦅';
  paintGuard();
  try {
    const [m, h] = await Promise.all([call('me'), call('history')]);
    if (m.ok) {
      const s = m.stats;
      $('#me-title').textContent = titleOf(s.areaM2) + (s.rank ? ' · Rank #' + s.rank : '');
      $('#me-stats').innerHTML = [[fmtArea(s.areaM2), 'territory'], [s.polys, 'conquests'], [fmtDist(s.distM), 'walked'], [s.walks, 'walks']].map((x) => '<div class="stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>').join('');
    }
    if (h.ok) $('#me-hist').innerHTML = h.items.map((i) => '<div class="row"><span class="nm">' + new Date(i.t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '<small>' + fmtDist(i.distM) + ' · ' + fmtTime(i.durS) + (i.stolenM2 ? ' · took ' + fmtArea(i.stolenM2) : '') + '</small></span><span class="vl">' + (i.claimed ? '+' + fmtArea(i.areaM2) : '') + '</span></div>').join('') || '<p class="muted">No walks yet.</p>';
  } catch (e) { $('#me-hist').innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; }
}
$('#btn-avatar').addEventListener('click', () => {
  const st = { em: user.em || EMOJI[0], col: user.col || COLORS[0] };
  openSheet('<h2>Your emblem</h2><div id="av-pick" class="avatar-pick"></div><button class="btn primary big" id="av-save">Save</button><button class="btn" id="av-no">Cancel</button>');
  pickerInto($('#av-pick'), st);
  $('#av-no').addEventListener('click', closeSheet);
  $('#av-save').addEventListener('click', async () => {
    try { const r = await call('setAvatar', st); if (r.ok) { user = Object.assign(user, { em: r.user.em, col: r.user.col }); store.set('user', user); if (map) map.setColor(user.col); closeSheet(); loadMe(); loadTerritory(true); } else toast(errText(r.error)); } catch (e) { toast(errText(e)); }
  });
});
$('#btn-logout').addEventListener('click', () => { if (!rec) logout(); else toast('Finish your walk first'); });
$('#btn-delete').addEventListener('click', () => {
  openSheet('<h2>Delete your account?</h2><p class="muted">Your account, walks and conquered land are erased for good.</p><button class="btn danger big" id="dl-yes">Delete everything</button><button class="btn" id="dl-no">Cancel</button>');
  $('#dl-no').addEventListener('click', closeSheet);
  $('#dl-yes').addEventListener('click', async () => {
    try { const r = await call('deleteAccount'); if (r.ok) { closeSheet(); logout(); toast('Account deleted'); } else toast(errText(r.error)); } catch (e) { toast(errText(e)); }
  });
});

// ---------------------------------------------------------------- boot
if (user) { setCreds({ uid: user.id, token: user.token }); Native.setSession(user.id, user.token); afterLogin(); refreshHeader().then(pollAlerts); } else show('auth');
