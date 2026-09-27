// Schnelle Engine-Tests in Node (Verhalten, nicht nur Syntax)
const PE = require('../src/engine.js');
const W = 1200, H = 800;
function synth(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const t = x / w, u = y / h;
    const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 * 18;
    d[i] = 40 + 180 * t + n; d[i + 1] = 30 + 200 * u + n; d[i + 2] = 60 + 120 * (1 - t) + n; d[i + 3] = 255;
    if (x > w * 0.7 && y < h * 0.3) { d[i] = d[i + 1] = d[i + 2] = 250; }
    if (x < w * 0.2 && y > h * 0.7) { d[i] = 8; d[i + 1] = 10; d[i + 2] = 12; }
  }
  return d;
}
function down(src, w, h, f) { const W2 = Math.round(w / f), H2 = Math.round(h / f); const d = new Uint8ClampedArray(W2 * H2 * 4); for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const si = (Math.min(h - 1, Math.round(y * f)) * w + Math.min(w - 1, Math.round(x * f))) * 4; d.set(src.subarray(si, si + 4), (y * W2 + x) * 4); } return { data: d, w: W2, h: H2 }; }
const src = synth(W, H); const proxy = down(src, W, H, W / 640);
function run(mod, extra) {
  const p = PE.defaultParams(); Object.assign(p.v, mod || {}); if (extra) extra(p);
  const t0 = Date.now();
  const ctx = PE.prepare(p, { fullW: W, fullH: H, proxy, brush: new Map() });
  const proc = PE.processRegion(ctx, src, W, H, 0, 0, W, H, 1);
  const geo = PE.geometry(p, W, H);
  const out = PE.renderOutput(ctx, proc, W, H, 0, 0, 1, geo, false, { x0: 0, y0: 0, w: Math.round(geo.crop.w), h: Math.round(geo.crop.h) }, 1, 'u8');
  return { out, ms: Date.now() - t0, w: Math.round(geo.crop.w), h: Math.round(geo.crop.h) };
}
function stats(o, region) {
  const d = o.out; let s = [0, 0, 0], n = 0, sat = 0;
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    if (region && !region(x / o.w, y / o.h)) continue; const i = (y * o.w + x) * 4;
    s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
  }
  return { r: s[0] / n, g: s[1] / n, b: s[2] / n, y: (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]) / n, sat: sat / n };
}
function lapl(o) { let s = 0; const d = o.out; for (let y = 1; y < o.h - 1; y++) for (let x = 1; x < o.w - 1; x++) { const i = (y * o.w + x) * 4 + 1; s += Math.abs(4 * d[i] - d[i - 4] - d[i + 4] - d[i - o.w * 4] - d[i + o.w * 4]); } return s / (o.w * o.h); }
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const base = run(); const B = stats(base);
console.log('Basis', B, base.ms + 'ms');
// Identität
{ let md = 0; for (let i = 0; i < src.length; i++) md = Math.max(md, Math.abs(src[i] - base.out[i])); ok(md <= 1, 'Neutral = Original (max diff ' + md + ')'); }
const T = (name, mod, check, extra) => { const o = run(mod, extra); const s = stats(o); let r; try { r = check(s, o); } catch (e) { r = false; console.log(e); } ok(r, `${name}  (${o.ms}ms)  y ${B.y.toFixed(1)}→${s.y.toFixed(1)} sat ${B.sat.toFixed(1)}→${s.sat.toFixed(1)}`); return o; };
T('Belichtung +1', { exposure: 1 }, (s) => s.y > B.y + 20);
T('Belichtung -1', { exposure: -1 }, (s) => s.y < B.y - 20);
T('Temperatur +50 (wärmer)', { temp: 50 }, (s) => s.r - s.b > B.r - B.b + 15);
T('Tönung +50 (magenta)', { tint: 50 }, (s) => s.g < B.g - 2 && s.r > B.r);
T('Kontrast +60', { contrast: 60 }, (s, o) => { const d = stats(o, (x, y) => x < 0.2 && y > 0.7), l = stats(o, (x, y) => x > 0.7 && y < 0.3); return d.y <= stats(base, (x, y) => x < 0.2 && y > 0.7).y && lapl(o) >= lapl(base); });
T('Tiefen +80', { shadows: 80 }, (s, o) => stats(o, (x, y) => x < 0.2 && y > 0.7).y > stats(base, (x, y) => x < 0.2 && y > 0.7).y + 8);
T('Lichter -80', { highlights: -80 }, (s, o) => stats(o, (x, y) => x > 0.75 && y < 0.25).y < stats(base, (x, y) => x > 0.75 && y < 0.25).y - 10);
T('Weiß +60', { whites: 60 }, (s) => s.y > B.y + 3);
T('Schwarz -60', { blacks: -60 }, (s, o) => stats(o, (x, y) => x < 0.2 && y > 0.7).y < stats(base, (x, y) => x < 0.2 && y > 0.7).y);
T('Levels Gamma 1.5', { lvGamma: 1.5 }, (s) => s.y > B.y + 5);
T('Klarheit +80', { clarity: 80 }, (s, o) => lapl(o) > lapl(base));
T('Struktur +80', { texture: 80 }, (s, o) => lapl(o) > lapl(base) * 1.1);
T('Struktur -80', { texture: -80 }, (s, o) => lapl(o) < lapl(base) * 0.9);
T('Dunst entfernen +60', { dehaze: 60 }, (s) => Math.abs(s.y - B.y) > 2 || s.sat > B.sat);
T('Dynamik +80', { vibrance: 80 }, (s) => s.sat > B.sat + 3);
T('Sättigung -100 (grau)', { saturation: -100 }, (s) => s.sat < 3);
T('Schwarzweiß', { bw: 1 }, (s) => s.sat < 3);
T('HSL Rot Sättigung -100', { s0: -100 }, (s) => s.sat < B.sat - 2);
T('HSL Blau Luminanz -100', { l5: -100 }, (s) => s.y < B.y);
T('HSL Grün Farbton +100', { h3: 100 }, (s) => Math.abs(s.g - B.g) > 1 || Math.abs(s.r - B.r) > 1);
T('Split-Toning Lichter orange', { gHiS: 80, gHiH: 30, gShS: 80, gShH: 220 }, (s, o) => { const l = stats(o, (x, y) => x > 0.75 && y < 0.25); return l.r > l.b + 5; });
T('Schärfen 150', { sharp: 150, sharpRadius: 1.5 }, (s, o) => lapl(o) > lapl(base) * 1.2);
T('Rauschred. Lum 80', { nrLum: 80 }, (s, o) => lapl(o) < lapl(base) * 0.8);
T('Rauschred. Farbe 80', { nrColor: 80 }, (s) => Math.abs(s.y - B.y) < 3);
T('Vignette -80', { vig: -80 }, (s, o) => stats(o, (x, y) => x < 0.05 && y < 0.05).y < stats(base, (x, y) => x < 0.05 && y < 0.05).y - 10);
T('Vignette +80', { vig: 80 }, (s, o) => stats(o, (x, y) => x < 0.05 && y < 0.05).y > stats(base, (x, y) => x < 0.05 && y < 0.05).y + 5);
T('Körnung 80', { grain: 80 }, (s, o) => lapl(o) > lapl(base) * 1.1);
T('Kurve RGB aufhellen', {}, (s) => s.y > B.y + 8, (p) => { p.curves.rgb = [[0, 0], [0.5, 0.65], [1, 1]]; });
T('Kurve Rot-Kanal', {}, (s) => s.r > B.r + 5 && Math.abs(s.g - B.g) < 2, (p) => { p.curves.r = [[0, 0], [0.5, 0.65], [1, 1]]; });
T('Parametrische Kurve Tiefen+', { cSh: 80 }, (s) => s.y > B.y);
T('Lin. Verlaufsmaske Belichtung -1 (oben)', {}, (s, o) => stats(o, (x, y) => y < 0.1).y < stats(base, (x, y) => y < 0.1).y - 15 && Math.abs(stats(o, (x, y) => y > 0.9).y - stats(base, (x, y) => y > 0.9).y) < 1,
  (p) => p.masks.push({ id: 'm1', type: 'linear', enabled: true, geom: { x1: 0.5, y1: 0, x2: 0.5, y2: 0.5 }, adj: { exposure: -1 } }));
