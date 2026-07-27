#!/usr/bin/env python3
"""Renders the extension icon: an open padlock with a lightning bolt cut out of it.

Emits icons/icon.svg (vector source, for listing artwork) and the three PNG sizes
Chrome loads, all from the GEOMETRY below -- edit that, re-run, and everything moves
together.

    python3 scripts/make-icons.py           # the shipped assets
    python3 scripts/make-icons.py 512       # plus icons/preview-512.png to eyeball

Requires Pillow for the PNGs (`pip install Pillow`). The SVG needs nothing.
"""
import os
import sys

# The accent hue from options.css at the one lightness that clears 3:1 contrast on
# BOTH white and Chrome's dark toolbar (#292A2D) -- these icons are the toolbar icon,
# since manifest.json's `action` declares no default_icon of its own.
#   oklch(0.60 0.14 255) -> #4081D2   (4.0:1 on white, 3.6:1 on dark)
# The page's own --accent, oklch(0.47 0.13 255), is only 2.1:1 on dark chrome.
COLOR = (0x40, 0x81, 0xD2)

CANVAS = 128  # design space; composition is inset 14 on every side

GEOMETRY = {
    # Lock body: the wider, lower mass.
    "body": {"left": 28, "top": 58, "right": 100, "bottom": 114, "radius": 13},
    # Shackle: a semicircle whose left leg drops into the body and whose right end
    # stops short of it. That gap is the whole "unlocked" read -- keep it >= 10 or
    # the lock looks shut at 16px.
    "shackle": {"cx": 64, "cy": 40, "r": 20, "stroke": 12, "leg_bottom": 70},
    # Lightning bolt, knocked out of the body to transparent.
    "bolt": {"cx": 64, "cy": 86, "w": 19, "h": 36},
}

# Bolt outline in a unit box, y pointing down.
BOLT = [
    (0.60, 0.00),
    (0.00, 0.58),
    (0.36, 0.58),
    (0.28, 1.00),
    (0.92, 0.40),
    (0.56, 0.40),
]

# One drawing does not serve 128px and 16px equally. Small sizes get the composition
# pushed out toward the edges -- the 14-unit inset costs ~25% of a 16px canvas -- and
# 128px keeps the airy version for listing artwork.
#
# The bolt is dropped entirely at 16px. There is no scale at which it survives: the
# knockout is ~1px wide, so it reads as a dent in the lock body rather than a bolt, and
# enlarging it just eats the body. A clean solid open padlock is the stronger 16px mark.
SIZE_TUNING = {
    16: {"zoom": 1.12, "with_bolt": False},
    48: {"zoom": 1.12, "bolt_scale": 1.06},
    128: {"zoom": 1.00, "bolt_scale": 1.00},
}
DEFAULT_TUNING = {"zoom": 1.00, "bolt_scale": 1.00}

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "icons"))
SUPERSAMPLE = 12  # draw big, downsample once -- this is all the antialiasing there is


def tuned(zoom=1.0, bolt_scale=1.0, with_bolt=True):
    """GEOMETRY scaled about the canvas centre, which the composition is centred on."""
    c = CANVAS / 2

    def z(v):
        return c + (v - c) * zoom

    body, sh, bolt = GEOMETRY["body"], GEOMETRY["shackle"], GEOMETRY["bolt"]
    return {
        "body": {
            "left": z(body["left"]),
            "top": z(body["top"]),
            "right": z(body["right"]),
            "bottom": z(body["bottom"]),
            "radius": body["radius"] * zoom,
        },
        "shackle": {
            "cx": z(sh["cx"]),
            "cy": z(sh["cy"]),
            "r": sh["r"] * zoom,
            "stroke": sh["stroke"] * zoom,
            "leg_bottom": z(sh["leg_bottom"]),
        },
        "bolt": {
            "cx": z(bolt["cx"]),
            "cy": z(bolt["cy"]),
            "w": bolt["w"] * zoom * bolt_scale,
            "h": bolt["h"] * zoom * bolt_scale,
        }
        if with_bolt
        else None,
    }


def bolt_points(g, scale=1.0):
    b = g["bolt"]
    x0, y0 = b["cx"] - b["w"] / 2, b["cy"] - b["h"] / 2
    return [((x0 + u * b["w"]) * scale, (y0 + v * b["h"]) * scale) for u, v in BOLT]


