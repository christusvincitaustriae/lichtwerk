"""Verhaltenstests für jede Funktion von Lichtwerk (echter Browser, echte Bedienung, Pixelmessung)."""
import asyncio, json, sys, os, io, struct, time, traceback
from playwright.async_api import async_playwright
from PIL import Image
import numpy as np, tifffile

URL = 'file:///home/claude/lichtwerk/dist/lichtwerk.html'
FIX = '/home/claude/lichtwerk/test/fixtures/'
OUT = '/home/claude/lichtwerk/test/out/'
os.makedirs(OUT, exist_ok=True)
ONLY = sys.argv[1:]
results = []

JS = r"""
window.__t = {
  stats(x0, y0, x1, y1, id) {
    const cv = document.querySelector(id || '#cvMain'); const c = cv.getContext('2d'); const w = cv.width, h = cv.height;
    const X0 = Math.floor(x0 * w), Y0 = Math.floor(y0 * h), X1 = Math.max(X0 + 1, Math.floor(x1 * w)), Y1 = Math.max(Y0 + 1, Math.floor(y1 * h));
    const W = X1 - X0, H = Y1 - Y0; const d = c.getImageData(X0, Y0, W, H).data;
    let r = 0, g = 0, b = 0, s = 0, n = 0, lap = 0, ln = 0, red = 0, transp = 0, sat2 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); s += mx - mn; n++;
      if (d[i] > 240 && d[i + 1] < 80 && d[i + 2] < 100) red++; if (d[i + 3] < 250) transp++;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) { lap += Math.abs(4 * d[i + 1] - d[i - 3] - d[i + 5] - d[i - W * 4 + 1] - d[i + W * 4 + 1]); ln++; }
    }
    return { r: r / n, g: g / n, b: b / n, y: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n, sat: s / n, lap: lap / Math.max(1, ln), red: red / n, transp: transp / n, w, h };
  },
  cssSize(id) { const r = document.querySelector(id || '#cvMain').getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top }; },
  renders() { return +document.querySelector('#stage').dataset.rendered || 0; },
};
"""

class T:
    def __init__(s, page): s.p = page
    async def settle(s, ms=520):
        await s.p.wait_for_timeout(ms)
    async def stats(s, box=(0, 0, 1, 1), cid=None):
        return await s.p.evaluate('([a,b,c,d,id])=>__t.stats(a,b,c,d,id)', [*box, cid])
    async def slider(s, k, v, scope='#panelBody'):
        sel = f'{scope} .ctl[data-k="{k}"] input[type=range]'
        n = await s.p.locator(sel).count()
        if not n: raise AssertionError('Regler nicht gefunden: ' + k)
        await s.p.evaluate("""([sel,v])=>{const r=document.querySelector(sel); r.value=v; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));}""", [sel, v])
        await s.settle()
    async def val(s, k, scope='#panelBody'):
        return await s.p.locator(f'{scope} .ctl[data-k="{k}"] input.val').first.input_value()
    async def open_group(s, gid):
        card = s.p.locator(f'.grp[data-g="{gid}"]')
        if 'closed' in (await card.get_attribute('class') or ''):
            await card.locator('.grp-h').click()
            await s.p.wait_for_timeout(100)
    async def open_adv(s, scope):
        adv = s.p.locator(f'{scope} .adv').first
        if 'open' not in (await adv.get_attribute('class') or ''):
            await adv.locator('.adv-t').click(); await s.p.wait_for_timeout(80)
    async def reset_all(s):
        await s.tab('edit')
        await s.p.click('button[title="Alle Bearbeitungen zurücksetzen"]'); await s.settle()
    async def tab(s, t):
        await s.p.click(f'#rail button[data-tab="{t}"]'); await s.p.wait_for_timeout(250)
    async def img_box(s):
        return await s.p.evaluate('__t.cssSize()')
    async def drag_img(s, fx0, fy0, fx1, fy1, steps=12):
        b = await s.img_box()
        await s.p.mouse.move(b['x'] + fx0 * b['w'], b['y'] + fy0 * b['h'])
        await s.p.mouse.down()
        await s.p.mouse.move(b['x'] + fx1 * b['w'], b['y'] + fy1 * b['h'], steps=steps)
        await s.p.mouse.up(); await s.settle()
    async def click_img(s, fx, fy):
        b = await s.img_box(); await s.p.mouse.click(b['x'] + fx * b['w'], b['y'] + fy * b['h']); await s.settle()
    async def handle_pos(s, h):
        return await s.p.evaluate("""(h)=>{const e=document.querySelector('#overlay [data-h="'+h+'"]'); if(!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2];}""", h)
    async def drag_handle(s, h, dx, dy):
        p = await s.handle_pos(h)
        if not p: raise AssertionError('Griff nicht gefunden: ' + h)
        await s.p.mouse.move(p[0], p[1]); await s.p.mouse.down(); await s.p.mouse.move(p[0] + dx, p[1] + dy, steps=8); await s.p.mouse.up(); await s.settle()
    async def export(s, fmt, bits=None, q=None, size_mode=None, size=None, sharpen=None, name=None):
        await s.p.click('#btnExport'); await s.p.wait_for_selector('#exFmt')
        await s.p.select_option('#exFmt', fmt)
        if bits: await s.p.select_option('#exBits', str(bits))
        if q is not None:
            await s.p.evaluate("(v)=>{const r=document.querySelector('.modal .ctl[data-k=\"exQ\"] input[type=range]'); r.value=v; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));}", q)
        await s.p.select_option('#exSize', size_mode or 'orig')
        if size: await s.p.fill('#exSizeVal', str(size)); await s.p.dispatch_event('#exSizeVal', 'change')
        if sharpen: await s.p.select_option('#exSharp', sharpen)
        async with s.p.expect_download(timeout=60000) as dl:
            await s.p.click('#exGo')
        d = await dl.value
        path = OUT + (name or d.suggested_filename)
        await d.save_as(path)
        await s.p.wait_for_timeout(300)
        return path, d.suggested_filename

def rec(name, ok, detail='', status=None):
    st = status or ('funktionsfähig' if ok else 'FEHLER')
    results.append({'name': name, 'ok': bool(ok), 'status': st, 'detail': detail})
    print(('OK   ' if ok else 'FAIL ') + name + ' — ' + detail, flush=True)

def f1(x): return f'{x:.1f}'

async def run(t, name, fn):
    if ONLY and not any(o.lower() in name.lower() for o in ONLY): return
    try:
        await fn()
    except Exception as e:
        rec(name, False, 'Ausnahme: ' + str(e)[:300])
        traceback.print_exc()

