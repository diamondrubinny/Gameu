#!/usr/bin/env python3
"""
Builds the Rubinny Gameu logo assets from one definition.

  python3 tools/brand/build_logo.py

Needs fonttools + pillow (dev only, e.g. `python3 -m venv .venv && .venv/bin/pip install fonttools pillow`)
and the Inter font (SIL Open Font License; outlines are embedded as paths, no font file is shipped).

Outputs:
  src/public/brand/logo-mark.svg      ruby + game controls (transparent)
  src/public/brand/logo.svg           horizontal lockup for dark backgrounds
  src/public/brand/logo-on-light.svg  horizontal lockup for light backgrounds
  src/public/brand/app-icon.svg       mark on the navy rounded square (favicon / PWA)
  src/public/brand/app-icon-{192,512}.png
  android/app/src/main/res/drawable/ic_launcher_foreground.xml
  android/app/src/main/res/drawable-*/banner.png
"""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BRAND = os.path.join(ROOT, 'src', 'public', 'brand')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
FONT_DIR = '/usr/share/fonts/opentype/inter'
FONT_WORD = os.path.join(FONT_DIR, 'InterDisplay-Black.otf')
FONT_SMALL = os.path.join(FONT_DIR, 'Inter-Bold.otf')

NAVY = '#0D1021'
YELLOW = '#FFCC33'
WHITE = '#FFFFFF'
TEXT_ON_DARK = '#F4F5FF'
TEXT_ON_LIGHT = '#14162B'
RUBY_TEXT_ON_DARK = '#FF5C7A'
RUBY_TEXT_ON_LIGHT = '#C2124F'

# ---- the mark: a faceted ruby (viewBox 0 0 120 120) ----
A, H, B = (24, 20), (60, 20), (96, 20)       # table edge
E, F, G, C = (6, 46), (42, 46), (78, 46), (114, 46)  # girdle
D = (60, 112)                                 # culet
FACETS = [
    ([A, F, E], '#FF6B86'),
    ([A, H, F], '#FF8FA3'),
    ([H, G, F], '#FFB3C1'),   # table, lightest
    ([H, B, G], '#FF8FA3'),
    ([B, C, G], '#F0476A'),
    ([E, F, D], '#C70F52'),
    ([F, G, D], '#E0115F'),
    ([G, C, D], '#9E0A42'),
]
# Game controls on the stone: a d-pad and two buttons.
DPAD = [(31, 56, 22, 7), (38.5, 48.5, 7, 22)]  # x, y, w, h (two bars of a plus)
BUTTONS = [((75, 55), 5.2, YELLOW), ((86, 62), 5.2, WHITE)]


def pts(poly):
    return ' '.join(f'{x},{y}' for x, y in poly)


def mark_svg_body():
    out = [f'<polygon points="{pts(p)}" fill="{c}"/>' for p, c in FACETS]
    out.append(f'<polygon points="{pts([A, B, C, D, E])}" fill="none" stroke="#5E0428" stroke-opacity=".35" stroke-width="1.5" stroke-linejoin="round"/>')
    for x, y, w, h in DPAD:
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="{WHITE}"/>')
    for (cx, cy), r, col in BUTTONS:
        out.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{col}"/>')
    return '\n  '.join(out)


# ---- text to outlined paths ----
def text_path(font_path, text, size, x, y, tracking=0.0):
    """Returns (svg path d, width). Baseline at y; simple advance-based layout (+tracking in em)."""
    font = TTFont(font_path)
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font['head'].unitsPerEm
    scale = size / upm
    pen = SVGPathPen(gs)
    cursor = 0.0
    for ch in text:
        gname = cmap[ord(ch)]
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x + cursor, y))
        gs[gname].draw(tpen)
        cursor += gs[gname].width * scale + tracking * size
    return pen.getCommands(), cursor - tracking * size


def lockup_svg(word_color, small_color):
    small_d, small_w = text_path(FONT_SMALL, 'RUBINNY', 25, 140, 47, tracking=0.16)
    word_d, word_w = text_path(FONT_WORD, 'Gameu', 78, 136, 108, tracking=-0.01)
    width = int(max(140 + small_w, 136 + word_w) + 8)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 120" width="{width}" height="120" role="img" aria-labelledby="t">
  <title id="t">Rubinny Gameu</title>
  {mark_svg_body()}
  <path d="{small_d}" fill="{small_color}"/>
  <path d="{word_d}" fill="{word_color}"/>
