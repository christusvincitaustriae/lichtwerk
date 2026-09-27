/* ===== Laden, Ansicht, Rendering, Histogramm ===== */
const MAXPIX = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 16e6 : 50e6;

async function decodeImage(blob, name) {
  const isTiff = /\.tiff?$/i.test(name || '') || blob.type === 'image/tiff';
  let bitmap, bits = 8;
  if (isTiff) {
    const r = await Codecs.decodeTIFF(await blob.arrayBuffer());
    bits = r.bits;
    bitmap = await createImageBitmap(new ImageData(r.data, r.width, r.height));
  } else {
    try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch (e) {
      const url = URL.createObjectURL(blob);
      try { const im = new Image(); im.src = url; await im.decode(); bitmap = await createImageBitmap(im); }
      catch (e2) { throw new Error('Dieses Dateiformat kann dein Browser nicht öffnen.'); }
      finally { URL.revokeObjectURL(url); }
    }
  }
  let W = bitmap.width, H = bitmap.height, reduced = false;
  if (W * H > MAXPIX) {
    const f = Math.sqrt(MAXPIX / (W * H)); const nw = Math.floor(W * f), nh = Math.floor(H * f);
    const nb = await createImageBitmap(bitmap, { resizeWidth: nw, resizeHeight: nh, resizeQuality: 'high' });
    bitmap.close && bitmap.close(); bitmap = nb; W = nw; H = nh; reduced = true;
  }
  return { bitmap, W, H, bits, reduced };
}

let scratch = null;
function scratchCtx(w, h) {
  if (!scratch) { scratch = document.createElement('canvas'); }
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const c = scratch.getContext('2d', { willReadFrequently: true });
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  return c;
}
function makeProxy(bitmap, W, H, L) {
  const f = Math.min(1, L / Math.max(W, H)); const w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f));
  const c = scratchCtx(w, h); c.clearRect(0, 0, w, h); c.drawImage(bitmap, 0, 0, w, h);
  return { data: c.getImageData(0, 0, w, h).data, w, h };
}
let srcCache = [];
function getSource(s, x0, y0, w, h) {
  const key = [s.toFixed(5), x0, y0, w, h].join(',');
  const hit = srcCache.find((e) => e.key === key); if (hit) return hit.data;
  const c = scratchCtx(w, h); c.clearRect(0, 0, w, h);
  c.drawImage(S.img.bitmap, x0 / s, y0 / s, w / s, h / s, 0, 0, w, h);
  const data = c.getImageData(0, 0, w, h).data;
  srcCache.unshift({ key, data }); if (srcCache.length > 3) srcCache.length = 3;
  return data;
}

async function loadImage(blob, meta, opts) {
  opts = opts || {};
  const t = toast('Foto wird geladen …', { ms: 60000 });
  let d;
  try { d = await decodeImage(blob, meta.name); }
  catch (e) { t.remove(); toast('Öffnen fehlgeschlagen: ' + (e.message || e), { err: true, ms: 6000 }); return false; }
  t.remove();
  if (S.img && S.img.bitmap && S.img.bitmap.close) { try { S.img.bitmap.close(); } catch (e) { /* ignorieren */ } }
  S.img = { bitmap: d.bitmap, W: d.W, H: d.H, name: meta.name || 'Foto', type: blob.type || meta.type || '', blob, key: meta.key || null, isSample: !!meta.isSample, bits: d.bits };
  S.proxy = makeProxy(d.bitmap, d.W, d.H, 640);
  srcCache = []; S.zones = null; S.lastPreset = null; S.selMask = null; S.tool = null;
  S.params = opts.params ? migrateParams(opts.params) : PE.defaultParams();
  let restored = false;
  if (!opts.params && S.img.key) {
    const saved = await idbGet('edit:' + S.img.key);
    if (saved && saved.params) { S.params = migrateParams(saved.params); restored = true; }
  }
  syncBrushRasters(true);
  resetHistory('Geöffnet');
  $('#empty').hidden = true;
  updateFileChip();
  resetView();
  renderPanel(); requestRender(false); drawOverlay();
  if (d.reduced) toast(`Sehr großes Bild: zur Bearbeitung auf ${d.W}×${d.H} px verkleinert.`, { ms: 6000 });
  if (d.bits > 8) toast(`${d.bits}-Bit-TIFF geöffnet. Die Bearbeitung nutzt 8-Bit-Quelldaten mit Gleitkomma-Verarbeitung.`, { ms: 5000 });
  if (restored) toast('Frühere Bearbeitung dieses Fotos wiederhergestellt.', { action: { label: 'Verwerfen', fn: () => { S.params = PE.defaultParams(); commit('Bearbeitung verworfen'); afterParamsReplaced(); } } });
  persistSoon();
  return true;
}
function migrateParams(p) {
  const d = PE.defaultParams();
  const q = Object.assign(d, p); q.v = Object.assign(PE.defaultParams().v, p.v || {});
  q.curves = Object.assign(d.curves, p.curves || {}); q.geo = Object.assign(PE.defaultParams().geo, p.geo || {});
  q.masks = (p.masks || []).map((m) => Object.assign({ enabled: true, opacity: 100, adj: {} }, m));
  q.off = p.off || {};
  return q;
}
function updateFileChip() {
  const c = $('#fileChip'); if (!S.img) { c.textContent = ''; return; }
  c.innerHTML = ''; c.append(el('b', { text: S.img.name }), ` · ${S.img.W}×${S.img.H}`);
  c.title = S.img.name;
}
function openFiles(files) {
  const f = files && files[0]; if (!f) return;
  const ok = /^image\//.test(f.type) || /\.(jpe?g|png|webp|tiff?|avif|gif|bmp)$/i.test(f.name);
  if (!ok) { toast('Bitte eine Bilddatei wählen (JPEG, PNG, WebP oder TIFF).', { err: true }); return; }
  loadImage(f, { name: f.name, type: f.type, key: f.name + '|' + f.size + '|' + (f.lastModified || 0) });
}

