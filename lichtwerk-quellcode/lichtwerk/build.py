#!/usr/bin/env python3
"""Baut Lichtwerk zu einer einzigen HTML-Datei (Standalone) und zu einer Artifact-Variante."""
import pathlib, re
root = pathlib.Path(__file__).parent
src = root / 'src'
tpl = (src / 'index.html').read_text()
css = (src / 'styles.css').read_text()
app_parts = sorted((src / 'app').glob('*.js'))
app = "\n".join(p.read_text() for p in app_parts)
js = (src / 'engine.js').read_text() + "\n" + (src / 'codecs.js').read_text() + "\n(function(){\n'use strict';\n" + app + "\n})();\n"
assert '</script' not in js.lower()
page = tpl.replace('/*STYLES*/', css).replace('/*SCRIPTS*/', js)
dist = root / 'dist'; dist.mkdir(exist_ok=True)
(dist / 'artifact.html').write_text(page)
i = page.index('<div class="app"')
head, body = page[:i], page[i:]
standalone = ('<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n'
              '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
              + head + '</head>\n<body>\n' + body + '</body>\n</html>\n')
(dist / 'lichtwerk.html').write_text(standalone)
print('ok', len(standalone) // 1024, 'KB')