</svg>
'''


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote', os.path.relpath(path, ROOT))


def build_svgs():
    write(os.path.join(BRAND, 'logo-mark.svg'), f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-labelledby="t">
  <title id="t">Rubinny Gameu</title>
  {mark_svg_body()}
</svg>
''')
    write(os.path.join(BRAND, 'logo.svg'), lockup_svg(TEXT_ON_DARK, RUBY_TEXT_ON_DARK))
    write(os.path.join(BRAND, 'logo-on-light.svg'), lockup_svg(TEXT_ON_LIGHT, RUBY_TEXT_ON_LIGHT))
    write(os.path.join(BRAND, 'app-icon.svg'), f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-labelledby="t">
  <title id="t">Rubinny Gameu</title>
  <rect width="120" height="120" rx="26" fill="{NAVY}"/>
  <g transform="translate(14 12) scale(.766)">
  {mark_svg_body()}
  </g>
</svg>
''')


# ---- raster (PIL, drawn at 4x then downscaled for anti-aliasing) ----
def draw_mark(d, ox, oy, s):
    T = lambda p: (ox + p[0] * s, oy + p[1] * s)
    for poly, col in FACETS:
        d.polygon([T(p) for p in poly], fill=col)
    for x, y, w, h in DPAD:
        d.rounded_rectangle([T((x, y)), T((x + w, y + h))], radius=2 * s, fill=WHITE)
    for (cx, cy), r, col in BUTTONS:
        d.ellipse([T((cx - r, cy - r)), T((cx + r, cy + r))], fill=col)


def app_icon_png(size, path):
    k = 4
    S = size * k
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=NAVY)
    # Maskable-safe: mark within the central 70%.
    s = S * 0.7 / 120
    draw_mark(d, (S - 120 * s) / 2, (S - 120 * s) / 2 - S * 0.01, s)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print('wrote', os.path.relpath(path, ROOT))


def banner_png(scale, path):
    """Android TV banner: 320x180 dp."""
    k = 4
    W, Hh = int(320 * scale * k), int(180 * scale * k)
    img = Image.new('RGB', (W, Hh), NAVY)
    d = ImageDraw.Draw(img)
    for y in range(Hh):  # subtle vertical gradient
        t = y / Hh
        d.line([(0, y), (W, y)], fill=(13, int(16 + 14 * t), int(33 + 12 * t)))
    u = W / 320  # 1 dp in pixels (at k)
    s = 96 * u / 120
    draw_mark(d, 22 * u, (180 * u - 120 * s) / 2 - 2 * u, s)
    small = ImageFont.truetype(FONT_SMALL, int(17 * u))
    word = ImageFont.truetype(FONT_WORD, int(48 * u))
    x = 130 * u
    # tracking for the small caps line
    cx = x
    for ch in 'RUBINNY':
        d.text((cx, 52 * u), ch, font=small, fill=RUBY_TEXT_ON_DARK)
        cx += d.textlength(ch, font=small) + 0.16 * 17 * u
    d.text((x - 2 * u, 72 * u), 'Gameu', font=word, fill=TEXT_ON_DARK)
    img.resize((int(320 * scale), int(180 * scale)), Image.LANCZOS).save(path, optimize=True)
    print('wrote', os.path.relpath(path, ROOT))


def android_vector():
    """Launcher foreground (108dp adaptive icon; the visible safe zone is the central 66dp)."""
    s = 64 / 120
    ox, oy = (108 - 120 * s) / 2, (108 - 120 * s) / 2 - 1
    T = lambda p: (round(ox + p[0] * s, 2), round(oy + p[1] * s, 2))
    paths = []
    for poly, col in FACETS:
        q = [T(p) for p in poly]
        paths.append((f'M{q[0][0]},{q[0][1]} ' + ' '.join(f'L{x},{y}' for x, y in q[1:]) + ' Z', col))
    for x, y, w, h in DPAD:
        (x0, y0), (x1, y1) = T((x, y)), T((x + w, y + h))
        paths.append((f'M{x0},{y0} L{x1},{y0} L{x1},{y1} L{x0},{y1} Z', WHITE))
    for (cx, cy), r, col in BUTTONS:
        (px, py), rr = T((cx, cy)), round(r * s, 2)
        paths.append((f'M{px - rr},{py} a{rr},{rr} 0 1,0 {2 * rr},0 a{rr},{rr} 0 1,0 {-2 * rr},0 Z', col))
    body = '\n'.join(f'    <path android:fillColor="{c}" android:pathData="{d}" />' for d, c in paths)
    write(os.path.join(RES, 'drawable', 'ic_launcher_foreground.xml'), f'''<!-- Generated by tools/brand/build_logo.py — Rubinny Gameu mark. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
{body}
</vector>
''')


if __name__ == '__main__':
    build_svgs()
    app_icon_png(192, os.path.join(BRAND, 'app-icon-192.png'))
    app_icon_png(512, os.path.join(BRAND, 'app-icon-512.png'))
    for name, scale in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3)]:
        banner_png(scale, os.path.join(RES, f'drawable-{name}', 'banner.png'))
    android_vector()
