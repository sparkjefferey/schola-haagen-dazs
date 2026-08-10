#!/usr/bin/env python3
"""Generate a full-page parchment sheet with curled edges & worn corners."""
import math
import random
from PIL import Image, ImageDraw, ImageFilter

random.seed(20260810)
W, H = 1600, 2200

# ---- parchment sheet base (warm light tan, centre-bright) ----
sheet = Image.new("RGB", (W, H))
spx = sheet.load()
base = (230, 207, 158)
for y in range(H):
    for x in range(W):
        tone = math.sin(x / 210.0) * 0.4 + math.sin(y / 170.0) * 0.35
        drift = (tone * 9, tone * 7, tone * 5)
        spx[x, y] = (
            max(0, min(255, base[0] + int(drift[0]))),
            max(0, min(255, base[1] + int(drift[1]))),
            max(0, min(255, base[2] + int(drift[2]))),
        )

# ---- fibre grain (subtle) ----
grain = Image.new("L", (W, H), 128)
gpx = grain.load()
for _ in range(400000):
    x = random.randrange(W)
    y = random.randrange(H)
    length = random.randint(2, 9)
    ang = random.uniform(-0.35, 0.35)
    dx = math.cos(ang) * length
    dy = math.sin(ang) * length
    v = random.randint(0, 40)
    for i in range(length):
        xx = int(x + dx * i / length) % W
        yy = int(y + dy * i / length) % H
        c = gpx[xx, yy]
        gpx[xx, yy] = max(0, min(255, c + (v - 60)))
for _ in range(80000):
    x = random.randrange(W)
    y = random.randrange(H)
    r = random.randint(0, 2)
    v = random.choice([-60, -35, 50, 85])
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            xx = (x + dx) % W
            yy = (y + dy) % H
            c = gpx[xx, yy]
            gpx[xx, yy] = max(0, min(255, c + v))
grain = grain.filter(ImageFilter.GaussianBlur(0.55))
# blend grain in gently: 128=neutral, +/- stays close to original
sheet = Image.composite(
    sheet.point(lambda c: max(0, min(255, int(c * 0.93)))),
    sheet.point(lambda c: max(0, min(255, int(c * 1.06)))),
    grain,
)

# ---- soft mottled stains (light touch) ----
stains = Image.new("L", (W, H), 0)
sdraw = ImageDraw.Draw(stains)
for _ in range(34):
    cx = random.randrange(W)
    cy = random.randrange(H)
    r = random.randint(90, 240)
    sdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=random.randint(20, 62))
stains = stains.filter(ImageFilter.GaussianBlur(38))
sheet = Image.composite(
    sheet.point(lambda c: max(0, min(255, int(c * 0.86)))),
    sheet,
    stains,
)

# ---- binding holes (left margin) ----
holes = Image.new("L", (W, H), 0)
hdraw = ImageDraw.Draw(holes)
for i in range(8):
    y = int(H * (0.10 + 0.11 * i))
    hdraw.ellipse([60, y, 70, y + 10], fill=52)
holes = holes.filter(ImageFilter.GaussianBlur(3))
sheet = Image.composite(
    sheet.point(lambda c: max(0, min(255, int(c * 0.75)))),
    sheet,
    holes,
)

# ---- dark desk frame around the sheet ----
# We keep the sheet for the central ~94% and paint a desk border
desk = Image.new("RGB", (W, H), (46, 33, 22))
dpx = desk.load()
for y in range(H):
    for x in range(W):
        v = int(10 * math.sin(x / 90.0) * math.sin(y / 130.0))
        dpx[x, y] = (
            max(0, min(255, dpx[x, y][0] + v)),
            max(0, min(255, dpx[x, y][1] + v)),
            max(0, min(255, dpx[x, y][2] + v)),
        )
margin = int(W * 0.05)
# mask: white = sheet (centre), black = desk (border)
mask = Image.new("L", (W, H), 0)
mdraw = ImageDraw.Draw(mask)
mdraw.rectangle([margin, margin, W - margin, H - margin], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(28))
page = Image.composite(sheet, desk, mask)

# ---- curled edge shadow around the sheet periphery ----
curl = Image.new("L", (W, H), 0)
cdraw = ImageDraw.Draw(curl)
cdraw.rectangle([0, 0, W, H], fill=150)
cdraw.rectangle([margin, margin, W - margin, H - margin], fill=0)
curl = curl.filter(ImageFilter.GaussianBlur(46))
edge = Image.new("RGB", (W, H), (64, 46, 28))
page = Image.composite(Image.blend(page, edge, 1.0), page, curl)
# ---- centre brighten ----
inner = Image.new("L", (W, H), 0)
idraw = ImageDraw.Draw(inner)
idraw.ellipse([-W * 0.25, -H * 0.15, W * 1.25, H * 1.15], fill=64)
inner = inner.filter(ImageFilter.GaussianBlur(170))
light = page.point(lambda c: max(0, min(255, int(c * 1.10))))
page = Image.composite(light, page, inner)

page.save("public/textures/parchment-page.jpg", quality=88)
print("saved public/textures/parchment-page.jpg")

img = Image.open("public/textures/parchment-page.jpg").convert("RGB")
for (x, y) in [(W // 2, H // 2), (W // 4, H // 4), (W // 2, 90), (20, 20)]:
    print(f"sample ({x},{y}):", img.getpixel((x, y)))
