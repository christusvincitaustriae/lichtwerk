/* Lichtwerk – eigene Codecs: TIFF lesen/schreiben, PNG (8/16 Bit) schreiben, ZIP (ohne Kompression) */
(function (G) {
  'use strict';
  const CRC = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
  function crc32(buf, crc) { let c = crc == null ? -1 : crc; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return c; }
  const crcFinal = (c) => (c ^ -1) >>> 0;

  async function zlibInflate(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Deflate-Dekompression wird von diesem Browser nicht unterstützt');
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function zlibDeflate(u8) {
    if (typeof CompressionStream === 'undefined') throw new Error('Deflate-Kompression wird von diesem Browser nicht unterstützt');
    const cs = new CompressionStream('deflate');
    const stream = new Blob([u8]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ---------- TIFF lesen ---------- */
  function lzwDecode(input, expected) {
    const out = new Uint8Array(expected); let op = 0;
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), lenA = new Int32Array(4096), first = new Uint8Array(4096);
    for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; lenA[i] = 1; first[i] = i; }
    let next = 258, width = 9, bit = 0, old = -1; const nbits = input.length * 8;
    const writeStr = (code) => { const L = lenA[code]; let p = op + L - 1, k = code; while (k >= 0) { if (p < expected) out[p] = suffix[k]; p--; k = prefix[k]; } op += L; };
    while (op < expected) {
      if (bit + width > nbits) break;
      const by = bit >> 3; const v = (input[by] << 16) | ((input[by + 1] || 0) << 8) | (input[by + 2] || 0);
      const code = (v >> (24 - (bit & 7) - width)) & ((1 << width) - 1); bit += width;
      if (code === 257) break;
      if (code === 256) { next = 258; width = 9; old = -1; continue; }
      if (old === -1) { if (code > 255) break; out[op++] = code; old = code; continue; }
      let fc;
      if (code < next) { writeStr(code); fc = first[code]; }
      else { writeStr(old); if (op < expected) out[op] = first[old]; op++; fc = first[old]; }
      if (next < 4096) { prefix[next] = old; suffix[next] = fc; lenA[next] = lenA[old] + 1; first[next] = first[old]; next++; }
      old = code;
      if (next + 1 >= (1 << width) && width < 12) width++;
    }
    return out;
  }
  function packbitsDecode(input, expected) {
    const out = new Uint8Array(expected); let ip = 0, op = 0;
    while (ip < input.length && op < expected) {
      const n = (input[ip++] << 24) >> 24;
      if (n >= 0) { for (let i = 0; i <= n && op < expected; i++) out[op++] = input[ip++]; }
      else if (n !== -128) { const v = input[ip++]; for (let i = 0; i < 1 - n && op < expected; i++) out[op++] = v; }
    }
    return out;
  }
  async function decodeTIFF(arrayBuffer) {
    const dv = new DataView(arrayBuffer); const u8 = new Uint8Array(arrayBuffer);
    const bo = dv.getUint16(0); const le = bo === 0x4949; if (!le && bo !== 0x4d4d) throw new Error('Keine gültige TIFF-Datei');
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    if (u16(2) !== 42) throw new Error('BigTIFF wird nicht unterstützt');
    const ifd = u32(4); const n = u16(ifd); const tags = {};
    const tsz = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12; const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
      const size = (tsz[type] || 1) * cnt; const off = size <= 4 ? e + 8 : u32(e + 8);
      const vals = [];
      for (let k = 0; k < Math.min(cnt, 1 << 20); k++) {
        if (type === 3) vals.push(u16(off + k * 2)); else if (type === 4) vals.push(u32(off + k * 4));
        else if (type === 1 || type === 7 || type === 2) vals.push(u8[off + k]);
        else if (type === 5) vals.push(u32(off + k * 8) / (u32(off + k * 8 + 4) || 1));
        else if (type === 16) vals.push(Number(dv.getBigUint64(off + k * 8, le)));
        else vals.push(u32(off + k * 4));
      }
      tags[tag] = vals;
    }
    const W = tags[256][0], H = tags[257][0];
    const spp = (tags[277] || [1])[0]; const bps = (tags[258] || [1])[0]; const comp = (tags[259] || [1])[0];
    const photo = (tags[262] || [spp >= 3 ? 2 : 1])[0]; const planar = (tags[284] || [1])[0]; const pred = (tags[317] || [1])[0];
    const sfmt = (tags[339] || [1])[0];
    if (![1, 5, 8, 32946, 32773].includes(comp)) throw new Error('TIFF-Kompression ' + comp + ' wird nicht unterstützt (unterstützt: keine, LZW, Deflate, PackBits)');
    if (![1, 8, 16, 32].includes(bps)) throw new Error('TIFF mit ' + bps + ' Bit je Kanal wird nicht unterstützt');
    if (photo === 5 || photo === 6) throw new Error('CMYK/YCbCr-TIFF wird nicht unterstützt');
    const tiled = !!tags[322];
    const tw = tiled ? tags[322][0] : W, th = tiled ? tags[323][0] : (tags[278] || [H])[0];
    const offs = tiled ? tags[324] : tags[273], cnts = tiled ? tags[325] : tags[279];
    const bpp = bps / 8;
    const planes = planar === 2 ? spp : 1, sppChunk = planar === 2 ? 1 : spp;
    const across = tiled ? Math.ceil(W / tw) : 1, down = Math.ceil(H / th);
    const raw = new Float32Array(W * H * spp);
    const maxv = bps === 16 ? 65535 : bps === 8 ? 255 : bps === 1 ? 1 : 1;
    for (let pl = 0; pl < planes; pl++) {
      for (let ty = 0; ty < down; ty++) for (let tx = 0; tx < across; tx++) {
        const idx = pl * across * down + ty * across + tx; if (idx >= offs.length) continue;
        const data = u8.subarray(offs[idx], offs[idx] + cnts[idx]);
        const rowsHere = tiled ? th : Math.min(th, H - ty * th);
        const rowBytes = bps === 1 ? Math.ceil(tw * sppChunk / 8) : tw * sppChunk * bpp;
        const expected = rowBytes * rowsHere;
        let dec;
        if (comp === 1) dec = data; else if (comp === 5) dec = lzwDecode(data, expected); else if (comp === 32773) dec = packbitsDecode(data, expected); else dec = await zlibInflate(data);
        const ddv = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);
        for (let r = 0; r < rowsHere; r++) {
          const y = ty * th + r; if (y >= H) break; const ro = r * rowBytes;
          const rowVals = new Float64Array(tw * sppChunk);
          for (let k = 0; k < tw * sppChunk; k++) {
            let val;
            if (bps === 8) val = dec[ro + k] || 0;
            else if (bps === 16) val = ro + k * 2 + 1 < dec.length ? ddv.getUint16(ro + k * 2, le) : 0;
            else if (bps === 32) val = ro + k * 4 + 3 < dec.length ? (sfmt === 3 ? ddv.getFloat32(ro + k * 4, le) : ddv.getUint32(ro + k * 4, le) / 4294967295) : 0;
            else val = (dec[ro + (k >> 3)] >> (7 - (k & 7))) & 1;
            rowVals[k] = val;
          }
          if (pred === 2) { for (let k = sppChunk; k < rowVals.length; k++) { rowVals[k] = (rowVals[k] + rowVals[k - sppChunk]) % (bps === 16 ? 65536 : 256); } }
          for (let x = 0; x < tw; x++) {
            const X = tx * tw + x; if (X >= W) break;
            for (let c = 0; c < sppChunk; c++) {
              const ch = planar === 2 ? pl : c; raw[(y * W + X) * spp + ch] = bps === 32 ? rowVals[x * sppChunk + c] : rowVals[x * sppChunk + c] / maxv;
            }
          }
        }
      }
    }
    const out = new Uint8ClampedArray(W * H * 4);
    const cmap = tags[320];
    const extra = tags[338] ? tags[338][0] : 0;
    for (let i = 0; i < W * H; i++) {
      let r, g, b, a = 1;
      if (photo === 3 && cmap) { const idx = Math.round(raw[i * spp] * maxv); const nC = cmap.length / 3; r = cmap[idx] / 65535; g = cmap[nC + idx] / 65535; b = cmap[2 * nC + idx] / 65535; }
      else if (spp >= 3) { r = raw[i * spp]; g = raw[i * spp + 1]; b = raw[i * spp + 2]; if (spp >= 4) a = raw[i * spp + 3]; }
      else { let v = raw[i * spp]; if (photo === 0) v = 1 - v; r = g = b = v; if (spp === 2) a = raw[i * spp + 1]; }
      if (a < 1 && extra === 1 && a > 0) { r /= a; g /= a; b /= a; }
      const j = i * 4; out[j] = r * 255 + 0.5; out[j + 1] = g * 255 + 0.5; out[j + 2] = b * 255 + 0.5; out[j + 3] = a * 255 + 0.5;
    }
    return { width: W, height: H, data: out, bits: bps };
  }

  /* ---------- TIFF schreiben ---------- */
  // data: Uint8ClampedArray oder Uint16Array (RGBA), alpha: Alphakanal behalten
  async function encodeTIFF(data, W, H, bits, alpha, compress) {
    const spp = alpha ? 4 : 3, bpc = bits / 8; const rowBytes = W * spp * bpc;
    let pix = new Uint8Array(rowBytes * H); const pdv = new DataView(pix.buffer);
    for (let i = 0, p = 0; i < W * H; i++) {
      for (let c = 0; c < spp; c++) {
        const v = data[i * 4 + c];
        if (bits === 8) pix[p++] = v; else { pdv.setUint16(p, v, true); p += 2; }
      }
    }
    let comp = 1, pred = 1;
    if (compress) {
      // horizontales Differenzieren (Predictor 2) für bessere Kompression
      for (let y = 0; y < H; y++) {
        const o = y * rowBytes;
        if (bits === 8) { for (let x = W - 1; x > 0; x--) for (let c = 0; c < spp; c++) { const k = o + x * spp + c; pix[k] = (pix[k] - pix[k - spp]) & 255; } }
        else { for (let x = W - 1; x > 0; x--) for (let c = 0; c < spp; c++) { const k = o + (x * spp + c) * 2; pdv.setUint16(k, (pdv.getUint16(k, true) - pdv.getUint16(k - spp * 2, true)) & 65535, true); } }
      }
      pix = await zlibDeflate(pix); comp = 8; pred = 2;
    }
    const entries = [];
    const add = (tag, type, vals) => entries.push({ tag, type, vals: Array.isArray(vals) ? vals : [vals] });
    add(256, 4, W); add(257, 4, H); add(258, 3, new Array(spp).fill(bits)); add(259, 3, comp); add(262, 3, 2);
    add(273, 4, 0); add(277, 3, spp); add(278, 4, H); add(279, 4, pix.length); add(282, 5, [[72, 1]]); add(283, 5, [[72, 1]]); add(284, 3, 1); add(296, 3, 2);
    add(305, 2, Array.from(new TextEncoder().encode('Lichtwerk\0')));
    if (pred !== 1) add(317, 3, pred);
    if (alpha) add(338, 3, 2);
    entries.sort((a, b) => a.tag - b.tag);
    const tsz = { 2: 1, 3: 2, 4: 4, 5: 8 };
    const ifdOff = 8, ifdSize = 2 + entries.length * 12 + 4;
    let extraOff = ifdOff + ifdSize; const extras = [];
    for (const e of entries) { const sz = tsz[e.type] * e.vals.length; if (sz > 4) { e.off = extraOff; extras.push(e); extraOff += sz + (sz & 1); } }
    const dataOff = extraOff; entries.find((e) => e.tag === 273).vals = [dataOff];
    const buf = new ArrayBuffer(dataOff + pix.length); const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true); dv.setUint16(ifdOff, entries.length, true);
    const writeVals = (e, off) => {
      e.vals.forEach((v, k) => {
        if (e.type === 3) dv.setUint16(off + k * 2, v, true); else if (e.type === 4) dv.setUint32(off + k * 4, v, true);
        else if (e.type === 2) dv.setUint8(off + k, v); else if (e.type === 5) { dv.setUint32(off + k * 8, v[0], true); dv.setUint32(off + k * 8 + 4, v[1], true); }
      });
    };
    entries.forEach((e, i) => {
      const o = ifdOff + 2 + i * 12; dv.setUint16(o, e.tag, true); dv.setUint16(o + 2, e.type, true); dv.setUint32(o + 4, e.vals.length, true);
      if (e.off != null) { dv.setUint32(o + 8, e.off, true); writeVals(e, e.off); } else writeVals(e, o + 8);
    });
    dv.setUint32(ifdOff + 2 + entries.length * 12, 0, true);
    u8.set(pix, dataOff);
    return new Blob([buf], { type: 'image/tiff' });
  }

  /* ---------- PNG schreiben ---------- */
  async function encodePNG(data, W, H, bits, alpha) {
    const spp = alpha ? 4 : 3, bpc = bits / 8, bpp = spp * bpc; const rowBytes = W * bpp;
    const raw = new Uint8Array((rowBytes + 1) * H);
    const line = new Uint8Array(rowBytes);
    for (let y = 0; y < H; y++) {
      for (let x = 0, p = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        for (let c = 0; c < spp; c++) { const v = data[i + c]; if (bits === 8) line[p++] = v; else { line[p++] = v >> 8; line[p++] = v & 255; } }
      }
      const o = y * (rowBytes + 1); raw[o] = 1; // Filter „Sub“
      for (let k = 0; k < rowBytes; k++) raw[o + 1 + k] = (line[k] - (k >= bpp ? line[k - bpp] : 0)) & 255;
    }
    const z = await zlibDeflate(raw);
    const chunks = [];
    const chunk = (type, body) => {
      const b = new Uint8Array(12 + body.length); const dv = new DataView(b.buffer);
      dv.setUint32(0, body.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i); b.set(body, 8);
      dv.setUint32(8 + body.length, crcFinal(crc32(b.subarray(4, 8 + body.length)))); chunks.push(b);
    };
    const ihdr = new Uint8Array(13); const idv = new DataView(ihdr.buffer); idv.setUint32(0, W); idv.setUint32(4, H); ihdr[8] = bits; ihdr[9] = alpha ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    chunk('IHDR', ihdr);
    chunk('sRGB', new Uint8Array([0]));
    chunk('IDAT', z); chunk('IEND', new Uint8Array(0));
    return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])].concat(chunks), { type: 'image/png' });
  }

  /* ---------- ZIP (Store) ---------- */
  async function makeZip(files) {
    const parts = [], central = []; let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer()); const name = enc.encode(f.name); const crc = crcFinal(crc32(data));
      const h = new Uint8Array(30 + name.length); const dv = new DataView(h.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true); h.set(name, 30);
      parts.push(h, data);
      const c = new Uint8Array(46 + name.length); const cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); c.set(name, 46);
      central.push(c); offset += h.length + data.length;
    }
    const csize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, csize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  G.Codecs = { decodeTIFF, encodeTIFF, encodePNG, makeZip, crc32, lzwDecode, packbitsDecode };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.Codecs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
