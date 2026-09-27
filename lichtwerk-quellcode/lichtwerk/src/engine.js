/* Lichtwerk – Bildverarbeitungs-Engine (reine CPU-Pipeline, keine Abhängigkeiten) */
(function (G) {
  'use strict';
  const F32 = Float32Array;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sm01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const smoothstep = (a, b, x) => sm01((x - a) / (b - a));

  /* ---------- Farbraum-Tabellen ---------- */
  const S2L8 = new F32(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; S2L8[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const LN = 4096;
  const L2S = new F32(LN + 2), S2L = new F32(LN + 2);
  for (let i = 0; i <= LN + 1; i++) {
    const v = i / LN;
    L2S[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function l2s(v) {
    if (!(v > 0)) return 0;
    if (v >= 1) return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    const f = v * LN, i = f | 0; return L2S[i] + (L2S[i + 1] - L2S[i]) * (f - i);
  }
  function s2l(v) {
    if (!(v > 0)) return 0;
    if (v >= 1) return Math.pow((v + 0.055) / 1.055, 2.4);
    const f = v * LN, i = f | 0; return S2L[i] + (S2L[i + 1] - S2L[i]) * (f - i);
  }
  const OK = new F32(3);
  function lin2ok(r, g, b, o) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    o[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    o[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  }
  function ok2lin(L, a, b, o) {
    let l = L + 0.3963377774 * a + 0.2158037573 * b;
    let m = L - 0.1055613458 * a - 0.0638541728 * b;
    let s = L - 0.0894841775 * a - 1.2914855480 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    o[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    o[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    o[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  }
  function hsv2rgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 60; const i = Math.floor(h), f = h - i;
    const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  }
  // Richtung (Oklab-Farbwinkel) eines HSV-Farbtons
  function hueDir(deg) {
    const c = hsv2rgb(deg, 1, 1); lin2ok(s2l(c[0]), s2l(c[1]), s2l(c[2]), OK);
    const n = Math.hypot(OK[1], OK[2]) || 1; return [OK[1] / n, OK[2] / n];
  }
  const BAND_HSV = [0, 30, 60, 120, 180, 240, 270, 300];
  const BAND_OK = BAND_HSV.map((d) => { const v = hueDir(d); let a = Math.atan2(v[1], v[0]); if (a < 0) a += TAU; return a; });

  /* ---------- Standardwerte ---------- */
  const DEF = {
    temp: 0, tint: 0, rGain: 0, gGain: 0, bGain: 0,
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    pivot: 50, hsSmooth: 50, hlRange: 50, shRange: 50,
    lvInB: 0, lvInW: 255, lvGamma: 1, lvOutB: 0, lvOutW: 255,
    texture: 0, clarity: 0, dehaze: 0, clarRadius: 50, texRadius: 50, halo: 50,
    vibrance: 0, saturation: 0, skin: 50, bw: 0,
    hslWidth: 50,
    gShH: 220, gShS: 0, gShL: 0, gMiH: 40, gMiS: 0, gMiL: 0, gHiH: 45, gHiS: 0, gHiL: 0, gGlH: 30, gGlS: 0, gBal: 0, gBlend: 50,
    cHi: 0, cLi: 0, cDa: 0, cSh: 0, cS1: 25, cS2: 50, cS3: 75,
    sharp: 0, sharpRadius: 1, sharpDetail: 25, sharpMask: 0, nrLum: 0, nrLumDetail: 50, nrColor: 0, nrColorDetail: 50,
    vig: 0, vigMid: 50, vigRound: 0, vigFeather: 50, vigHl: 0, grain: 0, grainSize: 25, grainRough: 50, grainColor: 0,
    angle: 0, vert: 0, horz: 0, geoAspect: 0, geoScale: 100, offX: 0, offY: 0, autoFill: 1,
  };
  for (let i = 0; i < 8; i++) { DEF['h' + i] = 0; DEF['s' + i] = 0; DEF['l' + i] = 0; }
  const GROUP_KEYS = {
    wb: ['temp', 'tint', 'rGain', 'gGain', 'bGain'],
    light: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'pivot', 'hsSmooth', 'hlRange', 'shRange', 'lvInB', 'lvInW', 'lvGamma', 'lvOutB', 'lvOutW'],
    presence: ['texture', 'clarity', 'dehaze', 'clarRadius', 'texRadius', 'halo'],
    color: ['vibrance', 'saturation', 'skin', 'bw'],
    hsl: ['hslWidth'].concat([0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => ['h' + i, 's' + i, 'l' + i])),
    grading: ['gShH', 'gShS', 'gShL', 'gMiH', 'gMiS', 'gMiL', 'gHiH', 'gHiS', 'gHiL', 'gGlH', 'gGlS', 'gBal', 'gBlend'],
    curve: ['cHi', 'cLi', 'cDa', 'cSh', 'cS1', 'cS2', 'cS3'],
    detail: ['sharp', 'sharpRadius', 'sharpDetail', 'sharpMask', 'nrLum', 'nrLumDetail', 'nrColor', 'nrColorDetail'],
    fx: ['vig', 'vigMid', 'vigRound', 'vigFeather', 'vigHl', 'grain', 'grainSize', 'grainRough', 'grainColor'],
    geo: ['angle', 'vert', 'horz', 'geoAspect', 'geoScale', 'offX', 'offY', 'autoFill'],
  };
  const PE_GK = GROUP_KEYS;
  const LOCAL_DEF = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, clarity: 0, temp: 0, tint: 0, dehaze: 0, colorHue: 35, colorAmt: 0 };
  const IDENT = () => [[0, 0], [1, 1]];
  function defaultParams() {
    return {
      v: Object.assign({}, DEF),
      curves: { rgb: IDENT(), r: IDENT(), g: IDENT(), b: IDENT() },
      geo: { rot90: 0, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 }, ratio: 'free', quad: null },
      masks: [],
      off: {},
    };
  }

  /* ---------- Puffer-Pool ---------- */
  const pool = {};
  function buf(name, n) { let a = pool[name]; if (!a || a.length < n) { a = pool[name] = new F32(Math.ceil(n * 1.05)); } return a.subarray(0, n); }

  /* ---------- Weichzeichner ---------- */
  function boxH(src, dst, w, h, r) {
    if (r < 1) { dst.set(src); return; }
    const inv = 1 / (2 * r + 1), wm = w - 1;
    for (let y = 0; y < h; y++) {
      const o = y * w; let acc = src[o] * (r + 1);
      for (let i = 1; i <= r; i++) acc += src[o + (i < wm ? i : wm)];
      for (let x = 0; x < w; x++) {
        dst[o + x] = acc * inv;
        const xa = x + r + 1, xs = x - r;
        acc += src[o + (xa < wm ? xa : wm)] - src[o + (xs > 0 ? xs : 0)];
      }
    }
  }
  const accPool = { a: new Float64Array(16) };
  function boxV(src, dst, w, h, r) {
    if (r < 1) { dst.set(src); return; }
    const inv = 1 / (2 * r + 1), hm = h - 1;
    if (accPool.a.length < w) accPool.a = new Float64Array(w);
    const acc = accPool.a;
    for (let x = 0; x < w; x++) acc[x] = src[x] * (r + 1);
    for (let i = 1; i <= r; i++) { const o = (i < hm ? i : hm) * w; for (let x = 0; x < w; x++) acc[x] += src[o + x]; }
    for (let y = 0; y < h; y++) {
      const o = y * w; const ya = y + r + 1, ys = y - r;
      const oa = (ya < hm ? ya : hm) * w, os = (ys > 0 ? ys : 0) * w;
      for (let x = 0; x < w; x++) { dst[o + x] = acc[x] * inv; acc[x] += src[oa + x] - src[os + x]; }
    }
  }
  function box(src, dst, tmp, w, h, r) { boxH(src, tmp, w, h, r); boxV(tmp, dst, w, h, r); }
  function boxesForGauss(sigma, n) {
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    const wu = wl + 2; const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal); const r = [];
    for (let i = 0; i < n; i++) r.push(((i < m ? wl : wu) - 1) / 2);
    return r;
  }
  function kernelBlur(src, dst, tmp, w, h, sigma) {
    const rad = Math.max(1, Math.ceil(sigma * 3)); const k = new F32(2 * rad + 1); let s = 0;
    for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + rad]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const wm = w - 1, hm = h - 1;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = -rad; i <= rad; i++) { let xx = x + i; xx = xx < 0 ? 0 : xx > wm ? wm : xx; acc += src[o + xx] * k[i + rad]; }
        tmp[o + x] = acc;
      }
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) dst[o + x] = 0;
      for (let i = -rad; i <= rad; i++) {
        let yy = y + i; yy = yy < 0 ? 0 : yy > hm ? hm : yy; const oo = yy * w, kk = k[i + rad];
        for (let x = 0; x < w; x++) dst[o + x] += tmp[oo + x] * kk;
      }
    }
  }
  function gauss(src, dst, tmp, w, h, sigma) {
    if (sigma < 0.2) { dst.set(src); return; }
    if (sigma <= 1.6) { kernelBlur(src, dst, tmp, w, h, sigma); return; }
    const rs = boxesForGauss(sigma, 3);
    box(src, dst, tmp, w, h, rs[0]); box(dst, dst, tmp, w, h, rs[1]); box(dst, dst, tmp, w, h, rs[2]);
  }
  function gaussMargin(sigma) { if (sigma < 0.2) return 0; if (sigma <= 1.6) return Math.ceil(sigma * 3); const r = boxesForGauss(sigma, 3); return r[0] + r[1] + r[2] + 1; }
  // Guided Filter (He et al.), selbstgeführt
  function guidedSelf(I, w, h, r, eps, out) {
    const n = w * h; const mI = new F32(n), mII = new F32(n), tmp = new F32(n), II = new F32(n);
    for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
    box(I, mI, tmp, w, h, r); box(II, mII, tmp, w, h, r);
    for (let i = 0; i < n; i++) { const m = mI[i]; const v = mII[i] - m * m; const a = v / (v + eps); II[i] = a; mII[i] = m - a * m; }
    box(II, mI, tmp, w, h, r); box(mII, II, tmp, w, h, r);
    for (let i = 0; i < n; i++) out[i] = mI[i] * I[i] + II[i];
    return out;
  }
  // Guided Filter mit separater Führung (Guide I, Eingang p)
  function guidedJoint(I, p, w, h, r, eps, out, tag) {
    const n = w * h; const mI = buf(tag + 'gA', n), mp = buf(tag + 'gB', n), mIp = buf(tag + 'gC', n), mII = buf(tag + 'gD', n), tmp = buf(tag + 'gE', n);
    for (let i = 0; i < n; i++) { mIp[i] = I[i] * p[i]; mII[i] = I[i] * I[i]; }
    box(I, mI, tmp, w, h, r); box(p, mp, tmp, w, h, r); box(mIp, mIp, tmp, w, h, r); box(mII, mII, tmp, w, h, r);
    for (let i = 0; i < n; i++) {
      const cov = mIp[i] - mI[i] * mp[i]; const v = mII[i] - mI[i] * mI[i];
      const a = cov / (v + eps); mIp[i] = a; mII[i] = mp[i] - a * mI[i];
    }
    box(mIp, mI, tmp, w, h, r); box(mII, mp, tmp, w, h, r);
    for (let i = 0; i < n; i++) out[i] = mI[i] * I[i] + mp[i];
    return out;
  }
  function minFilter(src, dst, w, h, r) {
    const tmp = new F32(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) { let m = 1e9; const a = Math.max(0, x - r), b = Math.min(w - 1, x + r); for (let i = a; i <= b; i++) { const v = src[o + i]; if (v < m) m = v; } tmp[o + x] = m; }
    }
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) { let m = 1e9; for (let i = a; i <= b; i++) { const v = tmp[i * w + x]; if (v < m) m = v; } dst[y * w + x] = m; }
    }
  }

  /* ---------- Kurven ---------- */
  function monotoneSpline(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0]);
    const n = p.length; const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    if (n === 1) return () => ys[0];
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
      const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
    };
  }
  const CN = 1024;
  function isIdentCurve(c) { return !c || (c.length === 2 && c[0][0] === 0 && c[0][1] === 0 && c[1][0] === 1 && c[1][1] === 1); }
  function curveLUT(pts, pre) {
    const f = monotoneSpline(pts); const lut = new F32(CN + 1);
    for (let i = 0; i <= CN; i++) { let x = i / CN; if (pre) x = pre(x); lut[i] = clamp(f(clamp(x, 0, 1)), 0, 1); }
    return lut;
  }
  function paramCurveFn(v) {
    const s1 = v.cS1 / 100, s2 = v.cS2 / 100, s3 = v.cS3 / 100;
    const reg = [[0, s1, v.cSh], [s1, s2, v.cDa], [s2, s3, v.cLi], [s3, 1, v.cHi]];
    return function (x) {
      let y = x;
      for (let i = 0; i < 4; i++) {
        const amt = reg[i][2]; if (!amt) continue;
        const c = (reg[i][0] + reg[i][1]) / 2, wd = Math.max(0.05, reg[i][1] - reg[i][0]) * 0.75;
        const bump = Math.exp(-((x - c) * (x - c)) / (2 * wd * wd)) * Math.sqrt(Math.max(0, 4 * x * (1 - x)));
        y += (amt / 100) * 0.16 * bump;
      }
      return y;
    };
  }
  function lutEval(lut, v) {
    if (v <= 0) return lut[0] + v;
    if (v >= 1) return lut[CN] + (v - 1);
    const f = v * CN, i = f | 0; return lut[i] + (lut[i + 1] - lut[i]) * (f - i);
  }

  /* ---------- Tonwert-Funktionen ---------- */
  function hsDelta(base, sh, hl, shR, hlR) {
    let d = 0;
    if (sh) {
      const t = base / shR;
      if (t < 1 && t > 0) { const f = (1 - t) * (1 - t) * Math.sqrt(t) * 2.3; d += sh * 0.32 * f * (sh < 0 ? Math.min(1, base * 4) : 1); }
    }
    if (hl) {
      const t = (base - (1 - hlR)) / hlR;
      if (t > 0) { const f = Math.pow(Math.min(t, 2), 1.6); d += hl * 0.32 * f; }
    }
    return d;
  }
  function makeToneFn(v) {
    const w = v.whites / 100, b = v.blacks / 100, c = v.contrast / 100;
    const k = Math.pow(2, c * 1.05), p = 0.25 + (v.pivot / 100) * 0.5;
    const lv = v.lvInB !== 0 || v.lvInW !== 255 || v.lvGamma !== 1 || v.lvOutB !== 0 || v.lvOutW !== 255;
    const inB = v.lvInB / 255, inW = Math.max(inB + 1 / 255, v.lvInW / 255), gm = Math.max(0.05, v.lvGamma), oB = v.lvOutB / 255, oW = v.lvOutW / 255;
    const active = !!(w || b || c || lv);
    return {
      active,
      f(x) {
        let y = x;
        if (w) y += w * 0.25 * (x >= 1 ? 1 : smoothstep(0.35, 1, x));
        if (b) y += b * 0.12 * (1 - smoothstep(0, 0.55, x));
        if (c) {
          if (y <= 0) y = y;
          else if (y < p) y = p * Math.pow(y / p, k);
          else if (y < 1) y = 1 - (1 - p) * Math.pow((1 - y) / (1 - p), k);
          else y = 1 + (y - 1) * (k > 1 ? 1 / k : 1);
        }
        if (lv) { y = (y - inB) / (inW - inB); if (y > 0) y = Math.pow(y, 1 / gm); y = oB + y * (oW - oB); }
        return y;
      },
    };
  }
  const TN = 2048, TMAX = 2;
  function buildLUT(fn, n, max) { const l = new F32(n + 1); for (let i = 0; i <= n; i++) l[i] = fn((i / n) * max); return l; }
  function evalLUT(l, n, max, x) {
    if (x <= 0) return l[0] + x;
    const f = (x / max) * n; if (f >= n) return l[n] + (x - max);
    const i = f | 0; return l[i] + (l[i + 1] - l[i]) * (f - i);
  }
  function applyLum(R, G, B, i, Y, Y2) {
    if (Y2 <= Y) {
      if (Y > 1e-5) { let f = Y2 / Y; if (f < 0) f = 0; R[i] *= f; G[i] *= f; B[i] *= f; }
      else { const z = Y2 > 0 ? Y2 : 0; R[i] = G[i] = B[i] = z; }
    } else {
      const d = Y2 - Y;
      if (Y > 1e-4) { const q = 0.5 * d / Y, h = 0.5 * d; R[i] += h + R[i] * q; G[i] += h + G[i] * q; B[i] += h + B[i] * q; }
      else { R[i] += d; G[i] += d; B[i] += d; }
    }
  }

  /* ---------- Farbtabellen ---------- */
  const HN = 1440;
  function buildHueLUT(v) {
    const dh = new F32(HN), ds = new F32(HN), dl = new F32(HN), skin = new F32(HN);
    const p = Math.pow(2, (50 - v.hslWidth) / 25);
    const skinC = (55 / 360) * TAU, skinW = (24 / 360) * TAU;
    for (let k = 0; k < HN; k++) {
      const h = (k + 0.5) / HN * TAU;
      let ia = 7;
      for (let j = 0; j < 8; j++) { if (h >= BAND_OK[j]) ia = j; }
      if (h < BAND_OK[0]) ia = 7;
      const ib = (ia + 1) % 8;
      let a0 = BAND_OK[ia], a1 = BAND_OK[ib]; if (a1 <= a0) a1 += TAU;
      let hh = h; if (hh < a0) hh += TAU;
      const t = clamp((hh - a0) / (a1 - a0), 0, 1);
      let wa = Math.pow(1 - t, p), wb = Math.pow(t, p); const sN = wa + wb; wa /= sN; wb /= sN;
      dh[k] = ((v['h' + ia] * wa + v['h' + ib] * wb) / 100) * (30 / 180) * Math.PI;
      ds[k] = (v['s' + ia] * wa + v['s' + ib] * wb) / 100;
      dl[k] = (v['l' + ia] * wa + v['l' + ib] * wb) / 100;
      let dd = Math.abs(h - skinC); if (dd > Math.PI) dd = TAU - dd;
      skin[k] = Math.exp(-(dd * dd) / (2 * skinW * skinW));
    }
    return { dh, ds, dl, skin };
  }

  /* ---------- Vorbereitung ---------- */
  const nz = (x) => Math.abs(x) > 1e-9;
  function localActive(m) {
    const a = m.adj || {}; return nz(a.exposure) || nz(a.contrast) || nz(a.highlights) || nz(a.shadows) || nz(a.saturation) || nz(a.clarity) || nz(a.temp) || nz(a.tint) || nz(a.dehaze) || nz(a.colorAmt);
  }
  function prepare(params, info) {
    const v = params.v;
    const ctx = { v, params, fullW: info.fullW, fullH: info.fullH, L0: Math.max(info.fullW, info.fullH), debug: info.debug || {} };
    let mr = Math.pow(2, v.temp / 100 * 0.5 + v.rGain / 100 * 0.5), mg = Math.pow(2, -v.tint / 100 * 0.5 + v.gGain / 100 * 0.5), mb = Math.pow(2, -v.temp / 100 * 0.5 + v.bGain / 100 * 0.5);
    const norm = 0.2126 * mr + 0.7152 * mg + 0.0722 * mb; mr /= norm; mg /= norm; mb /= norm;
    const e = Math.pow(2, v.exposure);
    ctx.mul = [mr * e, mg * e, mb * e];
    ctx.loadLUT = [0, 1, 2].map((c) => { const l = new F32(256); for (let i = 0; i < 256; i++) l[i] = l2s(S2L8[i] * ctx.mul[c]); return l; });
    ctx.needNR = v.nrLum > 0 || v.nrColor > 0;
    ctx.gDehaze = v.dehaze / 100;
    const masks = (params.masks || []).filter((m) => m.enabled !== false && (localActive(m) || ctx.debug.maskId === m.id));
    ctx.masks = masks;
    ctx.needT = nz(ctx.gDehaze) || masks.some((m) => nz(m.adj.dehaze));
    ctx.shR = 0.3 + v.shRange / 100 * 0.5; ctx.hlR = 0.3 + v.hlRange / 100 * 0.5;
    ctx.needHS = nz(v.highlights) || nz(v.shadows);
    if (ctx.needHS) ctx.hsLUT = buildLUT((b) => hsDelta(b, v.shadows / 100, v.highlights / 100, ctx.shR, ctx.hlR), 1536, 1.5);
    const tone = makeToneFn(v); ctx.needTone = tone.active;
    if (tone.active) ctx.toneLUT = buildLUT(tone.f, TN, TMAX);
    ctx.needClar = nz(v.clarity) || masks.some((m) => nz(m.adj.clarity));
    ctx.needTex = nz(v.texture);
    // Kurven
    const c = params.curves || {};
    const paramOn = nz(v.cHi) || nz(v.cLi) || nz(v.cDa) || nz(v.cSh);
    ctx.curveM = (!isIdentCurve(c.rgb) || paramOn) ? curveLUT(c.rgb || IDENT(), paramOn ? paramCurveFn(v) : null) : null;
    ctx.curveR = isIdentCurve(c.r) ? null : curveLUT(c.r);
    ctx.curveG = isIdentCurve(c.g) ? null : curveLUT(c.g);
    ctx.curveB = isIdentCurve(c.b) ? null : curveLUT(c.b);
    ctx.needCurves = !!(ctx.curveM || ctx.curveR || ctx.curveG || ctx.curveB);
    // Farbe
    let hslOn = false; for (let i = 0; i < 8; i++) if (v['h' + i] || v['s' + i] || v['l' + i]) hslOn = true;
    ctx.hslOn = hslOn; if (hslOn || nz(v.vibrance)) ctx.hue = buildHueLUT(v);
    const gz = (h, s) => { const d = hueDir(h); return [d[0] * s / 100 * 0.085, d[1] * s / 100 * 0.085]; };
    ctx.grade = { sh: gz(v.gShH, v.gShS), mi: gz(v.gMiH, v.gMiS), hi: gz(v.gHiH, v.gHiS), gl: gz(v.gGlH, v.gGlS), shL: v.gShL / 100 * 0.12, miL: v.gMiL / 100 * 0.12, hiL: v.gHiL / 100 * 0.12, p: 0.6 - v.gBal / 100 * 0.25, tw: 0.08 + v.gBlend / 100 * 0.3 };
    ctx.gradeOn = !!(v.gShS || v.gMiS || v.gHiS || v.gGlS || v.gShL || v.gMiL || v.gHiL);
    ctx.needColor = hslOn || nz(v.vibrance) || nz(v.saturation) || !!v.bw || ctx.gradeOn;
    ctx.needSharp = v.sharp > 0 || !!ctx.debug.sharpMask;
    ctx.needVig = nz(v.vig); ctx.needGrain = v.grain > 0;
    // Masken kompilieren
    ctx.cmasks = masks.map((m) => compileMask(m, ctx, info));
    // Proxy (gecacht, da nur von globalen Tonwertparametern abhängig)
    ctx.wantLuma = !!info.wantLuma || ctx.cmasks.some((c) => c.type === 'luma' || c.range);
    if (info.proxy) {
      const key = JSON.stringify([['temp', 'tint', 'rGain', 'gGain', 'bGain', 'exposure', 'dehaze', 'highlights', 'shadows', 'whites', 'blacks', 'contrast', 'pivot', 'hsSmooth', 'hlRange', 'shRange', 'lvInB', 'lvInW', 'lvGamma', 'lvOutB', 'lvOutW', 'clarRadius'].map((k) => v[k]), ctx.needT, ctx.needClar, ctx.wantLuma, ctx.cmasks.some((c) => c.hsOn)]);
      if (proxyCache.src === info.proxy && proxyCache.key === key) { ctx.pmap = proxyCache.pm; ctx.A = proxyCache.A; }
      else { ctx.pmap = proxyMaps(ctx, info.proxy); proxyCache = { src: info.proxy, key, pm: ctx.pmap, A: ctx.A }; }
    }
    return ctx;
  }

  let proxyCache = {};
  function compileMask(m, ctx, info) {
    const a = Object.assign({}, LOCAL_DEF, m.adj || {});
    const cm = { m, id: m.id, type: m.type, inv: !!m.invert, op: (m.opacity == null ? 100 : m.opacity) / 100, a };
    const tr = a.temp / 100 * 0.5, ti = a.tint / 100 * 0.5, ex = a.exposure;
    cm.mul = [Math.pow(2, ex + tr), Math.pow(2, ex - ti), Math.pow(2, ex - tr)];
    cm.linOn = nz(ex) || nz(tr) || nz(ti);
    cm.hsOn = nz(a.highlights) || nz(a.shadows);
    cm.k = Math.pow(2, a.contrast / 100 * 1.0);
    cm.col = hsv2rgb(a.colorHue, 1, 1).map((x) => x);
    cm.colY = 0.2126 * cm.col[0] + 0.7152 * cm.col[1] + 0.0722 * cm.col[2];
    const g = m.geom || {};
    const Lw = info.fullW / ctx.L0, Lh = info.fullH / ctx.L0; cm.Lw = Lw; cm.Lh = Lh;
    if (m.type === 'linear') {
      const x1 = g.x1 * Lw, y1 = g.y1 * Lh, x2 = g.x2 * Lw, y2 = g.y2 * Lh; const dx = x2 - x1, dy = y2 - y1; const d2 = Math.max(1e-9, dx * dx + dy * dy);
      cm.lin = { x1, y1, dx: dx / d2, dy: dy / d2 };
    } else if (m.type === 'radial') {
      const ang = (g.angle || 0) * Math.PI / 180;
      cm.rad = { cx: g.cx * Lw, cy: g.cy * Lh, rx: Math.max(1e-4, g.rx), ry: Math.max(1e-4, g.ry), ca: Math.cos(ang), sa: Math.sin(ang), f: Math.max(0.01, (g.feather == null ? 50 : g.feather) / 100) };
    } else if (m.type === 'brush') {
      cm.raster = info.brush ? info.brush.get(m.id) : null;
    } else if (m.type === 'luma') {
      cm.rng = { lo: g.lo, hi: g.hi, fe: Math.max(0.005, g.feather), sm: g.smooth == null ? 0.6 : g.smooth };
    }
    const r = m.range;
    if (r && r.on) cm.range = { lo: r.lo / 100, hi: r.hi / 100, fe: Math.max(0.005, r.feather / 100), sm: (r.smooth == null ? 30 : r.smooth) / 100 };
    return cm;
  }

  /* ---------- Block-Struktur ---------- */
  function makeBlock(w, h, tag) {
    const n = w * h; tag = tag || '';
    return { w, h, n, R: buf(tag + 'R', n), G: buf(tag + 'G', n), B: buf(tag + 'B', n), A: new Uint8Array(n), tag };
  }
  function lumaInto(b, Y) { const R = b.R, G = b.G, B = b.B; for (let i = 0; i < b.n; i++) Y[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; return Y; }

  function loadStage(ctx, b, src) {
    const lr = ctx.loadLUT[0], lg = ctx.loadLUT[1], lb = ctx.loadLUT[2]; const R = b.R, G = b.G, B = b.B, A = b.A;
    for (let i = 0, j = 0; i < b.n; i++, j += 4) { R[i] = lr[src[j]]; G[i] = lg[src[j + 1]]; B[i] = lb[src[j + 2]]; A[i] = src[j + 3]; }
  }

  function proxyMaps(ctx, proxy) {
    const v = ctx.v; const w = proxy.w, h = proxy.h, n = w * h;
    const b = { w, h, n, R: new F32(n), G: new F32(n), B: new F32(n), A: new Uint8Array(n), tag: 'p' };
    loadStage(ctx, b, proxy.data);
    const pm = { w, h };
    const Lp = Math.max(w, h);
    if (ctx.needT) {
      const dark = new F32(n), dmin = new F32(n);
      for (let i = 0; i < n; i++) dark[i] = Math.min(b.R[i], b.G[i], b.B[i]);
      const rr = Math.max(2, Math.round(Lp * 0.012)); minFilter(dark, dmin, w, h, rr);
      const hist = new Uint32Array(1025); for (let i = 0; i < n; i++) hist[Math.min(1024, Math.max(0, (dmin[i] * 1024) | 0))]++;
      const want = Math.max(1, Math.floor(n * 0.002)); let acc = 0, thr = 1024; while (thr > 0 && acc + hist[thr] < want) { acc += hist[thr]; thr--; }
      let A0 = 0, A1 = 0, A2 = 0, top = 0;
      for (let i = 0; i < n; i++) if (((dmin[i] * 1024) | 0) >= thr) { A0 += b.R[i]; A1 += b.G[i]; A2 += b.B[i]; top++; }
      top = Math.max(1, top);
      const A = [Math.max(0.5, Math.min(1, A0 / top)), Math.max(0.5, Math.min(1, A1 / top)), Math.max(0.5, Math.min(1, A2 / top))];
      for (let i = 0; i < n; i++) dark[i] = Math.min(b.R[i] / A[0], b.G[i] / A[1], b.B[i] / A[2]);
      minFilter(dark, dmin, w, h, rr);
      const t = new F32(n); for (let i = 0; i < n; i++) t[i] = 1 - 0.95 * dmin[i];
      const Y = lumaInto(b, new F32(n)); const tr = new F32(n);
      guidedJoint(Y, t, w, h, Math.max(3, Math.round(Lp * 0.03)), 0.002, tr, 'pd');
      for (let i = 0; i < n; i++) tr[i] = clamp(tr[i], 0.05, 1);
      pm.t = tr; ctx.A = A; b.t = tr;
      if (nz(ctx.gDehaze)) dehazeStage(ctx, b);
    }
    const Y = lumaInto(b, new F32(n));
    pm.Y0 = Y;
    if (ctx.needHS || ctx.cmasks.some((c) => c.hsOn)) {
      const r = Math.max(2, Math.round(Lp * (0.01 + ctx.v.hsSmooth / 100 * 0.05)));
      pm.hs = guidedSelf(Y, w, h, r, 0.012, new F32(n));
    } else pm.hs = Y;
    b.hs = pm.hs;
    toneStage(ctx, b);
    const Y2 = lumaInto(b, new F32(n)); pm.Y = Y2;
    if (ctx.needClar) { const sig = Lp * (0.006 + v.clarRadius / 100 * 0.03); pm.clar = new F32(n); gauss(Y2, pm.clar, new F32(n), w, h, sig); }
    if (ctx.wantLuma) pm.luma = guidedSelf(Y2, w, h, Math.max(2, Math.round(Lp * 0.02)), 0.008, new F32(n));
    pm.b = b;
    return pm;
  }

  function sampleMap(map, pw, ph, b, out, gx0, gy0, PW, PH) {
    const w = b.w, h = b.h;
    const xi = new Int32Array(w), xf = new F32(w);
    for (let x = 0; x < w; x++) { let p = (gx0 + x + 0.5) / PW * pw - 0.5; p = clamp(p, 0, pw - 1.001); xi[x] = p | 0; xf[x] = p - (p | 0); }
    for (let y = 0; y < h; y++) {
      let q = (gy0 + y + 0.5) / PH * ph - 0.5; q = clamp(q, 0, ph - 1.001); const yi = q | 0, fy = q - yi;
      const o0 = yi * pw, o1 = o0 + (yi + 1 < ph ? pw : 0), o = y * w;
      for (let x = 0; x < w; x++) {
        const i0 = o0 + xi[x], i1 = o1 + xi[x], f = xf[x];
        const a = map[i0] + (map[i0 + 1] - map[i0]) * f, c = map[i1] + (map[i1 + 1] - map[i1]) * f;
        out[o + x] = a + (c - a) * fy;
      }
    }
    return out;
  }

  /* ---------- Stufen ---------- */
  function nrStage(ctx, b) {
    const v = ctx.v, w = b.w, h = b.h, n = b.n, R = b.R, G = b.G, B = b.B, s = b.s;
    const Y = buf('nY', n), Cb = buf('nCb', n), Cr = buf('nCr', n), q = buf('nQ', n);
    for (let i = 0; i < n; i++) { const y = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]; Y[i] = y; Cb[i] = B[i] - y; Cr[i] = R[i] - y; }
    if (v.nrLum > 0) {
      const r = Math.max(1, Math.round((1 + v.nrLum / 100 * 3) * s));
      const amt = v.nrLum / 100; const eps = amt * amt * 0.012 + 1e-5;
      const keep = v.nrLumDetail / 100 * 0.5;
      const Yc = buf('nYc', n); Yc.set(Y);
      guidedJoint(Yc, Yc, w, h, r, eps, q, 'nl');
      for (let i = 0; i < n; i++) Y[i] = q[i] + (Yc[i] - q[i]) * keep;
    }
    if (v.nrColor > 0) {
      const r = Math.max(1, Math.round((2 + v.nrColor / 100 * 10) * s));
      const eps = 0.0004 + (1 - v.nrColorDetail / 100) * 0.006; const f = Math.min(1, v.nrColor / 100 * 1.6);
      guidedJoint(Y, Cb, w, h, r, eps, q, 'nc'); for (let i = 0; i < n; i++) Cb[i] += (q[i] - Cb[i]) * f;
      guidedJoint(Y, Cr, w, h, r, eps, q, 'nc'); for (let i = 0; i < n; i++) Cr[i] += (q[i] - Cr[i]) * f;
    }
    for (let i = 0; i < n; i++) { const y = Y[i]; const r = y + Cr[i], bb = y + Cb[i]; R[i] = r; B[i] = bb; G[i] = (y - 0.299 * r - 0.114 * bb) / 0.587; }
  }
  function nrMargin(ctx, s) {
    const v = ctx.v; let m = 0;
    if (v.nrLum > 0) m += 2 * Math.max(1, Math.round((1 + v.nrLum / 100 * 3) * s));
    if (v.nrColor > 0) m += 2 * Math.max(1, Math.round((2 + v.nrColor / 100 * 10) * s));
    return m;
  }
  function dehazeStage(ctx, b, amount, alpha) {
    const d = amount == null ? ctx.gDehaze : amount; const A = ctx.A; const t = b.t; const R = b.R, G = b.G, B = b.B;
    for (let i = 0; i < b.n; i++) {
      const al = alpha ? alpha[i] : 1; if (al <= 0) continue;
      let r = R[i], g = G[i], bb = B[i];
      if (d > 0) {
        const te = Math.max(0.12, 1 - d * (1 - t[i]));
        r = (r - A[0]) / te + A[0]; g = (g - A[1]) / te + A[1]; bb = (bb - A[2]) / te + A[2];
      } else {
        const m = -d * 0.7 * (1 - 0.5 * t[i]);
        r += (A[0] - r) * m; g += (A[1] - g) * m; bb += (A[2] - bb) * m;
      }
      R[i] += (r - R[i]) * al; G[i] += (g - G[i]) * al; B[i] += (bb - B[i]) * al;
    }
  }
  function toneStage(ctx, b) {
    if (!ctx.needHS && !ctx.needTone) return;
    const R = b.R, G = b.G, B = b.B, hs = b.hs, hl = ctx.hsLUT, tl = ctx.toneLUT;
    for (let i = 0; i < b.n; i++) {
      const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
      let Y2 = Y;
      if (hl) Y2 += evalLUT(hl, 1536, 1.5, clamp(hs[i], 0, 1.5));
      if (tl) Y2 = evalLUT(tl, TN, TMAX, Y2);
      if (Y2 !== Y) applyLum(R, G, B, i, Y, Y2);
    }
  }
  function clarityStage(ctx, b) {
    const v = ctx.v; const amt = v.clarity / 100; if (!amt) return;
    const hk = 1 + v.halo / 100 * 14; const R = b.R, G = b.G, B = b.B, cl = b.clar;
    const k = amt > 0 ? 1.3 * amt : 1.0 * amt;
    for (let i = 0; i < b.n; i++) {
      const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
      let d = Y - cl[i]; d = d / (1 + Math.abs(d) * hk);
      const mw = Y <= 0 || Y >= 1 ? 0 : Math.sqrt(4 * Y * (1 - Y));
      const dY = k * d * mw; R[i] += dY; G[i] += dY; B[i] += dY;
    }
  }
  function texSigma(ctx, b) { return Math.max(0.6, Math.max(b.PW, b.PH) * (0.0006 + ctx.v.texRadius / 100 * 0.0028)); }
  function textureStage(ctx, b) {
    const v = ctx.v; const n = b.n; const Y = buf('tY', n), Yb = buf('tYb', n), tmp = buf('tT', n);
    lumaInto(b, Y); gauss(Y, Yb, tmp, b.w, b.h, texSigma(ctx, b));
    const t = v.texture / 100, k = t > 0 ? t * 1.5 : t; const R = b.R, G = b.G, B = b.B;
    for (let i = 0; i < n; i++) { const dY = k * (Y[i] - Yb[i]); R[i] += dY; G[i] += dY; B[i] += dY; }
  }
  function curveStage(ctx, b) {
    const M = ctx.curveM, CR = ctx.curveR, CG = ctx.curveG, CB = ctx.curveB; const R = b.R, G = b.G, B = b.B;
    for (let i = 0; i < b.n; i++) {
      let r = R[i], g = G[i], bb = B[i];
      if (M) { r = lutEval(M, r); g = lutEval(M, g); bb = lutEval(M, bb); }
      if (CR) r = lutEval(CR, r); if (CG) g = lutEval(CG, g); if (CB) bb = lutEval(CB, bb);
      R[i] = r; G[i] = g; B[i] = bb;
    }
  }
  function colorPix(ctx, r, g, bl, o) {
    const v = ctx.v, hue = ctx.hue, hslOn = ctx.hslOn, vib = v.vibrance / 100, sat = v.saturation / 100, bw = !!v.bw, skinP = v.skin / 100;
    const gr = ctx.gradeOn ? ctx.grade : null;
    lin2ok(s2l(r), s2l(g), s2l(bl), o);
    let L = o[0], a = o[1], bb = o[2];
    const C = Math.sqrt(a * a + bb * bb);
    let scale = 1;
    if (hue && C > 1e-5) {
      let h = Math.atan2(bb, a); if (h < 0) h += TAU; let k = (h * HN / TAU) | 0; if (k >= HN) k = HN - 1;
      const cf = C < 0.08 ? C / 0.08 : 1;
      if (hslOn) {
        const dh = hue.dh[k] * cf;
        if (dh) { const cs = Math.cos(dh), sn = Math.sin(dh); const na = a * cs - bb * sn; bb = a * sn + bb * cs; a = na; }
        scale *= 1 + hue.ds[k];
        L += hue.dl[k] * cf * (bw ? 0.32 : 0.18);
      }
      if (vib) { let amt = vib * (1 - Math.min(1, C / 0.2)); if (vib > 0) amt *= 1 - skinP * hue.skin[k] * 0.8; scale *= 1 + amt; }
    }
    scale *= 1 + sat; if (scale < 0) scale = 0;
    a *= scale; bb *= scale;
    if (bw) { a = 0; bb = 0; }
    if (gr) {
      const s = smoothstep(gr.p - gr.tw, gr.p + gr.tw, L); const wS = (1 - s) * (1 - s), wH = s * s, wM = 2 * s * (1 - s);
      a += wS * gr.sh[0] + wM * gr.mi[0] + wH * gr.hi[0] + gr.gl[0];
      bb += wS * gr.sh[1] + wM * gr.mi[1] + wH * gr.hi[1] + gr.gl[1];
      L += wS * gr.shL + wM * gr.miL + wH * gr.hiL;
    }
    ok2lin(L, a, bb, o);
    o[0] = l2s(o[0]); o[1] = l2s(o[1]); o[2] = l2s(o[2]);
  }
  const CUBE = 33;
  let cubeCache = { key: null, lut: null };
  function buildCube(ctx) {
    const v = ctx.v, c = ctx.params.curves || {};
    const keyObj = { c, needColor: ctx.needColor };
    if (ctx.needColor) { keyObj.v = ['vibrance', 'saturation', 'skin', 'bw', 'hslWidth'].concat(PE_GK.hsl, PE_GK.grading).map((k) => v[k]); }
    if (ctx.curveM) keyObj.p = [v.cHi, v.cLi, v.cDa, v.cSh, v.cS1, v.cS2, v.cS3];
    const key = JSON.stringify(keyObj);
    if (cubeCache.key === key) return cubeCache.lut;
    const N = CUBE, lut = new F32(N * N * N * 3); const o = new F32(3);
    const M = ctx.curveM, CR = ctx.curveR, CG = ctx.curveG, CB = ctx.curveB;
    let q = 0;
    for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
      let r = ri / (N - 1), g = gi / (N - 1), bb = bi / (N - 1);
      if (M) { r = lutEval(M, r); g = lutEval(M, g); bb = lutEval(M, bb); }
      if (CR) r = lutEval(CR, r); if (CG) g = lutEval(CG, g); if (CB) bb = lutEval(CB, bb);
      if (ctx.needColor) { colorPix(ctx, r, g, bb, o); r = o[0]; g = o[1]; bb = o[2]; }
      lut[q++] = r; lut[q++] = g; lut[q++] = bb;
    }
    cubeCache = { key, lut };
    return lut;
  }
  function cubeStage(ctx, b) {
    const lut = buildCube(ctx); const N = CUBE, N1 = N - 1, sG = N * 3, sB = N * N * 3;
    const R = b.R, G = b.G, B = b.B;
    for (let i = 0; i < b.n; i++) {
      let r = R[i], g = G[i], bb = B[i];
      r = r <= 0 ? 0 : r >= 1 ? N1 : r * N1; g = g <= 0 ? 0 : g >= 1 ? N1 : g * N1; bb = bb <= 0 ? 0 : bb >= 1 ? N1 : bb * N1;
      let r0 = r | 0, g0 = g | 0, b0 = bb | 0; if (r0 === N1) r0--; if (g0 === N1) g0--; if (b0 === N1) b0--;
      const fr = r - r0, fg = g - g0, fb = bb - b0;
      const p000 = b0 * sB + g0 * sG + r0 * 3; const p100 = p000 + 3, p010 = p000 + sG, p110 = p010 + 3;
      const p001 = p000 + sB, p101 = p001 + 3, p011 = p001 + sG, p111 = p011 + 3;
      const w000 = (1 - fr) * (1 - fg) * (1 - fb), w100 = fr * (1 - fg) * (1 - fb), w010 = (1 - fr) * fg * (1 - fb), w110 = fr * fg * (1 - fb);
      const w001 = (1 - fr) * (1 - fg) * fb, w101 = fr * (1 - fg) * fb, w011 = (1 - fr) * fg * fb, w111 = fr * fg * fb;
      R[i] = lut[p000] * w000 + lut[p100] * w100 + lut[p010] * w010 + lut[p110] * w110 + lut[p001] * w001 + lut[p101] * w101 + lut[p011] * w011 + lut[p111] * w111;
      G[i] = lut[p000 + 1] * w000 + lut[p100 + 1] * w100 + lut[p010 + 1] * w010 + lut[p110 + 1] * w110 + lut[p001 + 1] * w001 + lut[p101 + 1] * w101 + lut[p011 + 1] * w011 + lut[p111 + 1] * w111;
      B[i] = lut[p000 + 2] * w000 + lut[p100 + 2] * w100 + lut[p010 + 2] * w010 + lut[p110 + 2] * w110 + lut[p001 + 2] * w001 + lut[p101 + 2] * w101 + lut[p011 + 2] * w011 + lut[p111 + 2] * w111;
    }
  }

  /* ---------- Masken ---------- */
  function rangeFn(val, lo, hi, fe) {
    if (val < lo) return lo <= 0.0001 ? 1 : sm01((val - (lo - fe)) / fe);
    if (val > hi) return hi >= 0.9999 ? 1 : 1 - sm01((val - hi) / fe);
    return 1;
  }
  function maskAlpha(cm, ctx, b, out) {
    const w = b.w, h = b.h, PW = b.PW, PH = b.PH;
    const R = b.R, G = b.G, B = b.B;
    if (cm.type === 'linear') {
      const L = cm.lin;
      for (let y = 0; y < h; y++) {
        const Y = (b.gy0 + y + 0.5) / PH * cm.Lh; const o = y * w;
        for (let x = 0; x < w; x++) { const X = (b.gx0 + x + 0.5) / PW * cm.Lw; const t = (X - L.x1) * L.dx + (Y - L.y1) * L.dy; out[o + x] = 1 - sm01(t); }
      }
    } else if (cm.type === 'radial') {
      const r = cm.rad; const inner = 1 - r.f;
      for (let y = 0; y < h; y++) {
        const Y = (b.gy0 + y + 0.5) / PH * cm.Lh - r.cy; const o = y * w;
        for (let x = 0; x < w; x++) {
          const X = (b.gx0 + x + 0.5) / PW * cm.Lw - r.cx;
          const xr = (X * r.ca + Y * r.sa) / r.rx, yr = (-X * r.sa + Y * r.ca) / r.ry; const d = Math.sqrt(xr * xr + yr * yr);
          out[o + x] = d <= inner ? 1 : d >= 1 ? 0 : 1 - sm01((d - inner) / r.f);
        }
      }
    } else if (cm.type === 'brush') {
      const ra = cm.raster;
      if (!ra) out.fill(0); else sampleMap(ra.data, ra.w, ra.h, b, out, b.gx0, b.gy0, PW, PH);
    } else if (cm.type === 'luma') {
      const g = cm.rng, lm = b.luma;
      for (let i = 0; i < b.n; i++) { const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; const val = Y + (lm[i] - Y) * g.sm; out[i] = rangeFn(val, g.lo, g.hi, g.fe); }
    } else out.fill(0);
    if (cm.inv) for (let i = 0; i < b.n; i++) out[i] = 1 - out[i];
    if (cm.range) {
      const g = cm.range, lm = b.luma;
      for (let i = 0; i < b.n; i++) { if (out[i] <= 0) continue; const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; const val = Y + (lm[i] - Y) * g.sm; out[i] *= rangeFn(val, g.lo, g.hi, g.fe); }
    }
    if (cm.op !== 1) for (let i = 0; i < b.n; i++) out[i] *= cm.op;
    return out;
  }
  function localStage(ctx, b) {
    const n = b.n, R = b.R, G = b.G, B = b.B; const al = buf('mA', n);
    const dbg = ctx.debug.maskId;
    let dbgAlpha = null;
    for (const cm of ctx.cmasks) {
      maskAlpha(cm, ctx, b, al);
      if (dbg === cm.id) { dbgAlpha = buf('mDbg', n); dbgAlpha.set(al); }
      if (!localActive(cm.m)) continue;
      const a = cm.a;
      if (nz(a.dehaze) && b.t) dehazeStage(ctx, b, a.dehaze / 100, al);
      const hsOn = cm.hsOn, sh = a.shadows / 100, hl = a.highlights / 100, ctr = nz(a.contrast), k = cm.k;
      const cla = a.clarity / 100, satv = a.saturation / 100, camt = a.colorAmt / 100;
      const m0 = cm.mul[0], m1 = cm.mul[1], m2 = cm.mul[2];
      for (let i = 0; i < n; i++) {
        const w = al[i]; if (w <= 0.0005) continue;
        const r0 = R[i], g0 = G[i], b0 = B[i];
        if (cm.linOn) { R[i] = l2s(s2l(r0) * m0); G[i] = l2s(s2l(g0) * m1); B[i] = l2s(s2l(b0) * m2); }
        if (hsOn || ctr) {
          const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; let Y2 = Y;
          if (hsOn) { let bs = clamp(b.hs[i], 0, 1.5); if (cm.linOn) bs = clamp(l2s(s2l(bs) * m1), 0, 1.5); Y2 += hsDelta(bs, sh, hl, 0.55, 0.55); }
          if (ctr && Y2 > 0) { if (Y2 < 0.5) Y2 = 0.5 * Math.pow(Y2 / 0.5, k); else if (Y2 < 1) Y2 = 1 - 0.5 * Math.pow((1 - Y2) / 0.5, k); }
          applyLum(R, G, B, i, Y, Y2);
        }
        if (cla) {
          const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; let d = Y - b.clar[i]; d = d / (1 + Math.abs(d) * 8);
          const mw = Y <= 0 || Y >= 1 ? 0 : Math.sqrt(4 * Y * (1 - Y)); const dY = cla * 1.3 * d * mw; R[i] += dY; G[i] += dY; B[i] += dY;
        }
        if (satv) { const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; const f = Math.max(0, 1 + satv); R[i] = Y + (R[i] - Y) * f; G[i] = Y + (G[i] - Y) * f; B[i] = Y + (B[i] - Y) * f; }
        if (camt) {
          const Y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; const c = cm.col, cy = cm.colY; const t = camt * 0.6;
          R[i] += (Y + (c[0] - cy) * 0.5 - R[i]) * t; G[i] += (Y + (c[1] - cy) * 0.5 - G[i]) * t; B[i] += (Y + (c[2] - cy) * 0.5 - B[i]) * t;
        }
        R[i] = r0 + (R[i] - r0) * w; G[i] = g0 + (G[i] - g0) * w; B[i] = b0 + (B[i] - b0) * w;
      }
    }
    if (dbgAlpha) {
      for (let i = 0; i < n; i++) { const w = dbgAlpha[i] * 0.6; R[i] += (1 - R[i]) * w; G[i] += (0.18 - G[i]) * w; B[i] += (0.25 - B[i]) * w; }
    }
  }
  function sharpSigma(ctx, s) { return Math.max(0.45, ctx.v.sharpRadius * s); }
  function sharpenStage(ctx, b) {
    const v = ctx.v, n = b.n, w = b.w, h = b.h; const Y = buf('sY', n), Yb = buf('sYb', n), tmp = buf('sT', n);
    lumaInto(b, Y); gauss(Y, Yb, tmp, w, h, sharpSigma(ctx, b.s));
    const amt = v.sharp / 100 * 1.6, th = (1 - v.sharpDetail / 100) * 0.02; const mk = v.sharpMask / 100 * 0.05;
    const R = b.R, G = b.G, B = b.B; const dbg = !!ctx.debug.sharpMask;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let m = 1;
        if (mk > 0) {
          const xl = x > 0 ? i - 1 : i, xr = x < w - 1 ? i + 1 : i, yu = y > 0 ? i - w : i, yd = y < h - 1 ? i + w : i;
          const gx = Yb[xr] - Yb[xl], gy = Yb[yd] - Yb[yu]; const gm = Math.sqrt(gx * gx + gy * gy) * 0.5 / Math.max(0.5, b.s);
          m = smoothstep(mk * 0.5, mk * 1.5 + 0.002, gm);
        }
        if (dbg) { R[i] = G[i] = B[i] = m; continue; }
        const d = Y[i] - Yb[i]; const ad = Math.abs(d); const g = th > 0 ? ad / (ad + th) : 1;
        const dY = amt * d * g * m; R[i] += dY; G[i] += dY; B[i] += dY;
      }
    }
  }

  /* ---------- Verarbeitung eines Bereichs ---------- */
  function margin(ctx, s, PW, PH) {
    let m = 2;
    if (ctx.needNR) m += nrMargin(ctx, s);
    if (ctx.needTex) m += gaussMargin(Math.max(0.6, Math.max(PW, PH) * (0.0006 + ctx.v.texRadius / 100 * 0.0028)));
    if (ctx.needSharp) m += gaussMargin(sharpSigma(ctx, s)) + 1;
    return m;
  }
  // src: Uint8 RGBA des Bereichs (w×h), Bereich beginnt bei (gx0,gy0) im Gesamtbild PW×PH (Skalierung s zur Originalgröße)
  function processRegion(ctx, src, w, h, gx0, gy0, PW, PH, s, out) {
    const b = makeBlock(w, h); b.gx0 = gx0; b.gy0 = gy0; b.PW = PW; b.PH = PH; b.s = s;
    loadStage(ctx, b, src);
    const pm = ctx.pmap;
    const needLumaMap = ctx.cmasks.some((c) => c.type === 'luma' || c.range);
    if (pm) {
      if (ctx.needT) b.t = sampleMap(pm.t, pm.w, pm.h, b, buf('mapT', b.n), gx0, gy0, PW, PH);
      if (ctx.needHS || ctx.cmasks.some((c) => c.hsOn)) b.hs = sampleMap(pm.hs, pm.w, pm.h, b, buf('mapHS', b.n), gx0, gy0, PW, PH);
      if (ctx.needClar) b.clar = sampleMap(pm.clar, pm.w, pm.h, b, buf('mapCL', b.n), gx0, gy0, PW, PH);
      if (needLumaMap) b.luma = sampleMap(pm.luma, pm.w, pm.h, b, buf('mapLM', b.n), gx0, gy0, PW, PH);
    }
    if (ctx.needNR) nrStage(ctx, b);
    if (nz(ctx.gDehaze) && b.t) dehazeStage(ctx, b);
    toneStage(ctx, b);
    if (ctx.needClar && nz(ctx.v.clarity)) clarityStage(ctx, b);
    if (ctx.needTex) textureStage(ctx, b);
    if (ctx.needCurves || ctx.needColor) cubeStage(ctx, b);
    if (ctx.cmasks.length) localStage(ctx, b);
    if (ctx.needSharp) sharpenStage(ctx, b);
    out = out || new Uint16Array(b.n * 4);
    const R = b.R, G = b.G, B = b.B, A = b.A;
    for (let i = 0, j = 0; i < b.n; i++, j += 4) {
      let r = R[i], g = G[i], bb = B[i];
      r = r <= 0 ? 0 : r >= 1 ? 65535 : r * 65535 + 0.5; g = g <= 0 ? 0 : g >= 1 ? 65535 : g * 65535 + 0.5; bb = bb <= 0 ? 0 : bb >= 1 ? 65535 : bb * 65535 + 0.5;
      out[j] = r; out[j + 1] = g; out[j + 2] = bb; out[j + 3] = A[i] * 257;
    }
    return out;
  }

  /* ---------- Geometrie ---------- */
  const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function mul3(A, B) {
    const C = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    return C;
  }
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-15) return I3(); const k = 1 / det;
    return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
  }
  function ap3(M, x, y) { const w = M[6] * x + M[7] * y + M[8]; return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w]; }
  const Tm = (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1];
  const Sm = (x, y) => [x, 0, 0, 0, y, 0, 0, 0, 1];
  const Rm = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  function homography4(src, dst) {
    const A = [], bv = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i * 2], y = src[i * 2 + 1], u = dst[i * 2], v = dst[i * 2 + 1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bv.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bv.push(v);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [bv[c], bv[p]] = [bv[p], bv[c]];
      const d = A[c][c] || 1e-12;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / d; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; bv[r] -= f * bv[c]; }
    }
    const h = bv.map((x, i) => x / (A[i][i] || 1e-12)); return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function geometry(params, W, H) {
    const g = params.geo || {}, v = params.v;
    let M = I3();
    if (g.quad) {
      const q = g.quad; const src = []; for (let i = 0; i < 4; i++) { src.push(q[i * 2] * W, q[i * 2 + 1] * H); }
      M = homography4(src, [0, 0, W, 0, W, H, 0, H]);
    }
    M = mul3(Tm(-W / 2, -H / 2), M);
    M = mul3(Sm(g.flipH ? -1 : 1, g.flipV ? -1 : 1), M);
    const k = ((g.rot90 || 0) % 4 + 4) % 4; M = mul3(Rm(k * Math.PI / 2), M);
    const FW = k % 2 ? H : W, FH = k % 2 ? W : H;
    if (v.geoAspect) { const sx = Math.pow(2, v.geoAspect / 100 * 0.5); M = mul3(Sm(sx, 1 / sx), M); }
    if (v.vert || v.horz) {
      const hw = FW / 2, hh = FH / 2, kv = v.vert / 100 * 0.35, kh = v.horz / 100 * 0.35;
      const src = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
      const dst = [-hw * (1 + kv), -hh * (1 + kh), hw * (1 + kv), -hh * (1 - kh), hw * (1 - kv), hh * (1 - kh), -hw * (1 - kv), hh * (1 + kh)];
      M = mul3(homography4(src, dst), M);
    }
    if (v.angle) M = mul3(Rm(v.angle * Math.PI / 180), M);
    M = mul3(Tm(v.offX / 100 * FW * 0.25, v.offY / 100 * FH * 0.25), M);
    let s = 1;
    if (v.autoFill) {
      const Mi = inv3(M); const corners = [[-FW / 2, -FH / 2], [FW / 2, -FH / 2], [FW / 2, FH / 2], [-FW / 2, FH / 2]];
      const inside = (sc) => corners.every(([x, y]) => { const p = ap3(Mi, x / sc, y / sc); return p[0] >= -0.01 && p[0] <= W + 0.01 && p[1] >= -0.01 && p[1] <= H + 0.01; });
      if (!inside(1)) { let lo = 1, hi = 8; if (inside(hi)) { for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (inside(m)) hi = m; else lo = m; } } s = hi; }
    }
    s *= v.geoScale / 100;
    M = mul3(Sm(s, s), M);
    M = mul3(Tm(FW / 2, FH / 2), M);
    const c = g.crop || { x: 0, y: 0, w: 1, h: 1 };
    return { H: M, Hinv: inv3(M), FW, FH, fill: s, crop: { x: c.x * FW, y: c.y * FH, w: Math.max(1, c.w * FW), h: Math.max(1, c.h * FH) }, srcW: W, srcH: H };
  }
  function isIdentityGeo(params) {
    const g = params.geo || {}, v = params.v; const c = g.crop || {};
    return !g.quad && !g.flipH && !g.flipV && !(g.rot90 % 4) && !v.geoAspect && !v.vert && !v.horz && !v.angle && !v.offX && !v.offY && v.geoScale === 100 && c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
  }

  /* ---------- Rauschen für Filmkorn ---------- */
  function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295 * 2 - 1;
  }
  const NT = 512, NTM = NT - 1; let noiseTab = null;
  function vnoise(x, y, seed) {
    if (!noiseTab) { noiseTab = new F32(NT * NT); for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) noiseTab[j * NT + i] = hash2(i, j, 7); }
    x += seed * 37.17; y += seed * 11.73;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ix & NTM, x1 = (ix + 1) & NTM, y0 = (iy & NTM) * NT, y1 = ((iy + 1) & NTM) * NT;
    const a = noiseTab[y0 + x0], b = noiseTab[y0 + x1], c = noiseTab[y1 + x0], d = noiseTab[y1 + x1];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }

  /* ---------- Ausgabe (Geometrie + Effekte nach dem Zuschnitt) ---------- */
  // proc: Uint16 RGBA (pw×ph), beginnt bei (ox,oy) im skalierten Quellbild (Skalierung s).
  // out: Ausschnitt rect {x0,y0,w,h} des Ausgabebildes bei Maßstab k (Ausgabe-Pixel je Original-Frame-Pixel).
  function renderOutput(ctx, proc, pw, ph, ox, oy, s, geo, cropMode, rect, k, fmt) {
    const v = ctx.v;
    const cx = cropMode ? 0 : geo.crop.x, cy = cropMode ? 0 : geo.crop.y;
    const OWf = cropMode ? geo.FW : geo.crop.w, OHf = cropMode ? geo.FH : geo.crop.h;
    let A = mul3(Sm(1 / k, 1 / k), I3());
    A = mul3(Tm(cx + (rect.x0 + 0.5) / k, cy + (rect.y0 + 0.5) / k), A);
    A = mul3(geo.Hinv, A);
    A = mul3(Sm(s, s), A);
    A = mul3(Tm(-0.5 - ox, -0.5 - oy), A);
    const w = rect.w, h = rect.h;
    const out = fmt === 'u16' ? new Uint16Array(w * h * 4) : new Uint8ClampedArray(w * h * 4);
    const scaleOut = fmt === 'u16' ? 65535 : 255;
    const isInt = (x) => Math.abs(x - Math.round(x)) < 1e-6;
    if (Math.abs(A[0] - 1) < 1e-9 && Math.abs(A[4] - 1) < 1e-9 && Math.abs(A[1]) < 1e-9 && Math.abs(A[3]) < 1e-9 && Math.abs(A[6]) < 1e-12 && Math.abs(A[7]) < 1e-12 && Math.abs(A[8] - 1) < 1e-9 && isInt(A[2]) && isInt(A[5])
      && !(ctx.needVig && !cropMode) && !(ctx.needGrain && !cropMode)) {
      const dx = Math.round(A[2]), dy = Math.round(A[5]);
      if (dx >= 0 && dy >= 0 && dx + w <= pw && dy + h <= ph) {
        if (fmt === 'u16') { for (let j = 0; j < h; j++) out.set(proc.subarray(((j + dy) * pw + dx) * 4, ((j + dy) * pw + dx + w) * 4), j * w * 4); }
        else { for (let j = 0; j < h; j++) { let si = ((j + dy) * pw + dx) * 4; const oo = j * w * 4; for (let q = 0; q < w * 4; q++) out[oo + q] = proc[si + q] / 257; } }
        return out;
      }
    }
    const vig = ctx.needVig && !cropMode, grain = ctx.needGrain && !cropMode;
    const va = v.vig / 100, hp = v.vigHl / 100;
    const rnd = v.vigRound / 100; const pexp = rnd < 0 ? 2 + (-rnd) * 6 : 2;
    const Lo = Math.max(OWf, OHf), diag = Math.hypot(OWf, OHf);
    const mid = 0.25 + v.vigMid / 100 * 1.0, fw = 0.05 + v.vigFeather / 100 * 1.2;
    const cell = 0.00045 + v.grainSize / 100 * 0.0035; const gAmt = v.grain / 100 * 0.16, rough = v.grainRough / 100, gcol = v.grainColor / 100;
    const pwm = pw - 1, phm = ph - 1;
    for (let j = 0; j < h; j++) {
      let X = A[0] * 0 + A[1] * j + A[2], Y = A[3] * 0 + A[4] * j + A[5], Wd = A[6] * 0 + A[7] * j + A[8];
      const oy2 = (rect.y0 + j + 0.5) / k;
      for (let i = 0; i < w; i++, X += A[0], Y += A[3], Wd += A[6]) {
        const px = X / Wd, py = Y / Wd; const o = (j * w + i) * 4;
        if (px < -0.5 || py < -0.5 || px > pw - 0.5 || py > ph - 0.5 || !(Wd > 0)) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
        let x0 = Math.floor(px), y0 = Math.floor(py); let fx = px - x0, fy = py - y0;
        if (x0 < 0) { x0 = 0; fx = 0; } if (y0 < 0) { y0 = 0; fy = 0; }
        if (x0 >= pwm) { x0 = pwm; fx = 0; } if (y0 >= phm) { y0 = phm; fy = 0; }
        const x1 = x0 < pwm ? x0 + 1 : x0, y1 = y0 < phm ? y0 + 1 : y0;
        const i00 = (y0 * pw + x0) * 4, i10 = (y0 * pw + x1) * 4, i01 = (y1 * pw + x0) * 4, i11 = (y1 * pw + x1) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        let r = (proc[i00] * w00 + proc[i10] * w10 + proc[i01] * w01 + proc[i11] * w11) / 65535;
        let g = (proc[i00 + 1] * w00 + proc[i10 + 1] * w10 + proc[i01 + 1] * w01 + proc[i11 + 1] * w11) / 65535;
        let b = (proc[i00 + 2] * w00 + proc[i10 + 2] * w10 + proc[i01 + 2] * w01 + proc[i11 + 2] * w11) / 65535;
        const a = (proc[i00 + 3] * w00 + proc[i10 + 3] * w10 + proc[i01 + 3] * w01 + proc[i11 + 3] * w11) / 65535;
        if (vig || grain) {
          const ox2 = (rect.x0 + i + 0.5) / k;
          if (vig) {
            let nx = (ox2 / OWf - 0.5) * 2, ny = (oy2 / OHf - 0.5) * 2;
            if (rnd > 0) { const cxn = (ox2 - OWf / 2) / (diag / 2) * Math.SQRT2, cyn = (oy2 - OHf / 2) / (diag / 2) * Math.SQRT2; nx += (cxn - nx) * rnd; ny += (cyn - ny) * rnd; }
            const d = pexp === 2 ? Math.sqrt(nx * nx + ny * ny) : Math.pow(Math.pow(Math.abs(nx), pexp) + Math.pow(Math.abs(ny), pexp), 1 / pexp) * Math.SQRT2 / Math.pow(2, 1 / pexp);
            const vv = smoothstep(mid, mid + fw, d);
            if (vv > 0) {
              if (va < 0) { const Yl = 0.2126 * r + 0.7152 * g + 0.0722 * b; const f = 1 + va * vv * (1 - hp * smoothstep(0.5, 1, Yl)); r *= f; g *= f; b *= f; }
              else { const t = va * vv; r += (1 - r) * t; g += (1 - g) * t; b += (1 - b) * t; }
            }
          }
          if (grain) {
            const gx = ox2 / Lo / cell, gy = oy2 / Lo / cell;
            const nm = vnoise(gx, gy, 11) * (1 - rough * 0.5) + vnoise(gx * 2.31 + 17.3, gy * 2.31 + 5.1, 23) * rough * 0.6;
            const Yl = 0.2126 * r + 0.7152 * g + 0.0722 * b; const wgt = 0.3 + 2.8 * clamp(Yl, 0, 1) * (1 - clamp(Yl, 0, 1));
            const base = nm * gAmt * wgt;
            if (gcol > 0) {
              const nr = vnoise(gx, gy, 41), nb = vnoise(gx, gy, 71);
              r += base + (nr - nm) * gAmt * wgt * gcol * 0.8; g += base; b += base + (nb - nm) * gAmt * wgt * gcol * 0.8;
            } else { r += base; g += base; b += base; }
          }
        }
        out[o] = clamp(r, 0, 1) * scaleOut + (fmt === 'u16' ? 0.5 : 0); out[o + 1] = clamp(g, 0, 1) * scaleOut + (fmt === 'u16' ? 0.5 : 0); out[o + 2] = clamp(b, 0, 1) * scaleOut + (fmt === 'u16' ? 0.5 : 0); out[o + 3] = a * scaleOut + (fmt === 'u16' ? 0.5 : 0);
      }
    }
    return out;
  }

  /* ---------- Ausgabeschärfung (auf fertigem Bild) ---------- */
  function outputSharpen(data, w, h, amount, sigma, maxv) {
    const n = w * h; const Y = new F32(n), Yb = new F32(n), tmp = new F32(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) Y[i] = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / maxv;
    gauss(Y, Yb, tmp, w, h, sigma);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const d = (Y[i] - Yb[i]) * amount * maxv; const ad = Math.abs(d / maxv); const g = ad / (ad + 0.004);
      const dd = d * g;
      data[j] = clamp(data[j] + dd, 0, maxv); data[j + 1] = clamp(data[j + 1] + dd, 0, maxv); data[j + 2] = clamp(data[j + 2] + dd, 0, maxv);
    }
  }

  /* ---------- Pinsel ---------- */
  function stampDab(stroke, mw, mh, cx, cy, rad, hard, flow, bbox) {
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(mw - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(mh - 1, Math.ceil(cy + rad));
    const inner = rad * hard, fw = Math.max(0.5, rad - inner);
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy; const o = y * mw;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx; const d = Math.sqrt(dx * dx + dy * dy); if (d >= rad) continue;
        const a = d <= inner ? 1 : 1 - sm01((d - inner) / fw);
        const s = stroke[o + x]; stroke[o + x] = s + (1 - s) * a * flow;
      }
    }
    if (bbox) { bbox[0] = Math.min(bbox[0], x0); bbox[1] = Math.min(bbox[1], y0); bbox[2] = Math.max(bbox[2], x1); bbox[3] = Math.max(bbox[3], y1); }
  }
  // Punkte einer Strichbahn in Masken-Pixeln abtasten
  function strokeDabs(st, mw, mh, fromIdx, lastPos, cb) {
    const L = Math.max(mw, mh); const rad = Math.max(0.6, st.s * L); const step = Math.max(0.5, rad * 0.15);
    const p = st.p; let px = lastPos ? lastPos[0] : null, py = lastPos ? lastPos[1] : null; let carry = lastPos ? lastPos[2] : 0;
    for (let i = fromIdx; i < p.length; i += 2) {
      const x = p[i] * mw, y = p[i + 1] * mh;
      if (px === null) { cb(x, y, rad); px = x; py = y; carry = 0; continue; }
      const dx = x - px, dy = y - py; const dist = Math.hypot(dx, dy);
      let t = step - carry;
      while (t <= dist) { cb(px + dx * t / dist, py + dy * t / dist, rad); t += step; }
      carry = dist - (t - step); px = x; py = y;
    }
    return [px, py, carry];
  }
  function compositeStroke(mask, before, stroke, st, bbox, mw) {
    const op = st.o == null ? 1 : st.o;
    for (let y = bbox[1]; y <= bbox[3]; y++) {
      const o = y * mw;
      for (let x = bbox[0]; x <= bbox[2]; x++) {
        const i = o + x; const s = stroke[i] * op, m = before[i];
        mask[i] = st.e ? m * (1 - s) : m + (1 - m) * s;
      }
    }
  }
  function rasterizeBrush(mask, mw, mh) {
    const data = new F32(mw * mh); const stroke = new F32(mw * mh); const before = new F32(mw * mh);
    for (const st of mask.strokes || []) {
      stroke.fill(0); before.set(data); const bb = [mw, mh, -1, -1];
      strokeDabs(st, mw, mh, 0, null, (x, y, r) => stampDab(stroke, mw, mh, x, y, r, st.h, st.f, bb));
      if (bb[2] >= 0) compositeStroke(data, before, stroke, st, bb, mw);
    }
    return { w: mw, h: mh, data };
  }

  /* ---------- Analyse ---------- */
  function percentile(arr, p) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))]; }
  function median(arr) { return percentile(arr, 0.5); }
  function evalProxy(params, info) { const ctx = prepare(params, Object.assign({}, info, { wantLuma: true })); return ctx.pmap; }
  function autoTone(params, info) {
    const base = JSON.parse(JSON.stringify(params)); const v = base.v;
    ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'].forEach((k) => (v[k] = 0));
    base.masks = [];
    const meas = (fn) => fn(evalProxy(base, info).Y);
    // Belichtung: Median auf ~0.46
    let lo = -3, hi = 3;
    for (let it = 0; it < 14; it++) { v.exposure = (lo + hi) / 2; const m = meas(median); if (m > 0.46) hi = v.exposure; else lo = v.exposure; }
    v.exposure = Math.round(clamp((lo + hi) / 2, -2.5, 2.5) * 100) / 100;
    let Y = evalProxy(base, info).Y;
    const clipFrac = (Y) => { let c = 0; for (let i = 0; i < Y.length; i++) if (Y[i] > 0.985) c++; return c / Y.length; };
    if (clipFrac(Y) > 0.004) { let a = -100, b = 0; for (let it = 0; it < 9; it++) { v.highlights = (a + b) / 2; if (clipFrac(evalProxy(base, info).Y) > 0.003) b = v.highlights; else a = v.highlights; } v.highlights = Math.round(Math.max(-80, (a + b) / 2)); }
    Y = evalProxy(base, info).Y;
    const p10 = percentile(Y, 0.1); if (p10 < 0.1) v.shadows = Math.round(clamp((0.14 - p10) * 320, 0, 55));
    Y = evalProxy(base, info).Y;
    const pHi = percentile(Y, 0.997); if (pHi < 0.95) v.whites = Math.round(clamp((0.97 - pHi) * 280, 0, 50));
    const pLo = percentile(Y, 0.003); if (pLo > 0.04) v.blacks = -Math.round(clamp((pLo - 0.02) * 300, 0, 50));
    Y = evalProxy(base, info).Y;
    let mean = 0; for (let i = 0; i < Y.length; i++) mean += Y[i]; mean /= Y.length; let sd = 0; for (let i = 0; i < Y.length; i++) sd += (Y[i] - mean) ** 2; sd = Math.sqrt(sd / Y.length);
    if (sd < 0.2) v.contrast = Math.round(clamp((0.21 - sd) * 160, 0, 25));
    const r = {}; ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'].forEach((k) => (r[k] = v[k]));
    return r;
  }
  function wbFromColor(r, g, b, v) {
    r = Math.max(1e-4, r); g = Math.max(1e-4, g); b = Math.max(1e-4, b);
    const gr = v.rGain / 100 * 0.5, gg = v.gGain / 100 * 0.5, gb = v.bGain / 100 * 0.5;
    const T = (Math.log2(b) + gb - Math.log2(r) - gr); // = temp/100 (k=0.5 → 2*0.5*temp/100)
    const temp = clamp(Math.round(T * 100), -100, 100);
    const tint = clamp(Math.round((Math.log2(g) + gg - (Math.log2(r) + gr + 0.5 * temp / 100)) / 0.5 * 100), -100, 100);
    return { temp, tint };
  }
  function autoWB(proxy, v) {
    let r = 0, g = 0, b = 0, c = 0; const d = proxy.data;
    for (let j = 0; j < d.length; j += 4) {
      const R = d[j], G2 = d[j + 1], B = d[j + 2];
      if (R > 245 || G2 > 245 || B > 245 || (R < 8 && G2 < 8 && B < 8)) continue;
      r += S2L8[R]; g += S2L8[G2]; b += S2L8[B]; c++;
    }
    if (!c) return { temp: 0, tint: 0 };
    return wbFromColor(r / c, g / c, b / c, Object.assign({}, v, { rGain: 0, gGain: 0, bGain: 0 }));
  }
  function detectZones(params, info) {
    const pm = evalProxy(Object.assign({}, params, { masks: [] }), info); const Y = pm.Y, S = pm.luma, n = Y.length;
    let nb = 0, nc = 0, nd = 0, nk = 0, sb = 0, sd = 0;
    for (let i = 0; i < n; i++) {
      if (S[i] > 0.8) { nb++; sb += Y[i]; } if (Y[i] > 0.985) nc++;
      if (S[i] < 0.16) { nd++; sd += Y[i]; } if (Y[i] < 0.015) nk++;
    }
    const res = { w: pm.w, h: pm.h, bright: nb / n, clipped: nc / n, dark: nd / n, black: nk / n, suggestions: [] };
    const over = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const y = Math.round(clamp(Y[i], 0, 1) * 170); const j = i * 4; over[j] = over[j + 1] = over[j + 2] = y; over[j + 3] = 255;
      const hb = smoothstep(0.74, 0.86, S[i]), hd = 1 - smoothstep(0.1, 0.2, S[i]);
      if (hb > 0) { over[j] += (255 - over[j]) * hb * 0.85; over[j + 1] *= 1 - hb * 0.6; over[j + 2] *= 1 - hb * 0.6; }
      if (hd > 0) { over[j] *= 1 - hd * 0.6; over[j + 1] += (140 - over[j + 1]) * hd * 0.7; over[j + 2] += (255 - over[j + 2]) * hd * 0.85; }
    }
    res.overlay = over;
    if (res.bright > 0.02) {
      const meanB = sb / Math.max(1, nb);
      const ex = -clamp(Math.round(((meanB - 0.7) * 2.6 + 0.25 + res.clipped * 4) * 20) / 20, 0.2, 1.3);
      res.suggestions.push({ kind: 'bright', name: 'Helle Bereiche abdunkeln', geom: { lo: 0.78, hi: 1, feather: 0.1, smooth: 0.75 }, adj: { exposure: ex, highlights: -30 } });
    }
    if (res.dark > 0.02) {
      const meanD = sd / Math.max(1, nd);
      const ex = clamp(Math.round(((0.26 - meanD) * 3 + 0.2) * 20) / 20, 0.2, 1.3);
      res.suggestions.push({ kind: 'dark', name: 'Dunkle Bereiche aufhellen', geom: { lo: 0, hi: 0.17, feather: 0.1, smooth: 0.75 }, adj: { exposure: ex, shadows: 30 } });
    }
    return res;
  }

  function effectiveParams(p) {
    if (!p.off || !Object.keys(p.off).some((k) => p.off[k])) return p;
    const q = Object.assign({}, p, { v: Object.assign({}, p.v) });
    for (const gname in p.off) {
      if (!p.off[gname]) continue;
      if (gname === 'masks') { q.masks = []; continue; }
      (GROUP_KEYS[gname] || []).forEach((k) => (q.v[k] = DEF[k]));
      if (gname === 'curve') q.curves = { rgb: IDENT(), r: IDENT(), g: IDENT(), b: IDENT() };
    }
    return q;
  }

  const PE = {
    DEF, GROUP_KEYS, LOCAL_DEF, defaultParams, prepare, processRegion, margin, renderOutput, geometry, isIdentityGeo,
    mul3, inv3, ap3, homography4, rasterizeBrush, stampDab, strokeDabs, compositeStroke, outputSharpen,
    autoTone, autoWB, wbFromColor, detectZones, evalProxy, effectiveParams, monotoneSpline, isIdentCurve,
    hsv2rgb, hueDir, s2l, l2s, S2L8, BAND_HSV, clamp,
  };
  G.PE = PE;
  if (typeof module !== 'undefined' && module.exports) module.exports = PE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
