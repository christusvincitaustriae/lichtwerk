/* ===== Werkzeuge: Zuschnitt, Masken, Pinsel, Overlay, Zeiger ===== */
function setTool(t) {
  if (S.tool === 'quad' && t !== 'quad') { S.quadDraft = null; geoCache.key = null; resetView(); }
  S.tool = t;
  if (t === 'quad') { geoCache.key = null; S.quadDraft = S.params.geo.quad ? S.params.geo.quad.slice() : [0.12, 0.12, 0.88, 0.12, 0.88, 0.88, 0.12, 0.88]; resetView(); }
  const H = {
    wbpick: 'Klicke auf eine Stelle, die neutral grau oder weiß sein soll · Esc beendet',
    tat: 'Auf eine Farbe klicken und nach oben oder unten ziehen · Esc beendet',
    straighten: 'Ziehe eine Linie entlang des Horizonts oder einer Kante',
    newLinear: 'Ziehe im Bild, um den Verlauf festzulegen',
    newRadial: 'Ziehe vom Mittelpunkt nach außen',
    quad: 'Ziehe die vier Punkte auf die Ecken einer Fläche, die rechteckig werden soll',
  };
  hint(H[t] || null);
  $('#stage').dataset.tool = t || '';
  renderPanel(); requestRender(false); drawOverlay(); updateCursor();
}
function brushActive() {
  if (S.tab === 'brush') return true;
  if (S.tab === 'masks') { const m = selMask(); return !!(m && m.type === 'brush' && !S.tool); }
  return false;
}
function updateCursor() {
  const st = $('#stage'); let c = 'default';
  if (S.tool === 'wbpick' || S.tool === 'tat' || S.tool === 'straighten' || S.tool === 'newLinear' || S.tool === 'newRadial') c = 'crosshair';
  else if (brushActive()) c = 'none';
  else if (S.view.zoom > 1.001) c = 'grab';
  st.style.cursor = c;
}
function selMask() { return S.params.masks.find((m) => m.id === S.selMask) || null; }

/* ---------- Pinsel-Raster ---------- */
function rasterDims() { const L = 1600, L0 = Math.max(S.img.W, S.img.H); return [Math.max(8, Math.round(S.img.W / L0 * L)), Math.max(8, Math.round(S.img.H / L0 * L))]; }
function strokeSig(m) { return (m.strokes || []).length + '|' + (m.strokes || []).map((s) => s.p.length + (s.e ? 'e' : '')).join(','); }
function syncBrushRasters(force) {
  if (!S.img) return;
  const [mw, mh] = rasterDims(); const ids = new Set();
  for (const m of S.params.masks) {
    if (m.type !== 'brush') continue; ids.add(m.id);
    const r = S.brushRasters.get(m.id); const sig = strokeSig(m);
    if (force || !r || r.sig !== sig || r.w !== mw) { const nr = PE.rasterizeBrush(m, mw, mh); nr.sig = sig; S.brushRasters.set(m.id, nr); }
  }
  for (const k of Array.from(S.brushRasters.keys())) if (!ids.has(k)) S.brushRasters.delete(k);
}
function brushRadiusFrac() { return 0.0025 * Math.pow(100, S.prefs.brush.size / 100); }
function getDBMask(kind) {
  let m = S.params.masks.find((q) => q.db === kind);
  if (!m) {
    m = { id: uid(), name: kind === 'dodge' ? 'Aufhellen (Pinsel)' : 'Abdunkeln (Pinsel)', type: 'brush', db: kind, enabled: true, invert: false, opacity: 100, strokes: [], adj: { exposure: kind === 'dodge' ? S.prefs.db.dodge : -S.prefs.db.burn } };
    S.params.masks.push(m);
  }
  return m;
}
let paint = null;
function startStroke(sx, sy, altErase) {
  const b = S.prefs.brush; let targets = []; let erase = false;
  if (S.tab === 'brush') {
    const mode = altErase ? 'erase' : S.prefs.db.mode;
    if (mode === 'erase') { erase = true; targets = S.params.masks.filter((m) => m.db); if (!targets.length) return; }
    else targets = [getDBMask(mode)];
  } else { const m = selMask(); if (!m || m.type !== 'brush') return; targets = [m]; erase = altErase || !!S.maskErase; }
  const p = o2srcN(...s2o(sx, sy));
  const st = { p: [+p[0].toFixed(5), +p[1].toFixed(5)], s: +brushRadiusFrac().toFixed(5), h: b.hard / 100, f: b.flow / 100, o: b.opacity / 100, e: erase };
  const [mw, mh] = rasterDims();
  paint = { st, mw, mh, targets: targets.map((m) => {
    let r = S.brushRasters.get(m.id); if (!r || r.w !== mw) { r = PE.rasterizeBrush(m, mw, mh); r.sig = strokeSig(m); S.brushRasters.set(m.id, r); }
    return { m, r, before: new Float32Array(r.data), buf: new Float32Array(mw * mh), last: null, idx: 0 };
  }) };
  paintStep();
}
function paintStep() {
  if (!paint) return;
  const { st, mw, mh } = paint;
  for (const t of paint.targets) {
    const bb = [mw, mh, -1, -1];
    t.last = PE.strokeDabs(st, mw, mh, t.idx, t.last, (x, y, r) => PE.stampDab(t.buf, mw, mh, x, y, r, st.h, st.f, bb));
    t.idx = st.p.length;
    if (bb[2] >= 0) PE.compositeStroke(t.r.data, t.before, t.buf, st, bb, mw);
  }
  requestRender(true);
}
function paintMove(sx, sy) {
  if (!paint) return; const p = o2srcN(...s2o(sx, sy)); paint.st.p.push(+p[0].toFixed(5), +p[1].toFixed(5)); paintStep();
}
function endStroke() {
  if (!paint) return;
  for (const t of paint.targets) { t.m.strokes = t.m.strokes || []; t.m.strokes.push(deep(paint.st)); t.r.sig = strokeSig(t.m); }
  const erase = paint.st.e; paint = null;
  commit(erase ? 'Pinsel: radiert' : 'Pinselstrich'); requestRender(false);
  if (S.tab === 'masks' || S.tab === 'brush') renderPanel();
}

