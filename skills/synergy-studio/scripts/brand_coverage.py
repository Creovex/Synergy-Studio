#!/usr/bin/env python3
"""How much of an image is in the brand's signature hue? A check for "the brand colour flooded the frame".

Usage: python3 brand_coverage.py <image> --brand "#2A67B7" [--brand "#B9D1E6"] [--tol 20] [--ffmpeg ffmpeg]
Decodes the image with ffmpeg (any format it reads) together with its transparency, then counts the pixels whose hue
is within --tol degrees of a brand colour's hue and that have some colour (saturation and brightness over 0.12).
Fully transparent pixels count for nothing (they are neither colour nor neutral; the share is still of the whole image). Prints the share per
brand colour, the share of near-neutral pixels, the main hues of the image, and a verdict:
ACCENT (at most 15%), HEAVY (15 to 35%), FLOODED (over 35%). Exit code 0, or 2 when FLOODED.
Needs numpy. Very light tints (like #E8EFF8) have little saturation; they count as neutral."""
import argparse, colorsys, subprocess, sys
import numpy as np

def hex_rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

ap = argparse.ArgumentParser()
ap.add_argument("image"); ap.add_argument("--brand", action="append", required=True)
ap.add_argument("--tol", type=float, default=20.0); ap.add_argument("--ffmpeg", default="ffmpeg")
a = ap.parse_args()
W = 480
p = subprocess.run([a.ffmpeg, "-v", "error", "-i", a.image, "-vf", f"scale={W}:-2", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True)
if p.returncode or not p.stdout: sys.exit(f"{a.image} is not a picture ffmpeg can read")
raw = np.frombuffer(p.stdout, np.uint8).reshape(-1, 4)
visible = raw[:, 3] > 0
px = raw[:, :3].astype(float) / 255
mx, mn = px.max(1), px.min(1); d = mx - mn
sat = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0); val = mx
r, g, b = px.T; dd = np.maximum(d, 1e-9)
hue = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4)) * 60
coloured = (sat > .12) & (val > .12) & visible
print(f"{a.image}: {len(px)} pixels sampled")
print(f"  neutral (little colour): {100 * (visible & ~coloured).mean():5.1f}%")
if not visible.all(): print(f"  transparent (not counted): {100 * (~visible).mean():5.1f}%")
worst = 0
for h in a.brand:
    bh, bs, bv = colorsys.rgb_to_hsv(*hex_rgb(h))
    if bs < .12: print(f"  {h}: a neutral or pale tint (saturation {bs:.2f}); not measured as a hue"); continue
    diff = np.abs((hue - bh * 360 + 180) % 360 - 180)
    share = 100 * (coloured & (diff <= a.tol)).mean(); worst = max(worst, share)
    print(f"  brand {h} (hue {bh * 360:.0f}°, ±{a.tol:.0f}°): {share:5.1f}% of the image")
bins = np.histogram(hue[coloured], bins=12, range=(0, 360))[0]
tot = max(1, coloured.sum()); top = sorted(((c, i) for i, c in enumerate(bins)), reverse=True)[:4]
print("  main hues: " + (", ".join(f"{i * 30}–{i * 30 + 30}° {100 * c / len(px):.0f}%" for c, i in top if c) or "none"))
distinct = int((bins / len(px) > .03).sum())
verdict = "ACCENT" if worst <= 15 else "HEAVY" if worst <= 35 else "FLOODED"
print(f"  hues over 3% of the image: {distinct}" + ("  (fewer than 3: the frame may look monotone)" if distinct < 3 else ""))
print(f"VERDICT: {verdict}" + {"ACCENT": " (the brand colour is an accent)", "HEAVY": " (fine for an end card or logo moment; too much for a scene)",
      "FLOODED": " (the brand colour is the wallpaper: rebuild the palette, see references/brand-colours.md)"}[verdict])
sys.exit(2 if verdict == "FLOODED" else 0)
