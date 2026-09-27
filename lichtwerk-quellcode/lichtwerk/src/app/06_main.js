/* ===== Layout, Bereiche, Tastatur, Start ===== */
function isMobile() { return $('#app').classList.contains('mobile'); }
function applyMobile(on, save) {
  $('#app').classList.toggle('mobile', !!on);
  const b = $('#btnMobile'); b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on)); b.innerHTML = icon(on ? 'desktop' : 'mobile');
  b.title = on ? 'Zur Desktop-Ansicht wechseln' : 'Zum Mobil-Modus wechseln';
  if (save) { S.prefs.mobile = !!on; savePrefs(); }
  renderPanel();
  requestAnimationFrame(() => { if (!S.img) return; clampView(); updateZoomLabel(); positionCanvases(); drawOverlay(); requestRender(false); });
}
function switchTab(t) {
  if (isHidden('t.' + t) && t !== 'edit') return;
  const wasFrame = frameMode();
  if (S.tool) { S.tool = null; S.quadDraft = null; }
  hint(null);
  S.tab = t; geoCache.key = null;
  $$('#rail button[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'); });
  if (wasFrame !== frameMode()) resetView();
  $('#panelBody').scrollTop = 0;
  renderPanel(); requestRender(false); drawOverlay(); updateCursor();
  if (t === 'brush') { hint('Male ins Bild zum ' + (S.prefs.db.mode === 'burn' ? 'Abdunkeln' : S.prefs.db.mode === 'erase' ? 'Radieren' : 'Aufhellen') + ' · Alt: radieren · [ ] Größe'); setTimeout(() => { if (S.tab === 'brush') hint(null); }, 3500); }
}
const PANEL_TITLES = { edit: 'Bearbeiten', crop: 'Zuschneiden & Perspektive', masks: 'Masken & lokale Korrekturen', brush: 'Pinsel', presets: 'Presets & Verlauf' };
function renderPanel() {
  const body = $('#panelBody'); const keep = body.scrollTop; const sameTab = body.dataset.tab === S.tab;
  ctlReg.clear(); curveDrawFns.clear(); pointInputsRefresh = () => {};
  body.innerHTML = ''; body.dataset.tab = S.tab;
  if (!S.img) { body.append(el('div', { class: 'note', text: 'Öffne ein Foto, um mit der Bearbeitung zu beginnen.' })); return; }
  if (!isMobile() || S.tab !== 'edit') {
    const head = el('div', { class: 'panel-title' }, el('h3', { text: PANEL_TITLES[S.tab] }));
    if (S.tab === 'edit') head.append(el('div', { class: 'row' }, iconBtn('copy', 'Einstellungen kopieren', copySettings), iconBtn('paste', 'Einstellungen einfügen', pasteSettings), iconBtn('reset', 'Alle Bearbeitungen zurücksetzen', resetAll)));
    body.append(head);
  }
  if (S.tab === 'edit') renderEditPanel(body);
  else if (S.tab === 'crop') renderCropPanel(body);
  else if (S.tab === 'masks') renderMaskPanel(body);
  else if (S.tab === 'brush') renderBrushPanel(body);
  else if (S.tab === 'presets') renderPresetPanel(body);
  if (sameTab) body.scrollTop = keep;
}

