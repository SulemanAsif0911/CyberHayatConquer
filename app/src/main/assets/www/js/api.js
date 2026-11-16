// Talks to the Apps Script database, and wraps the Android bridge (with a browser fallback so the web build can be tested).
import { CONFIG } from './config.js';

const A = window.AndroidNative || null;
export const isApp = !!A;
const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
const emit = (m) => { if (window.onNative) window.onNative(m); };

// ---- browser fallback: the same filter as the phone (accuracy <= 25 m, 4 m or 10 s between points)
const web = { id: null, rec: false, pts: [], last: null };
function webWatch() {
  if (web.id !== null || !navigator.geolocation) return;
  web.id = navigator.geolocation.watchPosition((pos) => {
    const c = pos.coords, t = Math.floor(pos.timestamp / 1000);
    emit({ t: 'gps', on: true });
    emit({ t: 'fix', lat: c.latitude, lng: c.longitude, acc: c.accuracy });
    if (web.rec && c.accuracy <= 25) {
      const l = web.last;
      if (!l || window.Geo.hav(l, [c.latitude, c.longitude]) >= 4 || t - l[2] >= 10) {
        const p = [c.latitude, c.longitude, t, Math.round(c.accuracy * 10) / 10, 0];
        web.pts.push(p); web.last = p; emit({ t: 'pt', i: web.pts.length - 1, p });
      }
    }
  }, () => emit({ t: 'gps', on: false }), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

export const Native = {
  isApp,
  deviceId() {
    if (A) return safe(() => String(A.deviceId()), '');
    let v = safe(() => localStorage.getItem('cq.dev'), null);
    if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join(''); safe(() => localStorage.setItem('cq.dev', v)); }
    return v;
  },
  permStatus: () => (A ? safe(() => JSON.parse(String(A.permStatus())), { loc: false }) : { loc: true, bg: true, notif: true, battery: true }),
  hasPerms: () => (A ? safe(() => !!A.hasPerms(), false) : true),
  requestPerm: (n) => { if (A) safe(() => A.requestPerm(n)); else { webWatch(); setTimeout(() => window.onPerms && window.onPerms(true), 300); } },
  openLocationSettings: () => { if (A) safe(() => A.openLocationSettings()); },
  viewStart: () => { if (!A) webWatch(); },          // on Android the shell starts it itself
  recActive: () => (A ? safe(() => !!A.recActive(), false) : web.rec),
  recStart() { if (A) return safe(() => !!A.recStart(), false); webWatch(); web.rec = true; web.pts = []; web.last = null; return true; },
  recPoints: (from) => (A ? safe(() => JSON.parse(String(A.recPoints(from))), []) : web.pts.slice(from)),
  recStop() { if (A) safe(() => A.recStop()); else web.rec = false; },
  recClear() { if (A) safe(() => A.recClear()); else { web.rec = false; web.pts = []; web.last = null; } },
  keepScreenOn: (on) => { if (A) safe(() => A.keepScreenOn(!!on)); }
};

// ---- server
export class NetError extends Error { constructor(m) { super(m); this.code = 'net'; } }
let creds = null;
export const setCreds = (c) => { creds = c; };

export async function call(action, body = {}, opts = {}) {
  if (!CONFIG.APPS_SCRIPT_URL) throw new NetError('The app is not connected to its database yet (js/config.js).');
  const payload = Object.assign({ action, secret: CONFIG.SHARED_SECRET }, opts.noAuth ? {} : (creds || {}), body);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 30000);
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },     // simple request: no CORS preflight
      body: JSON.stringify(payload)
    });
    const txt = await res.text();
    let j; try { j = JSON.parse(txt); } catch (e) { throw new NetError('Unexpected reply from the server.'); }
    return j;
  } catch (e) {
    if (e instanceof NetError) throw e;
    throw new NetError(e && e.name === 'AbortError' ? 'The server took too long.' : 'No internet connection.');
  } finally { clearTimeout(timer); }
}