def write_svg(path):
    g = tuned()  # the vector master is the 128px treatment
    body, sh = g["body"], g["shackle"]
    w, h = body["right"] - body["left"], body["bottom"] - body["top"]
    bolt = " ".join(
        f"{'M' if i == 0 else 'L'} {x:g} {y:g}" for i, (x, y) in enumerate(bolt_points(g))
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS} {CANVAS}" \
width="{CANVAS}" height="{CANVAS}" role="img" aria-label="Basic Auth Autofill">
  <mask id="bolt-knockout">
    <rect width="{CANVAS}" height="{CANVAS}" fill="black"/>
    <rect x="{body['left']:g}" y="{body['top']:g}" width="{w:g}" height="{h:g}" \
rx="{body['radius']:g}" fill="white"/>
    <path d="M {sh['cx'] - sh['r']:g} {sh['leg_bottom']:g} \
L {sh['cx'] - sh['r']:g} {sh['cy']:g} \
A {sh['r']:g} {sh['r']:g} 0 0 1 {sh['cx'] + sh['r']:g} {sh['cy']:g}" \
fill="none" stroke="white" stroke-width="{sh['stroke']:g}" stroke-linecap="round"/>
    <path d="{bolt} Z" fill="black"/>
  </mask>
  <rect width="{CANVAS}" height="{CANVAS}" fill="rgb({COLOR[0]},{COLOR[1]},{COLOR[2]})" \
mask="url(#bolt-knockout)"/>
</svg>
"""
    with open(path, "w") as handle:
        handle.write(svg)
    return f"icons/{os.path.basename(path)}"


def render_mask(size):
    """Alpha coverage for the mark at `size` px, drawn supersampled then reduced."""
    from PIL import Image, ImageDraw

    g = tuned(**SIZE_TUNING.get(size, DEFAULT_TUNING))
    s = size * SUPERSAMPLE
    k = s / CANVAS  # design units -> supersampled px
    mask = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(mask)

    body, sh = g["body"], g["shackle"]
    d.rounded_rectangle(
        [body["left"] * k, body["top"] * k, body["right"] * k, body["bottom"] * k],
        radius=body["radius"] * k,
        fill=255,
    )

    cx, cy, r = sh["cx"] * k, sh["cy"] * k, sh["r"] * k
    half = sh["stroke"] * k / 2

    # ImageDraw.arc() grows its stroke inward from the bounding box rather than
    # centering it on the radius, which breaks the join with the leg. Build the
    # shackle as a real annulus clipped to its top half instead, so the stroke
    # straddles r exactly the way the SVG's stroke-width does.
    ring = Image.new("L", (s, s), 0)
    rd = ImageDraw.Draw(ring)
    rd.ellipse([cx - r - half, cy - r - half, cx + r + half, cy + r + half], fill=255)
    rd.ellipse([cx - r + half, cy - r + half, cx + r - half, cy + r - half], fill=0)
    rd.rectangle([0, cy, s, s], fill=0)  # keep the top half only
    mask.paste(255, (0, 0), ring)

    # Legs: the left one drops into the body, the right one is just a rounded stub,
    # leaving the gap that reads as "open".
    d.rectangle([cx - r - half, cy, cx - r + half, sh["leg_bottom"] * k], fill=255)
    d.ellipse([cx + r - half, cy - half, cx + r + half, cy + half], fill=255)

    if g["bolt"]:
        d.polygon(bolt_points(g, k), fill=0)
    # BOX, not LANCZOS: the supersample factor is an integer, so a box filter is exact
    # area-averaging. LANCZOS's negative lobes ring, leaving a faint alpha haze around
    # the mark that shows up against some backgrounds.
    return mask.resize((size, size), Image.BOX)


def write_png(path, size):
    from PIL import Image

    img = Image.new("RGBA", (size, size), COLOR + (255,))
    img.putalpha(render_mask(size))
    img.save(path)
    return f"icons/{os.path.basename(path)}"


def main():
    os.makedirs(OUT, exist_ok=True)
    print("wrote", write_svg(os.path.join(OUT, "icon.svg")))
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow not installed -- SVG written, PNGs skipped.", file=sys.stderr)
        print("  pip install Pillow", file=sys.stderr)
        return 1
    for size in (16, 48, 128):
        print("wrote", write_png(os.path.join(OUT, f"{size}.png"), size))
    for size in (int(a) for a in sys.argv[1:] if a.isdigit()):
        print("wrote", write_png(os.path.join(OUT, f"preview-{size}.png"), size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