T('Radialmaske Belichtung +1 (Mitte)', {}, (s, o) => stats(o, (x, y) => Math.abs(x - 0.5) < 0.05 && Math.abs(y - 0.5) < 0.05).y > stats(base, (x, y) => Math.abs(x - 0.5) < 0.05 && Math.abs(y - 0.5) < 0.05).y + 15,
  (p) => p.masks.push({ id: 'm2', type: 'radial', enabled: true, geom: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.15, angle: 0, feather: 50 }, adj: { exposure: 1 } }));
T('Radialmaske invertiert', {}, (s, o) => stats(o, (x, y) => Math.abs(x - 0.5) < 0.05 && Math.abs(y - 0.5) < 0.05).y < stats(base, (x, y) => Math.abs(x - 0.5) < 0.05 && Math.abs(y - 0.5) < 0.05).y + 1 && s.y > B.y + 10,
  (p) => p.masks.push({ id: 'm2', type: 'radial', enabled: true, invert: true, geom: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.15, angle: 0, feather: 50 }, adj: { exposure: 1 } }));
T('Helligkeitsmaske (helle Bereiche) -1 EV', {}, (s, o) => stats(o, (x, y) => x > 0.75 && y < 0.25).y < stats(base, (x, y) => x > 0.75 && y < 0.25).y - 20 && Math.abs(stats(o, (x, y) => x < 0.2 && y > 0.7).y - stats(base, (x, y) => x < 0.2 && y > 0.7).y) < 2,
  (p) => p.masks.push({ id: 'm3', type: 'luma', enabled: true, geom: { lo: 0.8, hi: 1, feather: 0.1, smooth: 0.5 }, adj: { exposure: -1 } }));
