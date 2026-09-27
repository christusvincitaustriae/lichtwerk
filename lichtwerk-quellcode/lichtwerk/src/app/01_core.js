/* ===== Kern: Hilfsfunktionen, Symbole, Speicher, Zustand, Verlauf ===== */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 9);
const deep = (o) => JSON.parse(JSON.stringify(o));

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  return e;
}

const ICONS = {
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  before: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/><path d="M12 4h6a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-6z" fill="currentColor" opacity=".35" stroke="none"/>',
  tune: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
  mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  desktop: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  export: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  px: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9v6M16 9v6M12 10.5v.01M12 13.5v.01"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 2v20"/><path d="m8 10-2 2 2 2M16 10l2 2-2 2"/>',
  clip: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.01"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
  mask: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" opacity=".38" stroke="none"/>',
  brush: '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12.5 14.3 9.7 11.5z"/><path d="M9.2 12.3c-2.4 0-4 1.8-4 4 0 1.5-1 2.4-2.6 2.4 1.2 1.5 3 2.1 4.8 2.1 3 0 5-2 5-4.8"/>',
  presets: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5" opacity=".5"/>',
  chev: '<path d="m6 9 6 6 6-6"/>', chevR: '<path d="m9 6 6 6-6 6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  wand: '<path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M3 21 13.5 10.5"/><path d="M19 13l.7 1.3L21 15l-1.3.7L19 17l-.7-1.3L17 15l1.3-.7z"/>',
  pipette: '<path d="M17 3.5 20.5 7l-3 3L14 6.5z"/><path d="M14.5 7 5 16.5V19h2.5L17 9.5"/>',
  rotL: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M4 14V8a3 3 0 0 1 3-3h7"/><path d="m11 2 3 3-3 3"/>',
  rotR: '<rect x="3" y="9" width="12" height="12" rx="2"/><path d="M20 14V8a3 3 0 0 0-3-3h-7"/><path d="m13 2-3 3 3 3"/>',
  flipH: '<path d="M12 3v18"/><path d="M8.5 7 3.5 12l5 5z"/><path d="m15.5 7 5 5-5 5z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 8.5 12 3.5l5 5z"/><path d="m7 15.5 5 5 5-5z"/>',
  straighten: '<path d="M3 17 21 7"/><circle cx="7" cy="14.8" r="1.6"/><circle cx="17" cy="9.2" r="1.6"/>',
  linear: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 12h18"/><path d="M3 7.5h18M3 16.5h18" opacity=".45"/>',
  radial: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5" opacity=".6"/><path d="M12 11.9v.2"/>',
  luma: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  eraser: '<path d="M8 20h12"/><path d="M4.6 14.6 13.4 5.8a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L10 18.8H8z"/><path d="m9.5 9.7 4.8 4.8"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/>',
  dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M14.5 11.5v6M11.5 14.5h6"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  drop: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.8 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.2" r="1.2"/>',
  curve: '<path d="M4 20C10 20 9 4 20 4"/><rect x="3" y="3" width="18" height="18" rx="3" opacity=".45"/>',
  detail: '<path d="M3 12h3l3-7 4 14 3-7h5"/>',
  fx: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" opacity=".55"/><path d="M8 8.5v.01M15 7v.01M16.5 13.5v.01M9 15.5v.01M12.5 11v.01"/>',
  grade: '<circle cx="9" cy="10" r="5.5"/><circle cx="15" cy="10" r="5.5" opacity=".7"/><circle cx="12" cy="15" r="5.5" opacity=".5"/>',
  hsl: '<path d="M12 3v9l7.8 4.5"/><circle cx="12" cy="12" r="9"/>',
  presence: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/>',
};
function icon(name, cls) { return `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`; }
function iconEl(name, cls) { const t = document.createElement('template'); t.innerHTML = icon(name, cls); return t.content.firstChild; }
function hydrateIcons(root) { $$('svg[data-i]', root).forEach((s) => { const n = iconEl(s.getAttribute('data-i')); s.replaceWith(n); }); }

/* ---------- Speicher (localStorage + IndexedDB, jeweils mit Rückfall) ---------- */
const mem = {};
const store = {
  get(k, d) { try { const v = localStorage.getItem('lw.' + k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch (e) { return k in mem ? mem[k] : d; } },
  set(k, v) { mem[k] = v; try { localStorage.setItem('lw.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { delete mem[k]; try { localStorage.removeItem('lw.' + k); } catch (e) { /* egal */ } },
};
let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise((res) => {
    try {
      const rq = indexedDB.open('lichtwerk', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return dbP;
}
async function idbGet(k) { const d = await db(); if (!d) return undefined; return new Promise((res) => { try { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); } catch (e) { res(undefined); } }); }
async function idbSet(k, v) { const d = await db(); if (!d) return false; return new Promise((res) => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); } catch (e) { res(false); } }); }
async function idbDel(k) { const d = await db(); if (!d) return; return new Promise((res) => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); t.onerror = () => res(); } catch (e) { res(); } }); }
async function idbClear() { const d = await db(); if (!d) return; return new Promise((res) => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = () => res(); t.onerror = () => res(); } catch (e) { res(); } }); }