/* ---------- Geometrie für die Oberfläche ---------- */
function isQuadMode() { return S.tool === 'quad'; }
function viewParams() {
  let p = PE.effectiveParams(S.params);
  if (isQuadMode()) { p = Object.assign({}, p, { v: Object.assign({}, p.v), geo: Object.assign({}, p.geo, { quad: null, rot90: 0, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } }) }); PE.GROUP_KEYS.geo.forEach((k) => (p.v[k] = PE.DEF[k])); }
  return p;
}
let geoCache = { key: null, g: null };
function G() {
  const p = viewParams(); const key = JSON.stringify([p.geo, PE.GROUP_KEYS.geo.map((k) => p.v[k]), S.img && S.img.W, S.img && S.img.H]);
  if (geoCache.key !== key) geoCache = { key, g: PE.geometry(p, S.img.W, S.img.H) };
  return geoCache.g;
}
function frameMode() { return S.tab === 'crop' || isQuadMode(); }
function outDims() { const g = G(); return frameMode() ? { w: g.FW, h: g.FH } : { w: g.crop.w, h: g.crop.h }; }
function frameToOut(p) { if (frameMode()) return p; const g = G(); return [p[0] - g.crop.x, p[1] - g.crop.y]; }
function outToFrame(p) { if (frameMode()) return p; const g = G(); return [p[0] + g.crop.x, p[1] + g.crop.y]; }
function srcN2o(u, v) { const g = G(); return frameToOut(PE.ap3(g.H, u * S.img.W, v * S.img.H)); }
function o2srcN(x, y) { const g = G(); const f = outToFrame([x, y]); const p = PE.ap3(g.Hinv, f[0], f[1]); return [p[0] / S.img.W, p[1] / S.img.H]; }

