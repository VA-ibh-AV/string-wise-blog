# OG card sources

One HTML file per post, sized to exactly 1200×630 and styled with the same
custom properties as `src/index.css`, so the cards stay on-brand when the site
theme changes.

Rendered output lives in `public/og/<slug>.png` and is referenced from the
`ogImage` field in `src/registry.js`.

## Regenerating

Fonts are loaded from Google Fonts by `<link>`, which headless Chromium will
happily hang on. Inline them first, then screenshot:

```bash
SLUG=tcp-internals
OUT=$(mktemp -d)

# 1. inline the webfonts as data: URIs so the render needs no network
python3 - "$SLUG" "$OUT" <<'PY'
import base64, re, sys, urllib.request
slug, out = sys.argv[1], sys.argv[2]
ua = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0'}
href = ('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600'
        '&family=JetBrains+Mono:wght@400;500;600;700&display=swap')
css = urllib.request.urlopen(urllib.request.Request(href, headers=ua)).read().decode()
for u in sorted(set(re.findall(r'https://fonts\.gstatic\.com[^)]*\.woff2', css))):
    b = base64.b64encode(urllib.request.urlopen(u).read()).decode()
    css = css.replace(u, f'data:font/woff2;base64,{b}')
html = open(f'scripts/og/{slug}.html', encoding='utf-8').read()
a, b = html.index('<link rel="preconnect"'), html.index('<style>')
open(f'{out}/page.html', 'w', encoding='utf-8').write(html[:a] + '<style>' + css + '</style>\n' + html[b:])
PY

# 2. render at 2x. The window must be TALLER than 630 — at exactly 630 Chromium
#    drops the absolutely-positioned footer from the render tree. Crop after.
chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --hide-scrollbars --force-device-scale-factor=2 --window-size=1200,1100 \
  --screenshot="$OUT/raw.png" "file://$OUT/page.html"

# 3. crop to 1200×630 and downsample
python3 - "$SLUG" "$OUT" <<'PY'
import sys
from PIL import Image
slug, out = sys.argv[1], sys.argv[2]
im = Image.open(f'{out}/raw.png').crop((0, 0, 2400, 1260))
im.resize((1200, 630), Image.LANCZOS).convert('RGB').save(
    f'public/og/{slug}.png', optimize=True)
PY
```