/* ---------- Zuschnitt ---------- */
const RATIOS = [['free', 'Frei'], ['orig', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:2', '3:2'], ['16:9', '16:9']];
function ratioValue(r) {
  const g = G(); if (!r || r === 'free') return null;
  if (r === 'orig') return g.FW / g.FH;
  const [a, b] = r.split(':').map(Number); let v = a / b;
  if (S.params.geo.ratioPortrait) v = 1 / v; return v;
}
function applyRatio() {
  const r = ratioValue(S.params.geo.ratio); if (!r) return;
  const g = G(); const c = S.params.geo.crop; const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  let w = 1, h = (w * g.FW) / (r * g.FH); if (h > 1) { h = 1; w = (h * g.FH * r) / g.FW; }
  const x = clamp(cx - w / 2, 0, 1 - w), y = clamp(cy - h / 2, 0, 1 - h);
  S.params.geo.crop = { x, y, w, h };
}
function dragCrop(h, start, cur) {
  const g = G(); const c0 = start.crop; const dx = (cur[0] - start.p[0]) / g.FW, dy = (cur[1] - start.p[1]) / g.FH;
  let x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h; const MIN = 0.03;
  if (h === 'move') { const nx = clamp(x0 + dx, 0, 1 - c0.w), ny = clamp(y0 + dy, 0, 1 - c0.h); S.params.geo.crop = { x: nx, y: ny, w: c0.w, h: c0.h }; return; }
  if (h.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN); if (h.includes('e')) x1 = clamp(x1 + dx, x0 + MIN, 1);
  if (h.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN); if (h.includes('s')) y1 = clamp(y1 + dy, y0 + MIN, 1);
  const r = ratioValue(S.params.geo.ratio);
  if (r) {
    let w = x1 - x0, hh = y1 - y0; const wantH = (w * g.FW) / (r * g.FH), wantW = (hh * g.FH * r) / g.FW;
    const edgeOnlyV = (h === 'n' || h === 's'), edgeOnlyH = (h === 'e' || h === 'w');
    if (edgeOnlyV) w = wantW; else if (edgeOnlyH) hh = wantH; else if (wantH > hh) hh = wantH; else w = wantW;
    // Grenzen einhalten
    const maxW = h.includes('w') ? c0.x + c0.w : h.includes('e') ? 1 - c0.x : 1, maxH = h.includes('n') ? c0.y + c0.h : h.includes('s') ? 1 - c0.y : 1;
    if (w > maxW) { w = maxW; hh = (w * g.FW) / (r * g.FH); } if (hh > maxH) { hh = maxH; w = (hh * g.FH * r) / g.FW; }
    if (edgeOnlyV || edgeOnlyH) { const cxm = (c0.x + c0.w / 2), cym = (c0.y + c0.h / 2); if (edgeOnlyV) { x0 = clamp(cxm - w / 2, 0, 1 - w); x1 = x0 + w; } else { y0 = clamp(cym - hh / 2, 0, 1 - hh); y1 = y0 + hh; } }
    if (h.includes('w')) x0 = x1 - w; else if (h.includes('e')) x1 = x0 + w;
    if (h.includes('n')) y0 = y1 - hh; else if (h.includes('s')) y1 = y0 + hh;
    if (edgeOnlyV) { if (h === 'n') y0 = y1 - hh; else y1 = y0 + hh; }
    if (edgeOnlyH) { if (h === 'w') x0 = x1 - w; else x1 = x0 + w; }
  }
  S.params.geo.crop = { x: clamp(x0, 0, 1), y: clamp(y0, 0, 1), w: clamp(x1 - x0, MIN, 1), h: clamp(y1 - y0, MIN, 1) };
}
function rotate90(dir) {
  const c = S.params.geo.crop; S.params.geo.rot90 = ((S.params.geo.rot90 || 0) + dir + 4) % 4;
  S.params.geo.crop = dir > 0 ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
  geoCache.key = null; commit(dir > 0 ? 'Rechts drehen' : 'Links drehen'); resetView(); requestRender(false); drawOverlay();
}
function advSection(key, title, kids, defOpen) {
  const open = S.prefs.advOpen[key] != null ? S.prefs.advOpen[key] : (defOpen || S.prefs.advDefault);
  const adv = el('div', { class: 'adv' + (open ? ' open' : '') });
  const at = el('button', { type: 'button', class: 'adv-t', 'aria-expanded': String(!!open) }); at.append(iconEl('chevR'), title || 'Erweitert');
  at.addEventListener('click', () => { const o = !adv.classList.contains('open'); adv.classList.toggle('open', o); at.setAttribute('aria-expanded', String(o)); S.prefs.advOpen[key] = o; savePrefs(); });
  adv.append(at, el('div', { class: 'adv-b' }, ...kids.filter(Boolean)));
  return adv;
}
function renderCropPanel(body) {
  if (S.tool === 'quad') {
    body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('crop'), '4-Punkt-Perspektive'),
      el('div', { class: 'note', text: 'Setze die vier Punkte auf die Ecken einer Fläche, die im Ergebnis rechteckig sein soll, z. B. ein Gebäude, ein Dokument oder ein Bild an der Wand.' }),
      el('div', { class: 'row' }, btn('Übernehmen', () => { S.params.geo.quad = S.quadDraft.map((x) => +x.toFixed(5)); S.params.geo.crop = { x: 0, y: 0, w: 1, h: 1 }; setTool(null); commit('4-Punkt-Perspektive'); requestRender(false); }, 'primary small', 'check'),
        btn('Abbrechen', () => setTool(null), 'small'))));
    return;
  }
  const geo = S.params.geo;
  const chips = el('div', { class: 'chips' });
  RATIOS.forEach(([v, l]) => { const c = el('button', { type: 'button', class: 'chip' + ((geo.ratio || 'free') === v ? ' on' : ''), text: l }); c.addEventListener('click', () => { geo.ratio = v; applyRatio(); commit('Seitenverhältnis ' + l); renderPanel(); drawOverlay(); }); chips.append(c); });
  const swapB = iconBtn('rotR', 'Hoch-/Querformat tauschen', () => { geo.ratioPortrait = !geo.ratioPortrait; applyRatio(); commit('Ausrichtung getauscht'); renderPanel(); drawOverlay(); });
  body.append(el('div', { class: 'card' }, el('div', { class: 'row between' }, el('h4', {}, iconEl('crop'), 'Seitenverhältnis'), swapB), chips));
  if (!isHidden('c.angle') || !isHidden('c.rot')) {
    body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('straighten'), 'Ausrichten'),
      isHidden('c.angle') ? null : vSlider(d('angle', 'Winkel', -45, 45, { step: 0.1, fmt: 'sdeg' })),
      el('div', { class: 'row' },
        btn('Linie ziehen', () => setTool(S.tool === 'straighten' ? null : 'straighten'), 'small' + (S.tool === 'straighten' ? ' primary' : ''), 'straighten'),
        iconBtn('rotL', 'Links drehen (90°)', () => rotate90(-1)), iconBtn('rotR', 'Rechts drehen (90°)', () => rotate90(1)),
        iconBtn('flipH', 'Horizontal spiegeln', () => { geo.flipH = !geo.flipH; geoCache.key = null; commit('Horizontal gespiegelt'); requestRender(false); drawOverlay(); }),
        iconBtn('flipV', 'Vertikal spiegeln', () => { geo.flipV = !geo.flipV; geoCache.key = null; commit('Vertikal gespiegelt'); requestRender(false); drawOverlay(); }))));
  }
  if (!isHidden('c.persp')) {
    body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('px'), 'Perspektive'),
      vSlider(d('vert', 'Vertikal', -100, 100)), vSlider(d('horz', 'Horizontal', -100, 100)),
      advSection('crop', 'Erweitert', [
        vSlider(d('geoScale', 'Skalierung', 50, 150, { zero: 100, fmt: 'pct' })), vSlider(d('geoAspect', 'Seitenverhältnis', -100, 100)),
        vSlider(d('offX', 'Versatz X', -100, 100)), vSlider(d('offY', 'Versatz Y', -100, 100)),
        sw('Automatisch füllen (keine leeren Ränder)', !!S.params.v.autoFill, (on) => { S.params.v.autoFill = on ? 1 : 0; geoCache.key = null; commit('Auto-Füllen'); requestRender(false); drawOverlay(); }),
        el('div', { class: 'subhead', text: '4-Punkt-Korrektur' }),
        el('div', { class: 'row' }, btn(geo.quad ? 'Punkte bearbeiten' : '4 Punkte setzen', () => setTool('quad'), 'small', 'target'), geo.quad ? btn('Entfernen', () => { geo.quad = null; geoCache.key = null; commit('4-Punkt-Korrektur entfernt'); renderPanel(); requestRender(false); drawOverlay(); }, 'small danger', 'trash') : null),
      ])));
  }
  const g = G();
  body.append(el('div', { class: 'row between' }, el('span', { class: 'muted', text: `Ausgabe: ${Math.round(g.crop.w)} × ${Math.round(g.crop.h)} px` }),
    el('div', { class: 'row' }, btn('Zurücksetzen', () => { S.params.geo = PE.defaultParams().geo; PE.GROUP_KEYS.geo.forEach((k) => (S.params.v[k] = PE.DEF[k])); geoCache.key = null; commit('Geometrie zurückgesetzt'); resetView(); renderPanel(); requestRender(false); drawOverlay(); }, 'small', 'reset'),
      btn('Fertig', () => switchTab('edit'), 'small primary', 'check'))));
}

