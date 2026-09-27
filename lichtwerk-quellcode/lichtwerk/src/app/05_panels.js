/* ===== Presets, Verlauf, Export, Werkzeugkasten, Dialoge ===== */
const LOOK_GROUPS = ['light', 'presence', 'color', 'hsl', 'grading', 'curve', 'fx'];
const BUILTIN_PRESETS = [
  { name: 'Natürlich lebendig', v: { vibrance: 28, contrast: 10, clarity: 12, shadows: 15, highlights: -18 } },
  { name: 'Klassisch Schwarzweiß', v: { bw: 1, contrast: 28, clarity: 18, l0: 12, l1: 10, l5: -22, grain: 12, whites: 10, blacks: -12 } },
  { name: 'Film matt', v: { saturation: -12, contrast: -8, gShH: 200, gShS: 16, gHiH: 42, gHiS: 12, grain: 22, grainSize: 30, vig: -10 }, curves: { rgb: [[0, 0.07], [0.25, 0.25], [0.75, 0.77], [1, 0.95]] } },
  { name: 'Warmes Abendlicht', v: { vibrance: 18, highlights: -22, gHiH: 38, gHiS: 22, gShH: 20, gShS: 8, vig: -16 }, wb: { temp: 22, tint: 5 } },
  { name: 'Kühl & klar', v: { clarity: 20, dehaze: 12, contrast: 16, s5: 14, h5: -6, vibrance: 10 }, wb: { temp: -16, tint: 0 } },
  { name: 'Teal & Orange', v: { gShH: 192, gShS: 28, gHiH: 32, gHiS: 22, gBal: 10, s1: 18, h4: -8, s4: 12, s5: 8, vibrance: 8, contrast: 12 } },
  { name: 'High Key', v: { exposure: 0.45, shadows: 45, contrast: -18, whites: 18, highlights: -10, saturation: -12, clarity: -6 } },
  { name: 'Dramatisch', v: { contrast: 35, clarity: 38, dehaze: 16, highlights: -50, shadows: 25, vig: -28, saturation: -14, texture: 15 } },
  { name: 'Vintage', v: { saturation: -22, gShH: 205, gShS: 18, gHiH: 48, gHiS: 26, gBal: -10, grain: 30, grainRough: 70, vig: -22, contrast: 8 }, curves: { rgb: [[0, 0.1], [0.5, 0.52], [1, 0.92]], b: [[0, 0.06], [1, 0.9]] } },
];
function presetFromCurrent(name, groups) {
  const v = {}; const p = S.params;
  groups.forEach((g) => (PE.GROUP_KEYS[g] || []).forEach((k) => { if (p.v[k] !== PE.DEF[k]) v[k] = p.v[k]; }));
  const pr = { id: uid(), name, v, groups: groups.slice(), user: true };
  if (groups.includes('curve')) pr.curves = deep(p.curves);
  return pr;
}
function applyPreset(pr) {
  const base = deep(S.params); const t = deep(S.params);
  const groups = pr.groups || LOOK_GROUPS.concat(pr.wb ? ['wb'] : []);
  groups.forEach((g) => { (PE.GROUP_KEYS[g] || []).forEach((k) => (t.v[k] = PE.DEF[k])); if (g === 'curve') t.curves = PE.defaultParams().curves; });
  Object.assign(t.v, pr.v || {}); if (pr.wb) Object.assign(t.v, pr.wb);
  if (pr.curves) Object.keys(pr.curves).forEach((ch) => (t.curves[ch] = deep(pr.curves[ch])));
  S.lastPreset = { name: pr.name, base, target: deep(t), amt: 100 };
  S.params = t; commit('Preset: ' + pr.name); afterParamsReplaced();
}
function presetAmount(a) {
  const lp = S.lastPreset; if (!lp) return; lp.amt = a; const t = a / 100; const b = lp.base, g = lp.target;
  const p = deep(g);
  for (const k in g.v) { const x = b.v[k], y = g.v[k]; p.v[k] = k === 'bw' ? (t >= 0.5 ? y : x) : x + (y - x) * t; }
  ['rgb', 'r', 'g', 'b'].forEach((ch) => {
    if (JSON.stringify(b.curves[ch]) === JSON.stringify(g.curves[ch])) return;
    if (PE.isIdentCurve(b.curves[ch])) p.curves[ch] = g.curves[ch].map(([x, y]) => [x, x + (y - x) * t]);
    else p.curves[ch] = deep(t >= 0.5 ? g.curves[ch] : b.curves[ch]);
  });
  p.masks = S.params.masks; p.geo = S.params.geo; PE.GROUP_KEYS.geo.forEach((k) => (p.v[k] = S.params.v[k]));
  S.params = p; refreshControls(); requestRender(true);
}
function userPresets() { const a = store.get('presets', []); return Array.isArray(a) ? a : []; }
function saveUserPresets(a) { if (!store.set('presets', a)) toast('Presets konnten nicht dauerhaft gespeichert werden (Speicher blockiert). Sie gelten nur für diese Sitzung.', { err: true }); }
function copySettings() {
  const c = { v: {}, curves: deep(S.params.curves) };
  Object.keys(PE.GROUP_KEYS).filter((g) => g !== 'geo').forEach((g) => PE.GROUP_KEYS[g].forEach((k) => (c.v[k] = S.params.v[k])));
  store.set('clip', c); toast('Einstellungen kopiert (ohne Zuschnitt und Masken)');
}
function pasteSettings() {
  const c = store.get('clip', null); if (!c) { toast('Noch keine Einstellungen kopiert.'); return; }
  Object.assign(S.params.v, c.v); if (c.curves) S.params.curves = deep(c.curves);
  commit('Einstellungen eingefügt'); afterParamsReplaced(); toast('Einstellungen eingefügt');
}
function resetAll() {
  const keepGeo = S.params.geo; S.params = PE.defaultParams(); S.params.geo = PE.defaultParams().geo; void keepGeo;
  S.selMask = null; S.lastPreset = null; syncBrushRasters(); commit('Alles zurückgesetzt'); afterParamsReplaced(); resetView();
}

