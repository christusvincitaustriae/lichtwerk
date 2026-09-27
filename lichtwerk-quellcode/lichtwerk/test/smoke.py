import asyncio, sys, json
from playwright.async_api import async_playwright
URL='file:///home/claude/lichtwerk/dist/lichtwerk.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':900}, device_scale_factor=1)
        errs=[]
        pg.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
        await pg.goto(URL)
        await pg.wait_for_function('document.documentElement.dataset.ready==="1"', timeout=30000)
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path='test/shot_desktop.png')
        print('\n'.join(errs) or 'no errors')
        print(await pg.evaluate('document.querySelector("#histoPix").textContent'))
        await b.close()
asyncio.run(main())