/* ---------- Ansicht ---------- */
function stageSize() { const s = $('#stage'); return { w: s.clientWidth, h: s.clientHeight }; }
function viewCenter() { const st = stageSize(); return [st.w / 2, st.h / 2 - (isMobile() ? 29 : 22)]; }
function fitScale() {
  const st = stageSize(), od = outDims(); const pad = isMobile() ? 10 : 26;
  return Math.max(0.01, Math.min((st.w - pad * 2) / od.w, (st.h - pad * 2 - (isMobile() ? 62 : 46)) / od.h));
}
function dispScale() { return fitScale() * S.view.zoom; }
function resetView() { if (!S.img) return; const od = outDims(); S.view = { zoom: 1, cx: od.w / 2, cy: od.h / 2 }; updateZoomLabel(); }
function o2s(x, y) { const c = viewCenter(), ds = dispScale(); return [c[0] + (x - S.view.cx) * ds, c[1] + (y - S.view.cy) * ds]; }
function s2o(x, y) { const c = viewCenter(), ds = dispScale(); return [S.view.cx + (x - c[0]) / ds, S.view.cy + (y - c[1]) / ds]; }
function clampView() {
  const od = outDims(), ds = dispScale(), st = stageSize();
  const hw = st.w / 2 / ds, hh = st.h / 2 / ds;
  S.view.cx = od.w <= hw * 2 ? od.w / 2 : clamp(S.view.cx, hw * 0.6, od.w - hw * 0.6);
  S.view.cy = od.h <= hh * 2 ? od.h / 2 : clamp(S.view.cy, hh * 0.6, od.h - hh * 0.6);
}
function setZoom(z, sx, sy) {
  if (!S.img) return;
  const st = stageSize(); if (sx == null) { const c = viewCenter(); sx = c[0]; sy = c[1]; }
  const before = s2o(sx, sy);
  const maxZ = Math.max(4, 8 / (fitScale() * (window.devicePixelRatio || 1)));
  S.view.zoom = clamp(z, 1, maxZ);
  const after = s2o(sx, sy); S.view.cx += before[0] - after[0]; S.view.cy += before[1] - after[1];
  if (S.view.zoom === 1) { const od = outDims(); S.view.cx = od.w / 2; S.view.cy = od.h / 2; }
  clampView(); updateZoomLabel(); positionCanvases(); drawOverlay(); requestRender(true);
}
function zoom100() { const dpr = window.devicePixelRatio || 1; setZoom(1 / (fitScale() * dpr)); }
function updateZoomLabel() { if (!S.img) return; const dpr = window.devicePixelRatio || 1; $('#zoomVal').textContent = Math.round(dispScale() * dpr * 100) + '%'; }