/* ---------- Masken ---------- */
const MASK_TYPES = { linear: ['Verlauf', 'linear'], radial: ['Radial', 'radial'], brush: ['Pinsel', 'brush'], luma: ['Helligkeit', 'luma'] };
function newMask(type, geom, adj, name) {
  const n = S.params.masks.filter((m) => m.type === type && !m.db).length + 1;
  const m = { id: uid(), name: name || MASK_TYPES[type][0] + ' ' + n, type, enabled: true, invert: false, opacity: 100, geom: geom || {}, adj: Object.assign({}, adj || {}), range: { on: false, lo: 0, hi: 100, feather: 15, smooth: 30 } };
  if (type === 'brush') m.strokes = [];
  S.params.masks.push(m); S.selMask = m.id; return m;
}
function addMaskByButton(type) {
  if (type === 'linear') setTool('newLinear');
  else if (type === 'radial') setTool('newRadial');
  else if (type === 'brush') { newMask('brush', {}, { exposure: 0.5 }); commit('Pinselmaske'); setTool(null); hint('Male im Bild · Alt-Taste: radieren · [ ] Pinselgröße'); setTimeout(() => hint(null), 3500); }
  else if (type === 'luma') { newMask('luma', { lo: 0.7, hi: 1, feather: 0.1, smooth: 0.6 }, { exposure: -0.5 }); commit('Helligkeitsmaske'); renderPanel(); requestRender(false); }
}
const LOCAL_DEFS = [
  { k: 'exposure', l: 'Belichtung', min: -4, max: 4, step: 0.01, fmt: 'ev', track: TRACKS.exposure, zero: 0 },
  { k: 'contrast', l: 'Kontrast', min: -100, max: 100 }, { k: 'highlights', l: 'Lichter', min: -100, max: 100 }, { k: 'shadows', l: 'Tiefen', min: -100, max: 100 },
  { k: 'saturation', l: 'Sättigung', min: -100, max: 100 }, { k: 'clarity', l: 'Klarheit', min: -100, max: 100 },
];
const LOCAL_ADV = [
  { k: 'temp', l: 'Temperatur', min: -100, max: 100, track: TRACKS.temp }, { k: 'tint', l: 'Tönung', min: -100, max: 100, track: TRACKS.tint },
  { k: 'dehaze', l: 'Dunst entfernen', min: -100, max: 100 },
  { k: 'colorHue', l: 'Farbe: Ton', min: 0, max: 360, fmt: 'deg', track: TRACKS.hue, def: 35, zero: 0 }, { k: 'colorAmt', l: 'Farbe: Stärke', min: 0, max: 100, track: () => { const m = selMask(); return satTrack(m ? (m.adj.colorHue != null ? m.adj.colorHue : 35) : 35); } },
];
function mSlider(m, def, obj, label) {
  const tgt = obj || 'adj';
  const dd = Object.assign({ def: def.def != null ? def.def : 0 }, def, { k: 'm.' + tgt + '.' + def.k });
  return slider(dd, {
    get: () => { const o = tgt === 'root' ? m : m[tgt]; const v = o ? o[def.k] : undefined; return v == null ? dd.def : v; },
    set: (v, inter) => { const o = tgt === 'root' ? m : (m[tgt] = m[tgt] || {}); o[def.k] = v; if (m.db && tgt === 'adj' && def.k === 'exposure') { S.prefs.db[m.db] = Math.abs(v); savePrefs(); } requestRender(inter); if (!inter) drawOverlay(); },
    label: (label || m.name) + ': ' + def.l,
  });
}
function brushControls(forMask) {
  const b = S.prefs.brush;
  const pd = (k, l, min, max, extra) => slider(Object.assign({ k: 'brush.' + k, l, min, max, def: PREF_DEF.brush[k] }, extra || {}), { get: () => b[k], set: (v) => { b[k] = v; savePrefs(); drawOverlay(); }, label: 'Pinsel ' + l });
  const basic = [pd('size', 'Größe', 1, 100), pd('hard', 'Härte', 0, 100), pd('opacity', 'Deckkraft', 1, 100)];
  const adv = [pd('flow', 'Fluss', 1, 100)];
  return { basic, adv };
}
function renderMaskPanel(body) {
  const add = el('div', { class: 'card' }, el('h4', {}, iconEl('plus'), 'Neue Maske'));
  const row = el('div', { class: 'chips' });
  Object.keys(MASK_TYPES).forEach((t) => { const [l, ic] = MASK_TYPES[t]; if (isHidden('c.mask_' + t)) return; const c = el('button', { type: 'button', class: 'chip' + ((S.tool === 'newLinear' && t === 'linear') || (S.tool === 'newRadial' && t === 'radial') ? ' on' : ''), 'data-add': t }); c.append(iconEl(ic), l); c.addEventListener('click', () => addMaskByButton(t)); row.append(c); });
  add.append(row); body.append(add);
  if (!isHidden('c.zones')) body.append(zonesCard());
  const masks = S.params.masks;
  if (masks.length) {
    const list = el('div', { class: 'list' });
    masks.forEach((m) => {
      const li = el('div', { class: 'li' + (m.id === S.selMask ? ' on' : '') + (m.enabled === false ? ' off' : ''), 'data-mask': m.id, role: 'button', tabindex: '0' });
      li.append(iconEl(m.db === 'burn' ? 'moon' : m.db === 'dodge' ? 'sun' : MASK_TYPES[m.type][1], 'ic'), el('span', { class: 'nm', text: m.name }));
      const ex = m.adj && m.adj.exposure; if (ex) li.append(el('span', { class: 'sub', text: FMT.ev(ex) + ' EV' }));
      li.append(iconBtn(m.enabled === false ? 'eyeOff' : 'eye', 'Maske ein-/ausblenden', (e) => { e.stopPropagation(); m.enabled = m.enabled === false; commit(m.name + (m.enabled ? ' eingeblendet' : ' ausgeblendet')); renderPanel(); requestRender(false); }));
      li.append(iconBtn('trash', 'Maske löschen', (e) => { e.stopPropagation(); S.params.masks = S.params.masks.filter((q) => q !== m); if (S.selMask === m.id) S.selMask = null; syncBrushRasters(); commit(m.name + ' gelöscht'); renderPanel(); requestRender(false); drawOverlay(); }));
      const pick = () => { S.selMask = S.selMask === m.id ? null : m.id; if (S.tool) S.tool = null; hint(null); renderPanel(); requestRender(false); drawOverlay(); updateCursor(); };
      li.addEventListener('click', pick); li.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
      list.append(li);
    });
    body.append(el('div', { class: 'card' }, el('div', { class: 'row between' }, el('h4', {}, iconEl('mask'), 'Masken'), sw('Überlagerung', S.showMaskOverlay, (on) => { S.showMaskOverlay = on; requestRender(false); })), list));
  } else {
    body.append(el('div', { class: 'note', style: { padding: '0 4px' }, text: 'Masken wirken nur auf einen Teil des Bildes. Lege oben eine Maske an oder lass Lichtwerk zu helle und zu dunkle Bereiche erkennen.' }));
  }
  const m = selMask(); if (!m) return;
  const card = el('div', { class: 'card', 'data-editor': m.id });
  const nameIn = el('input', { class: 'inp', value: m.name, 'aria-label': 'Maskenname' }); nameIn.addEventListener('change', () => { m.name = nameIn.value.trim() || m.name; commit('Maske umbenannt'); renderPanel(); });
  card.append(el('div', { class: 'row', style: { flexWrap: 'nowrap' } }, nameIn, iconBtn('dup', 'Maske duplizieren', () => { const c = deep(m); c.id = uid(); c.name = m.name + ' Kopie'; delete c.db; S.params.masks.push(c); S.selMask = c.id; syncBrushRasters(); commit('Maske dupliziert'); renderPanel(); requestRender(false); })));
  const g = m.geom || (m.geom = {});
  const gs = (k, l, min, max, extra, scale) => slider(Object.assign({ k: 'mg.' + k, l, min, max, def: 0 }, extra || {}), { get: () => (g[k] == null ? (extra && extra.def) || 0 : g[k] * (scale || 1)), set: (v, inter) => { g[k] = v / (scale || 1); requestRender(inter); drawOverlay(); }, label: m.name + ': ' + l });
  if (m.type === 'linear') card.append(el('div', { class: 'muted', text: 'Im Bild die Punkte ziehen: Volle Wirkung am ersten Punkt, keine Wirkung ab dem zweiten.' }));
  if (m.type === 'radial') card.append(gs('feather', 'Weiche Kante', 0, 100, { def: 50, zero: 0 }), gs('angle', 'Drehung', -90, 90, { fmt: 'deg' }));
  if (m.type === 'luma') card.append(gs('lo', 'Bereich von', 0, 100, {}, 100), gs('hi', 'Bereich bis', 0, 100, { def: 100, zero: 0 }, 100), gs('feather', 'Weiche Kante', 1, 50, { def: 10, zero: 0 }, 100), gs('smooth', 'Glättung', 0, 100, { def: 60, zero: 0 }, 100));
  if (m.type === 'brush') {
    card.append(seg([{ v: 'paint', l: 'Malen', icon: 'brush' }, { v: 'erase', l: 'Radieren', icon: 'eraser' }], S.maskErase ? 'erase' : 'paint', (v) => { S.maskErase = v === 'erase'; }, 'full'));
    const bc = brushControls(true); card.append(...bc.basic);
    card.append(advSection('mbrush', 'Pinsel erweitert', bc.adv.concat([btn('Alle Striche löschen', () => { m.strokes = []; syncBrushRasters(); commit('Pinselstriche gelöscht'); requestRender(false); }, 'small danger', 'trash')])));
  }
  card.append(sw('Invertieren', !!m.invert, (on) => { m.invert = on; commit(m.name + (on ? ' invertiert' : ' nicht invertiert')); requestRender(false); }), mSlider(m, { k: 'opacity', l: 'Deckkraft', min: 0, max: 100, def: 100, zero: 0 }, 'root'));
  const rg = m.range || (m.range = { on: false, lo: 0, hi: 100, feather: 15, smooth: 30 });
  card.append(advSection('mrange', 'Bereichsmaske (Luminanz)', [
    sw('Auf Helligkeitsbereich begrenzen', !!rg.on, (on) => { rg.on = on; commit('Bereichsmaske'); requestRender(false); }),
    mSlider(m, { k: 'lo', l: 'Von', min: 0, max: 100 }, 'range'), mSlider(m, { k: 'hi', l: 'Bis', min: 0, max: 100, def: 100, zero: 0 }, 'range'),
    mSlider(m, { k: 'feather', l: 'Weiche Kante', min: 1, max: 50, def: 15, zero: 0 }, 'range'), mSlider(m, { k: 'smooth', l: 'Glättung', min: 0, max: 100, def: 30, zero: 0 }, 'range'),
  ]));
  body.append(card);
  const adj = el('div', { class: 'card' }, el('div', { class: 'row between' }, el('h4', {}, iconEl('sliders'), 'Korrekturen'), iconBtn('reset', 'Korrekturen zurücksetzen', () => { m.adj = {}; commit('Maskenkorrekturen zurückgesetzt'); renderPanel(); requestRender(false); })));
  LOCAL_DEFS.forEach((dd) => { if (!isHidden('c.local_' + dd.k)) adj.append(mSlider(m, dd)); });
  adj.append(advSection('mlocal', 'Erweitert', LOCAL_ADV.filter((dd) => !isHidden('c.local_' + dd.k)).map((dd) => mSlider(m, dd))));
  body.append(adj);
}
function zonesCard() {
  const card = el('div', { class: 'card' }, el('h4', {}, iconEl('scan'), 'Problemzonen erkennen'));
  const z = S.zones;
  const run = () => {
    const t0 = performance.now();
    S.zones = PE.detectZones(PE.effectiveParams(S.params), { fullW: S.img.W, fullH: S.img.H, proxy: S.proxy });
    S.zones.ms = Math.round(performance.now() - t0); renderPanel();
  };
  if (!z) {
    card.append(el('div', { class: 'note', text: 'Findet zu helle und zu dunkle Bildbereiche und schlägt passende Masken mit Korrekturwerten vor.' }), btn('Bild analysieren', run, 'small', 'scan'));
    return card;
  }
  const cv = el('canvas', { class: 'zones-thumb', width: z.w, height: z.h, 'aria-label': 'Erkannte Bereiche: rot zu hell, blau zu dunkel' });
  cv.getContext('2d').putImageData(new ImageData(z.overlay, z.w, z.h), 0, 0);
  card.append(cv, el('div', { class: 'legend' }, el('span', {}, el('i', { style: { background: '#ff5a5a' } }), `Sehr hell ${pctDE(z.bright, 1)}`), el('span', {}, el('i', { style: { background: '#5a8cff' } }), `Sehr dunkel ${pctDE(z.dark, 1)}`)));
  card.append(el('div', { class: 'muted', text: `Beschnitten: Lichter ${pctDE(z.clipped)} · Tiefen ${pctDE(z.black)}` }));
  if (!z.suggestions.length) card.append(el('div', { class: 'note', text: 'Keine auffälligen Bereiche gefunden. Die Belichtung ist ausgewogen.' }));
  const apply = (sg) => { newMask('luma', deep(sg.geom), deep(sg.adj), sg.name); };
  z.suggestions.forEach((sg) => {
    const parts = Object.keys(sg.adj).map((k) => (k === 'exposure' ? `Belichtung ${FMT.ev(sg.adj.exposure)}` : k === 'highlights' ? `Lichter ${FMT.int(sg.adj.highlights)}` : `Tiefen ${FMT.int(sg.adj.shadows)}`));
    card.append(el('div', { class: 'li', style: { cursor: 'default' } }, iconEl(sg.kind === 'bright' ? 'sun' : 'moon', 'ic'), el('div', { class: 'nm' }, el('div', { text: sg.name }), el('div', { class: 'sub', text: parts.join(' · ') })), btn('Übernehmen', () => { apply(sg); commit('Vorschlag: ' + sg.name); renderPanel(); requestRender(false); }, 'small')));
  });
  card.append(el('div', { class: 'row' }, z.suggestions.length > 1 ? btn('Alle übernehmen', () => { z.suggestions.forEach(apply); commit('Alle Vorschläge übernommen'); renderPanel(); requestRender(false); }, 'small primary', 'check') : null, btn('Neu analysieren', run, 'small ghost', 'reset'), el('span', { class: 'muted', text: z.ms + ' ms' })));
  return card;
}