/* ---------- Beispielbild (prozedural erzeugt, keine Fremddaten) ---------- */
async function makeSample() {
  const W = 2400, H = 1600; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sky = c.createLinearGradient(0, 0, 0, H * 0.62); sky.addColorStop(0, '#1b3f86'); sky.addColorStop(0.45, '#5f86c4'); sky.addColorStop(0.8, '#e8b58f'); sky.addColorStop(1, '#f7d6a8');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  const sun = c.createRadialGradient(W * 0.7, H * 0.3, 10, W * 0.7, H * 0.3, H * 0.6); sun.addColorStop(0, 'rgba(255,252,238,1)'); sun.addColorStop(0.07, 'rgba(255,250,230,1)'); sun.addColorStop(0.3, 'rgba(255,214,160,0.55)'); sun.addColorStop(1, 'rgba(255,190,140,0)');
  c.fillStyle = sun; c.fillRect(0, 0, W, H);
  c.filter = 'blur(18px)';
  for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(255,${230 + rnd() * 20 | 0},${215 + rnd() * 30 | 0},${0.25 + rnd() * 0.35})`; c.beginPath(); c.ellipse(rnd() * W, H * (0.08 + rnd() * 0.3), 120 + rnd() * 260, 22 + rnd() * 40, 0, 0, 7); c.fill(); }
  c.filter = 'none';
  const ridge = (base, amp, rough, col, col2) => {
    const n = 257; const pts = new Float32Array(n); pts[0] = rnd(); pts[n - 1] = rnd();
    const sub = (a, b, d) => { if (b - a < 2) return; const m = (a + b) >> 1; pts[m] = (pts[a] + pts[b]) / 2 + (rnd() - 0.5) * d; sub(a, m, d * rough); sub(m, b, d * rough); };
    sub(0, n - 1, 1);
    const g = c.createLinearGradient(0, base - amp, 0, H * 0.66); g.addColorStop(0, col); g.addColorStop(1, col2);
    c.fillStyle = g; c.beginPath(); c.moveTo(0, H);
    for (let i = 0; i < n; i++) c.lineTo(i / (n - 1) * W, base - pts[i] * amp);
    c.lineTo(W, H); c.closePath(); c.fill();
  };
  ridge(H * 0.53, H * 0.24, 0.55, '#8a86b0', '#c0a2a4');
  ridge(H * 0.58, H * 0.18, 0.58, '#4d5f8c', '#6b6b8e');
  ridge(H * 0.63, H * 0.14, 0.6, '#2c3d4a', '#34443f');
  const lakeTop = H * 0.64;
  c.save(); c.beginPath(); c.rect(0, lakeTop, W, H - lakeTop); c.clip();
  c.translate(0, lakeTop * 2); c.scale(1, -1); c.globalAlpha = 0.55; c.drawImage(cv, 0, 0); c.restore();
  const lake = c.createLinearGradient(0, lakeTop, 0, H); lake.addColorStop(0, 'rgba(40,70,110,0.35)'); lake.addColorStop(1, 'rgba(8,20,32,0.85)'); c.fillStyle = lake; c.fillRect(0, lakeTop, W, H - lakeTop);
  c.strokeStyle = 'rgba(255,235,200,0.25)'; c.lineWidth = 2;
  for (let i = 0; i < 90; i++) { const y = lakeTop + 10 + rnd() * (H * 0.22); const x = W * 0.7 + (rnd() - 0.5) * 380 * (1 + (y - lakeTop) / 300); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 30 + rnd() * 90, y); c.stroke(); }
  const shore = c.createLinearGradient(0, H * 0.8, 0, H); shore.addColorStop(0, '#1d2a18'); shore.addColorStop(1, '#070a06');
  c.fillStyle = shore; c.beginPath(); c.moveTo(0, H * 0.83); for (let x = 0; x <= W; x += 40) c.lineTo(x, H * 0.84 + Math.sin(x / 170) * 16 + rnd() * 10); c.lineTo(W, H); c.lineTo(0, H); c.fill();
  const flower = ['#e8434a', '#f29a2e', '#f4d23a', '#c84fd6', '#ff6fa2', '#e8434a', '#3fa9f5'];
  for (let i = 0; i < 520; i++) { const x = rnd() * W, y = H * 0.87 + rnd() * H * 0.13; c.fillStyle = flower[(rnd() * flower.length) | 0]; c.globalAlpha = 0.65 + rnd() * 0.35; c.beginPath(); c.arc(x, y, 2 + rnd() * 5 * (y / H), 0, 7); c.fill(); }
  c.globalAlpha = 1;
  c.fillStyle = '#05080a';
  const tree = (x, y, hgt) => { c.fillRect(x - 6, y - hgt * 0.25, 12, hgt * 0.25); for (let l = 0; l < 9; l++) { const yy = y - hgt * 0.2 - l * hgt * 0.085, ww = hgt * 0.28 * (1 - l / 10); c.beginPath(); c.moveTo(x - ww, yy); c.lineTo(x + ww, yy); c.lineTo(x, yy - hgt * 0.16); c.fill(); } };
  tree(W * 0.08, H * 0.9, H * 0.72); tree(W * 0.16, H * 0.88, H * 0.5); tree(W * 0.94, H * 0.88, H * 0.42);
  const id = c.getImageData(0, 0, W, H); const dd = id.data;
  for (let i = 0; i < dd.length; i += 4) { const n = (rnd() - 0.5) * 9; dd[i] += n; dd[i + 1] += n + (rnd() - 0.5) * 4; dd[i + 2] += n + (rnd() - 0.5) * 5; }
  c.putImageData(id, 0, 0);
  return await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
}
async function loadSample() {
  const blob = await makeSample();
  return loadImage(blob, { name: 'Beispiel – Bergsee.jpg', type: 'image/jpeg', key: 'sample-v1', isSample: true });
}

/* ---------- Ereignisse ---------- */
function bindEvents() {
  const fi = $('#fileInput');
  $('#btnOpen').addEventListener('click', () => fi.click()); $('#btnOpen2').addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => { openFiles(fi.files); fi.value = ''; });
  $('#btnSample').addEventListener('click', loadSample);
  $('#btnUndo').addEventListener('click', undo); $('#btnRedo').addEventListener('click', redo);
  $('#btnBefore').addEventListener('click', toggleBefore);
  $('#btnCustomize').addEventListener('click', openCustomize);
  $('#btnMobile').addEventListener('click', () => applyMobile(!isMobile(), true));
  $('#btnExport').addEventListener('click', openExport);
  $('#btnZoomIn').addEventListener('click', () => setZoom(S.view.zoom * 1.5));
  $('#btnZoomOut').addEventListener('click', () => setZoom(S.view.zoom / 1.5));
  $('#zoomVal').addEventListener('click', () => setZoom(1));
  $('#btnZoom100').addEventListener('click', zoom100);
  $('#btnSplit').addEventListener('click', toggleSplit);
  $('#btnClip').addEventListener('click', () => { const on = !(S.clip.hi && S.clip.lo); S.clip.hi = S.clip.lo = on; updateClipBtns(); requestRender(false); });
  $('#clipL').addEventListener('click', () => { S.clip.lo = !S.clip.lo; updateClipBtns(); requestRender(false); });
  $('#clipR').addEventListener('click', () => { S.clip.hi = !S.clip.hi; updateClipBtns(); requestRender(false); });
  $$('#rail button[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  ['#panel', '#stage', '#app', '.workspace'].forEach((q) => { const n = $(q); n.addEventListener('scroll', () => { if (n.scrollTop || n.scrollLeft) { n.scrollTop = 0; n.scrollLeft = 0; } }); });
  const st = $('#stage');
  st.addEventListener('pointerdown', onPointerDown); st.addEventListener('pointermove', onPointerMove);
  st.addEventListener('pointerup', onPointerUp); st.addEventListener('pointercancel', onPointerUp);
  st.addEventListener('pointerleave', () => { if (S.pointer) { S.pointer.inside = false; drawOverlay(); } });
  st.addEventListener('wheel', onWheel, { passive: false });
  st.addEventListener('dblclick', (e) => { if (!S.img || S.tool || brushActive() || S.tab === 'crop' || (e.target.closest && e.target.closest('.hud,[data-h]'))) return; const p = stagePt(e); if (S.view.zoom > 1.01) setZoom(1); else { const dpr = window.devicePixelRatio || 1; setZoom(1 / (fitScale() * dpr), p[0], p[1]); } });
  st.addEventListener('contextmenu', (e) => { if (brushActive()) e.preventDefault(); });
  const app = $('#app');
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); app.classList.add('dropping'); } });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) app.classList.remove('dropping'); });
  window.addEventListener('drop', (e) => { e.preventDefault(); app.classList.remove('dropping'); if (e.dataTransfer && e.dataTransfer.files.length) openFiles(e.dataTransfer.files); });
  window.addEventListener('paste', (e) => { const f = e.clipboardData && Array.from(e.clipboardData.files || []).find((x) => /^image\//.test(x.type)); if (f) openFiles([f]); });
  let rz = 0;
  const onResize = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (S.prefs.mobile == null) { const want = autoMobile(); if (want !== isMobile()) { applyMobile(want, false); return; } } if (!S.img) return; clampView(); updateZoomLabel(); positionCanvases(); drawOverlay(); requestRender(true); }); };
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(st); else window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; updateCursor(); } if (e.key === 'Alt' && brushActive()) drawOverlay(); });
  window.addEventListener('blur', () => { spaceDown = false; });
}
function autoMobile() { return window.matchMedia('(max-width: 760px)').matches || (window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600); }
function toggleBefore() { S.before = !S.before; if (S.before) S.split = false; $('#btnBefore').classList.toggle('on', S.before); $('#btnBefore').setAttribute('aria-pressed', String(S.before)); $('#btnSplit').classList.remove('on'); requestRender(false); drawOverlay(); }
function toggleSplit() { S.split = !S.split; if (S.split) { S.before = false; $('#btnBefore').classList.remove('on'); } $('#btnSplit').classList.toggle('on', S.split); beforeCache.key = null; requestRender(false); drawOverlay(); }
function updateClipBtns() { $('#clipL').classList.toggle('on', S.clip.lo); $('#clipR').classList.toggle('on', S.clip.hi); $('#btnClip').classList.toggle('on', S.clip.lo || S.clip.hi); }
function onKey(e) {
  const tgt = e.target; const typing = tgt && (tgt.tagName === 'INPUT' && tgt.type !== 'range' && tgt.type !== 'checkbox' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { if (openModalRef) { closeModal(); return; } if (S.tool) { setTool(null); return; } if (S.before) toggleBefore(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#fileInput').click(); return; }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); openExport(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copySettings(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSettings(); return; }
  if (mod || e.altKey) { if (e.key === 'Alt' && brushActive()) drawOverlay(); return; }
  if (openModalRef) return;
  if (e.code === 'Space') { if (!spaceDown) { spaceDown = true; $('#stage').style.cursor = 'grab'; } e.preventDefault(); return; }
  const k = e.key;
  if (k === '\\' || k === '#') { toggleBefore(); return; }
  const tabs = { e: 'edit', r: 'crop', m: 'masks', b: 'brush', p: 'presets' };
  if (tabs[k.toLowerCase()] && !tgt.closest('.seg')) { switchTab(tabs[k.toLowerCase()]); return; }
  if (k === 'y' || k === 'Y') { toggleSplit(); return; }
  if (k === 'j' || k === 'J') { $('#btnClip').click(); return; }
  if (k === 'o' || k === 'O') { S.showMaskOverlay = !S.showMaskOverlay; requestRender(false); if (S.tab === 'masks') renderPanel(); return; }
  if (k === '0') { setZoom(1); return; }
  if (k === '1') { zoom100(); return; }
  if (k === '+' || k === '=') { setZoom(S.view.zoom * 1.5); return; }
  if (k === '-') { setZoom(S.view.zoom / 1.5); return; }
  if (k === '[' || k === ']') { const b = S.prefs.brush; b.size = clamp(b.size + (k === ']' ? 4 : -4), 1, 100); savePrefs(); refreshControls(); drawOverlay(); return; }
}

/* ---------- Start ---------- */
async function init() {
  hydrateIcons(document);
  initDownloads();
  bindEvents(); updateUndo();
  applyMobile(S.prefs.mobile == null ? autoMobile() : S.prefs.mobile, false);
  applyTabVisibility();
  let ok = false;
  if (S.prefs.restore) {
    try {
      const ses = await idbGet('session');
      if (ses && ses.blob) { ok = await loadImage(ses.blob, { name: ses.name, type: ses.type, key: ses.key, isSample: ses.isSample }, { params: ses.params }); if (ok && !ses.isSample) toast('Letzte Sitzung wiederhergestellt: ' + ses.name, { ms: 2600 }); }
    } catch (e) { ok = false; }
  }
  if (!ok) { try { ok = await loadSample(); } catch (e) { ok = false; } }
  if (!ok) { $('#empty').hidden = false; renderPanel(); }
  document.documentElement.dataset.ready = '1';
}
init();