// Pinsel
{
  const p = PE.defaultParams(); const st = { p: [0.3, 0.5, 0.7, 0.5], s: 0.03, h: 0.5, f: 1, o: 1, e: false };
  const m = { id: 'b1', type: 'brush', enabled: true, strokes: [st], adj: { exposure: 1 } }; p.masks.push(m);
  const ras = PE.rasterizeBrush(m, 960, 640); const brush = new Map([['b1', ras]]);
  const ctx = PE.prepare(p, { fullW: W, fullH: H, proxy, brush }); const proc = PE.processRegion(ctx, src, W, H, 0, 0, W, H, 1);
  const geo = PE.geometry(p, W, H); const out = PE.renderOutput(ctx, proc, W, H, 0, 0, 1, geo, false, { x0: 0, y0: 0, w: W, h: H }, 1, 'u8');
  const o = { out, w: W, h: H };
  const on = stats(o, (x, y) => x > 0.4 && x < 0.6 && Math.abs(y - 0.5) < 0.01).y, bon = stats(base, (x, y) => x > 0.4 && x < 0.6 && Math.abs(y - 0.5) < 0.01).y;
  const off = stats(o, (x, y) => y < 0.3).y, boff = stats(base, (x, y) => y < 0.3).y;
  ok(on > bon + 15 && Math.abs(off - boff) < 0.5, `Pinselmaske (Dodge) Strich +1 EV: ${bon.toFixed(1)}→${on.toFixed(1)}, außerhalb ${boff.toFixed(1)}→${off.toFixed(1)}`);
  st2 = { p: [0.45, 0.5, 0.55, 0.5], s: 0.05, h: 1, f: 1, o: 1, e: true }; m.strokes.push(st2);
  const ras2 = PE.rasterizeBrush(m, 960, 640); let c = ras2.data[320 * 960 + 480];
  ok(c < 0.01 && ras2.data[320 * 960 + 330] > 0.9, 'Radierer entfernt Maske (Mitte ' + c.toFixed(3) + ')');
}
// Geometrie
{
  const o = run({ angle: 10 }); ok(o.w === W && o.h === H, 'Drehung + Auto-Füllen behält Maße');
  let transparent = 0; for (let i = 3; i < o.out.length; i += 4) if (o.out[i] < 250) transparent++; ok(transparent === 0, 'Auto-Füllen: keine leeren Ecken (' + transparent + ')');
  const c = run({}, (p) => { p.geo.crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }; }); ok(c.w === 600 && c.h === 400, 'Zuschnitt 50% → 600×400 (' + c.w + '×' + c.h + ')');
  const r = run({}, (p) => { p.geo.rot90 = 1; }); ok(r.w === H && r.h === W, '90° Drehung tauscht Maße');
  const kv = run({ vert: 50 }); let tr = 0; for (let i = 3; i < kv.out.length; i += 4) if (kv.out[i] < 250) tr++; ok(tr === 0 && lapl(kv) > 0, 'Perspektive vertikal mit Auto-Füllen ohne Lücken');
  const q = run({}, (p) => { p.geo.quad = [0.1, 0.1, 0.9, 0.05, 0.95, 0.95, 0.05, 0.9]; }); ok(q.w === W, '4-Punkt-Perspektive läuft');
  const f = run({}, (p) => { p.geo.flipH = true; }); ok(f.out[0] === base.out[(W - 1) * 4], 'Horizontal spiegeln');
}
// Streifen-Verarbeitung == Gesamtverarbeitung
{
  const p = PE.defaultParams(); Object.assign(p.v, { sharp: 100, nrLum: 40, nrColor: 40, texture: 40, clarity: 30, shadows: 30 });
  const info = { fullW: W, fullH: H, proxy, brush: new Map() }; const ctx = PE.prepare(p, info);
  const whole = PE.processRegion(ctx, src, W, H, 0, 0, W, H, 1);
  const M = PE.margin(ctx, 1, W, H); const strip = new Uint16Array(W * H * 4);
  for (let y0 = 0; y0 < H; y0 += 128) {
    const y1 = Math.min(H, y0 + 128), a = Math.max(0, y0 - M), b = Math.min(H, y1 + M);
    const pr = PE.processRegion(ctx, src.subarray(a * W * 4, b * W * 4), W, b - a, 0, a, W, H, 1);
    strip.set(pr.subarray((y0 - a) * W * 4, (y1 - a) * W * 4), y0 * W * 4);
  }
  let md = 0; for (let i = 0; i < whole.length; i++) md = Math.max(md, Math.abs(whole[i] - strip[i]));
  ok(md < 700, 'Streifenverarbeitung entspricht Gesamtbild (max Δ ' + md + '/65535, Rand ' + M + 'px)');
}
// Auto-Funktionen
{
  const p = PE.defaultParams(); p.v.exposure = -1.5; const info = { fullW: W, fullH: H, proxy, brush: new Map() };
  const r = PE.autoTone(p, info); const q = PE.defaultParams(); Object.assign(q.v, r); const Yq = PE.evalProxy(q, info).Y; const med = Float32Array.from(Yq).sort()[Yq.length >> 1];
  ok(Math.abs(r.exposure - p.v.exposure) > 0.5 && med > 0.38 && med < 0.56, 'Auto-Ton ersetzt Fehlbelichtung (Median danach ' + med.toFixed(2) + '): ' + JSON.stringify(r));
  const wb = PE.autoWB(proxy, p.v); ok(Math.abs(wb.temp) <= 100, 'Auto-WB: ' + JSON.stringify(wb));
  const z = PE.detectZones(PE.defaultParams(), info); ok(z.suggestions.length >= 1, 'Problemzonen: hell ' + (z.bright * 100).toFixed(1) + '%, dunkel ' + (z.dark * 100).toFixed(1) + '%, Vorschläge ' + z.suggestions.map((s) => s.name + ' ' + JSON.stringify(s.adj)).join(' | '));
  const e = PE.wbFromColor(0.2, 0.3, 0.4, PE.DEF); ok(e.temp > 0, 'Pipette: bläuliches Grau → wärmer (' + JSON.stringify(e) + ')');
}
// Performance aller Regler
{ const o = run({ exposure: .3, contrast: 20, highlights: -30, shadows: 30, whites: 10, blacks: -10, clarity: 20, texture: 20, dehaze: 10, vibrance: 20, s2: 20, gShS: 20, gHiS: 20, sharp: 40, nrLum: 20, nrColor: 25, vig: -20, grain: 20 });
  console.log('Alles aktiv, 0.96 MP: ' + o.ms + ' ms'); }
console.log(fails ? fails + ' FEHLER' : 'Alle Engine-Tests bestanden');