/* ---------- Abwedeln & Nachbelichten ---------- */
function renderBrushPanel(body) {
  const db = S.prefs.db;
  const card = el('div', { class: 'card' }, el('h4', {}, iconEl('brush'), 'Abwedeln & Nachbelichten'));
  card.append(seg([{ v: 'dodge', l: 'Aufhellen', icon: 'sun' }, { v: 'burn', l: 'Abdunkeln', icon: 'moon' }, { v: 'erase', l: 'Radieren', icon: 'eraser' }], db.mode, (v) => { db.mode = v; savePrefs(); requestRender(false); drawOverlay(); }, 'full'));
  const strength = (kind, l) => slider({ k: 'db.' + kind, l, min: 0, max: 2, step: 0.05, fmt: 'dec2', def: 0.6 }, {
    get: () => { const m = S.params.masks.find((q) => q.db === kind); return m ? Math.abs(m.adj.exposure || 0) : db[kind]; },
    set: (v, inter) => { db[kind] = v; savePrefs(); const m = S.params.masks.find((q) => q.db === kind); if (m) { m.adj.exposure = kind === 'dodge' ? v : -v; requestRender(inter); } },
    label: l,
  });
  card.append(strength('dodge', 'Hell (EV)'), strength('burn', 'Dunkel (EV)'));
  const bc = brushControls(false); card.append(...bc.basic);
  card.append(advSection('dbadv', 'Erweitert', bc.adv.concat([
    sw('Bemalte Bereiche anzeigen', !!db.showMask, (on) => { db.showMask = on; S.showMaskOverlay = true; savePrefs(); requestRender(false); }),
    btn('Alle Pinselstriche löschen', () => { S.params.masks = S.params.masks.filter((m) => !m.db); syncBrushRasters(); commit('Abwedeln & Nachbelichten gelöscht'); renderPanel(); requestRender(false); }, 'small danger', 'trash'),
  ])));
  const n = S.params.masks.filter((m) => m.db).reduce((a, m) => a + (m.strokes || []).length, 0);
  card.append(el('div', { class: 'muted', text: n ? `${n} Pinselstrich${n === 1 ? '' : 'e'} · Alt-Taste: radieren · [ ] Größe` : 'Male direkt ins Bild. Alt-Taste: radieren · [ ] ändert die Größe.' }));
  body.append(card);
}