/* ---------- Zustand ---------- */
const PREF_DEF = {
  mobile: null, hidden: {}, collapsed: { hsl: true, grading: true, curve: true, detail: true, fx: true }, advOpen: {}, advDefault: false,
  restore: true, showHisto: true, profile: 'standard',
  brush: { size: 45, hard: 55, opacity: 100, flow: 70 },
  db: { mode: 'dodge', dodge: 0.6, burn: 0.6 },
  export: { fmt: 'jpeg', q: 90, bits: 8, sizeMode: 'orig', size: 2048, pct: 100, sharpen: 'off', suffix: '-lichtwerk', tiffZip: true },
};
const S = {
  img: null, proxy: null, params: PE.defaultParams(),
  history: [], hIndex: -1,
  tab: 'edit', tool: null, selMask: null, mGroup: 'light',
  view: { zoom: 1, cx: 0, cy: 0 },
  before: false, split: false, splitPos: 0.5, clip: { hi: false, lo: false },
  showMaskOverlay: true, sharpMaskView: false,
  prefs: Object.assign(deep(PREF_DEF), store.get('prefs', {})),
  brushRasters: new Map(),
  lastPreset: null,
  zones: null,
};
['brush', 'db', 'export'].forEach((k) => { S.prefs[k] = Object.assign(deep(PREF_DEF[k]), S.prefs[k] || {}); });
function savePrefs() { store.set('prefs', S.prefs); }
const P = () => S.params;
const pctDE = (f, d) => (f * 100).toFixed(d == null ? 2 : d).replace('.', ',') + ' %';

/* ---------- Toasts & Hinweise ---------- */
function toast(msg, opts) {
  opts = opts || {};
  const t = el('div', { class: 'toast glass' + (opts.err ? ' err' : ''), role: opts.err ? 'alert' : 'status' }, el('span', { text: msg }));
  if (opts.action) t.appendChild(el('button', { class: 'btn small', onclick: () => { opts.action.fn(); t.remove(); } }, opts.action.label));
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), opts.ms || (opts.action ? 7000 : 3200));
  return t;
}
function hint(msg) { const h = $('#hint'); if (!msg) { h.hidden = true; return; } h.textContent = msg; h.hidden = false; }

/* ---------- Verlauf (Rückgängig/Wiederholen) ---------- */
function commit(label) {
  const snap = JSON.stringify(S.params);
  const cur = S.history[S.hIndex];
  if (cur && cur.s === snap) return;
  S.history = S.history.slice(0, S.hIndex + 1);
  S.history.push({ s: snap, label: label || 'Änderung', t: Date.now() });
  if (S.history.length > 150) S.history.shift();
  S.hIndex = S.history.length - 1;
  updateUndo(); persistSoon();
  if (S.tab === 'presets') renderPanel();
}
function resetHistory(label) { S.history = [{ s: JSON.stringify(S.params), label: label || 'Geöffnet', t: Date.now() }]; S.hIndex = 0; updateUndo(); }
function restoreSnap(i) {
  if (i < 0 || i >= S.history.length) return;
  S.hIndex = i; S.params = JSON.parse(S.history[i].s);
  if (S.selMask && !S.params.masks.find((m) => m.id === S.selMask)) S.selMask = null;
  updateUndo(); afterParamsReplaced(); persistSoon();
}
function undo() { if (S.hIndex > 0) { restoreSnap(S.hIndex - 1); toast('Rückgängig: ' + S.history[S.hIndex + 1].label, { ms: 1400 }); } }
function redo() { if (S.hIndex < S.history.length - 1) { restoreSnap(S.hIndex + 1); toast('Wiederholt: ' + S.history[S.hIndex].label, { ms: 1400 }); } }
function updateUndo() { $('#btnUndo').disabled = !(S.hIndex > 0); $('#btnRedo').disabled = !(S.hIndex < S.history.length - 1); }
function afterParamsReplaced() { syncBrushRasters(); renderPanel(); requestRender(false); drawOverlay(); }

/* ---------- Sitzung sichern ---------- */
let persistT = null;
function persistSoon() { clearTimeout(persistT); persistT = setTimeout(persistNow, 600); }
async function persistNow() {
  if (!S.img) return;
  const params = S.params;
  if (S.img.key) await idbSet('edit:' + S.img.key, { params, t: Date.now() });
  if (S.prefs.restore) await idbSet('session', { blob: S.img.blob, name: S.img.name, type: S.img.type, key: S.img.key, isSample: !!S.img.isSample, params, tab: S.tab });
}
