/* ===== Regler, Werkzeuggruppen, Bearbeiten-Panel ===== */
const MINUS = '−';
const FMT = {
  int: (v) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(Math.round(v)),
  plain: (v) => String(Math.round(v)),
  ev: (v) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(2).replace('.', ','),
  dec2: (v) => v.toFixed(2).replace('.', ','), dec1: (v) => v.toFixed(1).replace('.', ','),
  deg: (v) => Math.round(v) + '°', sdeg: (v) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(1).replace('.', ',') + '°',
  pct: (v) => Math.round(v) + ' %',
};
const hsvCss = (h, s, v) => { const c = PE.hsv2rgb(h, s, v); return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`; };
const TRACKS = {
  temp: 'linear-gradient(90deg,#3f7dff,#b9c8e6 45%,#eadfc8 55%,#ffae34)',
  tint: 'linear-gradient(90deg,#39c45a,#c8d8c8 45%,#e2cde0 55%,#d64fcf)',
  hue: 'linear-gradient(90deg,' + [0, 60, 120, 180, 240, 300, 360].map((h) => hsvCss(h, 0.85, 0.95)).join(',') + ')',
  exposure: 'linear-gradient(90deg,#15161b,#6b6e78 50%,#f4f5f8)',
  gray: 'linear-gradient(90deg,#2a2c33,#e8e9ee)',
};

const ctlReg = new Map();
function regCtl(key, fn) { if (!ctlReg.has(key)) ctlReg.set(key, new Set()); ctlReg.get(key).add(fn); }
function refreshControls() { ctlReg.forEach((set) => set.forEach((fn) => { try { fn(); } catch (e) { /* entfernt */ } })); }

/* Regler: def {k,l,min,max,step,def,fmt,track,zero}, io {get,set(v,interactive),label} */
let ctlSeq = 0;
function slider(def, io) {
  const id = 'c' + (++ctlSeq) + '_' + String(def.k).replace(/[^a-z0-9]/gi, '');
  const fmt = FMT[def.fmt || (def.min < 0 ? 'int' : 'plain')];
  const rng = el('input', { type: 'range', id, min: def.min, max: def.max, step: def.step || 1, 'aria-label': def.l });
  const val = el('input', { class: 'val', type: 'text', inputmode: 'decimal', 'aria-label': def.l + ' Wert', spellcheck: 'false' });
  const lab = el('label', { for: id, title: def.tip ? def.l + ' – ' + def.tip : def.l + ' (Doppelklick: zurücksetzen)', text: def.l });
  const row = el('div', { class: 'ctl', 'data-k': def.k }, lab, rng, val);
  const dflt = def.def != null ? def.def : 0;
  const zero = def.zero != null ? def.zero : def.min < 0 ? 0 : def.min;
  const pos = (v) => ((v - def.min) / (def.max - def.min)) * 100;
  if (def.track) { rng.classList.add('special'); }
  const paint = (v) => {
    rng.value = v; val.value = fmt(v);
    const a = pos(zero), b = pos(v); rng.style.setProperty('--lo', Math.min(a, b) + '%'); rng.style.setProperty('--hi', Math.max(a, b) + '%');
    if (def.track) rng.style.setProperty('--special', typeof def.track === 'function' ? def.track() : def.track);
    row.classList.toggle('changed', Math.abs(v - dflt) > 1e-9);
  };
  const cur = () => { const v = io.get(); return v == null ? dflt : v; };
  paint(cur());
  let dragging = false;
  rng.addEventListener('input', () => { dragging = true; const v = parseFloat(rng.value); io.set(v, true); paint(v); });
  rng.addEventListener('change', () => { dragging = false; const v = parseFloat(rng.value); io.set(v, false); paint(v); commit((io.label || def.l) + ' ' + fmt(v)); });
  const reset = () => { io.set(dflt, false); paint(dflt); commit((io.label || def.l) + ' zurückgesetzt'); };
  lab.addEventListener('dblclick', reset); rng.addEventListener('dblclick', reset);
  val.addEventListener('focus', () => val.select());
  const applyText = () => {
    let t = val.value.replace(',', '.').replace(MINUS, '-').replace(/[^0-9.+-]/g, '');
    let v = parseFloat(t); if (!isFinite(v)) { paint(cur()); return; }
    v = clamp(v, def.min, def.max); const st = def.step || 1; v = Math.round(v / st) * st; v = +v.toFixed(4);
    io.set(v, false); paint(v); commit((io.label || def.l) + ' ' + fmt(v));
  };
  val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyText(); val.blur(); } else if (e.key === 'Escape') { paint(cur()); val.blur(); } });
  val.addEventListener('change', applyText);
  regCtl(def.k, () => { if (!dragging && document.activeElement !== val) paint(cur()); });
  return row;
}
function vSlider(def) {
  return slider(def, {
    get: () => S.params.v[def.k],
    set: (v, inter) => { S.params.v[def.k] = v; onParamChange(inter, def.k); },
  });
}
function onParamChange(interactive, key) {
  requestRender(interactive); updateGroupStates();
  if (key && PE.GROUP_KEYS.geo.includes(key)) { geoCache.key = null; if (S.tab === 'crop') { clampView(); } drawOverlay(); }
}
function sw(label, checked, onChange, opts) {
  opts = opts || {};
  const inp = el('input', { type: 'checkbox', id: 'sw' + (++ctlSeq) });
  inp.checked = !!checked;
  inp.addEventListener('change', () => onChange(inp.checked));
  const l = el('label', { class: 'sw', for: inp.id, title: opts.title || null }, el('span', { text: label }), inp, el('span', { class: 'knob' }));
  return l;
}
function seg(items, value, onChange, cls) {
  const s = el('div', { class: 'seg ' + (cls || ''), role: 'tablist' });
  items.forEach((it) => {
    const b = el('button', { type: 'button', class: it.v === value ? 'on' : '', role: 'tab', 'aria-selected': String(it.v === value), title: it.title || null, 'data-v': it.v });
    if (it.icon) b.appendChild(iconEl(it.icon)); if (it.l) b.append(it.l);
    b.addEventListener('click', () => { $$('button', s).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); }); onChange(it.v); });
    s.appendChild(b);
  });
  return s;
}
function iconBtn(ic, title, fn, cls) { const b = el('button', { type: 'button', class: 'icon-btn sm ' + (cls || ''), title, 'aria-label': title }); b.appendChild(iconEl(ic)); b.addEventListener('click', fn); return b; }
function btn(label, fn, cls, ic) { const b = el('button', { type: 'button', class: 'btn ' + (cls || '') }); if (ic) b.appendChild(iconEl(ic)); b.append(label); b.addEventListener('click', fn); return b; }

/* ---------- Gruppendefinitionen ---------- */
const HSL_NAMES = ['Rot', 'Orange', 'Gelb', 'Grün', 'Aquamarin', 'Blau', 'Lila', 'Magenta'];
const d = (k, l, min, max, extra) => Object.assign({ k, l, min, max, def: PE.DEF[k] }, extra || {});
const GROUPS = [
  { id: 'wb', t: 'Weißabgleich', ic: 'thermo',
    basic: [d('temp', 'Temperatur', -100, 100, { track: TRACKS.temp }), d('tint', 'Tönung', -100, 100, { track: TRACKS.tint })],
    adv: [d('rGain', 'Rot-Anteil', -50, 50), d('gGain', 'Grün-Anteil', -50, 50), d('bGain', 'Blau-Anteil', -50, 50)],
    top: wbTools, advTop: wbPresets },
  { id: 'light', t: 'Licht', ic: 'sun',
    basic: [d('exposure', 'Belichtung', -5, 5, { step: 0.01, fmt: 'ev', track: TRACKS.exposure, zero: 0 }), d('contrast', 'Kontrast', -100, 100), d('highlights', 'Lichter', -100, 100), d('shadows', 'Tiefen', -100, 100), d('whites', 'Weiß', -100, 100), d('blacks', 'Schwarz', -100, 100)],
    adv: [d('pivot', 'Kontrast-Mitte', 0, 100, { zero: 50, tip: 'Drehpunkt der Kontrastkurve' }), d('hlRange', 'Lichterbereich', 0, 100, { zero: 50 }), d('shRange', 'Tiefenbereich', 0, 100, { zero: 50 }), d('hsSmooth', 'Halo-Glättung', 0, 100, { zero: 50, tip: 'Radius der lokalen Anpassung für Lichter/Tiefen' }),
      { sub: 'Tonwertkorrektur' }, d('lvInB', 'Eingang Schwarz', 0, 254, { track: TRACKS.gray }), d('lvInW', 'Eingang Weiß', 1, 255, { zero: 255, track: TRACKS.gray }), d('lvGamma', 'Gamma', 0.1, 3, { step: 0.01, fmt: 'dec2', zero: 1 }), d('lvOutB', 'Ausgang Schwarz', 0, 254), d('lvOutW', 'Ausgang Weiß', 1, 255, { zero: 255 })],
    top: lightTools },
  { id: 'presence', t: 'Präsenz', ic: 'presence',
    basic: [d('texture', 'Struktur', -100, 100), d('clarity', 'Klarheit', -100, 100), d('dehaze', 'Dunst entfernen', -100, 100)],
    adv: [d('texRadius', 'Struktur-Radius', 0, 100, { zero: 50 }), d('clarRadius', 'Klarheit-Radius', 0, 100, { zero: 50 }), d('halo', 'Halo-Schutz', 0, 100, { zero: 50 })] },
  { id: 'color', t: 'Farbe', ic: 'drop',
    basic: [d('vibrance', 'Dynamik', -100, 100), d('saturation', 'Sättigung', -100, 100)],
    adv: [d('skin', 'Hauttöne schützen', 0, 100, { tip: 'Dämpft die Dynamik bei Hauttönen' })],
    custom: colorExtras },
  { id: 'hsl', t: 'Farbmischer (HSL)', ic: 'hsl', basic: [], custom: hslEditor, adv: [d('hslWidth', 'Bandbreite', 0, 100, { zero: 50, tip: 'Weichheit der Übergänge zwischen den Farbkanälen' })], advTop: hslAdvTools, ctlList: () => HSL_NAMES.map((n, i) => ({ k: 'hsl' + i, l: n })) },
  { id: 'grading', t: 'Farbüberlagerung', ic: 'grade',
    basic: [{ sub: 'Tiefen' }, d('gShH', 'Farbton', 0, 360, { fmt: 'deg', track: TRACKS.hue, zero: 0 }), d('gShS', 'Sättigung', 0, 100, { track: () => satTrack(S.params.v.gShH) }),
      { sub: 'Lichter' }, d('gHiH', 'Farbton', 0, 360, { fmt: 'deg', track: TRACKS.hue, zero: 0 }), d('gHiS', 'Sättigung', 0, 100, { track: () => satTrack(S.params.v.gHiH) }),
      d('gBal', 'Balance', -100, 100, { tip: 'Verschiebt die Grenze zwischen Tiefen und Lichtern' })],
    adv: [d('gShL', 'Tiefen-Luminanz', -100, 100), d('gHiL', 'Lichter-Luminanz', -100, 100), { sub: 'Mitteltöne' }, d('gMiH', 'Farbton', 0, 360, { fmt: 'deg', track: TRACKS.hue, zero: 0 }), d('gMiS', 'Sättigung', 0, 100, { track: () => satTrack(S.params.v.gMiH) }), d('gMiL', 'Luminanz', -100, 100),
      { sub: 'Global' }, d('gGlH', 'Farbton', 0, 360, { fmt: 'deg', track: TRACKS.hue, zero: 0 }), d('gGlS', 'Sättigung', 0, 100, { track: () => satTrack(S.params.v.gGlH) }), d('gBlend', 'Überblendung', 0, 100, { zero: 50 })] },
  { id: 'curve', t: 'Gradationskurve', ic: 'curve', basic: [], custom: curveEditor,
    adv: [{ sub: 'Parametrisch' }, d('cHi', 'Lichter', -100, 100), d('cLi', 'Helle Töne', -100, 100), d('cDa', 'Dunkle Töne', -100, 100), d('cSh', 'Tiefen', -100, 100), d('cS1', 'Trennung 1', 5, 45, { zero: 25 }), d('cS2', 'Trennung 2', 30, 70, { zero: 50 }), d('cS3', 'Trennung 3', 55, 95, { zero: 75 })],
    advTop: curvePointInputs, ctlList: () => [{ k: 'curveEditor', l: 'Kurveneditor' }] },
  { id: 'detail', t: 'Details', ic: 'detail',
    basic: [{ sub: 'Schärfen' }, d('sharp', 'Betrag', 0, 150), { sub: 'Rauschreduzierung' }, d('nrLum', 'Luminanz', 0, 100), d('nrColor', 'Farbe', 0, 100)],
    adv: [{ sub: 'Schärfen' }, d('sharpRadius', 'Radius', 0.5, 3, { step: 0.1, fmt: 'dec1', zero: 0.5 }), d('sharpDetail', 'Details', 0, 100), d('sharpMask', 'Maskieren', 0, 100), { sw: 'Schärfemaske anzeigen', get: () => S.sharpMaskView, set: (x) => { S.sharpMaskView = x; requestRender(false); } },
      { sub: 'Rauschreduzierung' }, d('nrLumDetail', 'Lum.-Details', 0, 100), d('nrColorDetail', 'Farb-Details', 0, 100)],
    note: 'Schärfe und Rauschen am besten in der 100-%-Ansicht beurteilen.' },
  { id: 'fx', t: 'Effekte', ic: 'fx',
    basic: [d('vig', 'Vignette', -100, 100), d('grain', 'Körnung', 0, 100)],
    adv: [{ sub: 'Vignette' }, d('vigMid', 'Mittelpunkt', 0, 100, { zero: 50 }), d('vigRound', 'Rundheit', -100, 100), d('vigFeather', 'Weiche Kante', 0, 100, { zero: 50 }), d('vigHl', 'Lichter schützen', 0, 100),
      { sub: 'Körnung' }, d('grainSize', 'Größe', 0, 100, { zero: 25 }), d('grainRough', 'Unregelmäßigkeit', 0, 100, { zero: 50 }), d('grainColor', 'Farbkörnung', 0, 100)] },
];
function satTrack(h) { return `linear-gradient(90deg,#8a8c93,${hsvCss(h, 0.9, 0.95)})`; }
function groupCtlList(g) {
  const list = [];
  (g.basic || []).concat(g.adv || []).forEach((c) => { if (c.k) list.push({ k: c.k, l: c.l }); });
  if (g.ctlList) g.ctlList().forEach((c) => list.push(c));
  const seen = new Set(); return list.filter((c) => (seen.has(c.k) ? false : seen.add(c.k)));
}
const isHidden = (key) => !!S.prefs.hidden[key];

/* ---------- Gruppenzustand ---------- */
function groupDirty(g) {
  const v = S.params.v; const keys = PE.GROUP_KEYS[g.id] || [];
  if (keys.some((k) => Math.abs(v[k] - PE.DEF[k]) > 1e-9)) return true;
  if (g.id === 'curve') { const c = S.params.curves; return !['rgb', 'r', 'g', 'b'].every((ch) => PE.isIdentCurve(c[ch])); }
  return false;
}
function updateGroupStates() {
  $$('.grp[data-g]').forEach((card) => { const g = GROUPS.find((x) => x.id === card.dataset.g); if (!g) return; card.classList.toggle('dirty', groupDirty(g)); card.classList.toggle('off', !!S.params.off[g.id]); });
  $$('.mchips .chip[data-g]').forEach((c) => { const g = GROUPS.find((x) => x.id === c.dataset.g); if (g) c.classList.toggle('dirty', groupDirty(g)); });
}
function resetGroup(g) {
  (PE.GROUP_KEYS[g.id] || []).forEach((k) => (S.params.v[k] = PE.DEF[k]));
  if (g.id === 'curve') S.params.curves = PE.defaultParams().curves;
  commit(g.t + ' zurückgesetzt'); refreshControls(); updateGroupStates(); requestRender(false);
  if (g.id === 'curve' || g.id === 'hsl') renderPanel();
}

function buildControls(list, gid) {
  const frag = [];
  for (const c of list) {
    if (c.sub) { frag.push(el('div', { class: 'subhead', text: c.sub })); continue; }
    if (c.sw) { frag.push(sw(c.sw, c.get(), c.set)); continue; }
    if (isHidden('c.' + c.k)) continue;
    frag.push(vSlider(c));
  }
  // leere Zwischenüberschriften entfernen
  return frag.filter((x, i) => !(x.classList.contains('subhead') && (!frag[i + 1] || frag[i + 1].classList.contains('subhead'))));
}
function groupCard(g, forceOpen) {
  const closed = !forceOpen && !!S.prefs.collapsed[g.id];
  const card = el('section', { class: 'grp' + (closed ? ' closed' : ''), 'data-g': g.id });
  const head = el('div', { class: 'grp-h', role: 'button', tabindex: '0', 'aria-expanded': String(!closed) });
  head.append(iconEl('chev', 'chev'), el('div', { class: 't' }, el('span', { text: g.t }), el('i', { class: 'dot', title: 'Geändert' })));
  const pwr = iconBtn(S.params.off[g.id] ? 'eyeOff' : 'eye', 'Gruppe vorübergehend aus-/einblenden', (e) => { e.stopPropagation(); S.params.off[g.id] = !S.params.off[g.id]; pwr.innerHTML = icon(S.params.off[g.id] ? 'eyeOff' : 'eye'); commit(g.t + (S.params.off[g.id] ? ' ausgeschaltet' : ' eingeschaltet')); updateGroupStates(); requestRender(false); });
  const rst = iconBtn('reset', 'Gruppe zurücksetzen', (e) => { e.stopPropagation(); resetGroup(g); });
  head.append(pwr, rst);
  const toggle = () => { if (isMobile()) return; const c = !card.classList.contains('closed'); card.classList.toggle('closed', c); head.setAttribute('aria-expanded', String(!c)); S.prefs.collapsed[g.id] = c; savePrefs(); if (!c) requestAnimationFrame(() => { card.dispatchEvent(new Event('grpopen')); const body = $('#panelBody'); const pb = body.getBoundingClientRect(), cr = card.getBoundingClientRect(); if (cr.bottom > pb.bottom) { const delta = cr.height > pb.height - 20 ? cr.top - pb.top - 8 : cr.bottom - pb.bottom + 12; body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' }); } }); };
  head.addEventListener('click', toggle); head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  const body = el('div', { class: 'grp-b' });
  if (g.top) { const t = g.top(); if (t) body.append(t); }
  body.append(...buildControls(g.basic || [], g.id));
  if (g.custom) { const c = g.custom(card); if (c) body.append(c); }
  const advList = buildControls(g.adv || [], g.id);
  const advTop = g.advTop ? g.advTop() : null;
  if (advList.length || advTop) {
    const open = S.prefs.advOpen[g.id] != null ? S.prefs.advOpen[g.id] : S.prefs.advDefault;
    const adv = el('div', { class: 'adv' + (open ? ' open' : '') });
    const at = el('button', { type: 'button', class: 'adv-t', 'aria-expanded': String(!!open) }); at.append(iconEl('chevR'), 'Erweitert');
    at.addEventListener('click', () => { const o = !adv.classList.contains('open'); adv.classList.toggle('open', o); at.setAttribute('aria-expanded', String(o)); S.prefs.advOpen[g.id] = o; savePrefs(); });
    const ab = el('div', { class: 'adv-b' }); if (advTop) ab.append(advTop); ab.append(...advList);
    adv.append(at, ab); body.append(adv);
  }
  if (g.note) body.append(el('div', { class: 'muted', style: { marginTop: '6px' }, text: g.note }));
  card.append(head, body);
  return card;
}

function renderEditPanel(body) {
  const groups = GROUPS.filter((g) => !isHidden('g.' + g.id));
  if (!groups.length) { body.append(el('div', { class: 'card' }, el('div', { class: 'note', text: 'Alle Werkzeuggruppen sind ausgeblendet. Über „Werkzeugkasten anpassen“ kannst du sie wieder einblenden.' }))); return; }
  if (isMobile()) {
    if (!groups.find((g) => g.id === S.mGroup)) S.mGroup = groups[0].id;
    const chips = el('div', { class: 'mchips', role: 'tablist' });
    groups.forEach((g) => { const c = el('button', { type: 'button', class: 'chip' + (g.id === S.mGroup ? ' on' : ''), 'data-g': g.id }); c.append(iconEl(g.ic), g.t.replace(' (HSL)', '')); c.addEventListener('click', () => { S.mGroup = g.id; renderPanel(); }); chips.append(c); });
    body.append(chips);
    body.append(groupCard(groups.find((g) => g.id === S.mGroup), true));
    requestAnimationFrame(() => { const on = $('.mchips .chip.on'); if (on) { const cc = on.parentElement; cc.scrollLeft = on.offsetLeft - cc.clientWidth / 2 + on.offsetWidth / 2; } });
  } else {
    groups.forEach((g) => body.append(groupCard(g)));
  }
  updateGroupStates();
}

/* ---------- Spezielle Bereiche ---------- */
function wbTools() {
  return el('div', { class: 'row', style: { margin: '2px 0 4px' } },
    btn('Pipette', () => setTool(S.tool === 'wbpick' ? null : 'wbpick'), 'small' + (S.tool === 'wbpick' ? ' primary' : ''), 'pipette'),
    btn('Automatisch', () => { const r = PE.autoWB(S.proxy, S.params.v); S.params.v.temp = r.temp; S.params.v.tint = r.tint; refreshControls(); commit('Auto-Weißabgleich'); onParamChange(false); toast(`Weißabgleich: Temperatur ${FMT.int(r.temp)}, Tönung ${FMT.int(r.tint)}`); }, 'small', 'wand'));
}
const WB_PRESETS = [['Wie Aufnahme', 0, 0], ['Tageslicht', 5, 0], ['Bewölkt', 18, 4], ['Schatten', 32, 6], ['Kunstlicht', -45, 6], ['Leuchtstoff', -22, 28], ['Blitz', 12, 0]];
function wbPresets() {
  const s = el('select', { class: 'inp', 'aria-label': 'Weißabgleich-Vorgabe' }, el('option', { value: '', text: 'Vorgabe wählen …' }), ...WB_PRESETS.map((p, i) => el('option', { value: i, text: p[0] })));
  s.addEventListener('change', () => { if (s.value === '') return; const p = WB_PRESETS[+s.value]; S.params.v.temp = p[1]; S.params.v.tint = p[2]; refreshControls(); commit('Weißabgleich: ' + p[0]); onParamChange(false); s.value = ''; });
  return el('div', { class: 'field', style: { marginBottom: '4px' } }, el('span', { text: 'Vorgabe (relativ zum Foto)' }), s);
}
function lightTools() {
  return el('div', { class: 'row between', style: { margin: '2px 0 4px' } },
    btn('Auto-Ton', () => {
      const t0 = performance.now(); const r = PE.autoTone(PE.effectiveParams(S.params), { fullW: S.img.W, fullH: S.img.H, proxy: S.proxy });
      Object.assign(S.params.v, r); refreshControls(); commit('Auto-Ton'); onParamChange(false);
      toast(`Auto-Ton angewendet (${Math.round(performance.now() - t0)} ms)`, { action: { label: 'Rückgängig', fn: undo } });
    }, 'small', 'wand'),
    el('span', { class: 'muted hide-m', text: 'Doppelklick setzt einen Regler zurück' }));
}
function colorExtras() {
  return sw('Schwarzweiß', !!S.params.v.bw, (on) => { S.params.v.bw = on ? 1 : 0; commit(on ? 'Schwarzweiß' : 'Farbe'); onParamChange(false); renderPanel(); }, { title: 'Im Schwarzweiß-Modus steuert die HSL-Luminanz die Graumischung' });
}
function hslEditor() {
  const wrap = el('div');
  const tab = S.hslTab || 'h';
  wrap.append(el('div', { style: { margin: '2px 0 6px' } }, seg([{ v: 'h', l: 'Farbton' }, { v: 's', l: 'Sättigung' }, { v: 'l', l: S.params.v.bw ? 'Graumischung' : 'Luminanz' }], tab, (v) => { S.hslTab = v; renderPanel(); }, 'full')));
  HSL_NAMES.forEach((n, i) => {
    if (isHidden('c.hsl' + i)) return;
    const hc = PE.BAND_HSV[i]; const k = tab + i;
    let track;
    if (tab === 'h') track = `linear-gradient(90deg,${hsvCss(hc - 30, 0.8, 0.95)},${hsvCss(hc, 0.8, 0.95)},${hsvCss(hc + 30, 0.8, 0.95)})`;
    else if (tab === 's') track = `linear-gradient(90deg,#8a8c93,${hsvCss(hc, 0.95, 0.95)})`;
    else track = `linear-gradient(90deg,${hsvCss(hc, 0.9, 0.22)},${hsvCss(hc, 0.85, 0.85)},${hsvCss(hc, 0.25, 1)})`;
    wrap.append(slider({ k, l: n, min: -100, max: 100, def: 0, track }, { get: () => S.params.v[k], set: (v, inter) => { S.params.v[k] = v; onParamChange(inter, k); }, label: n + ' ' + { h: 'Farbton', s: 'Sättigung', l: 'Luminanz' }[tab] }));
  });
  return wrap;
}
function hslAdvTools() {
  return el('div', { class: 'row', style: { margin: '2px 0 6px' } },
    btn('Zielkorrektur', () => setTool(S.tool === 'tat' ? null : 'tat'), 'small' + (S.tool === 'tat' ? ' primary' : ''), 'target'),
    el('span', { class: 'muted', text: 'Im Bild auf eine Farbe klicken und vertikal ziehen' }));
}

/* ---------- Gradationskurve ---------- */
const CURVE_PRESETS = {
  'Linear': [[0, 0], [1, 1]],
  'Mittlerer Kontrast': [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]],
  'Starker Kontrast': [[0, 0], [0.25, 0.17], [0.75, 0.85], [1, 1]],
  'Matt (Film)': [[0, 0.07], [0.25, 0.25], [0.75, 0.77], [1, 0.95]],
  'Aufhellen': [[0, 0], [0.5, 0.6], [1, 1]],
  'Abdunkeln': [[0, 0], [0.5, 0.4], [1, 1]],
};
const CH_COL = { rgb: '#e8eaf0', r: '#ff5a5a', g: '#4fd67a', b: '#5b8dff' };
function curveEditor(card) {
  const ch = S.curveCh || 'rgb';
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  if (isHidden('c.curveEditor')) return null;
  const top = el('div', { class: 'row between' },
    seg([{ v: 'rgb', l: 'RGB' }, { v: 'r', l: 'R' }, { v: 'g', l: 'G' }, { v: 'b', l: 'B' }], ch, (v) => { S.curveCh = v; S.curveSel = null; renderPanel(); }));
  const pre = el('select', { class: 'inp', style: { width: '150px' }, 'aria-label': 'Kurvenvorgabe' }, el('option', { value: '', text: 'Vorgabe …' }), ...Object.keys(CURVE_PRESETS).map((k) => el('option', { value: k, text: k })));
  pre.addEventListener('change', () => { if (!pre.value) return; S.params.curves[ch] = deep(CURVE_PRESETS[pre.value]); commit('Kurve: ' + pre.value); onParamChange(false); draw(); pre.value = ''; });
  top.append(pre);
  const box = el('div', { class: 'curve-wrap' }); const cv = el('canvas', { 'aria-label': 'Kurveneditor: Klicken fügt Punkte hinzu, Doppelklick entfernt sie' }); box.append(cv);
  wrap.append(top, box, el('div', { class: 'muted', text: 'Klicken: Punkt setzen · Ziehen: verschieben · Doppelklick: Punkt entfernen' }));
  const pts = () => S.params.curves[ch];
  let size = 0;
  function draw() {
    const w = box.clientWidth; if (!w) return; const dpr = window.devicePixelRatio || 1; size = w;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, w);
    // Histogramm
    let mx = 1; for (let i = 2; i < 254; i++) mx = Math.max(mx, histo.l[i]);
    c.beginPath(); c.moveTo(0, w); for (let i = 0; i < 256; i++) c.lineTo(i / 255 * w, w - Math.min(1, histo.l[i] / mx) * w * 0.9); c.lineTo(w, w); c.fillStyle = 'rgba(255,255,255,0.07)'; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1;
    for (let q = 1; q < 4; q++) { c.beginPath(); c.moveTo(q * w / 4, 0); c.lineTo(q * w / 4, w); c.moveTo(0, q * w / 4); c.lineTo(w, q * w / 4); c.stroke(); }
    c.setLineDash([3, 4]); c.beginPath(); c.moveTo(0, w); c.lineTo(w, 0); c.strokeStyle = 'rgba(255,255,255,0.18)'; c.stroke(); c.setLineDash([]);
    ['rgb', 'r', 'g', 'b'].forEach((k) => {
      if (k === ch || PE.isIdentCurve(S.params.curves[k])) return;
      const f = PE.monotoneSpline(S.params.curves[k]); c.beginPath(); for (let i = 0; i <= 64; i++) { const x = i / 64; const y = clamp(f(x), 0, 1); if (i) c.lineTo(x * w, (1 - y) * w); else c.moveTo(x * w, (1 - y) * w); }
      c.strokeStyle = CH_COL[k] + '55'; c.lineWidth = 1.2; c.stroke();
    });
    const f = PE.monotoneSpline(pts()); c.beginPath(); for (let i = 0; i <= 128; i++) { const x = i / 128; const y = clamp(f(x), 0, 1); if (i) c.lineTo(x * w, (1 - y) * w); else c.moveTo(x * w, (1 - y) * w); }
    c.strokeStyle = CH_COL[ch]; c.lineWidth = 2; c.stroke();
    pts().forEach((p, i) => { c.beginPath(); c.arc(p[0] * w, (1 - p[1]) * w, i === S.curveSel ? 6 : 4.5, 0, Math.PI * 2); c.fillStyle = i === S.curveSel ? CH_COL[ch] : '#12141b'; c.fill(); c.strokeStyle = CH_COL[ch]; c.lineWidth = 1.6; c.stroke(); });
  }
  const toN = (e) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]; };
  let drag = -1;
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); const [x, y] = toN(e); const arr = pts(); const tol = 12 / (size || 200);
    let hit = -1, best = 1e9; arr.forEach((p, i) => { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < tol * 1.3 && dd < best) { best = dd; hit = i; } });
    if (hit < 0) { const cur = S.params.curves[ch] = arr.concat([[x, y]]).sort((a, b) => a[0] - b[0]); hit = cur.findIndex((p) => p[0] === x && p[1] === y); }
    drag = hit; S.curveSel = hit; cv.setPointerCapture(e.pointerId); draw(); onParamChange(true); refreshPointInputs();
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0) return; const [x, y] = toN(e); const arr = pts(); const lo = drag > 0 ? arr[drag - 1][0] + 0.01 : 0, hi = drag < arr.length - 1 ? arr[drag + 1][0] - 0.01 : 1;
    arr[drag] = [+clamp(x, lo, hi).toFixed(4), +y.toFixed(4)]; draw(); onParamChange(true); refreshPointInputs();
  });
  const end = () => { if (drag >= 0) { drag = -1; commit('Gradationskurve'); onParamChange(false); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', (e) => {
    const [x, y] = toN(e); const arr = pts(); const tol = 14 / (size || 200);
    const i = arr.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < tol);
    if (i > 0 && i < arr.length - 1) { arr.splice(i, 1); S.curveSel = null; commit('Kurvenpunkt entfernt'); onParamChange(false); draw(); refreshPointInputs(); }
  });
  curveDrawFns.add(draw);
  card && card.addEventListener('grpopen', draw);
  requestAnimationFrame(draw);
  if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(box);
  return wrap;
}
const curveDrawFns = new Set();
function redrawCurves() { curveDrawFns.forEach((f) => { if (!document.contains(f.box)) { /* noop */ } try { f(); } catch (e) { /* weg */ } }); }
let pointInputsRefresh = () => {};
function refreshPointInputs() { pointInputsRefresh(); }
function curvePointInputs() {
  const wrap = el('div', { class: 'grid2', style: { marginBottom: '6px' } });
  const iIn = el('input', { class: 'inp', type: 'number', min: 0, max: 255, 'aria-label': 'Eingang' }), iOut = el('input', { class: 'inp', type: 'number', min: 0, max: 255, 'aria-label': 'Ausgabe' });
  wrap.append(el('label', { class: 'field' }, el('span', { text: 'Punkt: Eingang' }), iIn), el('label', { class: 'field' }, el('span', { text: 'Punkt: Ausgabe' }), iOut));
  pointInputsRefresh = () => {
    const arr = S.params.curves[S.curveCh || 'rgb']; const p = S.curveSel != null ? arr[S.curveSel] : null;
    iIn.disabled = iOut.disabled = !p; iIn.value = p ? Math.round(p[0] * 255) : ''; iOut.value = p ? Math.round(p[1] * 255) : '';
    iIn.placeholder = iOut.placeholder = p ? '' : 'Punkt wählen';
  };
  const apply = () => {
    const ch = S.curveCh || 'rgb'; const arr = S.params.curves[ch]; const i = S.curveSel; if (i == null || !arr[i]) return;
    const lo = i > 0 ? arr[i - 1][0] + 0.01 : 0, hi = i < arr.length - 1 ? arr[i + 1][0] - 0.01 : 1;
    arr[i] = [clamp((+iIn.value || 0) / 255, lo, hi), clamp((+iOut.value || 0) / 255, 0, 1)];
    commit('Kurvenpunkt'); onParamChange(false); redrawCurves();
  };
  iIn.addEventListener('change', apply); iOut.addEventListener('change', apply);
  pointInputsRefresh();
  return wrap;
}