/* ---------- Rendering ---------- */
let rafId = 0, idleT = 0, backT = 0, wantInteractive = false;
const lastDraw = { main: null, back: null };
function requestRender(interactive) {
  if (!S.img) return;
  wantInteractive = !!interactive;
  if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; try { renderNow(wantInteractive); } catch (e) { console.error(e); toast('Renderfehler: ' + e.message, { err: true }); } });
  clearTimeout(idleT);
  if (interactive) idleT = setTimeout(() => requestRender(false), 230);
}
function beforeParams(p) {
  const b = PE.defaultParams(); b.geo = deep(p.geo); PE.GROUP_KEYS.geo.forEach((k) => (b.v[k] = p.v[k])); return b;
}
function renderRegion(params, geo, rect, k, fm, debug) {
  const W0 = S.img.W, H0 = S.img.H;
  const s = Math.min(1, k * geo.fill * 1.0);
  const PW = Math.max(1, Math.round(W0 * s)), PH = Math.max(1, Math.round(H0 * s));
  const ctx = PE.prepare(params, { fullW: W0, fullH: H0, proxy: S.proxy, brush: S.brushRasters, debug });
  const M = PE.margin(ctx, s, PW, PH) + 2;
  const cx = fm ? 0 : geo.crop.x, cy = fm ? 0 : geo.crop.y;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
    const fx = cx + (rect.x0 + rect.w * a / 4) / k, fy = cy + (rect.y0 + rect.h * b / 4) / k;
    const p = PE.ap3(geo.Hinv, fx, fy); bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]);
  }
  const rx0 = clamp(Math.floor(bx0 * s) - M, 0, PW - 1), ry0 = clamp(Math.floor(by0 * s) - M, 0, PH - 1);
  const rx1 = clamp(Math.ceil(bx1 * s) + M, rx0 + 1, PW), ry1 = clamp(Math.ceil(by1 * s) + M, ry0 + 1, PH);
  const rw = rx1 - rx0, rh = ry1 - ry0;
  const src = getSource(s, rx0, ry0, rw, rh);
  const proc = PE.processRegion(ctx, src, rw, rh, rx0, ry0, PW, PH, s);
  const out = PE.renderOutput(ctx, proc, rw, rh, rx0, ry0, s, geo, fm, rect, k, 'u8');
  return { out, px: rw * rh };
}
let beforeCache = { key: null, out: null };
function renderNow(interactive) {
  if (!S.img) return;
  const t0 = performance.now();
  const fm = frameMode();
  let params = viewParams();
  const showBefore = S.before && !S.split;
  if (showBefore) params = beforeParams(params);
  const geo = G();
  const od = outDims(), st = stageSize();
  const a = s2o(0, 0), b = s2o(st.w, st.h);
  const vx0 = clamp(a[0], 0, od.w), vy0 = clamp(a[1], 0, od.h), vx1 = clamp(b[0], 0, od.w), vy1 = clamp(b[1], 0, od.h);
  if (vx1 - vx0 < 0.5 || vy1 - vy0 < 0.5) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ds = dispScale();
  let k = ds * dpr; const mob = isMobile();
  const budget = interactive ? (mob ? 0.28e6 : 0.5e6) : (mob ? 1.5e6 : 2.8e6);
  const area = (vx1 - vx0) * (vy1 - vy0) * k * k; if (area > budget) k *= Math.sqrt(budget / area);
  k = Math.min(k, 1);
  const rect = { x0: Math.floor(vx0 * k), y0: Math.floor(vy0 * k) };
  rect.w = Math.max(1, Math.min(Math.ceil(od.w * k), Math.ceil(vx1 * k)) - rect.x0); rect.h = Math.max(1, Math.min(Math.ceil(od.h * k), Math.ceil(vy1 * k)) - rect.y0);
  const debug = {};
  if (S.tab === 'masks' && S.selMask && S.showMaskOverlay && !showBefore) debug.maskId = S.selMask;
  if (S.tab === 'brush' && S.showMaskOverlay && !showBefore) { const m = S.params.masks.find((q) => q.db === S.prefs.db.mode) || S.params.masks.find((q) => q.db); if (m && S.prefs.db.showMask) debug.maskId = m.id; }
  if (S.sharpMaskView && !showBefore) debug.sharpMask = true;
  const r = renderRegion(params, geo, rect, k, fm, debug);
  let out = r.out;
  // Geteilte Ansicht: links Vorher
  if (S.split && !fm) {
    const bp = beforeParams(params); const key = JSON.stringify([bp.geo, rect, k, geoCache.key]);
    if (beforeCache.key !== key) beforeCache = { key, out: renderRegion(bp, geo, rect, k, fm, {}).out };
    const sxo = s2o(S.splitPos * st.w, 0)[0] * k - rect.x0; const cut = clamp(Math.round(sxo), 0, rect.w);
    const bo = beforeCache.out;
    for (let y = 0; y < rect.h; y++) { const o = y * rect.w * 4; out.set(bo.subarray(o, o + cut * 4), o); }
  }
  const whole = rect.x0 === 0 && rect.y0 === 0 && rect.w >= Math.floor(od.w * k) - 1 && rect.h >= Math.floor(od.h * k) - 1;
  if (whole) drawHisto(out, rect.w, rect.h);
  if (S.clip.hi || S.clip.lo) out = clipOverlay(out);
  const cv = $('#cvMain'); if (cv.width !== rect.w || cv.height !== rect.h) { cv.width = rect.w; cv.height = rect.h; }
  cv.getContext('2d').putImageData(new ImageData(out, rect.w, rect.h), 0, 0);
  lastDraw.main = { x: rect.x0 / k, y: rect.y0 / k, w: rect.w / k, h: rect.h / k, k };
  cv.classList.toggle('pix', ds * dpr / k > 1.6);
  positionCanvases();
  const ms = performance.now() - t0;
  S.lastRender = { ms, mp: r.px / 1e6, interactive };
  $('#histoPix').textContent = `${(r.px / 1e6).toFixed(1).replace('.', ',')} MP · ${Math.round(ms)} ms`;
  $('#badgeBefore').hidden = !showBefore;
  // Hintergrund (ganzes Bild) bei Zoom
  const back = $('#cvBack');
  if (whole) { back.hidden = true; lastDraw.back = null; }
  else if (!interactive) { clearTimeout(backT); backT = setTimeout(() => renderBackdrop(params, geo, fm, od), 40); }
  $('#stage').dataset.rendered = String((+$('#stage').dataset.rendered || 0) + 1);
}
function renderBackdrop(params, geo, fm, od) {
  if (!S.img) return;
  const k = Math.min(1, Math.sqrt((isMobile() ? 0.5e6 : 1e6) / (od.w * od.h)));
  const rect = { x0: 0, y0: 0, w: Math.max(1, Math.floor(od.w * k)), h: Math.max(1, Math.floor(od.h * k)) };
  const r = renderRegion(params, geo, rect, k, fm, {});
  drawHisto(r.out, rect.w, rect.h);
  const cv = $('#cvBack'); cv.width = rect.w; cv.height = rect.h; cv.getContext('2d').putImageData(new ImageData(r.out, rect.w, rect.h), 0, 0);
  cv.hidden = false; lastDraw.back = { x: 0, y: 0, w: rect.w / k, h: rect.h / k };
  positionCanvases();
}
function positionCanvases() {
  if (!S.img) return;
  const ds = dispScale();
  const place = (cv, d) => { if (!d) return; const p = o2s(d.x, d.y); cv.style.transform = `translate(${p[0]}px,${p[1]}px)`; cv.style.width = d.w * ds + 'px'; cv.style.height = d.h * ds + 'px'; };
  place($('#cvMain'), lastDraw.main); place($('#cvBack'), lastDraw.back);
}
function clipOverlay(out) {
  const o = new Uint8ClampedArray(out); const hi = S.clip.hi, lo = S.clip.lo;
  for (let i = 0; i < o.length; i += 4) {
    const r = o[i], g = o[i + 1], b = o[i + 2];
    if (hi && (r >= 254 || g >= 254 || b >= 254)) { o[i] = 255; o[i + 1] = 50; o[i + 2] = 70; }
    else if (lo && (r <= 1 || g <= 1 || b <= 1)) { o[i] = 40; o[i + 1] = 110; o[i + 2] = 255; }
  }
  return o;
}