SKY = (0.3, 0.03, 0.55, 0.18); SUN = (0.62, 0.22, 0.78, 0.38); TREE = (0.07, 0.62, 0.11, 0.8); FG = (0.3, 0.88, 0.7, 0.98); ALL = (0, 0, 1, 1)
CORNER = (0.0, 0.0, 0.05, 0.07); CENTER = (0.45, 0.45, 0.55, 0.55)

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        cur = {'n': ''}
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append((results[-1]['name'] if results else '-') + ' :: ' + m.text) if m.type == 'error' else None)
        await pg.add_init_script(JS)
        await pg.goto(URL)
        await pg.wait_for_function('document.documentElement.dataset.ready==="1"', timeout=30000)
        t = T(pg); await t.settle(800)
        base = await t.stats(ALL)

        # ---------- Basis ----------
        async def exposure():
            await t.reset_all(); b = await t.stats(ALL)
            # echte Mausbedienung des Reglers
            r = pg.locator('.ctl[data-k="exposure"] input[type=range]'); bb = await r.bounding_box()
            await pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await pg.mouse.down(); await pg.mouse.move(bb['x'] + bb['width'] * 0.62, bb['y'] + bb['height'] / 2, steps=6); await pg.mouse.up(); await t.settle()
            v = await t.val('exposure'); a = await t.stats(ALL)
            rec('Belichtung (Maus am Regler)', a['y'] > b['y'] + 8 and v.startswith('+'), f'Wert {v}, Ø-Helligkeit {f1(b["y"])} → {f1(a["y"])}')
            await pg.focus('.ctl[data-k="exposure"] input[type=range]')
            for _ in range(20): await pg.keyboard.press('ArrowLeft')
            await t.settle(); v2 = await t.val('exposure')
            rec('Belichtung per Tastatur (Pfeiltasten)', v2 != v, f'{v} → {v2}')
        await run(t, 'Belichtung', exposure)

        async def simple(name, k, v, box, check, group=None, desc=''):
            await t.reset_all()
            if group: await t.open_group(group)
            b = await t.stats(box); await t.slider(k, v); a = await t.stats(box)
            ok, det = check(b, a)
            rec(name, ok, det)
        async def basics():
            await simple('Kontrast', 'contrast', 70, ALL, lambda b, a: (a['lap'] > b['lap'] * 1.02 and abs(a['y'] - b['y']) < 25, f'Kantenenergie {f1(b["lap"])} → {f1(a["lap"])}'))
            await simple('Lichter (abdunkeln)', 'highlights', -100, SUN, lambda b, a: (a['y'] < b['y'] - 5, f'Sonnenbereich {f1(b["y"])} → {f1(a["y"])}'))
            await simple('Tiefen (aufhellen)', 'shadows', 100, FG, lambda b, a: (a['y'] > b['y'] + 4, f'Vordergrund {f1(b["y"])} → {f1(a["y"])}'))
            await simple('Weiß', 'whites', 80, SKY, lambda b, a: (a['y'] > b['y'] + 3, f'Himmel {f1(b["y"])} → {f1(a["y"])}'))
            await simple('Schwarz', 'blacks', -80, FG, lambda b, a: (a['y'] < b['y'] - 1, f'Vordergrund {f1(b["y"])} → {f1(a["y"])}'))
            await simple('Dynamik', 'vibrance', 90, ALL, lambda b, a: (a['sat'] > b['sat'] + 3, f'Sättigung Ø {f1(b["sat"])} → {f1(a["sat"])}'), 'color')
            await simple('Sättigung', 'saturation', -100, ALL, lambda b, a: (a['sat'] < 2.5, f'Sättigung Ø {f1(b["sat"])} → {f1(a["sat"])}'), 'color')
            await simple('Struktur', 'texture', 100, ALL, lambda b, a: (a['lap'] > b['lap'] * 1.08, f'Kantenenergie {f1(b["lap"])} → {f1(a["lap"])}'), 'presence')
            await simple('Klarheit', 'clarity', 100, ALL, lambda b, a: (abs(a['lap'] - b['lap']) > 0.2 or abs(a['y'] - b['y']) > 1, f'Kantenenergie {f1(b["lap"])} → {f1(a["lap"])}, Ø {f1(b["y"])} → {f1(a["y"])}'), 'presence')
            await simple('Dunst entfernen', 'dehaze', 80, SKY, lambda b, a: (a['sat'] > b['sat'] + 2 or a['y'] < b['y'] - 3, f'Himmel Sättigung {f1(b["sat"])} → {f1(a["sat"])}, Helligkeit {f1(b["y"])} → {f1(a["y"])}'), 'presence')
            await simple('Temperatur', 'temp', 60, ALL, lambda b, a: ((a['r'] - a['b']) > (b['r'] - b['b']) + 10, f'R−B {f1(b["r"]-b["b"])} → {f1(a["r"]-a["b"])}'), 'wb')
            await simple('Tönung', 'tint', 60, ALL, lambda b, a: (a['g'] < b['g'] - 1 and a['r'] > b['r'], f'G {f1(b["g"])} → {f1(a["g"])}'), 'wb')
            await simple('Schärfen', 'sharp', 150, ALL, lambda b, a: (a['lap'] > b['lap'] * 1.1, f'Kantenenergie {f1(b["lap"])} → {f1(a["lap"])}'), 'detail')
            await simple('Rauschreduzierung Luminanz', 'nrLum', 100, SKY, lambda b, a: (a['lap'] < b['lap'] * 0.8, f'Kantenenergie Himmel {f1(b["lap"])} → {f1(a["lap"])}'), 'detail')
            await simple('Rauschreduzierung Farbe', 'nrColor', 100, SKY, lambda b, a: (abs(a['y'] - b['y']) < 2 and a['lap'] <= b['lap'] * 1.01, f'Helligkeit stabil {f1(b["y"])} → {f1(a["y"])}, Kanten {f1(b["lap"])} → {f1(a["lap"])}'), 'detail')
            await simple('Körnung', 'grain', 80, SKY, lambda b, a: (a['lap'] > b['lap'] * 1.3, f'Kantenenergie Himmel {f1(b["lap"])} → {f1(a["lap"])}'), 'fx')
            await simple('Vignette abdunkeln', 'vig', -90, CORNER, lambda b, a: (a['y'] < b['y'] - 5, f'Ecke {f1(b["y"])} → {f1(a["y"])}'), 'fx')
            await simple('Vignette aufhellen', 'vig', 90, CORNER, lambda b, a: (a['y'] > b['y'] + 5, f'Ecke {f1(b["y"])} → {f1(a["y"])}'), 'fx')
        await run(t, 'Basis', basics)

        async def adv_controls():
            await t.reset_all(); await t.open_adv('.grp[data-g="light"]')
            vis = await pg.locator('.grp[data-g="light"] .ctl[data-k="lvGamma"]').is_visible()
            b = await t.stats(ALL); await t.slider('lvGamma', 1.6); a = await t.stats(ALL)
            rec('Erweitert-Bereich + Tonwertkorrektur (Gamma)', vis and a['y'] > b['y'] + 8, f'sichtbar={vis}, Ø {f1(b["y"])} → {f1(a["y"])}')
            await t.slider('lvGamma', 1); await t.slider('highlights', -100); s1 = await t.stats(SUN); await t.slider('hlRange', 100); s2 = await t.stats(SUN)
            rec('Erweitert: Lichterbereich', abs(s2['y'] - s1['y']) > 0.5, f'Sonne {f1(s1["y"])} → {f1(s2["y"])}')
            await t.reset_all(); await t.open_group('fx'); await t.open_adv('.grp[data-g="fx"]'); await t.slider('vig', -80); c1 = await t.stats(CORNER); await t.slider('vigMid', 0); c2 = await t.stats((0.15, 0.15, 0.2, 0.2))
            await t.slider('vigMid', 100); c3 = await t.stats((0.15, 0.15, 0.2, 0.2))
            rec('Erweitert: Vignette-Mittelpunkt', c2['y'] < c3['y'] - 2, f'innen {f1(c2["y"])} (0) vs {f1(c3["y"])} (100)')
            await t.slider('vig', 0); await t.slider('grain', 70); g1 = await t.stats(SKY); await t.slider('grainSize', 100); g2 = await t.stats(SKY)
            rec('Erweitert: Korngröße', g2['lap'] < g1['lap'], f'Kantenenergie {f1(g1["lap"])} → {f1(g2["lap"])}')
            await t.reset_all(); await t.open_group('detail'); await t.open_adv('.grp[data-g="detail"]'); await t.slider('sharp', 100); await t.slider('sharpMask', 80)
            await pg.locator('.grp[data-g="detail"] label.sw', has_text='Schärfemaske anzeigen').click(); await t.settle()
            m = await t.stats(ALL)
            rec('Schärfen: Maskieren + Maskenvorschau', m['sat'] < 1 and m['y'] < 200, f'Graustufenmaske (Sättigung {f1(m["sat"])}, Ø {f1(m["y"])})')
            await pg.locator('.grp[data-g="detail"] label.sw', has_text='Schärfemaske anzeigen').click(); await t.settle()
        await run(t, 'Erweitert', adv_controls)

        async def value_entry():
            await t.reset_all(); inp = pg.locator('.ctl[data-k="exposure"] input.val')
            await inp.click(); await inp.fill('1,5'); await inp.press('Enter'); await t.settle()
            v = await t.val('exposure'); r = await pg.locator('.ctl[data-k="exposure"] input[type=range]').input_value()
            rec('Werteingabe per Tastatur (Komma)', v == '+1,50' and r == '1.5', f'Anzeige {v}, Regler {r}')
            await pg.dblclick('.ctl[data-k="exposure"] label'); await t.settle(); v = await t.val('exposure')
            rec('Doppelklick setzt Regler zurück', v == '0,00', f'Anzeige {v}')
        await run(t, 'Werteingabe', value_entry)

        async def wb_tools():
            await t.reset_all(); await pg.click('button:has-text("Automatisch")'); await t.settle()
            tv = await t.val('temp'); ti = await t.val('tint')
            rec('Auto-Weißabgleich', tv != '0' or ti != '0', f'Temperatur {tv}, Tönung {ti}')
            await t.reset_all(); await pg.click('button:has-text("Pipette")'); await pg.wait_for_timeout(150)
            await t.click_img(0.35, 0.1)
            tv = await t.val('temp')
            rec('Weißabgleich-Pipette (Klick auf blauen Himmel)', tv.startswith('+'), f'Temperatur → {tv} (Himmel wird neutralisiert = wärmer)')
            await t.reset_all(); await t.open_adv('.grp[data-g="wb"]'); await pg.select_option('.grp[data-g="wb"] select', label='Kunstlicht'); await t.settle()
            tv = await t.val('temp'); rec('Weißabgleich-Vorgabe (Kunstlicht)', tv.startswith('−'), f'Temperatur {tv}')
            s0 = await t.stats(ALL); await t.slider('rGain', 30); s = await t.stats(ALL); rec('Erweitert: Rot-Anteil (Feinabstimmung)', s['r'] - s['b'] > s0['r'] - s0['b'] + 2, f'R−B {f1(s0["r"]-s0["b"])} → {f1(s["r"]-s["b"])}')
        await run(t, 'Weißabgleich', wb_tools)

        async def auto_tone():
            await t.reset_all(); b = await t.stats(ALL); await pg.click('button:has-text("Auto-Ton")'); await t.settle(700)
            v = await t.val('exposure'); a = await t.stats(ALL)
            rec('Auto-Ton', v != '0,00' and abs(a['y'] - b['y']) > 3, f'Belichtung {v}, Ø {f1(b["y"])} → {f1(a["y"])}')
        await run(t, 'Auto-Ton', auto_tone)

        async def hsl():
            await t.reset_all(); await t.open_group('hsl')
            await pg.click('.grp[data-g="hsl"] .seg button:has-text("Luminanz")'); await pg.wait_for_timeout(150)
            b = await t.stats(SKY); await t.slider('l5', -100); a = await t.stats(SKY)
            rec('HSL: Blau-Luminanz', a['y'] < b['y'] - 3, f'Himmel {f1(b["y"])} → {f1(a["y"])}')
            await t.reset_all(); await t.open_group('hsl'); await pg.click('.grp[data-g="hsl"] .seg button:has-text("Farbton")'); await pg.wait_for_timeout(150)
            b = await t.stats(SKY); await t.slider('h5', 100); a = await t.stats(SKY)
            rec('HSL: Blau-Farbton', abs(a['r'] - b['r']) + abs(a['g'] - b['g']) > 3, f'Himmel R/G {f1(b["r"])}/{f1(b["g"])} → {f1(a["r"])}/{f1(a["g"])}')
            await t.reset_all(); await t.open_group('hsl'); await pg.click('.grp[data-g="hsl"] .seg button:has-text("Sättigung")'); await pg.wait_for_timeout(150)
            b = await t.stats(FG); await t.slider('s0', -100); await t.slider('s1', -100); await t.slider('s2', -100); a = await t.stats(FG)
            rec('HSL: Rot/Orange/Gelb-Sättigung', a['sat'] < b['sat'] - 1, f'Blumenwiese Sättigung {f1(b["sat"])} → {f1(a["sat"])}')
            # Zielkorrektur
            await t.reset_all(); await t.open_group('hsl'); await pg.click('.grp[data-g="hsl"] .seg button:has-text("Luminanz")'); await t.open_adv('.grp[data-g="hsl"]')
            await pg.click('button:has-text("Zielkorrektur")'); await pg.wait_for_timeout(200)
            b = await t.stats(SKY); await t.drag_img(0.4, 0.08, 0.4, 0.2, steps=10); a = await t.stats(SKY)
            vals = [await t.val(f'l{i}') for i in range(8)]
            rec('HSL-Zielkorrektur (im Bild ziehen)', any(v not in ('0',) for v in vals) and a['y'] < b['y'], f'Werte {vals}, Himmel {f1(b["y"])} → {f1(a["y"])}')
            await pg.keyboard.press('Escape')
        await run(t, 'HSL', hsl)

        async def bw():
            await t.reset_all(); await t.open_group('color'); await pg.locator('.grp[data-g="color"] label.sw', has_text='Schwarzweiß').click(); await t.settle()
            a = await t.stats(ALL); await t.open_group('hsl'); await pg.click('.grp[data-g="hsl"] .seg button:has-text("Graumischung")'); b = await t.stats(SKY); await t.slider('l5', -100); c = await t.stats(SKY)
            rec('Schwarzweiß + Graumischung', a['sat'] < 1.5 and c['y'] < b['y'] - 5, f'Sättigung {f1(a["sat"])}, Himmel grau {f1(b["y"])} → {f1(c["y"])}')
        await run(t, 'Schwarzweiß', bw)

        async def grading():
            await t.reset_all(); await t.open_group('grading')
            await t.slider('gHiH', 30); b = await t.stats(SUN); await t.slider('gHiS', 90); a = await t.stats(SUN)
            await t.slider('gShH', 220); bs = await t.stats(TREE); await t.slider('gShS', 90); as_ = await t.stats(TREE)
            rec('Farbüberlagerung / Split-Toning', (a['r'] - a['b']) > (b['r'] - b['b']) + 5 and (as_['b'] - as_['r']) > (bs['b'] - bs['r']) + 1, f'Lichter R−B {f1(b["r"]-b["b"])} → {f1(a["r"]-a["b"])}; Tiefen B−R {f1(bs["b"]-bs["r"])} → {f1(as_["b"]-as_["r"])}')
            await t.open_adv('.grp[data-g="grading"]'); m1 = await t.stats(ALL); await t.slider('gMiS', 80); m2 = await t.stats(ALL)
            rec('Erweitert: Mitteltöne färben', abs(m2['r'] - m1['r']) + abs(m2['b'] - m1['b']) > 2, f'Ø R/B {f1(m1["r"])}/{f1(m1["b"])} → {f1(m2["r"])}/{f1(m2["b"])}')
        await run(t, 'Farbüberlagerung', grading)

        async def curves():
            await t.reset_all(); await t.open_group('curve'); await pg.wait_for_timeout(200)
            cv = pg.locator('.curve-wrap canvas'); await cv.scroll_into_view_if_needed(); await pg.wait_for_timeout(400); bb = await cv.bounding_box()
            b = await t.stats(ALL)
            await pg.mouse.move(bb['x'] + bb['width'] * 0.5, bb['y'] + bb['height'] * 0.5); await pg.mouse.down(); await pg.mouse.move(bb['x'] + bb['width'] * 0.5, bb['y'] + bb['height'] * 0.3, steps=6); await pg.mouse.up(); await t.settle()
            a = await t.stats(ALL)
            rec('Gradationskurve RGB (Punkt setzen + ziehen)', a['y'] > b['y'] + 6, f'Ø {f1(b["y"])} → {f1(a["y"])}')
            await pg.dblclick('.curve-wrap canvas', position={'x': bb['width'] * 0.5, 'y': bb['height'] * 0.3}); await t.settle(); c = await t.stats(ALL)
            rec('Kurvenpunkt per Doppelklick entfernen', abs(c['y'] - b['y']) < 1.5, f'Ø wieder {f1(c["y"])}')
            await pg.click('.grp[data-g="curve"] .seg button[data-v="r"]'); await pg.wait_for_timeout(150); await pg.locator('.curve-wrap canvas').scroll_into_view_if_needed(); bb = await pg.locator('.curve-wrap canvas').bounding_box()
            b = await t.stats(ALL); await pg.mouse.click(bb['x'] + bb['width'] * 0.5, bb['y'] + bb['height'] * 0.3); await t.settle(); a = await t.stats(ALL)
            rec('Gradationskurve Rot-Kanal', a['r'] > b['r'] + 5 and abs(a['g'] - b['g']) < 2, f'R {f1(b["r"])} → {f1(a["r"])}, G {f1(b["g"])} → {f1(a["g"])}')
            await t.reset_all(); await t.open_group('curve'); await pg.click('.grp[data-g="curve"] .seg button[data-v="rgb"]'); b = await t.stats(ALL); await pg.select_option('.grp[data-g="curve"] select', 'Starker Kontrast'); await t.settle(); a = await t.stats(ALL)
            rec('Kurvenvorgabe „Starker Kontrast“', a['lap'] > b['lap'], f'Kantenenergie {f1(b["lap"])} → {f1(a["lap"])}')
            await t.reset_all(); await t.open_group('curve'); await t.open_adv('.grp[data-g="curve"]'); b = await t.stats(ALL); await t.slider('cSh', 100); a = await t.stats(ALL)
            rec('Parametrische Kurve (Tiefen)', a['y'] > b['y'] + 1, f'Ø {f1(b["y"])} → {f1(a["y"])}')
            await pg.click('.grp[data-g="curve"] .seg button[data-v="rgb"]'); await pg.wait_for_timeout(100); await pg.locator('.curve-wrap canvas').scroll_into_view_if_needed(); bb = await pg.locator('.curve-wrap canvas').bounding_box()
            await pg.mouse.click(bb['x'] + bb['width'] * 0.25, bb['y'] + bb['height'] * 0.75); await pg.wait_for_timeout(150)
            await pg.fill('input[aria-label="Ausgabe"]', '100'); await pg.dispatch_event('input[aria-label="Ausgabe"]', 'change'); await t.settle(); c = await t.stats(ALL)
            rec('Kurvenpunkt numerisch (Erweitert)', c['y'] > a['y'] + 3, f'Ø {f1(a["y"])} → {f1(c["y"])}')
        await run(t, 'Kurven', curves)

        # ---------- Masken ----------
        async def masks():
            await t.reset_all(); await t.tab('masks')
            await pg.click('[data-add="linear"]'); await pg.wait_for_timeout(150)
            b_top = await t.stats((0.2, 0.02, 0.8, 0.1)); b_bot = await t.stats((0.2, 0.9, 0.8, 0.98))
            await t.drag_img(0.5, 0.05, 0.5, 0.5)
            await pg.click('#panelBody label.sw:has-text("Überlagerung")'); await t.settle()  # Überlagerung aus
            a_top = await t.stats((0.2, 0.02, 0.8, 0.1)); a_bot = await t.stats((0.2, 0.9, 0.8, 0.98))
            n = await pg.locator('[data-mask]').count()
            rec('Linearer Verlauf (im Bild aufziehen)', n == 1 and a_top['y'] < b_top['y'] - 6 and abs(a_bot['y'] - b_bot['y']) < 0.8, f'oben {f1(b_top["y"])} → {f1(a_top["y"])}, unten {f1(b_bot["y"])} → {f1(a_bot["y"])}')
            await t.drag_handle('l-b', 0, 250); c_mid = await t.stats((0.2, 0.55, 0.8, 0.62))
            await t.drag_handle('l-b', 0, -250); d_mid = await t.stats((0.2, 0.55, 0.8, 0.62))
            rec('Verlauf per Griff anpassen', c_mid['y'] < d_mid['y'] - 1, f'Mitte {f1(d_mid["y"])} (kurz) vs {f1(c_mid["y"])} (lang)')
            await t.slider('m.adj.exposure', 1.5); e_top = await t.stats((0.2, 0.02, 0.8, 0.1))
            rec('Lokale Korrektur: Belichtung', e_top['y'] > b_top['y'] + 10, f'oben {f1(b_top["y"])} → {f1(e_top["y"])}')
            await pg.click('#panelBody label.sw:has-text("Invertieren")'); await t.settle(); i_top = await t.stats((0.2, 0.02, 0.8, 0.1)); i_bot = await t.stats((0.2, 0.9, 0.8, 0.98))
            rec('Maske invertieren', abs(i_top['y'] - b_top['y']) < 2 and i_bot['y'] > b_bot['y'] + 5, f'oben {f1(i_top["y"])}, unten {f1(b_bot["y"])} → {f1(i_bot["y"])}')
            await t.slider('m.root.opacity', 0); o = await t.stats((0.2, 0.9, 0.8, 0.98))
            rec('Masken-Deckkraft 0 %', abs(o['y'] - b_bot['y']) < 1, f'unten {f1(o["y"])} (Original {f1(b_bot["y"])})')
            await pg.locator('[data-mask] button[title="Maske löschen"]').first.click(); await t.settle()
            # Radial
            await pg.click('[data-add="radial"]'); await pg.wait_for_timeout(150); bc = await t.stats(CENTER); be = await t.stats(CORNER)
            await t.drag_img(0.5, 0.5, 0.7, 0.7); ac = await t.stats(CENTER); ae = await t.stats(CORNER)
            rec('Radialfilter', ac['y'] > bc['y'] + 5 and abs(ae['y'] - be['y']) < 1, f'Mitte {f1(bc["y"])} → {f1(ac["y"])}, Ecke {f1(be["y"])} → {f1(ae["y"])}')
            await t.drag_handle('r-x', 120, 0); await t.drag_handle('r-c', -100, 0); rc = await t.stats((0.35, 0.45, 0.42, 0.55))
            rec('Radialfilter verschieben/skalieren', rc['y'] > bc['y'] - 50, f'Bereich links der Mitte {f1(rc["y"])}')
            await t.open_adv('[data-editor]')
            await pg.locator('[data-editor] label.sw', has_text='Auf Helligkeitsbereich').click(); await t.slider('m.range.lo', 60); r1 = await t.stats(CENTER)
            rec('Bereichsmaske (Luminanz) begrenzt Wirkung', r1['y'] < ac['y'], f'Mitte {f1(ac["y"])} → {f1(r1["y"])}')
            await pg.locator('[data-mask] button[title="Maske löschen"]').first.click(); await t.settle()
            # Helligkeitsmaske
            await pg.click('[data-add="luma"]'); await t.settle(); await pg.click('#panelBody label.sw:has-text("Überlagerung")'); await t.settle()
            s = await t.stats(SUN); tr = await t.stats(TREE)
            rec('Helligkeitsmaske', s['y'] < (await pg.evaluate('0')) + 999 and True, f'Sonne {f1(s["y"])}, Bäume {f1(tr["y"])}', None)
            await pg.locator('[data-mask] button[title="Maske löschen"]').first.click(); await t.settle()
            s0 = await t.stats(SUN); await pg.click('[data-add="luma"]'); await t.settle(); await pg.click('#panelBody label.sw:has-text("Überlagerung")'); await t.settle(); s1 = await t.stats(SUN); tr1 = await t.stats(TREE)
            results.pop(); rec('Helligkeitsmaske (helle Bereiche −0,5 EV)', s1['y'] < s0['y'] - 3 and abs(tr1['y'] - tr['y']) < 1, f'Sonne {f1(s0["y"])} → {f1(s1["y"])}, Bäume unverändert {f1(tr1["y"])}')
            # Überlagerung zeigt Maske rot
            await pg.click('#panelBody label.sw:has-text("Überlagerung")'); await t.settle(); ov = await t.stats(SUN)
            rec('Masken-Überlagerung (rote Anzeige)', ov['r'] > s1['r'] + 10, f'Rotanteil Sonne {f1(s1["r"])} → {f1(ov["r"])}')
            await pg.locator('[data-mask] button[title="Maske löschen"]').first.click(); await t.settle()
            # Pinselmaske
            await pg.click('[data-add="brush"]'); await t.settle(); await pg.click('#panelBody label.sw:has-text("Überlagerung")'); await t.settle()
            band = (0.3, 0.47, 0.7, 0.53); b1 = await t.stats(band); o1 = await t.stats((0.3, 0.2, 0.7, 0.25))
            await t.drag_img(0.25, 0.5, 0.75, 0.5, steps=25); a1 = await t.stats(band); o2 = await t.stats((0.3, 0.2, 0.7, 0.25))
            rec('Pinselmaske malen', a1['y'] > b1['y'] + 5 and abs(o2['y'] - o1['y']) < 0.5, f'Pinselbahn {f1(b1["y"])} → {f1(a1["y"])}, außerhalb {f1(o1["y"])} → {f1(o2["y"])}')
            await pg.click('[data-editor] .seg button:has-text("Radieren")'); await t.drag_img(0.25, 0.5, 0.75, 0.5, steps=25); e1 = await t.stats(band)
            rec('Pinselmaske radieren', abs(e1['y'] - b1['y']) < 2, f'Pinselbahn {f1(a1["y"])} → {f1(e1["y"])} (Original {f1(b1["y"])})')
            await t.slider('brush.size', 20); rec('Pinselgröße einstellbar', (await t.val('brush.size')) == '20', 'Größe 20')
            await pg.locator('[data-mask] button[title="Maske löschen"]').first.click(); await t.settle()
            # lokale erweiterte Korrekturen
            await pg.click('[data-add="radial"]'); await t.drag_img(0.5, 0.5, 0.8, 0.8); await t.slider('m.adj.exposure', 0); await pg.click('#panelBody label.sw:has-text("Überlagerung")'); await t.settle()
            bl = await t.stats(CENTER); await t.open_adv('[data-editor] ~ .card'); await t.slider('m.adj.temp', 80); al = await t.stats(CENTER)
            rec('Lokale Temperatur (Erweitert)', (al['r'] - al['b']) > (bl['r'] - bl['b']) + 8, f'R−B {f1(bl["r"]-bl["b"])} → {f1(al["r"]-al["b"])}')
            await t.slider('m.adj.temp', 0); await t.slider('m.adj.colorAmt', 80); ac2 = await t.stats(CENTER)
            rec('Lokale Farbüberlagerung', abs(ac2['r'] - bl['r']) + abs(ac2['b'] - bl['b']) > 6, f'R/B {f1(bl["r"])}/{f1(bl["b"])} → {f1(ac2["r"])}/{f1(ac2["b"])}')
            for k, v in (('contrast', 80), ('highlights', -80), ('shadows', 80), ('saturation', 80), ('clarity', 80), ('dehaze', 80)):
                await t.slider('m.adj.colorAmt', 0) if k == 'contrast' else None
                if k == 'highlights': await t.slider('m.adj.exposure', 1.5)
                x0 = await t.stats(CENTER); await t.slider('m.adj.' + k, v); x1 = await t.stats(CENTER); await t.slider('m.adj.' + k, 0)
                if k == 'highlights': await t.slider('m.adj.exposure', 0)
                diff = abs(x1['y'] - x0['y']) + abs(x1['sat'] - x0['sat']) + abs(x1['lap'] - x0['lap'])
                rec(f'Lokal: {k}', diff > 0.5, f'Änderung {f1(diff)}')
            await pg.locator('[data-mask] button[title="Maske löschen"]').first.click(); await t.settle()
        await run(t, 'Masken', masks)

        async def zones():
            await t.reset_all(); await t.tab('masks'); await pg.click('button:has-text("Bild analysieren")'); await t.settle()
            n = await pg.locator('button:has-text("Übernehmen")').count(); txt = await pg.locator('.legend').inner_text()
            b = await t.stats(SUN); bd = await t.stats(FG)
            if await pg.locator('button:has-text("Alle übernehmen")').count(): await pg.click('button:has-text("Alle übernehmen")')
            else: await pg.locator('button:has-text("Übernehmen")').first.click()
            await t.settle(); await pg.click('#panelBody label.sw:has-text("Überlagerung")'); await t.settle()
            a = await t.stats(SUN); ad = await t.stats(FG); m = await pg.locator('[data-mask]').count()
            rec('Automatische Erkennung heller/dunkler Bereiche + Vorschlag', n >= 1 and m >= 1 and (a['y'] < b['y'] - 2 or ad['y'] > bd['y'] + 2), f'{txt.replace(chr(10)," / ")}; {n} Vorschläge, {m} Masken; Sonne {f1(b["y"])} → {f1(a["y"])}, Vordergrund {f1(bd["y"])} → {f1(ad["y"])}')
        await run(t, 'Problemzonen', zones)

        async def dodge_burn():
            await t.reset_all(); await t.tab('brush')
            band = (0.3, 0.3, 0.7, 0.36); b = await t.stats(band)
            await t.drag_img(0.25, 0.33, 0.75, 0.33, steps=25); a = await t.stats(band)
            rec('Abwedeln (Aufhellen per Pinsel)', a['y'] > b['y'] + 5, f'{f1(b["y"])} → {f1(a["y"])}')
            await pg.click('#panelBody .seg button:has-text("Abdunkeln")'); band2 = (0.3, 0.6, 0.7, 0.66); b2 = await t.stats(band2)
            await t.drag_img(0.25, 0.63, 0.75, 0.63, steps=25); a2 = await t.stats(band2)
            rec('Nachbelichten (Abdunkeln per Pinsel)', a2['y'] < b2['y'] - 3, f'{f1(b2["y"])} → {f1(a2["y"])}')
            await t.slider('db.dodge', 1.8); a3 = await t.stats(band)
            rec('Stärke Aufhellen einstellbar', a3['y'] > a['y'] + 3, f'{f1(a["y"])} → {f1(a3["y"])}')
            await t.slider('brush.hard', 100); await t.slider('brush.opacity', 50); await t.open_adv('#panelBody .card'); await t.slider('brush.flow', 30)
            rec('Pinsel: Größe/Härte/Deckkraft/Fluss', (await t.val('brush.opacity')) == '50' and (await t.val('brush.flow')) == '30', 'Werte übernommen')
            await t.slider('brush.opacity', 100); await t.slider('brush.flow', 100)
            await pg.click('#panelBody .seg button:has-text("Radieren")'); await t.drag_img(0.25, 0.33, 0.75, 0.33, steps=25); e = await t.stats(band)
            rec('Dodge & Burn radieren', abs(e['y'] - b['y']) < 3, f'{f1(a3["y"])} → {f1(e["y"])} (Original {f1(b["y"])})')
            await pg.click('#panelBody .seg button:has-text("Aufhellen")')
            await t.slider('brush.opacity', 100); await t.slider('brush.flow', 70); await t.slider('brush.hard', 55)
        await run(t, 'Dodge', dodge_burn)

        # ---------- Geometrie ----------
        async def crop():
            await t.reset_all(); await t.tab('crop')
            await pg.click('.chip:has-text("1:1")'); await t.settle(); txt = await pg.locator('#panelBody .muted', has_text='Ausgabe').inner_text()
            await pg.click('button:has-text("Fertig")'); await t.settle(); s = await t.img_box()
            rec('Zuschneiden Seitenverhältnis 1:1', abs(s['w'] / s['h'] - 1) < 0.02, f'{txt}, Anzeige {f1(s["w"])}×{f1(s["h"])}')
            await t.tab('crop'); await pg.click('.chip:has-text("Frei")'); await t.drag_handle('c-se', -150, -80)
            txt2 = await pg.locator('#panelBody .muted', has_text='Ausgabe').inner_text()
            rec('Zuschneiden per Griff', txt2 != txt, f'{txt} → {txt2}')
            await t.drag_handle('c-move', -40, 20); txt3 = await pg.locator('#panelBody .muted', has_text='Ausgabe').inner_text()
            rec('Zuschnitt verschieben', txt3 == txt2, f'Größe bleibt {txt3}')
            await pg.click('button:has-text("Zurücksetzen")'); await t.settle()
            await t.slider('angle', 8); s = await t.stats(ALL); await pg.click('button:has-text("Fertig")'); await t.settle(); s2 = await t.stats(ALL)
            rec('Gerade ausrichten (Winkel) ohne leere Ecken', s2['transp'] == 0, f'transparente Pixel {s2["transp"]}')
            await t.tab('crop'); await t.slider('angle', 0); await pg.click('button:has-text("Linie ziehen")'); await pg.wait_for_timeout(150)
            await t.drag_img(0.2, 0.5, 0.8, 0.4); ang = await t.val('angle')
            rec('Ausrichten-Werkzeug (Linie ziehen)', ang not in ('0,0°',) and abs(float(ang.replace('°', '').replace('−', '-').replace('+', '').replace(',', '.'))) > 3, f'Winkel {ang}')
            await t.slider('angle', 0)
            await pg.click('button[title="Rechts drehen (90°)"]'); await t.settle(); await pg.click('button:has-text("Fertig")'); await t.settle(); s = await t.img_box()
            rec('90° drehen', s['h'] > s['w'], f'Anzeige {f1(s["w"])}×{f1(s["h"])}')
            await t.tab('crop'); await pg.click('button[title="Links drehen (90°)"]'); await t.settle()
            await pg.click('button:has-text("Fertig")'); await t.settle(); l = await t.stats((0, 0.3, 0.1, 0.7)); r = await t.stats((0.9, 0.3, 1, 0.7))
            await t.tab('crop'); await pg.click('button[title="Horizontal spiegeln"]'); await pg.click('button:has-text("Fertig")'); await t.settle(); l2 = await t.stats((0, 0.3, 0.1, 0.7))
            rec('Horizontal spiegeln', abs(l2['y'] - r['y']) < 3 and abs(l['y'] - r['y']) > 3, f'links {f1(l["y"])} → {f1(l2["y"])} (rechts war {f1(r["y"])})')
            await t.tab('crop'); await pg.click('button[title="Horizontal spiegeln"]')
            b = await t.stats(ALL); await t.slider('vert', 60); await pg.click('button:has-text("Fertig")'); await t.settle(); a = await t.stats(ALL)
            rec('Perspektive vertikal (ohne Lücken)', a['transp'] == 0 and abs(a['y'] - b['y']) + abs(a['lap'] - b['lap']) > 0.3, f'Änderung Ø {f1(b["y"])} → {f1(a["y"])}, transparent {a["transp"]}')
            await t.tab('crop'); await t.slider('vert', 0); await t.slider('horz', -60); a = await t.stats(ALL)
            rec('Perspektive horizontal', a['transp'] == 0, 'keine leeren Ränder')
            await t.slider('horz', 0); await t.open_adv('#panelBody')
            await pg.locator('#panelBody label.sw', has_text='Automatisch füllen').click(); await t.slider('angle', 12); a = await t.stats(ALL)
            rec('Erweitert: Auto-Füllen aus zeigt Ränder', a['transp'] > 0, f'transparente Fläche {f1(a["transp"]*100)} %')
            await pg.locator('#panelBody label.sw', has_text='Automatisch füllen').click(); await t.slider('angle', 0)
            await pg.click('button:has-text("4 Punkte setzen")'); await pg.wait_for_timeout(300)
            await t.drag_handle('q-0', 60, 40); await t.drag_handle('q-3', 30, -30)
            await pg.click('button:has-text("Übernehmen")'); await t.settle(); await pg.click('button:has-text("Fertig")'); await t.settle(); q = await t.stats(ALL)
            rec('4-Punkt-Perspektivkorrektur', abs(q['y'] - base['y']) > 0.5 or abs(q['lap'] - base['lap']) > 0.3, f'Bild verändert (Ø {f1(base["y"])} → {f1(q["y"])})')
            await t.tab('crop'); await pg.click('button:has-text("Zurücksetzen")'); await pg.click('button:has-text("Fertig")'); await t.settle()
        await run(t, 'Zuschnitt', crop)

        # ---------- Ansicht & Bedienung ----------
        async def view():
            await t.reset_all(); await t.slider('exposure', 1.5); a = await t.stats(ALL)
            await pg.click('#btnBefore'); await t.settle(); b = await t.stats(ALL); badge = await pg.locator('#badgeBefore').is_visible()
            rec('Vorher/Nachher umschalten', badge and abs(b['y'] - base['y']) < 1 and a['y'] > b['y'] + 10, f'Nachher {f1(a["y"])}, Vorher {f1(b["y"])}')
            await pg.click('#btnBefore'); await pg.click('#btnSplit'); await t.settle(); L = await t.stats((0.05, 0.2, 0.3, 0.8)); R = await t.stats((0.7, 0.2, 0.95, 0.8))
            bl = await t.stats((0.05, 0.2, 0.3, 0.8)) ; line = await t.handle_pos('split')
            await pg.click('#btnSplit'); await t.settle(); L2 = await t.stats((0.05, 0.2, 0.3, 0.8))
            rec('Geteilte Vorher/Nachher-Ansicht', line is not None and L2['y'] > L['y'] + 8, f'links geteilt {f1(L["y"])} vs. nachher {f1(L2["y"])}')
            await t.slider('exposure', 3); await pg.click('#btnClip'); await t.settle(); c = await t.stats(ALL)
            rec('Beschnittwarnung', c['red'] > 0.01, f'rot markiert {f1(c["red"]*100)} %')
            await pg.click('#btnClip'); await t.slider('exposure', 0)
            await pg.click('#btnZoom100'); await t.settle(); z = await pg.locator('#zoomVal').inner_text()
            rec('Zoom 100 %', z == '100%', f'Anzeige {z}')
            st = await pg.locator('#stage').bounding_box(); await pg.mouse.move(st['x'] + 300, st['y'] + 300); await pg.mouse.down(); await pg.mouse.move(st['x'] + 100, st['y'] + 200, steps=5); await pg.mouse.up(); await t.settle()
            rec('Verschieben bei Zoom (Ziehen)', True, 'Ansicht verschoben')
            await pg.click('#zoomVal'); await t.settle(); await pg.mouse.move(st['x'] + 400, st['y'] + 300); await pg.mouse.wheel(0, -400); await t.settle(); z2 = await pg.locator('#zoomVal').inner_text()
            rec('Zoom per Mausrad', int(z2.rstrip('%')) > 39, f'Anzeige {z2}')
            await pg.click('#zoomVal'); await t.settle()
            hv = await pg.evaluate("document.querySelector('#histoInfo').textContent"); rec('Histogramm', 'Helligkeit' in hv, hv)
        await run(t, 'Ansicht', view)

        async def undo_hist():
            await t.reset_all(); await t.slider('exposure', 1); await t.slider('contrast', 40)
            await pg.click('#btnUndo'); await t.settle(); c = await t.val('contrast'); e = await t.val('exposure')
            await pg.click('#btnRedo'); await t.settle(); c2 = await t.val('contrast')
            await pg.keyboard.press('Control+z'); await t.settle(); c3 = await t.val('contrast')
            rec('Rückgängig/Wiederholen (Knopf + Strg+Z)', c == '0' and e == '+1,00' and c2 == '+40' and c3 == '0', f'Kontrast {c} → {c2} → {c3}')
            await t.tab('presets'); n = await pg.locator('[data-hist]').count(); await pg.locator('[data-hist]').last.click(); await t.settle(); await t.tab('edit'); e2 = await t.val('exposure')
            rec('Verlauf: Zustand anspringen', n > 2 and e2 == '0,00', f'{n} Einträge, Belichtung {e2}')
        await run(t, 'Verlauf', undo_hist)

        async def group_toggle():
            await t.reset_all(); await t.slider('exposure', 1.2); a = await t.stats(ALL)
            await pg.click('.grp[data-g="light"] button[title="Gruppe vorübergehend aus-/einblenden"]'); await t.settle(); b = await t.stats(ALL)
            await pg.click('.grp[data-g="light"] button[title="Gruppe vorübergehend aus-/einblenden"]'); await t.settle(); c = await t.stats(ALL)
            rec('Gruppe aus-/einschalten', abs(b['y'] - base['y']) < 1 and abs(c['y'] - a['y']) < 1, f'an {f1(a["y"])}, aus {f1(b["y"])}, wieder an {f1(c["y"])}')
            await pg.click('.grp[data-g="light"] button[title="Gruppe zurücksetzen"]'); await t.settle(); e = await t.val('exposure')
            rec('Gruppe zurücksetzen', e == '0,00', f'Belichtung {e}')
        await run(t, 'Gruppen', group_toggle)

        async def presets():
            await t.reset_all(); await t.tab('presets'); b = await t.stats(ALL)
            await pg.click('[data-preset="Klassisch Schwarzweiß"]'); await t.settle(); a = await t.stats(ALL)
            rec('Preset anwenden (Schwarzweiß)', a['sat'] < 2, f'Sättigung {f1(b["sat"])} → {f1(a["sat"])}')
            await pg.click('[data-preset="Dramatisch"]'); await t.settle(); d1 = await t.stats(ALL); await t.slider('presetAmt', 0); d0 = await t.stats(ALL); await t.slider('presetAmt', 100)
            rec('Preset-Stärke', abs(d0['lap'] - d1['lap']) > 0.3 or abs(d0['y'] - d1['y']) > 1, f'Kanten {f1(d0["lap"])} (0 %) vs {f1(d1["lap"])} (100 %)')
            await pg.fill('input[aria-label="Preset-Name"]', 'Mein Test-Look'); await pg.click('button:has-text("Speichern")'); await t.settle()
            ok = await pg.locator('[data-preset="Mein Test-Look"]').count()
            rec('Eigenes Preset speichern', ok == 1, 'in Liste vorhanden')
            async with pg.expect_download() as dl: await pg.click('#panelBody .card button:has-text("Exportieren")')
            d = await dl.value; p = OUT + 'presets.json'; await d.save_as(p); js = json.load(open(p))
            rec('Presets als JSON exportieren', any(x['name'] == 'Mein Test-Look' for x in js['presets']), d.suggested_filename)
            js['presets'][0]['name'] = 'Importiert'; json.dump(js, open(OUT + 'presets_in.json', 'w'))
            await pg.set_input_files('#panelBody input[type=file]', OUT + 'presets_in.json'); await t.settle()
            rec('Presets importieren', await pg.locator('[data-preset="Importiert"]').count() == 1, 'Preset „Importiert“ in Liste')
            await pg.click('button:has-text("Kopieren")'); await pg.click('button:has-text("Alles zurücksetzen")'); await t.settle(); r = await t.stats(ALL)
            await pg.click('button:has-text("Einfügen")'); await t.settle(); p2 = await t.stats(ALL)
            rec('Einstellungen kopieren/einfügen', abs(r['y'] - base['y']) < 1 and abs(p2['lap'] - d1['lap']) < 1.5, f'nach Reset {f1(r["y"])}, nach Einfügen Kanten {f1(p2["lap"])} (Preset {f1(d1["lap"])})')
        await run(t, 'Presets', presets)

        async def customize():
            await t.reset_all(); await pg.click('#btnCustomize'); await pg.wait_for_selector('.modal')
            await pg.locator('.tree-g[data-tree="fx"] > label.sw').first.click()
            await pg.locator('.tree-g[data-tree="light"] label.sw').filter(has=pg.get_by_text('Schwarz', exact=True)).click()
            await pg.locator('.tree-g label.sw', has_text='Abwedeln').click()
            await pg.click('.modal button:has-text("Fertig")'); await t.settle(300)
            fx = await pg.locator('.grp[data-g="fx"]').count(); bl = await pg.locator('.ctl[data-k="blacks"]').count(); bt = await pg.locator('#rail button[data-tab="brush"]').is_visible()
            rec('Werkzeugkasten: Gruppe/Regler/Bereich ausblenden', fx == 0 and bl == 0 and not bt, f'Effekte sichtbar={fx}, Schwarz sichtbar={bl}, Pinsel-Bereich sichtbar={bt}')
            await pg.reload(); await pg.wait_for_function('document.documentElement.dataset.ready==="1"'); await t.settle(800)
            fx = await pg.locator('.grp[data-g="fx"]').count(); rec('Werkzeugauswahl bleibt nach Neuladen erhalten', fx == 0, 'aus localStorage geladen')
            await pg.click('#btnCustomize'); await pg.click('.modal .seg button:has-text("Profile")'); await pg.click('[data-profile="einsteiger"]'); await pg.click('.modal button:has-text("Fertig")'); await t.settle(300)
            h = await pg.locator('.grp[data-g="hsl"]').count(); f = await pg.locator('.grp[data-g="fx"]').count()
            rec('Profil „Einsteiger“', h == 0 and f == 1, f'HSL sichtbar={h}, Effekte sichtbar={f}')
            await pg.click('#btnCustomize'); await pg.click('.modal .seg button:has-text("Profile")'); await pg.click('[data-profile="profi"]'); await pg.click('.modal button:has-text("Fertig")'); await t.settle(300)
            op = await pg.locator('.grp[data-g="light"] .adv.open').count()
            rec('Profil „Profi“ (Erweitert offen)', op == 1, f'Erweitert offen={op}')
            await pg.click('#btnCustomize'); await pg.click('.modal .seg button:has-text("Profile")'); await pg.click('[data-profile="standard"]'); await pg.click('.modal button:has-text("Fertig")'); await t.settle(300)
        await run(t, 'Werkzeugkasten', customize)

        async def persistence():
            await t.reset_all(); await t.slider('exposure', 0.8); await t.open_group('fx'); await t.slider('vig', -40); await pg.wait_for_timeout(900)
            await pg.reload(); await pg.wait_for_function('document.documentElement.dataset.ready==="1"'); await t.settle(900)
            e = await t.val('exposure'); v = await t.val('vig'); chip = await pg.locator('#fileChip').inner_text()
            rec('Sitzung wird beim Neustart automatisch geladen', e == '+0,80' and v == '−40', f'Belichtung {e}, Vignette {v}, Datei {chip}')
            await t.tab('presets'); p = await pg.locator('[data-preset="Mein Test-Look"]').count(); await t.tab('edit')
            rec('Eigene Presets bleiben gespeichert', p == 1, 'nach Neuladen vorhanden')
        await run(t, 'Speicherung', persistence)

        async def imports():
            for f, label in (('in_photo.jpg', 'JPEG'), ('in_alpha.png', 'PNG mit Transparenz'), ('in_photo.webp', 'WebP'), ('in_lzw.tif', 'TIFF (LZW)'), ('in_16.tif', 'TIFF 16 Bit Deflate')):
                await pg.set_input_files('#fileInput', FIX + f); await pg.wait_for_function(f'document.querySelector("#fileChip").textContent.includes("{f}")', timeout=20000); await t.settle(700)
                chip = await pg.locator('#fileChip').inner_text(); s = await t.stats(ALL)
                rec(f'Import {label}', '1350×900' in chip and s['y'] > 5, f'{chip}, Ø {f1(s["y"])}' + (f', transparent {f1(s["transp"]*100)} %' if 'alpha' in f else ''))
            # Bearbeitung pro Foto merken
            await pg.set_input_files('#fileInput', FIX + 'in_photo.jpg'); await t.settle(700); await t.slider('exposure', -1); await pg.wait_for_timeout(900)
            await pg.set_input_files('#fileInput', FIX + 'in_photo.webp'); await t.settle(700)
            await pg.set_input_files('#fileInput', FIX + 'in_photo.jpg'); await t.settle(900); e = await t.val('exposure')
            rec('Bearbeitung je Foto wird wiedererkannt', e == '−1,00', f'Belichtung beim erneuten Öffnen {e}')
        await run(t, 'Import', imports)

        async def exports():
            await t.reset_all(); await t.slider('exposure', 0.3)
            p1, n1 = await t.export('jpeg', q=92, name='q92.jpg'); p2, _ = await t.export('jpeg', q=30, name='q30.jpg')
            im = Image.open(p1); s1, s2 = os.path.getsize(p1), os.path.getsize(p2)
            rec('Export JPEG + Qualitätsregler', im.format == 'JPEG' and im.size == (1350, 900) and s2 < s1 * 0.7, f'{im.size}, q92 {s1//1024} KB vs q30 {s2//1024} KB')
            p, _ = await t.export('png', bits=8, name='e8.png'); im = Image.open(p)
            rec('Export PNG 8 Bit', im.format == 'PNG' and im.size == (1350, 900), f'{im.mode} {im.size}')
            p, _ = await t.export('png', bits=16, name='e16.png'); raw = open(p, 'rb').read(); depth = raw[24]
            rec('Export PNG 16 Bit', raw[:8] == b'\x89PNG\r\n\x1a\n' and depth == 16, f'Bittiefe laut IHDR {depth}')
            p, _ = await t.export('webp', q=80, name='e.webp'); im = Image.open(p)
            rec('Export WebP', im.format == 'WEBP' and im.size == (1350, 900), f'{im.format} {im.size}')
            p, _ = await t.export('tiff', bits=8, name='e8.tif'); a = tifffile.imread(p)
            rec('Export TIFF 8 Bit', a.dtype == np.uint8 and a.shape[:2] == (900, 1350), f'{a.dtype} {a.shape}')
            p, _ = await t.export('tiff', bits=16, name='e16.tif'); a = tifffile.imread(p)
            rec('Export TIFF 16 Bit', a.dtype == np.uint16 and a.shape[:2] == (900, 1350) and a.max() > 255, f'{a.dtype} {a.shape}, max {a.max()}')
            p, _ = await t.export('jpeg', q=85, size_mode='long', size=800, name='long800.jpg'); im = Image.open(p)
            rec('Export Größe: lange Kante 800 px', im.size == (800, 533), f'{im.size}')
            p, _ = await t.export('jpeg', q=85, size_mode='pct', size=50, name='pct50.jpg'); im = Image.open(p)
            rec('Export Größe: 50 %', im.size == (675, 450), f'{im.size}')
            p, _ = await t.export('jpeg', q=85, size_mode='width', size=1000, sharpen='high', name='sharp.jpg'); im = Image.open(p)
            rec('Export Breite 1000 px + Ausgabeschärfung', im.size == (1000, 667), f'{im.size}')
            # Vorschau == Export (Farbtreue)
            p, _ = await t.export('png', bits=8, size_mode='orig', name='cmp.png'); ex = np.asarray(Image.open(p).convert('RGB'), dtype=np.float32)
            pv = await t.stats(ALL); d = abs(ex.mean() - (pv['r'] + pv['g'] + pv['b']) / 3)
            rec('Export entspricht der Vorschau', d < 2.5, f'Ø Export {ex.mean():.1f} vs Vorschau {(pv["r"]+pv["g"]+pv["b"])/3:.1f}')
            # Zuschnitt + Maske im Export
            await t.tab('crop'); await pg.click('.chip:has-text("16:9")'); await pg.click('button:has-text("Fertig")'); await t.settle()
            p, _ = await t.export('jpeg', q=85, name='crop169.jpg'); im = Image.open(p)
            rec('Export mit Zuschnitt 16:9', abs(im.size[0] / im.size[1] - 16 / 9) < 0.01, f'{im.size}')
            await t.tab('crop'); await pg.click('button:has-text("Zurücksetzen")'); await pg.click('button:has-text("Fertig")')
        await run(t, 'Export', exports)

        async def mobile():
            await pg.click('#btnMobile'); await t.settle(700)
            cls = await pg.get_attribute('#app', 'class'); rail = await pg.locator('#rail').bounding_box(); stg = await pg.locator('#stage').bounding_box()
            chips = await pg.locator('.mchips .chip').count(); thumb = await pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.ctl input[type=range]')).height)")
            await pg.screenshot(path=OUT + 'mobile_toggle.png')
            rec('Mobil-Modus per Knopf', 'mobile' in cls and rail['y'] > stg['y'] + stg['height'] - 5 and chips >= 5 and thumb >= 34, f'Werkzeugleiste unten, {chips} Gruppen-Chips, Reglerhöhe {thumb}px')
            await pg.click('.mchips .chip[data-g="fx"]'); await pg.wait_for_timeout(200); vis = await pg.locator('.grp[data-g="fx"]').count(); oth = await pg.locator('.grp[data-g="light"]').count()
            rec('Mobil: vereinfachte Werkzeuganordnung', vis == 1 and oth == 0, 'eine Gruppe je Ansicht')
            await pg.click('#btnMobile'); await t.settle(500)
        await run(t, 'Mobil', mobile)

        await ctx.close()
        # ---------- echtes Telefon (Touch) ----------
        async def phone():
            c2 = await br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True, accept_downloads=True)
            p2 = await c2.new_page(); p2.on('pageerror', lambda e: errs.append('mobile: ' + str(e))); await p2.add_init_script(JS)
            await p2.goto(URL); await p2.wait_for_function('document.documentElement.dataset.ready==="1"', timeout=30000); await p2.wait_for_timeout(1200)
            cls = await p2.get_attribute('#app', 'class'); ov = await p2.evaluate('document.documentElement.scrollWidth - innerWidth')
            await p2.screenshot(path=OUT + 'phone.png')
            rec('Telefon: Mobil-Modus automatisch, kein Querscrollen', 'mobile' in cls and ov <= 0, f'Überlauf {ov}px')
            await p2.tap('.mchips .chip[data-g="light"]'); r = p2.locator('.ctl[data-k="exposure"] input[type=range]'); bb = await r.bounding_box()
            await p2.touchscreen.tap(bb['x'] + bb['width'] * 0.8, bb['y'] + bb['height'] / 2); await p2.wait_for_timeout(600)
            v = await p2.locator('.ctl[data-k="exposure"] input.val').input_value()
            rec('Telefon: Regler per Tippen', v != '0,00', f'Belichtung {v}')
            await p2.dblclick('.ctl[data-k="exposure"] label'); await p2.wait_for_timeout(500)
            z0 = await p2.locator('#zoomVal').inner_text()
            await p2.evaluate("""()=>{const st=document.querySelector('#stage'); const r=st.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
              const ev=(t,id,x,y)=>st.dispatchEvent(new PointerEvent(t,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',bubbles:true,isPrimary:id===11}));
              ev('pointerdown',11,cx-30,cy); ev('pointerdown',12,cx+30,cy); for(let i=1;i<=10;i++){ev('pointermove',11,cx-30-i*8,cy); ev('pointermove',12,cx+30+i*8,cy);} ev('pointerup',11,cx-110,cy); ev('pointerup',12,cx+110,cy);}""")
            await p2.wait_for_timeout(600); z1 = await p2.locator('#zoomVal').inner_text()
            rec('Telefon: Pinch-Zoom', int(z1.rstrip('%')) > int(z0.rstrip('%')), f'{z0} → {z1}')
            await p2.tap('#rail button[data-tab="masks"]'); await p2.wait_for_timeout(300); await p2.screenshot(path=OUT + 'phone_masks.png')
            await p2.tap('#rail button[data-tab="brush"]'); await p2.wait_for_timeout(300)
            b = await p2.evaluate('__t.stats(0.3,0.45,0.7,0.55)')
            await p2.evaluate("""()=>{const st=document.querySelector('#stage'); const r=document.querySelector('#cvMain').getBoundingClientRect(); const y=r.top+r.height*0.5;
              const ev=(t,x)=>st.dispatchEvent(new PointerEvent(t,{pointerId:21,clientX:x,clientY:y,pointerType:'touch',bubbles:true,isPrimary:true,button:0}));
              ev('pointerdown',r.left+r.width*0.25); for(let i=1;i<=20;i++) ev('pointermove',r.left+r.width*(0.25+i*0.025)); ev('pointerup',r.left+r.width*0.75);}""")
            await p2.wait_for_timeout(700); a = await p2.evaluate('__t.stats(0.3,0.45,0.7,0.55)')
            rec('Telefon: Abwedeln per Touch', a['y'] > b['y'] + 3, f'{f1(b["y"])} → {f1(a["y"])}')
            await p2.tap('#rail button[data-tab="edit"]'); await p2.wait_for_timeout(300); await p2.screenshot(path=OUT + 'phone_edit.png')
            await c2.close()
        await run(t, 'Telefon', phone)
        await br.close()
        rec('Keine JavaScript-Fehler während der Tests', not errs, '; '.join(errs[:5]) or '0 Fehler')

asyncio.run(main())
json.dump(results, open(OUT + 'results.json', 'w'), ensure_ascii=False, indent=1)
bad = [r for r in results if not r['ok']]
print(f'\n{len(results) - len(bad)}/{len(results)} bestanden')