/* ---------- Overlay (SVG) ---------- */
function drawOverlay() {
  const svg = $('#overlay'); if (!S.img) { svg.innerHTML = ''; return; }
  const st = stageSize(); let h = '';
  const P2 = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  const handle = (id, p, r) => `<circle class="hnd hit" data-h="${id}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r || 6}"/>`;
  if (S.tab === 'crop' && S.tool !== 'quad') {
    const g = G(); const c = S.params.geo.crop;
    const a = o2s(c.x * g.FW, c.y * g.FH), b = o2s((c.x + c.w) * g.FW, (c.y + c.h) * g.FH);
    const o0 = o2s(0, 0), o1 = o2s(g.FW, g.FH);
    h += `<path class="shade" d="M${o0[0]},${o0[1]}H${o1[0]}V${o1[1]}H${o0[0]}Z M${a[0]},${a[1]}V${b[1]}H${b[0]}V${a[1]}Z"/>`;
    const w = b[0] - a[0], hh = b[1] - a[1];
    for (let i = 1; i < 3; i++) h += `<path class="grid" d="M${a[0] + w * i / 3},${a[1]}V${b[1]}M${a[0]},${a[1] + hh * i / 3}H${b[0]}"/>`;
    h += `<rect class="hit" data-h="c-move" x="${a[0]}" y="${a[1]}" width="${Math.max(0, w)}" height="${Math.max(0, hh)}" fill="transparent" style="cursor:move"/>`;
    h += `<rect class="ln" x="${a[0]}" y="${a[1]}" width="${w}" height="${hh}"/>`;
    const L = Math.min(22, w / 3, hh / 3);
    h += `<path class="ln" style="stroke-width:3.5" d="M${a[0]},${a[1] + L}V${a[1]}H${a[0] + L} M${b[0] - L},${a[1]}H${b[0]}V${a[1] + L} M${b[0]},${b[1] - L}V${b[1]}H${b[0] - L} M${a[0] + L},${b[1]}H${a[0]}V${b[1] - L}"/>`;
    const hs = { nw: [a[0], a[1]], n: [(a[0] + b[0]) / 2, a[1]], ne: [b[0], a[1]], e: [b[0], (a[1] + b[1]) / 2], se: [b[0], b[1]], s: [(a[0] + b[0]) / 2, b[1]], sw: [a[0], b[1]], w: [a[0], (a[1] + b[1]) / 2] };
    const cur = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
    for (const k in hs) h += `<rect class="hit" data-h="c-${k}" x="${hs[k][0] - 12}" y="${hs[k][1] - 12}" width="24" height="24" fill="transparent" style="cursor:${cur[k]}-resize"/>`;
    h += `<text class="tag" x="${a[0] + 8}" y="${a[1] + 18}">${Math.round(c.w * g.FW)} × ${Math.round(c.h * g.FH)}</text>`;
  }
  if (S.tool === 'quad' && S.quadDraft) {
    const q = S.quadDraft; const pts = [0, 1, 2, 3].map((i) => o2s(q[i * 2] * S.img.W, q[i * 2 + 1] * S.img.H));
    h += `<path class="ln acc" style="stroke-width:1.6" d="M${pts.map(P2).join('L')}Z"/>`;
    pts.forEach((p, i) => { h += handle('q-' + i, p, 8); });
  }
  const m = S.tab === 'masks' ? selMask() : null;
  if (m && !S.before) {
    const g = m.geom || {};
    if (m.type === 'linear' && g.x1 != null) {
      const a = o2s(...srcN2o(g.x1, g.y1)), b = o2s(...srcN2o(g.x2, g.y2)); const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1; const nx = -dy / len * 3000, ny = dx / len * 3000;
      const line = (p, cls) => `<path class="ln ${cls || ''}" d="M${p[0] - nx},${p[1] - ny}L${p[0] + nx},${p[1] + ny}"/>`;
      h += line(a) + line(mid, 'dim') + line(b);
      h += `<path class="ln dim" d="M${P2(a)}L${P2(b)}"/>` + handle('l-a', a, 7) + handle('l-b', b, 7) + `<circle class="hnd hit" data-h="l-c" cx="${mid[0]}" cy="${mid[1]}" r="9" style="fill:var(--accent)"/>`;
    }
    if (m.type === 'radial' && g.cx != null) {
      const L0 = Math.max(S.img.W, S.img.H), ax = S.img.W / L0, ay = S.img.H / L0, an = (g.angle || 0) * Math.PI / 180, ca = Math.cos(an), sa = Math.sin(an);
      const pt = (t, sc) => { const X = g.cx * ax + (Math.cos(t) * g.rx * ca - Math.sin(t) * g.ry * sa) * sc, Y = g.cy * ay + (Math.cos(t) * g.rx * sa + Math.sin(t) * g.ry * ca) * sc; return o2s(...srcN2o(X / ax, Y / ay)); };
      const ring = (sc, cls) => { let d = ''; for (let i = 0; i <= 64; i++) d += (i ? 'L' : 'M') + P2(pt(i / 64 * Math.PI * 2, sc)); return `<path class="ln ${cls || ''}" d="${d}Z"/>`; };
      h += ring(1) + ring(Math.max(0.02, 1 - (g.feather == null ? 50 : g.feather) / 100), 'dim');
      h += `<circle class="hnd hit" data-h="r-c" cx="${o2s(...srcN2o(g.cx, g.cy))[0]}" cy="${o2s(...srcN2o(g.cx, g.cy))[1]}" r="9" style="fill:var(--accent)"/>`;
      h += handle('r-x', pt(0, 1), 7) + handle('r-x2', pt(Math.PI, 1), 7) + handle('r-y', pt(Math.PI / 2, 1), 7) + handle('r-y2', pt(-Math.PI / 2, 1), 7);
    }
  }
  if (S.split && S.tab !== 'crop' && S.tool !== 'quad') {
    const x = S.splitPos * st.w; const od = outDims(); const t0 = Math.max(0, o2s(0, 0)[1]), t1 = Math.min(st.h, o2s(od.w, od.h)[1]); const cy = (t0 + t1) / 2;
    h += `<path class="split" d="M${x},${t0}V${t1}"/><rect class="hit" data-h="split" x="${x - 10}" y="${t0}" width="20" height="${Math.max(0, t1 - t0)}" fill="transparent" style="cursor:ew-resize"/>`;
    h += `<circle class="hnd hit" data-h="split" cx="${x}" cy="${cy}" r="12"/><path d="M${x - 5},${cy - 4}l-3,4 3,4M${x + 5},${cy - 4}l3,4 -3,4" stroke="#222" fill="none" stroke-width="1.6"/>`;
    h += `<text class="tag" text-anchor="end" x="${x - 10}" y="${t0 + 22}">VORHER</text><text class="tag" x="${x + 10}" y="${t0 + 22}">NACHHER</text>`;
  }
  if (drag && drag.type === 'line') h += `<path class="ln acc" style="stroke-width:2" d="M${P2(drag.a)}L${P2(drag.b)}"/>`;
  if (brushActive() && S.pointer && S.pointer.inside && !S.before) {
    const ds = dispScale(); const r = brushRadiusFrac() * Math.max(S.img.W, S.img.H) * ds * G().fill;
    const erase = S.tab === 'brush' ? S.prefs.db.mode === 'erase' || S.pointer.alt : S.maskErase || S.pointer.alt;
    h += `<circle class="brush-cur" cx="${S.pointer.x}" cy="${S.pointer.y}" r="${Math.max(2, r)}" ${erase ? 'style="stroke-dasharray:5 3"' : ''}/>`;
    h += `<circle class="brush-in" cx="${S.pointer.x}" cy="${S.pointer.y}" r="${Math.max(1, r * S.prefs.brush.hard / 100)}"/>`;
  }
  svg.innerHTML = h;
}