function renderPresetPanel(body) {
  const lp = S.lastPreset;
  if (lp) {
    body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('star'), 'Zuletzt angewendet: ' + lp.name),
      slider({ k: 'presetAmt', l: 'Stärke', min: 0, max: 150, def: 100, zero: 0, fmt: 'pct' }, { get: () => lp.amt, set: (v, inter) => { presetAmount(v); if (!inter) updateGroupStates(); }, label: 'Preset-Stärke' })));
  }
  const list = el('div', { class: 'list' });
  const row = (pr, user) => {
    const li = el('div', { class: 'li', role: 'button', tabindex: '0', 'data-preset': pr.name });
    li.append(iconEl(user ? 'star' : 'presets', 'ic'), el('span', { class: 'nm', text: pr.name }));
    if (user) li.append(iconBtn('trash', 'Preset löschen', (e) => { e.stopPropagation(); saveUserPresets(userPresets().filter((q) => q.id !== pr.id)); toast('Preset „' + pr.name + '“ gelöscht'); renderPanel(); }));
    const go = () => { applyPreset(pr); toast('Preset „' + pr.name + '“ angewendet', { ms: 1800 }); };
    li.addEventListener('click', go); li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return li;
  };
  const ups = userPresets();
  if (ups.length) { list.append(el('div', { class: 'subhead', text: 'Eigene Presets' })); ups.forEach((p) => list.append(row(p, true))); }
  list.append(el('div', { class: 'subhead', text: 'Mitgeliefert' })); BUILTIN_PRESETS.forEach((p) => list.append(row(p, false)));
  body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('presets'), 'Presets'), list));
  // Speichern
  const nameIn = el('input', { class: 'inp', placeholder: 'Name für das Preset', 'aria-label': 'Preset-Name', maxlength: '60' });
  const inc = { wb: false, detail: false };
  const save = () => {
    const name = nameIn.value.trim(); if (!name) { nameIn.focus(); toast('Bitte einen Namen eingeben.'); return; }
    const groups = LOOK_GROUPS.concat(inc.wb ? ['wb'] : [], inc.detail ? ['detail'] : []);
    const a = userPresets().filter((q) => q.name !== name); a.unshift(presetFromCurrent(name, groups)); saveUserPresets(a);
    toast('Preset „' + name + '“ gespeichert'); renderPanel();
  };
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const fileIn = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text()); const arr = (Array.isArray(data) ? data : data.presets || [data]).filter((p) => p && typeof p.name === 'string' && typeof p.v === 'object');
      if (!arr.length) throw new Error('keine Presets gefunden');
      const cur = userPresets(); arr.forEach((p) => { p.id = uid(); p.user = true; cur.unshift(p); }); saveUserPresets(cur);
      toast(arr.length + ' Preset(s) importiert'); renderPanel();
    } catch (e) { toast('Import fehlgeschlagen: ' + e.message, { err: true }); }
  });
  body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('plus'), 'Aktuellen Look speichern'), nameIn,
    advSection('presetopt', 'Optionen', [sw('Weißabgleich einschließen', false, (on) => (inc.wb = on)), sw('Details (Schärfen, Rauschen) einschließen', false, (on) => (inc.detail = on))]),
    el('div', { class: 'row' }, btn('Speichern', save, 'small primary', 'check'), btn('Importieren', () => fileIn.click(), 'small', 'upload'),
      btn('Exportieren', () => { const a = userPresets(); if (!a.length) { toast('Es gibt noch keine eigenen Presets.'); return; } saveBlob(new Blob([JSON.stringify({ app: 'Lichtwerk', presets: a }, null, 2)], { type: 'application/json' }), 'lichtwerk-presets.json'); }, 'small', 'download'), fileIn)));
  body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('copy'), 'Einstellungen'),
    el('div', { class: 'row' }, btn('Kopieren', copySettings, 'small', 'copy'), btn('Einfügen', pasteSettings, 'small', 'paste'), btn('Alles zurücksetzen', resetAll, 'small danger', 'reset'))));
  // Verlauf
  const hl = el('div', { class: 'list', style: { maxHeight: '260px', overflowY: 'auto' } });
  for (let i = S.history.length - 1; i >= 0; i--) {
    const h = S.history[i]; const t = new Date(h.t);
    const li = el('div', { class: 'li' + (i === S.hIndex ? ' on' : ''), role: 'button', tabindex: '0', 'data-hist': String(i) }, el('span', { class: 'nm', text: h.label }), el('span', { class: 'sub', text: t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
    li.addEventListener('click', () => { restoreSnap(i); renderPanel(); });
    hl.append(li);
  }
  body.append(el('div', { class: 'card' }, el('h4', {}, iconEl('clock'), 'Verlauf'), hl));
}

/* ---------- Dialoge ---------- */
let openModalRef = null;
function openModal(title, bodyKids, footKids, opts) {
  closeModal();
  const back = el('div', { class: 'modal-back', role: 'presentation' });
  const m = el('div', { class: 'modal glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const x = iconBtn('x', 'Schließen', () => closeModal());
  m.append(el('div', { class: 'modal-h' }, el('h3', { text: title }), x), el('div', { class: 'modal-b' }, ...bodyKids), footKids && footKids.length ? el('div', { class: 'modal-f' }, ...footKids) : null);
  back.append(m); back.addEventListener('pointerdown', (e) => { if (e.target === back) closeModal(); });
  $('#modalRoot').append(back); openModalRef = { back, onClose: opts && opts.onClose };
  setTimeout(() => { const f = m.querySelector('input,select,button.primary'); if (f) f.focus(); }, 30);
  return m;
}
function closeModal() { if (!openModalRef) return; const r = openModalRef; openModalRef = null; r.back.remove(); if (r.onClose) r.onClose(); }

/* ---------- Speichern / Herunterladen ---------- */
let dlCap = null, dlCapP = null;
function initDownloads() {
  try { if (window.claude && typeof window.claude.use === 'function') dlCapP = window.claude.use('downloads').then((c) => (dlCap = c)).catch(() => null); } catch (e) { /* kein Viewer */ }
}
async function saveBlob(blob, filename) {
  if (dlCapP && !dlCap) await Promise.race([dlCapP, sleep(2500)]);
  if (dlCap) {
    try { await dlCap.save({ filename, data: blob }); return 'saved'; }
    catch (e) {
      const code = e && e.code;
      if (code === 'declined') { toast('Speichern abgebrochen.'); return 'declined'; }
      if (code === 'rejected_extension' || code === 'extension_not_enabled') {
        const zipName = filename.replace(/\.[^.]+$/, '') + '.zip';
        const z = await Codecs.makeZip([{ name: filename, blob }]);
        try { await dlCap.save({ filename: zipName, data: z }); toast('Diese Umgebung erlaubt keine .' + filename.split('.').pop() + '-Downloads. Die Datei wurde als ZIP verpackt.', { ms: 6000 }); return 'saved'; }
        catch (e2) { toast('Speichern nicht möglich: ' + (e2.message || e2.code), { err: true }); return 'error'; }
      }
      if (code === 'rate_limited') { toast('Bitte kurz warten und erneut versuchen.'); return 'error'; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
}

/* ---------- Export ---------- */
function exportTarget(e, OW, OH) {
  let tw = OW, th = OH;
  if (e.sizeMode === 'long') { const f = e.size / Math.max(OW, OH); tw = OW * f; th = OH * f; }
  else if (e.sizeMode === 'width') { const f = e.size / OW; tw = e.size; th = OH * f; }
  else if (e.sizeMode === 'height') { const f = e.size / OH; th = e.size; tw = OW * f; }
  else if (e.sizeMode === 'pct') { tw = OW * e.pct / 100; th = OH * e.pct / 100; }
  return [Math.max(1, Math.round(tw)), Math.max(1, Math.round(th))];
}
const FMT_INFO = { jpeg: ['JPEG', 'jpg', 'image/jpeg'], png: ['PNG', 'png', 'image/png'], webp: ['WebP', 'webp', 'image/webp'], tiff: ['TIFF', 'tif', 'image/tiff'] };
function openExport() {
  if (!S.img) { toast('Bitte zuerst ein Foto öffnen.'); return; }
  const e = S.prefs.export; const geo = PE.geometry(PE.effectiveParams(S.params), S.img.W, S.img.H);
  const OW = Math.round(geo.crop.w), OH = Math.round(geo.crop.h);
  const base = S.img.name.replace(/\.[^.]+$/, '');
  const fmtSel = el('select', { class: 'inp', id: 'exFmt', 'aria-label': 'Format' }, ...Object.keys(FMT_INFO).map((k) => el('option', { value: k, text: FMT_INFO[k][0] })));
  fmtSel.value = e.fmt;
  const bitsSel = el('select', { class: 'inp', id: 'exBits', 'aria-label': 'Farbtiefe' }, el('option', { value: '8', text: '8 Bit je Kanal' }), el('option', { value: '16', text: '16 Bit je Kanal' })); bitsSel.value = String(e.bits);
  const q = el('div');
  const sizeSel = el('select', { class: 'inp', id: 'exSize', 'aria-label': 'Größe' }, el('option', { value: 'orig', text: 'Originalgröße' }), el('option', { value: 'long', text: 'Lange Kante (px)' }), el('option', { value: 'width', text: 'Breite (px)' }), el('option', { value: 'height', text: 'Höhe (px)' }), el('option', { value: 'pct', text: 'Prozent' }));
  sizeSel.value = e.sizeMode;
  const sizeIn = el('input', { class: 'inp', id: 'exSizeVal', type: 'number', min: '1', max: '30000', 'aria-label': 'Größe in Pixel oder Prozent' });
  const sharpSel = el('select', { class: 'inp', id: 'exSharp', 'aria-label': 'Ausgabeschärfung' }, el('option', { value: 'off', text: 'Aus' }), el('option', { value: 'low', text: 'Niedrig' }), el('option', { value: 'std', text: 'Standard' }), el('option', { value: 'high', text: 'Hoch' })); sharpSel.value = e.sharpen;
  const nameIn = el('input', { class: 'inp', id: 'exName', value: base + (e.suffix || ''), 'aria-label': 'Dateiname' });
  const tiffZip = sw('TIFF verlustfrei komprimieren (Deflate)', e.tiffZip, (on) => { e.tiffZip = on; });
  const info = el('div', { class: 'note', id: 'exInfo' });
  const prog = el('div', { class: 'progress', hidden: true }, el('i'));
  const upd = () => {
    e.fmt = fmtSel.value; e.bits = +bitsSel.value; e.sizeMode = sizeSel.value;
    const v = +sizeIn.value; if (e.sizeMode === 'pct') { if (v) e.pct = clamp(v, 1, 400); } else if (e.sizeMode !== 'orig' && v) e.size = clamp(Math.round(v), 16, 30000);
    sizeIn.disabled = e.sizeMode === 'orig'; sizeIn.placeholder = e.sizeMode === 'orig' ? '–' : ''; sizeIn.value = e.sizeMode === 'pct' ? e.pct : e.sizeMode === 'orig' ? '' : e.size;
    bitsSel.disabled = !(e.fmt === 'png' || e.fmt === 'tiff'); if (bitsSel.disabled) bitsSel.value = '8';
    q.innerHTML = '';
    if (e.fmt === 'jpeg' || e.fmt === 'webp') q.append(slider({ k: 'exQ', l: 'Qualität', min: 1, max: 100, def: 90, zero: 1 }, { get: () => e.q, set: (v) => { e.q = v; upd2(); } }));
    tiffZip.hidden = e.fmt !== 'tiff';
    upd2();
  };
  const upd2 = () => {
    const [tw, th] = exportTarget(e, OW, OH);
    const mp = tw * th / 1e6; const bpp = e.fmt === 'jpeg' ? 0.06 + (e.q / 100) ** 3 * 0.5 : e.fmt === 'webp' ? 0.04 + (e.q / 100) ** 3 * 0.34 : e.fmt === 'png' ? (e.bits === 16 ? 4.5 : 2.2) : (e.tiffZip ? 0.7 : 1) * 3 * e.bits / 8;
    const est = mp * 1e6 * bpp;
    info.textContent = `Ausgabe ${tw} × ${th} px (${mp.toFixed(1).replace('.', ',')} MP) · ca. ${est > 1e6 ? (est / 1e6).toFixed(1).replace('.', ',') + ' MB' : Math.round(est / 1e3) + ' KB'}` + (tw > OW ? ' · hochskaliert' : '');
  };
  [fmtSel, bitsSel, sizeSel, sizeIn].forEach((x) => x.addEventListener('change', upd)); sizeIn.addEventListener('input', upd2);
  sizeIn.addEventListener('input', () => { const v = +sizeIn.value; if (e.sizeMode === 'pct') { if (v) e.pct = clamp(v, 1, 400); } else if (v) e.size = clamp(Math.round(v), 16, 30000); upd2(); });
  sharpSel.addEventListener('change', () => (e.sharpen = sharpSel.value));
  const go = btn('Exportieren', async () => {
    e.suffix = nameIn.value.startsWith(base) ? nameIn.value.slice(base.length) : e.suffix; savePrefs();
    go.disabled = true; prog.hidden = false;
    try {
      const t0 = performance.now();
      const res = await runExport(Object.assign({}, e), (f) => { prog.firstChild.style.width = Math.round(f * 100) + '%'; });
      const fn = (nameIn.value.trim() || base) + '.' + res.ext;
      const st = await saveBlob(res.blob, fn);
      if (st === 'saved') { toast(`Exportiert: ${fn} · ${(res.blob.size / 1e6).toFixed(2).replace('.', ',')} MB · ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s`, { ms: 5000 }); S.lastExport = { name: fn, size: res.blob.size, type: res.blob.type, w: res.w, h: res.h }; closeModal(); }
      if (res.warn) toast(res.warn, { ms: 6000 });
    } catch (err) { console.error(err); toast('Export fehlgeschlagen: ' + (err.message || err), { err: true, ms: 7000 }); }
    go.disabled = false; prog.hidden = true;
  }, 'primary', 'export');
  go.id = 'exGo';
  openModal('Exportieren', [
    el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', { text: 'Format' }), fmtSel), el('label', { class: 'field' }, el('span', { text: 'Farbtiefe' }), bitsSel)),
    q, tiffZip,
    el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', { text: 'Größe' }), sizeSel), el('label', { class: 'field' }, el('span', { text: 'Wert' }), sizeIn)),
    el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', { text: 'Ausgabeschärfung (Bildschirm)' }), sharpSel), el('label', { class: 'field' }, el('span', { text: 'Dateiname' }), nameIn)),
    info, prog,
    el('div', { class: 'muted', text: 'Der Export rechnet in voller Auflösung und passiert vollständig auf deinem Gerät.' }),
  ], [btn('Abbrechen', closeModal, 'ghost'), go]);
  upd();
}
async function runExport(e, onProg) {
  const params = PE.effectiveParams(S.params); const W0 = S.img.W, H0 = S.img.H;
  const geo = PE.geometry(params, W0, H0);
  const OW = geo.crop.w, OH = geo.crop.h; const [tw, th] = exportTarget(e, Math.round(OW), Math.round(OH));
  const k = tw / OW; const s = Math.min(1, k * geo.fill);
  const PW = Math.max(1, Math.round(W0 * s)), PH = Math.max(1, Math.round(H0 * s));
  const ctx = PE.prepare(params, { fullW: W0, fullH: H0, proxy: S.proxy, brush: S.brushRasters });
  const M = PE.margin(ctx, s, PW, PH) + 2;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) { const p = PE.ap3(geo.Hinv, geo.crop.x + OW * a / 6, geo.crop.y + OH * b / 6); bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
  bx0 = clamp(Math.floor(bx0 * s) - 2, 0, PW - 1); by0 = clamp(Math.floor(by0 * s) - 2, 0, PH - 1); bx1 = clamp(Math.ceil(bx1 * s) + 2, bx0 + 1, PW); by1 = clamp(Math.ceil(by1 * s) + 2, by0 + 1, PH);
  const bw = bx1 - bx0, bh = by1 - by0;
  const proc = new Uint16Array(bw * bh * 4);
  const rows = Math.max(32, Math.min(512, Math.floor(3e6 / bw)));
  // Rand horizontal ebenfalls mitnehmen
  const qx0 = Math.max(0, bx0 - M), qx1 = Math.min(PW, bx1 + M), qw = qx1 - qx0;
  for (let y = by0; y < by1; y += rows) {
    const y1 = Math.min(by1, y + rows); const ry0 = Math.max(0, y - M), ry1 = Math.min(PH, y1 + M);
    const c = scratchCtx(qw, ry1 - ry0); c.clearRect(0, 0, qw, ry1 - ry0); c.drawImage(S.img.bitmap, qx0 / s, ry0 / s, qw / s, (ry1 - ry0) / s, 0, 0, qw, ry1 - ry0);
    const src = c.getImageData(0, 0, qw, ry1 - ry0).data;
    const pr = PE.processRegion(ctx, src, qw, ry1 - ry0, qx0, ry0, PW, PH, s);
    for (let yy = y; yy < y1; yy++) { const so = ((yy - ry0) * qw + (bx0 - qx0)) * 4; proc.set(pr.subarray(so, so + bw * 4), (yy - by0) * bw * 4); }
    onProg(0.85 * (y1 - by0) / bh); await sleep(0);
  }
  const hi = (e.fmt === 'png' || e.fmt === 'tiff') && e.bits === 16;
  const out = PE.renderOutput(ctx, proc, bw, bh, bx0, by0, s, geo, false, { x0: 0, y0: 0, w: tw, h: th }, k, hi ? 'u16' : 'u8');
  onProg(0.92); await sleep(0);
  const maxv = hi ? 65535 : 255;
  if (e.sharpen !== 'off') PE.outputSharpen(out, tw, th, { low: 0.35, std: 0.65, high: 1.0 }[e.sharpen], 0.8, maxv);
  let alpha = false; for (let i = 3; i < out.length; i += 4) if (out[i] < maxv) { alpha = true; break; }
  const info = FMT_INFO[e.fmt]; let blob, ext = info[1], warn = null;
  if (e.fmt === 'tiff') blob = await Codecs.encodeTIFF(out, tw, th, hi ? 16 : 8, alpha, e.tiffZip);
  else if (e.fmt === 'png' && hi) blob = await Codecs.encodePNG(out, tw, th, 16, alpha);
  else {
    if (e.fmt === 'jpeg' && alpha) for (let i = 0; i < out.length; i += 4) { const a = out[i + 3] / 255; out[i] = out[i] * a + 255 * (1 - a); out[i + 1] = out[i + 1] * a + 255 * (1 - a); out[i + 2] = out[i + 2] * a + 255 * (1 - a); out[i + 3] = 255; }
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    const c2 = cv.getContext('2d'); if (!c2) throw new Error('Das Bild ist für diesen Browser zu groß. Bitte eine kleinere Ausgabegröße wählen.');
    c2.putImageData(new ImageData(out, tw, th), 0, 0);
    blob = await new Promise((res) => cv.toBlob(res, info[2], e.q / 100));
    if (!blob) throw new Error('Der Browser konnte das Bild nicht kodieren. Bitte eine kleinere Größe oder ein anderes Format wählen.');
    if (blob.type !== info[2]) { warn = `${info[0]} wird von diesem Browser nicht unterstützt. Stattdessen wurde PNG gespeichert.`; ext = 'png'; }
    cv.width = cv.height = 1;
  }
  onProg(1);
  return { blob, ext, w: tw, h: th, warn };
}

/* ---------- Werkzeugkasten anpassen ---------- */
const TAB_DEFS = [['crop', 'Zuschneiden & Perspektive'], ['masks', 'Masken & lokale Korrekturen'], ['brush', 'Abwedeln & Nachbelichten (Pinsel)'], ['presets', 'Presets & Verlauf']];
const PROFILES = {
  einsteiger: { hidden: { 'g.hsl': true, 'g.grading': true, 'g.curve': true, 'g.detail': true, 'c.texture': true, 'c.dehaze': true, 'c.mask_luma': true }, advDefault: false, collapsed: {} },
  standard: { hidden: {}, advDefault: false, collapsed: { hsl: true, grading: true, curve: true, detail: true, fx: true } },
  profi: { hidden: {}, advDefault: true, collapsed: {} },
};
function applyProfile(name) {
  const p = PROFILES[name]; S.prefs.hidden = deep(p.hidden); S.prefs.advDefault = p.advDefault; S.prefs.collapsed = deep(p.collapsed); S.prefs.advOpen = {}; S.prefs.profile = name;
  savePrefs(); applyTabVisibility(); renderPanel();
}
function applyTabVisibility() {
  $$('#rail button[data-tab]').forEach((b) => { b.hidden = isHidden('t.' + b.dataset.tab); });
  if (isHidden('t.' + S.tab)) switchTab('edit');
  $('#histoWrap').hidden = !S.prefs.showHisto;
}
function openCustomize() {
  const tabsSeg = el('div');
  const render = (which) => {
    tabsSeg.innerHTML = '';
    if (which === 'tools') {
      const setH = (key, visible) => { if (visible) delete S.prefs.hidden[key]; else S.prefs.hidden[key] = true; S.prefs.profile = 'eigene'; savePrefs(); applyTabVisibility(); renderPanel(); };
      tabsSeg.append(el('div', { class: 'note', text: 'Blende Bereiche, Gruppen oder einzelne Regler aus, die du nicht brauchst. Ausgeblendete Werkzeuge behalten ihre Werte und wirken weiter.' }));
      tabsSeg.append(el('div', { class: 'tree-g' }, el('div', { class: 'subhead', text: 'Bereiche in der Werkzeugleiste' }), el('div', { class: 'tree-c' }, ...TAB_DEFS.map(([t, l]) => sw(l, !isHidden('t.' + t), (on) => setH('t.' + t, on))))));
      GROUPS.forEach((g) => {
        const kids = groupCtlList(g).map((c) => sw(c.l, !isHidden('c.' + c.k), (on) => setH('c.' + c.k, on)));
        tabsSeg.append(el('div', { class: 'tree-g', 'data-tree': g.id }, sw(g.t, !isHidden('g.' + g.id), (on) => setH('g.' + g.id, on)), el('div', { class: 'tree-c' }, ...kids)));
      });
      const maskKids = [['mask_linear', 'Linearer Verlauf'], ['mask_radial', 'Radialfilter'], ['mask_brush', 'Pinselmaske'], ['mask_luma', 'Helligkeitsmaske'], ['zones', 'Problemzonen erkennen']].concat(LOCAL_DEFS.concat(LOCAL_ADV).map((x) => ['local_' + x.k, 'Lokal: ' + x.l]));
      tabsSeg.append(el('div', { class: 'tree-g' }, el('div', { class: 'subhead', text: 'Masken' }), el('div', { class: 'tree-c' }, ...maskKids.map(([k, l]) => sw(l, !isHidden('c.' + k), (on) => setH('c.' + k, on))))));
      tabsSeg.append(el('div', { class: 'tree-g' }, el('div', { class: 'subhead', text: 'Zuschnitt' }), el('div', { class: 'tree-c' }, sw('Ausrichten & Drehen', !isHidden('c.angle'), (on) => setH('c.angle', on)), sw('Perspektive', !isHidden('c.persp'), (on) => setH('c.persp', on)))));
    } else if (which === 'profile') {
      tabsSeg.append(el('div', { class: 'note', text: 'Profile setzen die Auswahl sichtbarer Werkzeuge auf einen Schlag. Danach kannst du unter „Werkzeuge“ weiter anpassen.' }));
      [['einsteiger', 'Einsteiger', 'Nur die wichtigsten Regler, erweiterte Bereiche zugeklappt.'], ['standard', 'Standard', 'Alle Werkzeuge, erweiterte Bereiche zugeklappt.'], ['profi', 'Profi', 'Alle Werkzeuge, erweiterte Bereiche standardmäßig geöffnet.']].forEach(([k, l, dsc]) => {
        tabsSeg.append(el('div', { class: 'li' + (S.prefs.profile === k ? ' on' : ''), role: 'button', tabindex: '0', 'data-profile': k, onclick: () => { applyProfile(k); render('profile'); toast('Profil „' + l + '“ aktiv'); } }, el('div', { class: 'nm' }, el('div', { text: l }), el('div', { class: 'sub', text: dsc }))));
      });
    } else {
      let confirmClear = false; const clr = btn('Gespeicherte Daten löschen', async () => {
        if (!confirmClear) { confirmClear = true; clr.lastChild.textContent = 'Wirklich löschen? Erneut klicken'; return; }
        try { Object.keys(localStorage).filter((k) => k.startsWith('lw.')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* egal */ }
        await idbClear(); toast('Alle lokal gespeicherten Daten wurden gelöscht.'); closeModal();
      }, 'small danger', 'trash');
      tabsSeg.append(
        sw('Letzte Sitzung beim Start automatisch laden', S.prefs.restore, (on) => { S.prefs.restore = on; savePrefs(); if (!on) idbDel('session'); }),
        sw('Erweiterte Bereiche standardmäßig öffnen', S.prefs.advDefault, (on) => { S.prefs.advDefault = on; S.prefs.advOpen = {}; savePrefs(); renderPanel(); }),
        sw('Histogramm anzeigen', S.prefs.showHisto, (on) => { S.prefs.showHisto = on; savePrefs(); applyTabVisibility(); }),
        el('div', { class: 'note', text: 'Presets und Einstellungen liegen im localStorage, das zuletzt geöffnete Foto und die Bearbeitungen je Foto in der IndexedDB dieses Browsers. Nichts verlässt dein Gerät.' }), clr,
        el('div', { class: 'subhead', text: 'Tastenkürzel' }),
        el('div', { class: 'shortcuts' }, ...[['Strg/⌘ Z', 'Rückgängig'], ['Strg/⌘ ⇧ Z', 'Wiederholen'], ['\\', 'Vorher/Nachher'], ['Y', 'Geteilte Ansicht'], ['J', 'Beschnittwarnung'], ['E R M B P', 'Bereiche: Bearbeiten, Zuschnitt, Masken, Pinsel, Presets'], ['0 / 1', 'Einpassen / 100 %'], ['+ / −', 'Zoom'], ['Leertaste', 'Ziehen zum Verschieben'], ['[ / ]', 'Pinselgröße'], ['Alt', 'Pinsel: radieren'], ['O', 'Masken-Überlagerung'], ['Strg/⌘ E', 'Exportieren'], ['Strg/⌘ O', 'Öffnen'], ['Doppelklick', 'Regler zurücksetzen']].flatMap(([k, l]) => [el('span', {}, el('span', { class: 'kbd', text: k })), el('span', { text: l })])));
    }
  };
  const tabs = seg([{ v: 'tools', l: 'Werkzeuge' }, { v: 'profile', l: 'Profile' }, { v: 'general', l: 'Allgemein' }], 'tools', render, 'full');
  openModal('Werkzeugkasten anpassen', [tabs, tabsSeg], [btn('Fertig', closeModal, 'primary', 'check')]);
  render('tools');
}