/* ---------- Histogramm ---------- */
const histo = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), n: 0 };
function drawHisto(out, w, h) {
  histo.r.fill(0); histo.g.fill(0); histo.b.fill(0); histo.l.fill(0);
  const step = w * h > 1.2e6 ? 8 : 4; let n = 0;
  for (let i = 0; i < out.length; i += step) {
    if (out[i + 3] < 8) continue;
    const r = out[i], g = out[i + 1], b = out[i + 2];
    histo.r[r]++; histo.g[g]++; histo.b[b]++; histo.l[(0.2126 * r + 0.7152 * g + 0.0722 * b) | 0]++; n++;
  }
  histo.n = n;
  const cv = $('#histo'); const c = cv.getContext('2d'); const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  let mx = 1; for (let i = 2; i < 254; i++) mx = Math.max(mx, histo.r[i], histo.g[i], histo.b[i]);
  mx *= 1.08;
  c.globalCompositeOperation = 'lighter';
  const plot = (arr, col) => {
    c.beginPath(); c.moveTo(0, H);
    for (let i = 0; i < 256; i++) { const y = H - Math.min(1, arr[i] / mx) * (H - 4); c.lineTo(i / 255 * W, y); }
    c.lineTo(W, H); c.closePath(); c.fillStyle = col; c.fill();
  };
  plot(histo.r, 'rgba(255,72,72,0.55)'); plot(histo.g, 'rgba(70,220,110,0.5)'); plot(histo.b, 'rgba(70,130,255,0.6)');
  c.globalCompositeOperation = 'source-over';
  c.beginPath(); for (let i = 0; i < 256; i++) { const y = H - Math.min(1, histo.l[i] / mx) * (H - 4); if (i) c.lineTo(i / 255 * W, y); else c.moveTo(0, y); }
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.5; c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1;
  for (let q = 1; q < 4; q++) { c.beginPath(); c.moveTo(q * W / 4, 0); c.lineTo(q * W / 4, H); c.stroke(); }
  const hiC = (histo.r[255] + histo.g[255] + histo.b[255]) / Math.max(1, n * 3), loC = (histo.r[0] + histo.g[0] + histo.b[0]) / Math.max(1, n * 3);
  $('#clipR').classList.toggle('hot', hiC > 0.001); $('#clipL').classList.toggle('hot', loC > 0.001);
  let mean = 0; for (let i = 0; i < 256; i++) mean += i * histo.l[i]; mean /= Math.max(1, n);
  $('#histoInfo').textContent = `Ø Helligkeit ${Math.round(mean / 2.55)} % · Beschnitt ${pctDE(hiC, 1)} / ${pctDE(loC, 1)}`;
  $('#histoInfo').title = 'Durchschnittliche Helligkeit · Anteil beschnittener Lichter / Tiefen';
}
