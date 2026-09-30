"""Measure a reference (images or videos) and draft a custom look from it (numpy and Pillow only).

Run through the CLI:  node scripts/studio.mjs look <project> --from <file> [<file> ...]
Direct:               python look.py <ffmpeg> <ffprobe> <project> <file> [<file> ...]
Writes <project>/look-reference.json (every number) and <project>/src/look.css (the palette mapped onto the look
variables; an earlier look.css is kept as src/look.previous.css). The look card is drawn by the CLI afterwards.

Only numbers and colours are taken from the reference: no text, shape or layout is copied anywhere.

Measures
  palette      six colours by seeded k-means in CIE Lab (k-means++ start, 6 restarts, fixed seed), with their share of the pixels
  background   the palette colour with the largest share; "light" when its Lab L* is 50 or more, otherwise "dark"
  contrast     WCAG ratio of the best text and background pair in the palette; the ink that look.css uses and its ratio
  grain        standard deviation, in luma levels (0 to 255), of the detail left after a 3x3 box blur inside flat 32 px blocks
               (a block is flat when its sixteen 8 px means differ by less than 3 levels std and 12 levels range, and its detail is not
               concentrated in a few pixels, which marks an edge); for white
               noise this equals the noise sigma. Blocks with no detail at all (std under 0.05) are drawn graphics and are
               left out of the median. Present when the median is at least GRAIN_PRESENT.
  edge density fraction of pixels whose central difference gradient magnitude exceeds 16 levels (luma, 640 px wide)
  video only   fps (ffprobe), cuts per minute (ffmpeg select='gt(scene,0.3)'), motion energy (mean absolute difference of
               consecutive frames at 10 fps, 160x90 luma, 0 to 1; the same without frame pairs that are cuts)
Videos are sampled at 1 frame per second, evenly thinned to at most 60 frames (a video longer than 60 s gets 60 evenly spread frames).
"""
import json, math, pathlib, re, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image

SEED = 7
K = 6
MAX_FRAMES = 60
GRAIN_PRESENT = 0.4           # luma levels; at or above it the look is written with a texture overlay and the card shows it
                              # (a clean vector render through H.264 measures 0.2 to 0.3, white noise of sigma 3 measures 3; video compression
                              # removes most grain, so 0.4 in a video is already well above the codec floor)
FLAT_STD, FLAT_RANGE = 3.0, 12.0
EDGE_TOP, EDGE_ENERGY = 82, 0.6   # a block whose 82 strongest detail pixels (8%) hold over 60% of its detail energy holds an edge, not grain (white noise: about 38%)
EDGE_LEVEL = 16.0
BLOCK, SUB = 32, 8
BAR_LUMA, BAR_SPREAD, BAR_FRAMES = 17.5, 4.0, 0.95   # a black bar row or column: median luma at most 17.5, channels within 4 of each other, in 95% of a video's frames
BAR_MIN_AREA, BAR_KEEP_AREA = 0.03, 0.30            # bars are cut only when they are at least 3% of the frame and at least 30% of it stays
CUT_DIFF = 0.2                # a consecutive frame pair whose mean difference is above this is a cut, not motion
MOTION_FPS, MOTION_MAX_S = 10, 180
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
WHITE_D65 = np.array([0.95047, 1.0, 1.08883])


