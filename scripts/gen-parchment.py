#!/usr/bin/env python3
"""Generate a realistic medieval parchment texture (tileable).

Produces public/textures/parchment.jpg — warm aged parchment with
fibrous grain, mottled stains, subtle fibre streaks and edge vignette.
"""
import math
import random
from PIL import Image, ImageFilter, ImageDraw

random.seed(20260809)
W = H = 1024
img = Image.new("RGB", (W, H))
px = img.load()

# Base parchment colour (aged calfskin): warm light tan
base = (222, 198, 152)
for y in range(H):
    for x in range(W):
        # gentle large-scale tonal drift
        tone = math.sin(x / 190.0) * 0.35 + math.sin(y / 150.0) * 0.3 + math.sin((x + y) / 320.0) * 0.25
        drift = (tone * 9, tone * 7, tone * 5)
        px[x, y] = (
            max(0, min(255, base[0] + int(drift[0]))),
            max(0, min(255, base[1] + int(drift[1]))),
            max(0, min(255, base[2] + int(drift[2]))),
        )

# --- fibrous grain: fine short fibre streaks + speckle ---
grain = Image.new("L", (W, H), 128)
gpx = grain.load()
for _ in range(260000):
    x = random.randrange(W)
    y = random.randrange(H)
    # short fibres, mostly horizontal
    length = random.randint(2, 9)
    ang = random.uniform(-0.35, 0.35) + (random.random() - 0.5) * 0.3
    dx = math.cos(ang) * length
    dy = math.sin(ang) * length
    v = random.randint(0, 80)
    for i in range(length):
        xx = int(x + dx * i / length) % W
        yy = int(y + dy * i / length) % H
        c = gpx[xx, yy]
        gpx[xx, yy] = max(0, min(255, c + (v - 40)))
# also random speckle (paper pulp particles)
for _ in range(60000):
    x = random.randrange(W)
    y = random.randrange(H)
    r = random.randint(0, 2)
    v = random.choice([-70, -40, 55, 90])
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            xx = (x + dx) % W
            yy = (y + dy) % H
            c = gpx[xx, yy]
            gpx[xx, yy] = max(0, min(255, c + v))
grain = grain.filter(ImageFilter.GaussianBlur(0.55))
grain = Image.blend(grain, Image.new("L", (W, H), 128), 0.3)
img = Image.composite(
    img,
    img.point(lambda c: max(0, min(255, int(c * 0.88)))),
    grain,
)

# --- mottled stains: large soft blotches of deeper brown ---
stains = Image.new("L", (W, H), 0)
sdraw = ImageDraw.Draw(stains)
for _ in range(26):
    cx = random.randrange(W)
    cy = random.randrange(H)
    r = random.randint(60, 210)
    sdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=random.randint(26, 88))
stains = stains.filter(ImageFilter.GaussianBlur(28))
dark = img.point(lambda c: max(0, min(255, int(c * 0.8))))
img = Image.composite(dark, img, stains)

# --- very faint inked scribble margins (historical annotation hint) ---
marg = Image.new("L", (W, H), 255)
mdraw = ImageDraw.Draw(marg)
for _ in range(9):
    x = random.randrange(60, W - 60)
    y = random.randrange(60, H - 60)
    length = random.randint(40, 130)
    for i in range(length):
        mdraw.line(
            [x + i * 1.6, y + math.sin(i / 9.0) * 2.2, x + i * 1.6 + 1, y + math.sin(i / 9.0) * 2.2 + 1],
            fill=random.randint(200, 242),
            width=1,
        )
marg = marg.filter(ImageFilter.GaussianBlur(1.2))
ink_color = Image.new("RGB", (W, H), (150, 122, 82))
img = Image.composite(img, Image.blend(img, ink_color, 1.0), marg)
# --- edge vignette (darker worn edges like an old page) ---
vig = Image.new("L", (W, H), 0)
vdraw = ImageDraw.Draw(vig)
vdraw.rectangle([0, 0, W, H], fill=120)
vdraw.ellipse([-W * 0.12, -H * 0.12, W * 1.12, H * 1.12], fill=0)
vig = vig.filter(ImageFilter.GaussianBlur(110))
edge_color = Image.new("RGB", (W, H), (95, 70, 38))
img = Image.composite(Image.blend(img, edge_color, 1.0), img, vig)

# slight warm sepia overlay
sep = Image.new("RGB", (W, H), (64, 48, 20))
img = Image.blend(img, sep, 0.06)

img.save("public/textures/parchment.jpg", quality=88)
print("saved public/textures/parchment.jpg")
