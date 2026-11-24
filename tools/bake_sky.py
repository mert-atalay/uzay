#!/usr/bin/env python3
"""Bakes the game's sky from real data.

Inputs (download next to this script's working directory first):
  milkyway.png      Stellarium's all-sky Milky Way photograph, J2000 equatorial
                    https://raw.githubusercontent.com/Stellarium/stellarium/master/textures/milkyway.png
  hygdata_v41.csv   HYG star catalogue (positions, magnitudes, colours of ~120,000 real stars)
                    https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv

Outputs:
  assets/textures/milky_way.jpg   8192x4096 panorama in the game's sky frame (galactic: centre of the
                                  image is the galactic centre, u = 0.5 + l/360, north up), Milky Way
                                  glow plus every catalogue star. Used by the sky and the black hole lens.
  data/stars.bin                  the naked-eye stars as float32 x, y, z, magnitude, r, g, b (sky frame),
                                  drawn as sharp points on top (src/game/star_points.gd).

Usage: python3 tools/bake_sky.py <input dir> <repo dir>
"""
import csv
import sys

import numpy as np
from PIL import Image

W, H = 8192, 4096
POINT_STAR_LIMIT = 7.0
# J2000 equatorial -> galactic rotation.
EQ_TO_GAL = np.array([
    [-0.0548755604, -0.8734370902, -0.4838350155],
    [0.4941094279, -0.4448296300, 0.7469822445],
    [-0.8676661490, -0.1980763734, 0.4559837762],
])


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def bv_to_rgb(bv):
    """Star colour from its B-V index (blue-white through yellow to orange-red), linear RGB."""
    bv = np.clip(np.nan_to_num(bv, nan=0.6), -0.4, 2.0)
    t = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62))  # Ballesteros: kelvin
    x = t / 100.0
    r = np.where(x <= 66, 255.0, 329.698727446 * np.maximum(x - 60, 1e-3) ** -0.1332047592)
    g = np.where(x <= 66, 99.4708025861 * np.log(x) - 161.1195681661, 288.1221695283 * np.maximum(x - 60, 1e-3) ** -0.0755148492)
    b = np.where(x >= 66, 255.0, np.where(x <= 19, 0.0, 138.5177312231 * np.log(np.maximum(x - 10, 1e-3)) - 305.0447927307))
    rgb = srgb_to_linear(np.clip(np.stack([r, g, b], axis=-1), 0, 255) / 255.0)
    return rgb / rgb.max(axis=-1, keepdims=True)


def sky_frame(l, b):
    """Galactic longitude/latitude (radians) -> the game's sky-frame unit vector."""
    return np.stack([np.cos(b) * np.sin(l), np.sin(b), np.cos(b) * np.cos(l)], axis=-1)


def main(src, repo):
    # --- Milky Way glow, resampled from equatorial to the sky frame ---
    mw = srgb_to_linear(np.asarray(Image.open(f"{src}/milkyway.png").convert("RGB"), dtype=np.float32) / 255.0)
    sh, sw = mw.shape[:2]
    out = np.zeros((H, W, 3), dtype=np.float32)
    u = (np.arange(W) + 0.5) / W
    l = (u - 0.5) * 2 * np.pi
    for y in range(H):
        b = np.pi / 2 - (y + 0.5) / H * np.pi
        gal = np.stack([np.cos(b) * np.cos(l), np.cos(b) * np.sin(l), np.full_like(l, np.sin(b))], axis=-1)
        eq = gal @ EQ_TO_GAL  # transpose-multiply: galactic -> equatorial
        ra = np.arctan2(eq[:, 1], eq[:, 0])
        dec = np.arcsin(np.clip(eq[:, 2], -1, 1))
        # Stellarium's map: declination +90 at the top, right ascension 90 deg at the left edge, decreasing.
        sx = ((np.pi / 2 - ra) / (2 * np.pi)) % 1.0 * sw - 0.5
        sy = np.clip((np.pi / 2 - dec) / np.pi * sh - 0.5, 0, sh - 1.001)
        x0 = np.floor(sx).astype(int)
        y0 = int(np.floor(sy[0])) if False else np.floor(sy).astype(int)
        fx = (sx - x0)[:, None]
        fy = (sy - y0)[:, None]
        a = mw[y0, x0 % sw]
        b2 = mw[y0, (x0 + 1) % sw]
        c = mw[np.minimum(y0 + 1, sh - 1), x0 % sw]
        d = mw[np.minimum(y0 + 1, sh - 1), (x0 + 1) % sw]
        out[y] = (a * (1 - fx) + b2 * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    # The photograph's black level is a dark blue haze: pull it down so empty sky is truly black.
    floor = np.percentile(out.reshape(-1, 3), 20, axis=0)
    out = np.maximum(out - floor * 1.15, 0.0) * 1.25

    # --- Stars ---
    ra, dec, mag, ci = [], [], [], []
    with open(f"{src}/hygdata_v41.csv", newline="") as f:
        for row in csv.DictReader(f):
            if row["proper"] == "Sol" or not row["mag"]:
                continue
            ra.append(float(row["ra"]) * np.pi / 12)
            dec.append(float(row["dec"]) * np.pi / 180)
            mag.append(float(row["mag"]))
            ci.append(float(row["ci"]) if row["ci"] else np.nan)
    ra, dec, mag, ci = map(np.array, (ra, dec, mag, ci))
    eq = np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)
    gal = eq @ EQ_TO_GAL.T
    gl = np.arctan2(gal[:, 1], gal[:, 0])
    gb = np.arcsin(np.clip(gal[:, 2], -1, 1))
    rgb = bv_to_rgb(ci)
    print(f"{len(mag)} stars, {np.sum(mag < POINT_STAR_LIMIT)} drawn as points")

    # Splat each star as a small gaussian. Brightness is compressed (8 bits cannot hold 11 magnitudes).
    px = (0.5 + gl / (2 * np.pi)) % 1.0 * W
    py = (np.pi / 2 - gb) / np.pi * H
    peak = np.minimum(1.0, 0.9 * 10 ** (-0.2 * (mag - 2.0)))
    sigma = 0.75 * (1.0 + 0.35 * np.maximum(0.0, 2.0 - mag))
    for i in np.argsort(-mag):
        # Stretch horizontally towards the poles so stars stay round on the sphere.
        stretch = min(1.0 / max(np.cos(gb[i]), 0.05), 12.0)
        rx = int(np.ceil(3 * sigma[i] * stretch))
        ry = int(np.ceil(3 * sigma[i]))
        cx, cy = int(np.floor(px[i])), int(np.floor(py[i]))
        ys = np.arange(max(cy - ry, 0), min(cy + ry + 1, H))
        xs = np.arange(cx - rx, cx + rx + 1)
        g = np.exp(-(((xs + 0.5 - px[i]) / stretch) ** 2)[None, :] / (2 * sigma[i] ** 2)
                   - ((ys + 0.5 - py[i]) ** 2)[:, None] / (2 * sigma[i] ** 2))
        out[np.ix_(ys, xs % W)] += (peak[i] * g)[:, :, None] * rgb[i]

    Image.fromarray((linear_to_srgb(out) * 255 + 0.5).astype(np.uint8)).save(
        f"{repo}/assets/textures/milky_way.jpg", quality=93, subsampling=0)

    keep = mag < POINT_STAR_LIMIT
    data = np.concatenate([sky_frame(gl[keep], gb[keep]), mag[keep, None], rgb[keep]], axis=1).astype("<f4")
    data.tofile(f"{repo}/data/stars.bin")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