# ------------------------------------------------------------------ colour maths
def srgb_to_lab(rgb):
    """rgb: (..., 3) floats 0..255 -> Lab (..., 3), D65"""
    c = np.asarray(rgb, np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    t = (lin @ m.T) / WHITE_D65
    f = np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_rgb(lab):
    """Lab (..., 3) -> rgb floats 0..255, clipped to the sRGB gamut"""
    lab = np.asarray(lab, np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx, fz = fy + lab[..., 1] / 500, fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    t = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * WHITE_D65
    m = np.array([[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]])
    lin = np.clip(t @ m.T, 0, 1)
    c = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    return np.clip(c, 0, 1) * 255.0


def to_hex(rgb):
    r = np.clip(np.rint(np.asarray(rgb, np.float64)), 0, 255).astype(int)
    return "#%02X%02X%02X" % tuple(r)


def hex_to_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float64)


def lab_hex(lab):
    return to_hex(lab_to_rgb(lab))


def hex_lab(h):
    return srgb_to_lab(hex_to_rgb(h))


def luminance(rgb):
    c = np.asarray(rgb, np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return float(lin @ np.array([0.2126, 0.7152, 0.0722]))


def contrast_ratio(hex_a, hex_b):
    """WCAG 2 contrast ratio between two hex colours (1 to 21)"""
    la, lb = luminance(hex_to_rgb(hex_a)), luminance(hex_to_rgb(hex_b))
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def delta_e(lab_a, lab_b):
    """CIE76 colour difference"""
    return float(np.linalg.norm(np.asarray(lab_a, np.float64) - np.asarray(lab_b, np.float64)))


def chroma(lab):
    return float(math.hypot(lab[1], lab[2]))


def mix_lab(a, b, t):
    return np.asarray(a, np.float64) * (1 - t) + np.asarray(b, np.float64) * t


def rotate_hue(lab, degrees):
    c, h = chroma(lab), math.atan2(lab[2], lab[1]) + math.radians(degrees)
    return np.array([lab[0], c * math.cos(h), c * math.sin(h)])


# ------------------------------------------------------------------ k-means
def kmeans_lab(X, k=K, seed=SEED, n_init=6, iters=40):
    """seeded k-means (k-means++ start, best of n_init by inertia) on Lab points; returns (centroids, labels).
    Fewer than k distinct colours give fewer centroids."""
    X = np.asarray(X, np.float64)
    distinct = len(np.unique(np.rint(X).astype(np.int32), axis=0))
    k = max(1, min(k, distinct))
    best = None
    for r in range(n_init):
        rng = np.random.default_rng(seed + r)
        C = [X[rng.integers(len(X))]]
        d2 = ((X - C[0]) ** 2).sum(1)
        for _ in range(1, k):
            tot = d2.sum()
            idx = rng.choice(len(X), p=d2 / tot) if tot > 0 else rng.integers(len(X))
            C.append(X[idx])
            d2 = np.minimum(d2, ((X - X[idx]) ** 2).sum(1))
        C = np.array(C)
        for _ in range(iters):
            dist = ((X[:, None, :] - C[None, :, :]) ** 2).sum(2)
            lab = dist.argmin(1)
            new = C.copy()
            for j in range(k):
                pts = X[lab == j]
                if len(pts):
                    new[j] = pts.mean(0)
                else:                                   # empty cluster: restart it at the worst fitted point
                    new[j] = X[dist[np.arange(len(X)), lab].argmax()]
            if np.allclose(new, C, atol=1e-4):
                C = new
                break
            C = new
        dist = ((X[:, None, :] - C[None, :, :]) ** 2).sum(2)
        lab = dist.argmin(1)
        inertia = float(dist[np.arange(len(X)), lab].sum())
        if best is None or inertia < best[0] - 1e-9:
            best = (inertia, C, lab)
    return best[1], best[2]


def palette_of(pixels_rgb, k=K, seed=SEED, max_points=40000):
    """pixels_rgb: (N, 3) uint8 or float. Returns palette entries sorted by share, largest first"""
    px = np.asarray(pixels_rgb, np.float64).reshape(-1, 3)
    if len(px) > max_points:
        px = px[np.linspace(0, len(px) - 1, max_points).astype(np.int64)]
    X = srgb_to_lab(px)
    C, lab = kmeans_lab(X, k, seed)
    share = np.bincount(lab, minlength=len(C)) / len(X)
    order = np.argsort(-share, kind="stable")
    return [{"hex": lab_hex(C[i]), "lab": [round(float(v), 2) for v in C[i]], "share": round(float(share[i]), 4)} for i in order]


# ------------------------------------------------------------------ grain and edges
def grain_blocks(y):
    """y: 2D float luma 0..255. Returns (per flat block detail std as a 1D array, share of blocks that are flat, blocks)"""
    y = np.asarray(y, np.float64)
    H, W = y.shape
    p = np.pad(y, 1, mode="edge")
    blur = sum(p[i:i + H, j:j + W] for i in range(3) for j in range(3)) / 9.0
    hp = (y - blur) / math.sqrt(8 / 9)                     # white noise of sigma s leaves s
    h, w = (H // BLOCK) * BLOCK, (W // BLOCK) * BLOCK
    if h == 0 or w == 0:
        return np.zeros(0), 0.0, 0
    n = BLOCK // SUB
    m = y[:h, :w].reshape(h // SUB, SUB, w // SUB, SUB).mean((1, 3))
    mb = m.reshape(h // BLOCK, n, w // BLOCK, n).transpose(0, 2, 1, 3).reshape(h // BLOCK, w // BLOCK, n * n)
    flat = (mb.std(2) < FLAT_STD) & (np.ptp(mb, axis=2) < FLAT_RANGE)
    hb = hp[:h, :w].reshape(h // BLOCK, BLOCK, w // BLOCK, BLOCK).transpose(0, 2, 1, 3).reshape(h // BLOCK, w // BLOCK, BLOCK * BLOCK)
    energy = hb ** 2
    top = np.sort(energy, axis=2)[:, :, -EDGE_TOP:].sum(2)
    flat &= ~(top > EDGE_ENERGY * energy.sum(2))                      # blocks that straddle a colour edge are not flat
    s = hb.std(2)
    return s[flat], float(flat.mean()), int(flat.size)


def grain_summary(stds, flat_shares):
    """median and 90th percentile of the detail std over flat blocks that hold some detail, and the share of flat blocks"""
    s = np.concatenate(stds) if stds else np.zeros(0)
    textured = s[s >= 0.05]
    return {
        "value": round(float(np.median(textured)), 3) if len(textured) else 0.0,
        "p90": round(float(np.percentile(textured, 90)), 3) if len(textured) else 0.0,
        "flat_share": round(float(np.mean(flat_shares)), 4) if flat_shares else 0.0,
        "flat_blocks_with_detail": round(float(len(textured) / len(s)), 4) if len(s) else 0.0,
        "present": bool(len(textured) and float(np.median(textured)) >= GRAIN_PRESENT),
        "threshold": GRAIN_PRESENT,
    }


def edge_density(y):
    """fraction of pixels with a central difference gradient above EDGE_LEVEL, on luma resized to 640 px wide"""
    y = np.asarray(y, np.float64)
    if y.shape[1] > 640:
        im = Image.fromarray(np.clip(y, 0, 255).astype(np.uint8)).resize((640, max(1, round(y.shape[0] * 640 / y.shape[1]))), Image.BOX)
        y = np.asarray(im, np.float64)
    gx = (y[1:-1, 2:] - y[1:-1, :-2]) / 2
    gy = (y[2:, 1:-1] - y[:-2, 1:-1]) / 2
    return float((np.hypot(gx, gy) > EDGE_LEVEL).mean())


def luma(rgb):
    return np.asarray(rgb, np.float64) @ np.array([0.299, 0.587, 0.114])


# ------------------------------------------------------------------ reading files
def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"{pathlib.Path(cmd[0]).name} failed: {r.stderr.decode('utf8', 'replace')[-800:]}")
    return r


def probe(ffprobe, video):
    out = run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate:format=duration",
               "-of", "json", str(video)]).stdout
    j = json.loads(out)
    if not j.get("streams"):
        sys.exit(f"no video stream in {video}")
    def frac(s):
        a, _, b = s.partition("/")
        return float(a) / float(b) if b and float(b) else float(a)
    st = j["streams"][0]
    fps = frac(st.get("avg_frame_rate", "0/0")) or frac(st.get("r_frame_rate", "0/0"))
    dur = float(j["format"].get("duration") or 0)
    if dur <= 0:
        sys.exit(f"cannot read the duration of {video}")
    return fps, dur


def video_frames(ffmpeg, video, dur, dest):
    """1 frame per second, at most MAX_FRAMES (evenly spread over a longer video), native size capped at 1280 wide"""
    rate = 1.0 if dur <= MAX_FRAMES else MAX_FRAMES / dur
    run([ffmpeg, "-loglevel", "error", "-y", "-i", str(video), "-an", "-vf", f"fps={rate:.9f},scale='min(1280,iw)':-2",
         "-frames:v", str(MAX_FRAMES), str(dest / "f%03d.png")])
    return sorted(dest.glob("f*.png"))


def count_cuts(ffmpeg, video):
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", str(video), "-an", "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"], capture_output=True)
    if r.returncode != 0:
        sys.exit(f"ffmpeg failed while looking for cuts: {r.stderr.decode('utf8', 'replace')[-800:]}")
    return [float(m) for m in re.findall(r"Parsed_showinfo.*?pts_time:([0-9.]+)", r.stderr.decode("utf8", "replace"))]


def motion(ffmpeg, video):
    """(mean, mean without cut pairs) of the absolute difference of consecutive frames, 0..1"""
    W, H = 160, 90
    raw = run([ffmpeg, "-loglevel", "error", "-i", str(video), "-an", "-t", str(MOTION_MAX_S), "-vf", f"fps={MOTION_FPS},scale={W}:{H},format=gray",
               "-f", "rawvideo", "-"]).stdout
    n = len(raw) // (W * H)
    if n < 2:
        return 0.0, 0.0
    f = np.frombuffer(raw[: n * W * H], np.uint8).reshape(n, W * H).astype(np.float64)
    d = np.abs(np.diff(f, axis=0)).mean(1) / 255.0
    calm = d[d <= CUT_DIFF]
    return float(d.mean()), float(calm.mean()) if len(calm) else 0.0


# ------------------------------------------------------------------ measuring
def measure_arrays(frames, video_info=None, sources=None):
    """frames: list of (H, W, 3) uint8 arrays. Returns the look-reference dict (without the CSS)."""
    thumbs, stds, flats, edges = [], [], [], []
    for a in frames:
        a = np.asarray(a, np.uint8)
        h, w = a.shape[:2]
        tw = min(128, w)
        th = max(1, round(h * tw / w))
        thumbs.append(np.asarray(Image.fromarray(a).resize((tw, th), Image.NEAREST), np.uint8).reshape(-1, 3))
        y = luma(a)
        s, fl, _ = grain_blocks(y)
        stds.append(s)
        flats.append(fl)
        edges.append(edge_density(y))
    palette = palette_of(np.concatenate(thumbs))
    bg = palette[0]
    L = bg["lab"][0]
    best = None
    for c in palette[1:]:
        r = contrast_ratio(bg["hex"], c["hex"])
        if best is None or r > best[0]:
            best = (r, c)
    pair = {"background": bg["hex"], "text": best[1]["hex"] if best else bg["hex"], "ratio": round(best[0], 2) if best else 1.0}
    out = {
        "seed": SEED,
        "sources": sources or [],
        "frames": len(frames),
        "palette": palette,
        "background": {"hex": bg["hex"], "share": bg["share"], "lightness": round(L, 2)},
        "mode": "light" if L >= 50 else "dark",
        "contrast": {"best_pair": pair},
        "grain": grain_summary(stds, flats),
        "edge_density": round(float(np.mean(edges)), 4),
        "video": video_info,
        "method": {"palette": f"k-means in Lab, k={K}, seed {SEED}, 6 restarts, pixels sampled from thumbnails 128 px wide (nearest neighbour, so no blended edge colours)",
                   "grain": f"std of 3x3 box blur residual in flat {BLOCK} px blocks, present at {GRAIN_PRESENT} or more",
                   "black_bars": f"rows and columns whose median pixel is black in {int(BAR_FRAMES * 100)}% of a video's frames are left out of every measure",
                   "edge_density": f"central difference gradient above {EDGE_LEVEL} levels, luma 640 px wide",
                   "motion_energy": f"mean absolute frame difference at {MOTION_FPS} fps, 160x90 luma, 0 to 1; cut pairs above {CUT_DIFF} left out of the second figure"},
    }
    return out


def _black_lines(a, axis):
    """for each row (axis=1) or column (axis=0): is its median pixel black? a is (H, W, 3) uint8"""
    m = np.median(a, axis=axis)                                  # (n, 3): per line, per channel median
    luma_m = m @ np.array([0.299, 0.587, 0.114])
    return (luma_m <= BAR_LUMA) & ((m.max(1) - m.min(1)) <= BAR_SPREAD)


def trim_bars(frames):
    """cut rows and columns that are black in nearly every frame of one video (letterbox and pillar bars, black bands of a
    stacked layout). Returns (frames, rows removed, columns removed). Nothing is cut when the bars are small or would leave too little."""
    if len(frames) < 3:
        return frames, 0, 0
    rows = np.mean([_black_lines(f, 1) for f in frames], axis=0) >= BAR_FRAMES
    cols = np.mean([_black_lines(f, 0) for f in frames], axis=0) >= BAR_FRAMES
    h, w = frames[0].shape[:2]
    area_cut = 1 - (1 - rows.mean()) * (1 - cols.mean())
    if area_cut < BAR_MIN_AREA or (1 - area_cut) < BAR_KEEP_AREA:
        return frames, 0, 0
    return [f[~rows][:, ~cols] for f in frames], int(rows.sum()), int(cols.sum())


def load_image(path):
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.width > 1280:
            im = im.resize((1280, max(1, round(im.height * 1280 / im.width))), Image.LANCZOS)
        return np.asarray(im, np.uint8)


def measure_files(ffmpeg, ffprobe, files):
    frames, sources, vids = [], [], []
    for f in files:
        p = pathlib.Path(f)
        if not p.is_file():
            sys.exit(f"not found: {f}")
        ext = p.suffix.lower()
        if ext in IMAGE_EXT:
            try:
                frames.append(load_image(p))
            except Exception as err:
                sys.exit(f"cannot read the image {f}: {err}")
            sources.append({"file": p.name, "kind": "image", "frames": 1})
        elif ext in VIDEO_EXT:
            fps, dur = probe(ffprobe, p)
            with tempfile.TemporaryDirectory(prefix="look-frames-") as t:
                got = video_frames(ffmpeg, p, dur, pathlib.Path(t))
                if not got:
                    sys.exit(f"no frames could be read from {f}")
                vf, br, bc = trim_bars([load_image(x) for x in got])
                frames.extend(vf)
            cuts = count_cuts(ffmpeg, p)
            me, me_calm = motion(ffmpeg, p)
            vids.append({"file": p.name, "fps": round(fps, 3), "duration": round(dur, 3), "cuts": len(cuts),
                         "cuts_per_minute": round(len(cuts) / dur * 60, 2), "motion_energy": round(me, 4),
                         "motion_energy_without_cuts": round(me_calm, 4)})
            sources.append({"file": p.name, "kind": "video", "frames": len(got), "black_rows_removed": br, "black_columns_removed": bc})
        else:
            sys.exit(f"{p.name}: use images ({', '.join(sorted(IMAGE_EXT))}) or videos ({', '.join(sorted(VIDEO_EXT))})")
    if not frames:
        sys.exit("give at least one image or video after --from")
    info = None
    if vids:
        tot = sum(v["duration"] for v in vids)
        wmean = lambda k: round(sum(v[k] * v["duration"] for v in vids) / tot, 4)
        info = {"fps": round(sum(v["fps"] * v["duration"] for v in vids) / tot, 3), "cuts_per_minute": round(sum(v["cuts"] for v in vids) / tot * 60, 2),
                "motion_energy": wmean("motion_energy"), "motion_energy_without_cuts": wmean("motion_energy_without_cuts"), "files": vids}
    return measure_arrays(frames, info, sources)


# ------------------------------------------------------------------ the look
INK_MIN = 4.5
INK_MAX_CHROMA = 35.0
def grain_svg(dark):
    """a static noise layer (same in every frame): light specks on a dark look, dark specks on a light one; no network, no script"""
    v = 1 if dark else 0
    return ('<svg class="grain-overlay" width="100%" height="100%"><filter id="grainf" x="0" y="0" width="100%" height="100%">'
            '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>'
            f'<feColorMatrix type="matrix" values="0 0 0 0 {v}  0 0 0 0 {v}  0 0 0 0 {v}  1.6 0 0 0 -0.45"/></filter>'
            '<rect width="100%" height="100%" filter="url(#grainf)"/></svg>')


def grain_opacity(g):
    # video compression hides most grain, so the overlay is drawn stronger than the measured number
    return round(min(0.2, 0.02 + 0.05 * g), 3)


def push_to_contrast(ink_lab, bg_hex, target, dark):
    """move ink toward white (dark background) or black (light background) until the contrast with bg reaches target"""
    end = np.array([100.0, 0.0, 0.0]) if dark else np.array([0.0, 0.0, 0.0])
    for i in range(0, 101):
        c = lab_hex(mix_lab(ink_lab, end, i / 100))
        if contrast_ratio(c, bg_hex) >= target:
            return c
    return lab_hex(end)


def derive_look(ref):
    """map the measurement onto the look variables (LITE 9.2). Returns (vars, notes)"""
    pal = ref["palette"]
    bg = pal[0]
    bgl = np.array(bg["lab"])
    dark = ref["mode"] == "dark"
    notes = []
    rest = pal[1:]
    # ink: the highest contrast palette colour that is not strongly saturated; else a neutral tinted with the background hue
    cands = [c for c in rest if chroma(c["lab"]) <= INK_MAX_CHROMA]
    ink_from = max(cands, key=lambda c: contrast_ratio(bg["hex"], c["hex"])) if cands else None
    if ink_from is not None:
        ink = ink_from["hex"]
    else:
        ink = lab_hex([90.0 if dark else 12.0, bgl[1] * 0.3, bgl[2] * 0.3])
        notes.append("no low saturation colour in the palette: ink is a neutral tinted with the background hue")
    raw_ratio = contrast_ratio(ink, bg["hex"])
    ink_info = {"hex": ink, "ratio": round(raw_ratio, 2), "adjusted": False}
    if raw_ratio < INK_MIN:
        adj = push_to_contrast(hex_lab(ink), bg["hex"], INK_MIN, dark)
        notes.append(f"ink adjusted from {ink} (contrast {raw_ratio:.2f}) toward {'white' if dark else 'black'} to {adj} to reach {INK_MIN} (WCAG AA)")
        ink_info = {"hex": adj, "ratio": round(contrast_ratio(adj, bg["hex"]), 2), "adjusted": True, "measured_hex": ink, "measured_ratio": round(raw_ratio, 2)}
        ink = adj
    inkl = hex_lab(ink)
    # accents: what is left of the palette, most saturated first; missing ones are hue rotations of the first
    left = [c for c in rest if not (ink_from is not None and c is ink_from)]
    # colours that show against the background come first, then by saturation
    left.sort(key=lambda c: (contrast_ratio(c["hex"], bg["hex"]) < 3.0, -chroma(c["lab"])))
    acc = [np.array(c["lab"]) for c in left[:4]]
    base = acc[0] if acc else np.array([60.0, 40.0, 20.0])
    for step in (120, 240, 60, 180):
        if len(acc) >= 4:
            break
        acc.append(rotate_hue(base, step))
        notes.append(f"accent {len(acc)} is the first accent turned by {step} degrees (the reference had too few distinct colours)")
    if not acc:
        acc = [base]
    while len(acc) < 4:
        acc.append(rotate_hue(base, 120 * len(acc)))
    acc = acc[:4]
    accent_hex = [lab_hex(a) for a in acc]
    for i, h in enumerate(accent_hex):
        r = contrast_ratio(h, bg["hex"])
        if i == 0 and r < 3:
            notes.append(f"--accent {h} has contrast {r:.2f} on the background: use it for large or decorative elements, not small text")
    # surfaces
    if dark:
        bg2 = lab_hex([max(0.0, bgl[0] * 0.6), bgl[1], bgl[2]])
        glow = lab_hex([min(100.0, bgl[0] + 10), bgl[1], bgl[2]])
        card = lab_hex([min(100.0, bgl[0] + 6), bgl[1], bgl[2]])
        line = lab_hex(mix_lab(bgl, inkl, 0.20))
        mixt = 0.30
    else:
        bg2 = lab_hex([max(0.0, bgl[0] - 4), bgl[1], bgl[2]])
        glow = lab_hex([min(100.0, bgl[0] + 3), bgl[1], bgl[2]])
        card = lab_hex(mix_lab(bgl, [100.0, 0.0, 0.0], 0.75))
        line = lab_hex(mix_lab(bgl, inkl, 0.16))
        mixt = 0.30
    # text sits on the card as well as on the background: the card keeps INK_MIN against the ink, moving toward the background
    # colour (which the ink already clears) until it does
    if contrast_ratio(ink, card) < INK_MIN:
        was, was_ratio = card, contrast_ratio(ink, card)
        for i in range(1, 101):
            card = lab_hex(mix_lab(hex_lab(was), bgl, i / 100))
            if contrast_ratio(ink, card) >= INK_MIN:
                break
        notes.append(f"--card adjusted from {was} (ink contrast {was_ratio:.2f}) toward the background to {card} so the ink on it keeps {INK_MIN}")
    muted_t = 0.40
    while muted_t > 0.05 and min(contrast_ratio(lab_hex(mix_lab(inkl, bgl, muted_t)), bg["hex"]),
                                 contrast_ratio(lab_hex(mix_lab(inkl, bgl, muted_t)), card)) < 3.0:
        muted_t -= 0.05
    v = {"--bg": bg["hex"], "--bg2": bg2, "--glow": glow, "--ink": ink, "--muted": lab_hex(mix_lab(inkl, bgl, muted_t)), "--line": line, "--card": card,
         "--accent": accent_hex[0], "--accent2": accent_hex[1], "--accent3": accent_hex[2], "--accent4": accent_hex[3],
         "--soft": lab_hex(mix_lab(bgl, acc[0], mixt)), "--soft2": lab_hex(mix_lab(bgl, acc[1], mixt)), "--soft3": lab_hex(mix_lab(bgl, acc[2], mixt)),
         "--ok": "#35E0C4" if dark else "#2E7D6F", "--bad": "#FF4D5E" if dark else "#B5523B"}
    return v, notes, ink_info


def motion_words(ref):
    vid = ref.get("video")
    if not vid:
        return ["no video was measured, so pick the pace and the eases from the brief."]
    me, cpm = vid["motion_energy_without_cuts"], vid["cuts_per_minute"]
    if me < 0.02:
        ease = "slow and soft: power2.inOut, 0.8 to 1.4 s moves, long holds"
    elif me < 0.06:
        ease = "moderate: power3.out, 0.5 to 0.8 s moves"
    else:
        ease = "quick and snappy: expo.out or back.out, 0.25 to 0.5 s moves"
    if cpm < 6:
        shots = "long shots, mostly dissolves or continuous camera moves"
    elif cpm < 20:
        shots = f"shots of about {60 / max(cpm, 0.1):.1f} s, a mix of cuts and dissolves"
    else:
        shots = f"short shots of about {60 / cpm:.1f} s, hard cuts on the music"
    return [f"eases {ease}", f"pace {shots} ({cpm} cuts per minute measured)", f"frame rate: the reference runs at {vid['fps']} fps; set project.json fps to match when the style depends on it (24 for drawn work on twos, 60 for smooth motion)"]


def font_words(ref):
    sat = np.mean([chroma(c["lab"]) for c in ref["palette"]])
    if ref["mode"] == "dark" and sat < 30:
        return "Cormorant Garamond 500 for headlines with tracked Jost capitals for labels (bundled): a restrained, premium reading."
    if ref["edge_density"] > 0.08 or sat > 55:
        return "Manrope 800 for headlines with Inter for text (bundled): loud, dense, high contrast."
    return "Manrope 800 for headlines with Inter for text (bundled); for a hand drawn feel add one open licence font in src/assets/fonts/ with an @font-face."


def render_css(ref):
    v, notes, ink_info = derive_look(ref)
    g = ref["grain"]
    lines = [
        "/* Custom look drafted from a reference by `studio look`. It loads after looks.css and its selectors carry the id, so these",
        "   variables win whatever data-look the page has. Only numbers and colours were taken from the reference (no text, shape or layout).",
        "   Edit freely; running `look --from` again rewrites this file (the previous one is kept as look.previous.css). */",
        f"/* measured: background {ref['background']['hex']} ({ref['mode']}, L* {ref['background']['lightness']}), ink {ink_info['hex']} at contrast {ink_info['ratio']} : 1,",
        f"   grain {g['value']} (texture threshold {g['threshold']}), edge density {ref['edge_density']}"
        + (f", {ref['video']['fps']} fps, {ref['video']['cuts_per_minute']} cuts per minute, motion energy {ref['video']['motion_energy']}" if ref.get("video") else "") + " */",
    ]
    for n in notes:
        lines.append(f"/* note: {n} */")
    lines.append("#root, #root[data-look]{")
    lines += [f"  {k}:{val};" for k, val in v.items()]
    lines += ["  --h-font:Manrope,sans-serif;--h-weight:800;--b-font:Inter,sans-serif;--cap-font:var(--h-font);--cap-weight:800",
              "}",
              "/* --ok and --bad are semantic defaults, not measured: set the brand's own green and red if it has them. */",
              "/* Fonts (edit): " + font_words(ref) + " */",
              "#root[data-look]{font-family:var(--b-font)}",
              "#root[data-look] .h1{font-family:var(--h-font);font-weight:var(--h-weight)}"]
    lines += ["/* Motion (edit), " + w + " */" for w in motion_words(ref)]
    if g["present"]:
        op = grain_opacity(g["value"])
        lines += [
            f"/* Grain: the reference carries grain ({g['value']} luma levels in flat areas), which a flat page cannot show by itself. Add this once inside #root,",
            "   above the scenes, as the last child (a static noise, the same in every frame, so renders stay identical):",
            "   " + grain_svg(ref["mode"] == "dark"),
            "   For a paper or hand drawn feel use the sketch kit instead: SK.create(canvas).paperBG() (template/sketch.js). */",
            f"#root .grain-overlay{{position:absolute;left:0;top:0;pointer-events:none;opacity:{op}}}",
        ]
    else:
        lines.append(f"/* Grain: the reference is clean (grain {g['value']}, below {g['threshold']}), so no texture is added. */")
    return "\n".join(lines) + "\n", v, ink_info


def main(argv):
    if len(argv) < 5:
        sys.exit("usage: look.py <ffmpeg> <ffprobe> <project> <image or video> [...]")
    ffmpeg, ffprobe, proj, files = argv[1], argv[2], pathlib.Path(argv[3]), argv[4:]
    ref = measure_files(ffmpeg, ffprobe, files)
    css, v, ink_info = render_css(ref)
    ref["contrast"]["ink"] = ink_info
    ref["look"] = v
    ref["css"] = "src/look.css"
    (proj / "src").mkdir(parents=True, exist_ok=True)
    target = proj / "src" / "look.css"
    if target.exists():
        shutil.copyfile(target, proj / "src" / "look.previous.css")
    target.write_text(css)
    (proj / "look-reference.json").write_text(json.dumps(ref, indent=2, sort_keys=False) + "\n")


if __name__ == "__main__":
    main(sys.argv)