/* ---------- Zeiger-Interaktion ---------- */
let drag = null; const ptrs = new Map(); let pinch = null; let spaceDown = false;
function stagePt(e) { const r = $('#stage').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function onPointerDown(e) {
  if (!S.img) return;
  if (e.target.closest && e.target.closest('.hud, .hint, .empty-card, .badge-before')) return;
  const st = $('#stage'); try { st.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
  const p = stagePt(e); ptrs.set(e.pointerId, p);
  if (ptrs.size === 2) {
    if (paint) { paint = null; syncBrushRasters(true); requestRender(false); }
    drag = null; const [a, b] = Array.from(ptrs.values());
    pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: S.view.zoom, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], c0: [S.view.cx, S.view.cy] };
    return;
  }
  if (ptrs.size > 2) return;
  e.preventDefault();
  const toolFirst = S.tool && S.tool !== 'quad';
  const hEl = !toolFirst && e.target.closest && e.target.closest('[data-h]');
  const o = s2o(p[0], p[1]);
  if (hEl) {
    const hId = hEl.getAttribute('data-h'); const m = selMask();
    drag = { type: 'handle', h: hId, p0: p, o0: o, crop: deep(S.params.geo.crop), geom: m ? deep(m.geom) : null, q: S.quadDraft ? S.quadDraft.slice() : null };
    return;
  }
  if (spaceDown || e.button === 1) { drag = { type: 'pan', p0: p, c0: [S.view.cx, S.view.cy] }; return; }
  if (S.tool === 'wbpick') { pickWB(o); return; }
  if (S.tool === 'tat') { startTAT(p, o); return; }
  if (S.tool === 'straighten') { drag = { type: 'line', a: p, b: p }; return; }
  if (S.tool === 'newLinear' || S.tool === 'newRadial') { drag = { type: 'create', kind: S.tool, a: p, b: p }; return; }
  if (brushActive() && e.button === 0) { S.pointer = { x: p[0], y: p[1], inside: true, alt: e.altKey }; startStroke(p[0], p[1], e.altKey); drag = { type: 'paint' }; return; }
  if (S.view.zoom > 1.001) { drag = { type: 'pan', p0: p, c0: [S.view.cx, S.view.cy] }; $('#stage').style.cursor = 'grabbing'; return; }
}
function onPointerMove(e) {
  if (!S.img) return;
  const p = stagePt(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
  S.pointer = { x: p[0], y: p[1], inside: true, alt: e.altKey };
  if (pinch && ptrs.size >= 2) {
    const [a, b] = Array.from(ptrs.values()); const dd = Math.hypot(a[0] - b[0], a[1] - b[1]); const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    S.view.cx = pinch.c0[0]; S.view.cy = pinch.c0[1]; S.view.zoom = pinch.z0;
    const before = s2o(pinch.m0[0], pinch.m0[1]);
    const maxZ = Math.max(4, 8 / (fitScale() * (window.devicePixelRatio || 1)));
    S.view.zoom = clamp(pinch.z0 * dd / Math.max(1, pinch.d0), 1, maxZ);
    const after = s2o(mid[0], mid[1]); S.view.cx += before[0] - after[0]; S.view.cy += before[1] - after[1];
    clampView(); updateZoomLabel(); positionCanvases(); drawOverlay(); return;
  }
  if (!drag) { if (brushActive()) drawOverlay(); return; }
  const o = s2o(p[0], p[1]);
  if (drag.type === 'pan') { const ds = dispScale(); S.view.cx = drag.c0[0] - (p[0] - drag.p0[0]) / ds; S.view.cy = drag.c0[1] - (p[1] - drag.p0[1]) / ds; clampView(); positionCanvases(); drawOverlay(); return; }
  if (drag.type === 'paint') { let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; if (!evs || !evs.length) evs = [e]; for (const ev of evs) { const q = stagePt(ev); paintMove(q[0], q[1]); } drawOverlay(); return; }
  if (drag.type === 'line' || drag.type === 'create') { drag.b = p; if (drag.type === 'create') previewCreate(); drawOverlay(); return; }
  if (drag.type === 'tat') { moveTAT(p); return; }
  if (drag.type === 'handle') { moveHandle(drag, p, o, e.shiftKey); return; }
}
function onPointerUp(e) {
  ptrs.delete(e.pointerId);
  if (e.pointerType === 'touch' && S.pointer) { S.pointer.inside = false; setTimeout(drawOverlay, 0); }
  if (pinch) { if (ptrs.size < 2) { pinch = null; requestRender(false); } return; }
  if (!drag) return;
  const dr = drag; drag = null;
  if (dr.type === 'pan') { updateCursor(); requestRender(false); return; }
  if (dr.type === 'paint') { endStroke(); return; }
  if (dr.type === 'line') { finishStraighten(dr); drawOverlay(); return; }
  if (dr.type === 'create') { finishCreate(dr); return; }
  if (dr.type === 'tat') { commit('Zielkorrektur'); requestRender(false); refreshControls(); return; }
  if (dr.type === 'handle') {
    if (dr.h.startsWith('c-')) { commit('Zuschnitt'); geoCache.key = null; }
    else if (dr.h === 'split') { /* nur Ansicht */ }
    else if (dr.h.startsWith('q-')) { /* Entwurf */ }
    else commit('Maske verschoben');
    requestRender(false); drawOverlay(); if (S.tab === 'crop') renderPanel();
  }
}
function moveHandle(dr, p, o, shift) {
  const h = dr.h;
  if (h === 'split') { S.splitPos = clamp(p[0] / stageSize().w, 0.02, 0.98); drawOverlay(); requestRender(true); return; }
  if (h.startsWith('c-')) { dragCrop(h.slice(2), { p: dr.o0, crop: dr.crop }, o); geoCache.key = null; drawOverlay(); return; }
  if (h.startsWith('q-')) { const i = +h.slice(2); const f = outToFrame(o); S.quadDraft[i * 2] = clamp(f[0] / S.img.W, -0.2, 1.2); S.quadDraft[i * 2 + 1] = clamp(f[1] / S.img.H, -0.2, 1.2); drawOverlay(); return; }
  const m = selMask(); if (!m) return; const g = m.geom; const sN = o2srcN(o[0], o[1]); const s0 = o2srcN(dr.o0[0], dr.o0[1]);
  const L0 = Math.max(S.img.W, S.img.H), ax = S.img.W / L0, ay = S.img.H / L0;
  if (h === 'l-a') { g.x1 = sN[0]; g.y1 = sN[1]; }
  else if (h === 'l-b') { g.x2 = sN[0]; g.y2 = sN[1]; }
  else if (h === 'l-c') { const dx = sN[0] - s0[0], dy = sN[1] - s0[1]; g.x1 = dr.geom.x1 + dx; g.y1 = dr.geom.y1 + dy; g.x2 = dr.geom.x2 + dx; g.y2 = dr.geom.y2 + dy; }
  else if (h === 'r-c') { g.cx = dr.geom.cx + sN[0] - s0[0]; g.cy = dr.geom.cy + sN[1] - s0[1]; }
  else if (h.startsWith('r-')) {
    const an = (g.angle || 0) * Math.PI / 180; const X = (sN[0] - g.cx) * ax, Y = (sN[1] - g.cy) * ay;
    const lx = Math.abs(X * Math.cos(an) + Y * Math.sin(an)), ly = Math.abs(-X * Math.sin(an) + Y * Math.cos(an));
    if (h.startsWith('r-x')) { g.rx = Math.max(0.01, lx); if (shift) g.ry = g.rx; } else { g.ry = Math.max(0.01, ly); if (shift) g.rx = g.ry; }
  }
  drawOverlay(); requestRender(true);
}
function previewCreate() { /* Linie wird im Overlay als Vorschau gezeichnet */ }
function finishCreate(dr) {
  const a = o2srcN(...s2o(dr.a[0], dr.a[1])); let b = o2srcN(...s2o(dr.b[0], dr.b[1]));
  const moved = Math.hypot(dr.b[0] - dr.a[0], dr.b[1] - dr.a[1]) > 8;
  const L0 = Math.max(S.img.W, S.img.H), ax = S.img.W / L0, ay = S.img.H / L0;
  if (dr.kind === 'newLinear') {
    if (!moved) b = [a[0], a[1] + 0.25];
    newMask('linear', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, { exposure: -0.5 });
    commit('Linearer Verlauf');
  } else {
    let rx = Math.abs(b[0] - a[0]) * ax, ry = Math.abs(b[1] - a[1]) * ay;
    if (!moved) { rx = 0.18; ry = 0.14; } else { const r = Math.max(rx, ry); rx = Math.max(0.03, rx < r * 0.25 ? r : rx); ry = Math.max(0.03, ry < r * 0.25 ? r : ry); }
    newMask('radial', { cx: a[0], cy: a[1], rx, ry, angle: 0, feather: 50 }, { exposure: 0.5 });
    commit('Radialfilter');
  }
  S.tool = null; hint(null); renderPanel(); requestRender(false); drawOverlay(); updateCursor();
}
function finishStraighten(dr) {
  const a = s2o(dr.a[0], dr.a[1]), b = s2o(dr.b[0], dr.b[1]);
  if (Math.hypot(dr.b[0] - dr.a[0], dr.b[1] - dr.a[1]) < 10) return;
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  while (ang > 90) ang -= 180; while (ang < -90) ang += 180;
  if (ang > 45) ang -= 90; else if (ang < -45) ang += 90;
  S.params.v.angle = +clamp(S.params.v.angle - ang, -45, 45).toFixed(2);
  geoCache.key = null; commit('Ausgerichtet ' + FMT.sdeg(S.params.v.angle)); setTool(null); refreshControls(); requestRender(false);
}
function sampleProxyLinear(u, v) {
  const pr = S.proxy; const cx = Math.round(u * pr.w), cy = Math.round(v * pr.h); let r = 0, g = 0, b = 0, n = 0;
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    if (x < 0 || y < 0 || x >= pr.w || y >= pr.h) continue; const i = (y * pr.w + x) * 4; r += PE.S2L8[pr.data[i]]; g += PE.S2L8[pr.data[i + 1]]; b += PE.S2L8[pr.data[i + 2]]; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}
function pickWB(o) {
  const sN = o2srcN(o[0], o[1]); const c = sampleProxyLinear(sN[0], sN[1]);
  if (!c) { toast('Bitte innerhalb des Bildes klicken.'); return; }
  const r = PE.wbFromColor(c[0], c[1], c[2], S.params.v); S.params.v.temp = r.temp; S.params.v.tint = r.tint;
  refreshControls(); commit('Weißabgleich per Pipette'); onParamChange(false);
  toast(`Weißabgleich gesetzt: Temperatur ${FMT.int(r.temp)}, Tönung ${FMT.int(r.tint)}`);
  setTool(null);
}
function startTAT(p, o) {
  const cv = $('#cvMain'); const d = lastDraw.main; if (!d) return;
  const px = Math.floor((o[0] - d.x) * d.k), py = Math.floor((o[1] - d.y) * d.k);
  if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return;
  const q = cv.getContext('2d').getImageData(px, py, 1, 1).data;
  const r = q[0] / 255, g = q[1] / 255, b = q[2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let hdeg = 0; if (mx - mn > 1e-4) { if (mx === r) hdeg = 60 * (((g - b) / (mx - mn)) % 6); else if (mx === g) hdeg = 60 * ((b - r) / (mx - mn) + 2); else hdeg = 60 * ((r - g) / (mx - mn) + 4); }
  if (hdeg < 0) hdeg += 360;
  const B = PE.BAND_HSV.concat([360]); let i = 0; while (i < 7 && hdeg >= B[i + 1]) i++;
  const t = (hdeg - B[i]) / (B[i + 1] - B[i]); const j = (i + 1) % 8;
  const tab = S.hslTab || 'h';
  drag = { type: 'tat', p0: p, w: [[i, 1 - t], [j, t]], start: [S.params.v[tab + i], S.params.v[tab + j]], tab };
  hint(`${HSL_NAMES[t < 0.5 ? i : j]}: ${{ h: 'Farbton', s: 'Sättigung', l: 'Luminanz' }[tab]} · nach oben/unten ziehen`);
}
function moveTAT(p) {
  const dy = drag.p0[1] - p[1]; const tab = drag.tab;
  drag.w.forEach(([band, w], n) => { S.params.v[tab + band] = Math.round(clamp(drag.start[n] + dy * 0.6 * w, -100, 100)); });
  refreshControls(); onParamChange(true);
}
function onWheel(e) {
  if (!S.img) return; e.preventDefault();
  const p = stagePt(e); const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018));
  setZoom(S.view.zoom * f, p[0], p[1]);
}
