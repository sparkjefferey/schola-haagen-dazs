import re
import sys
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

def fetch_css(fam):
    url = f"https://fonts.googleapis.com/css2?family={fam}&display=swap"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=30).read().decode()

def download(name, css):
    blocks = re.findall(r"@font-face\s*\{([^}]+)\}", css)
    seen = set()
    for b in blocks:
        d = dict(re.findall(r"([\w-]+)\s*:\s*([^;]+);", b))
        weight = d.get("font-weight", "400")
        style = d.get("font-style", "normal")
        ur = d.get("unicode-range", "")
        if not (ur.startswith("U+0000") or ur.startswith("U+00")):
            continue
        key = (weight, style)
        if key in seen:
            continue
        seen.add(key)
        m = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", b)
        if not m:
            print("✗ no url for", name, weight, style)
            continue
        url = m.group(1)
        fname = f"{name}-{weight}{'i' if style == 'italic' else ''}.woff2"
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read()
            open(f"public/fonts/{fname}", "wb").write(data)
            print("✔", fname, len(data) // 1024, "KB")
        except Exception as e:
            print("✗", fname, e)

download("cinzel", fetch_css("Cinzel:wght@400;600;700;900"))
download("garamond", fetch_css("EB+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600"))