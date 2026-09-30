"""look.py: palette, background, light or dark, contrast, grain, edges, video numbers, determinism and the drafted look.css."""
import importlib.util, json, os, pathlib, re, shutil, subprocess, sys
import numpy as np
import pytest
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOOK_PY = ROOT / "skills" / "synergy-studio" / "scripts" / "look.py"
spec = importlib.util.spec_from_file_location("look_under_test", LOOK_PY)
look = importlib.util.module_from_spec(spec)
spec.loader.exec_module(look)

VARS = ["--bg", "--bg2", "--glow", "--ink", "--muted", "--line", "--card", "--accent", "--accent2", "--accent3", "--accent4",
        "--soft", "--soft2", "--soft3", "--ok", "--bad"]


def tool(name):
    """ffmpeg or ffprobe from the tool home, else from PATH, else None (video tests are skipped)"""
    home = pathlib.Path(os.environ.get("SYNERGY_STUDIO_HOME") or (pathlib.Path.home() / "Library" / "Application Support" / "SynergyStudioLite"))
    cand = home / "bin" / name
    return str(cand) if cand.exists() else shutil.which(name)


FFMPEG, FFPROBE = tool("ffmpeg"), tool("ffprobe")
needs_ffmpeg = pytest.mark.skipif(not (FFMPEG and FFPROBE), reason="ffmpeg and ffprobe are not available")

# six flat colours that are far apart in Lab
KNOWN = ["#F2EDE0", "#1B2A49", "#D9483B", "#2E9E6B", "#F2B233", "#7A4FB5"]


def blocks_image(colours, w=360, h=240, weights=None):
    """vertical stripes of the given colours (equal width unless weights are given)"""
    weights = weights or [1] * len(colours)
    edges = np.rint(np.cumsum([0] + list(weights)) / sum(weights) * w).astype(int)
    img = np.zeros((h, w, 3), np.uint8)
    for c, a, b in zip(colours, edges[:-1], edges[1:]):
        img[:, a:b] = look.hex_to_rgb(c).astype(np.uint8)
    return img


def save(img, path):
    Image.fromarray(img).save(path)
    return path


def measure(*imgs):
    return look.measure_arrays(list(imgs))


def css_of(ref):
    return look.render_css(ref)[0]


def cli(tmp_path, *files, name="p"):
    proj = tmp_path / name
    proj.mkdir(exist_ok=True)
    r = subprocess.run([sys.executable, str(LOOK_PY), FFMPEG or "ffmpeg", FFPROBE or "ffprobe", str(proj), *map(str, files)], capture_output=True, text=True)
    return proj, r


# ------------------------------------------------------------------ colour maths
def test_contrast_ratio_matches_wcag_reference_values():
    assert look.contrast_ratio("#000000", "#FFFFFF") == pytest.approx(21.0, abs=0.01)
    assert look.contrast_ratio("#777777", "#FFFFFF") == pytest.approx(4.48, abs=0.02)
    assert look.contrast_ratio("#FFFFFF", "#FFFFFF") == pytest.approx(1.0)


def test_lab_round_trip_is_close_to_the_original():
    for h in KNOWN:
        assert look.to_hex(look.lab_to_rgb(look.hex_lab(h))) == h


# ------------------------------------------------------------------ palette
def test_palette_recovers_six_known_colours_within_delta_e_5():
    ref = measure(blocks_image(KNOWN))
    assert len(ref["palette"]) == 6
    for c in KNOWN:
        best = min(look.delta_e(look.hex_lab(c), p["lab"]) for p in ref["palette"])
        assert best <= 5, (c, best)


def test_palette_is_recovered_when_the_areas_are_very_unequal():
    ref = measure(blocks_image(KNOWN, weights=[50, 20, 12, 8, 6, 4]))
    for c in KNOWN:
        assert min(look.delta_e(look.hex_lab(c), p["lab"]) for p in ref["palette"]) <= 5, c
    assert ref["palette"][0]["hex"] == KNOWN[0] and ref["background"]["hex"] == KNOWN[0]     # the largest area is the background
    shares = [p["share"] for p in ref["palette"]]
    assert shares == sorted(shares, reverse=True) and sum(shares) == pytest.approx(1.0, abs=0.01)


def test_two_colour_image_gives_two_palette_entries_and_a_complete_look():
    ref = measure(blocks_image(["#101820", "#F0E6D2"]))
    assert [p["hex"] for p in ref["palette"]] and len(ref["palette"]) == 2
    css = css_of(ref)
    for v in VARS:
        assert re.search(rf"\s{v}:#[0-9A-F]{{6}};", css), v


# ------------------------------------------------------------------ light or dark
def test_light_and_dark_backgrounds_are_told_apart():
    light = blocks_image(["#F4F1EA", "#1E1D1B", "#D9775A"], weights=[70, 20, 10])
    dark = blocks_image(["#07101F", "#EEF4FF", "#35E0C4"], weights=[70, 20, 10])
    assert measure(light)["mode"] == "light" and measure(light)["background"]["lightness"] > 50
    assert measure(dark)["mode"] == "dark" and measure(dark)["background"]["lightness"] < 50


# ------------------------------------------------------------------ grain and edges
def noisy(sigma, seed=1, base=120, size=(288, 384)):
    rng = np.random.default_rng(seed)
    img = np.full(size + (3,), base, np.float64) + rng.normal(0, sigma, size + (1,))
    return np.clip(np.rint(img), 0, 255).astype(np.uint8)


def test_noisy_image_has_more_grain_than_a_clean_one_and_matches_the_noise_sigma():
    clean = measure(noisy(0))["grain"]
    lightly = measure(noisy(1.0))["grain"]
    heavy = measure(noisy(6.0))["grain"]
    assert clean["value"] < lightly["value"] < heavy["value"]
    assert heavy["value"] == pytest.approx(6.0, rel=0.15)              # white noise: the measure is the sigma
    assert clean["present"] is False and heavy["present"] is True
    assert clean["threshold"] == look.GRAIN_PRESENT


def test_grain_is_measured_only_in_flat_regions():
    # a pattern with strong detail at the scale of a block leaves no flat block, so no grain is reported
    stripes = np.tile(np.array([0, 255], np.uint8).repeat(16), 12)[:384]
    img = np.repeat(np.tile(stripes, (288, 1))[:, :, None], 3, axis=2)
    g = measure(img)["grain"]
    assert g["flat_share"] == 0.0 and g["value"] == 0.0 and g["present"] is False


def test_edge_density_orders_a_plain_image_below_a_busy_one():
    plain = blocks_image(["#202020", "#E0E0E0"], weights=[1, 1])
    checker = (np.indices((240, 360)).sum(0) // 6 % 2 * 255).astype(np.uint8)
    busy = np.repeat(checker[:, :, None], 3, axis=2)
    assert measure(plain)["edge_density"] < 0.02 < 0.3 < measure(busy)["edge_density"]


# ------------------------------------------------------------------ contrast and ink
def test_ink_is_adjusted_when_the_palette_gives_less_than_4_5():
    ref = measure(blocks_image(["#8A8A8A", "#7A7A7A", "#9A9A9A"], weights=[60, 20, 20]))
    ink = ref["contrast"]["best_pair"]["ratio"]
    assert ink < look.INK_MIN
    css, v, info = look.render_css(ref)
    assert info["adjusted"] is True and info["ratio"] >= look.INK_MIN and info["measured_ratio"] < look.INK_MIN
    assert look.contrast_ratio(v["--ink"], v["--bg"]) >= look.INK_MIN
    assert "ink adjusted from" in css and "WCAG AA" in css


def test_ink_is_left_alone_when_the_contrast_is_enough():
    ref = measure(blocks_image(["#F4F1EA", "#1E1D1B", "#D9775A", "#3E6FB0"], weights=[60, 20, 10, 10]))
    css, v, info = look.render_css(ref)
    assert info["adjusted"] is False and info["ratio"] >= 4.5
    assert "ink adjusted" not in css


# ------------------------------------------------------------------ look.css
def test_css_defines_every_variable_under_an_id_selector_and_names_no_network():
    for img in (blocks_image(KNOWN), noisy(5)):
        css = css_of(measure(img))
        rule = re.search(r"#root, #root\[data-look\]\{([^}]*)\}", css)
        assert rule, "the variables must sit under #root so they win over looks.css whatever data-look says"
        for v in VARS:
            assert re.search(rf"{v}:#[0-9A-F]{{6}};", rule.group(1)), v
        assert "http:" not in css and "https:" not in css and "@import" not in css


def test_css_follows_the_writing_rules():
    css = css_of(measure(noisy(5)))
    assert not re.search(r"\bv\d\b|\bphase \d", css)
    assert " - " not in css and "—" not in css and "–" not in css


def test_grain_snippet_and_texture_appear_only_when_grain_is_present():
    grainy = css_of(measure(noisy(5)))
    assert ".grain-overlay{" in grainy and "<svg" in grainy and "feTurbulence" in grainy and "sketch kit" in grainy
    clean = css_of(measure(noisy(0)))
    assert ".grain-overlay{" not in clean and "clean" in clean


def test_grain_overlay_is_light_specks_on_dark_and_dark_specks_on_light():
    assert 'values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1' in look.grain_svg(True)
    assert 'values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0' in look.grain_svg(False)


def test_accents_are_the_most_saturated_visible_colours():
    ref = measure(blocks_image(["#0B0B12", "#EDEDED", "#E8402A", "#2A6BE8", "#9A9A9A"], weights=[50, 20, 10, 10, 10]))
    v = look.render_css(ref)[1]
    assert v["--accent"] in ("#E8402A", "#2A6BE8") or min(look.delta_e(look.hex_lab(v["--accent"]), look.hex_lab(c)) for c in ("#E8402A", "#2A6BE8")) < 6


# ------------------------------------------------------------------ black bars
def test_black_bars_in_a_video_are_left_out_of_every_measure():
    body = blocks_image(["#F4F1EA", "#D9775A"], w=320, h=200, weights=[3, 1])
    frames = []
    for i in range(6):
        f = np.zeros((360, 320, 3), np.uint8)
        f[80:280] = body
        f[10:14, 100:220] = 255                                     # a white label inside the top bar does not make the bar count as content
        frames.append(f)
    trimmed, rows, cols = look.trim_bars(frames)
    assert rows == 160 and cols == 0 and trimmed[0].shape[0] == 200
    with_bars = look.measure_arrays(frames)
    without = look.measure_arrays(trimmed)
    assert without["mode"] == "light" and without["background"]["hex"] == "#F4F1EA"
    assert with_bars["mode"] == "dark"                             # without the trim the bars would have decided the look


def test_bars_are_kept_when_they_would_leave_too_little_or_appear_in_few_frames():
    dark_video = [np.zeros((100, 100, 3), np.uint8) for _ in range(5)]
    assert look.trim_bars(dark_video)[1:] == (0, 0)                # nothing would be left: keep it
    mixed = [np.full((100, 100, 3), 200, np.uint8) for _ in range(5)]
    mixed[0][:20] = 0
    assert look.trim_bars(mixed)[1:] == (0, 0)                     # black in one frame only: content, not a bar


# ------------------------------------------------------------------ files and the CLI
def test_cli_is_deterministic_for_images(tmp_path):
    a = save(noisy(4, seed=3), tmp_path / "a.png")
    b = save(blocks_image(KNOWN), tmp_path / "b.png")
    p1, r1 = cli(tmp_path, a, b, name="one")
    p2, r2 = cli(tmp_path, a, b, name="two")
    assert r1.returncode == 0 and r2.returncode == 0, r1.stderr + r2.stderr
    assert (p1 / "look-reference.json").read_bytes() == (p2 / "look-reference.json").read_bytes()
    assert (p1 / "src" / "look.css").read_bytes() == (p2 / "src" / "look.css").read_bytes()


def test_cli_accepts_several_files_and_records_only_file_names(tmp_path):
    a = save(blocks_image(KNOWN[:3]), tmp_path / "a.png")
    b = save(blocks_image(KNOWN[3:]), tmp_path / "b.jpg")
    proj, r = cli(tmp_path, a, b)
    assert r.returncode == 0, r.stderr
    ref = json.loads((proj / "look-reference.json").read_text())
    assert [s["file"] for s in ref["sources"]] == ["a.png", "b.jpg"] and ref["frames"] == 2 and ref["video"] is None
    assert str(tmp_path) not in json.dumps(ref)
    assert set(VARS) <= set(ref["look"])


def test_cli_keeps_an_earlier_look_css(tmp_path):
    a = save(blocks_image(KNOWN), tmp_path / "a.png")
    proj = tmp_path / "p"
    (proj / "src").mkdir(parents=True)
    (proj / "src" / "look.css").write_text("/* hand edited */\n")
    _, r = cli(tmp_path, a)
    assert r.returncode == 0, r.stderr
    assert (proj / "src" / "look.previous.css").read_text() == "/* hand edited */\n"
    assert (proj / "src" / "look.css").read_text().startswith("/* Custom look drafted")


def test_cli_refuses_a_missing_file_and_an_unknown_type(tmp_path):
    proj, r = cli(tmp_path, tmp_path / "nope.png")
    assert r.returncode != 0 and "not found" in r.stderr
    txt = tmp_path / "notes.txt"
    txt.write_text("hello")
    proj, r = cli(tmp_path, txt)
    assert r.returncode != 0 and "images" in r.stderr and not (proj / "src" / "look.css").exists()


# ------------------------------------------------------------------ video
def make_video(tmp_path, name, fps=25, graph=None):
    out = tmp_path / name
    graph = graph or "color=c=0xF4F1EA:s=320x180:d=1.5:r={r}[a];color=c=0x1B2A49:s=320x180:d=1.5:r={r}[b];[a][b]concat=n=2:v=1:a=0"
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=d=0.1", "-filter_complex", graph.format(r=fps),
                    "-pix_fmt", "yuv420p", str(out)], check=True, capture_output=True)
    return out


@needs_ffmpeg
def test_video_numbers_fps_cuts_and_motion(tmp_path):
    v = make_video(tmp_path, "two.mp4", fps=25)
    proj, r = cli(tmp_path, v)
    assert r.returncode == 0, r.stderr
    ref = json.loads((proj / "look-reference.json").read_text())
    vid = ref["video"]
    assert vid["fps"] == pytest.approx(25.0)
    assert vid["files"][0]["cuts"] == 1 and vid["cuts_per_minute"] == pytest.approx(20.0, abs=0.5)      # one cut in 3 s
    assert 0 < vid["motion_energy"] and vid["motion_energy_without_cuts"] == pytest.approx(0.0, abs=0.001)    # only the cut moves
    assert ref["sources"][0]["frames"] == 3                                                            # 1 frame per second of a 3 s video
    for c in ("#F4F1EA", "#1B2A49"):                                                                   # YUV rounding moves a colour by a step or two
        assert min(look.delta_e(look.hex_lab(c), p["lab"]) for p in ref["palette"]) < 3, c


@needs_ffmpeg
def test_a_moving_video_has_more_motion_energy_than_a_still_one(tmp_path):
    still = make_video(tmp_path, "still.mp4", graph="color=c=0x336699:s=320x180:d=3:r={r}")
    moving = make_video(tmp_path, "moving.mp4", graph="testsrc2=s=320x180:d=3:r={r}")
    ref = {}
    for n, v in (("still", still), ("moving", moving)):
        proj, r = cli(tmp_path, v, name=n)
        assert r.returncode == 0, r.stderr
        ref[n] = json.loads((proj / "look-reference.json").read_text())["video"]
    assert ref["still"]["motion_energy"] == 0.0 < ref["moving"]["motion_energy"]
    assert ref["still"]["cuts_per_minute"] == 0.0


@needs_ffmpeg
def test_cli_is_deterministic_for_video(tmp_path):
    v = make_video(tmp_path, "d.mp4", graph="testsrc2=s=320x180:d=3:r={r}")
    p1, r1 = cli(tmp_path, v, name="one")
    p2, r2 = cli(tmp_path, v, name="two")
    assert r1.returncode == 0 and r2.returncode == 0, r1.stderr + r2.stderr
    assert (p1 / "look-reference.json").read_bytes() == (p2 / "look-reference.json").read_bytes()
    assert (p1 / "src" / "look.css").read_bytes() == (p2 / "src" / "look.css").read_bytes()


@needs_ffmpeg
def test_long_video_is_sampled_with_at_most_60_frames(tmp_path):
    v = make_video(tmp_path, "long.mp4", fps=5, graph="testsrc2=s=160x90:d=90:r={r}")
    proj, r = cli(tmp_path, v)
    assert r.returncode == 0, r.stderr
    ref = json.loads((proj / "look-reference.json").read_text())
    assert ref["sources"][0]["frames"] == 60 and ref["frames"] == 60


# ------------------------------------------------------------------ fixes found by verification
def flat_bands(width, cols=("#F2EDE0", "#E9DFCF", "#F0E6D2", "#EADCC5")):
    """noise free hard edged bands of nearly the same lightness"""
    img = np.zeros((288, 384, 3), np.uint8)
    for i in range(0, 384, width):
        img[:, i:i + width] = look.hex_to_rgb(cols[(i // width) % len(cols)]).astype(np.uint8)
    return img


@pytest.mark.parametrize("width", [11, 17, 40])
def test_clean_flat_colour_bands_are_not_grain(width):
    clean = measure(flat_bands(width))["grain"]
    assert clean["value"] < 0.05 and clean["present"] is False
    assert clean["value"] < measure(noisy(4.0))["grain"]["value"]                 # and far below an image with real noise


def test_noise_is_still_measured_after_the_edge_exclusion():
    for sigma in (1.0, 4.0):
        g = measure(noisy(sigma))["grain"]
        assert g["value"] == pytest.approx(sigma, rel=0.15) and g["flat_share"] > 0.9


def test_grain_survives_next_to_an_edge_in_other_blocks():
    img = noisy(4.0).copy()
    img[:, 192:] = 200                                                              # a hard edge through the middle: those blocks are dropped
    g = measure(img)["grain"]
    assert g["value"] == pytest.approx(4.0, rel=0.15) and 0.3 < g["flat_share"] < 1.0


@pytest.mark.parametrize("colours,weights", [
    (["#141026", "#E4E3DB", "#D58167", "#4B3081"], [50, 30, 10, 10]),
    (["#07101F", "#EEF4FF", "#35E0C4"], [70, 20, 10]),
    (["#0B0906", "#F4EDE1", "#C9A45C"], [80, 12, 8]),
    (["#3A3A3A", "#F0F0F0", "#909090"], [60, 20, 20]),
    (["#F4F1EA", "#1E1D1B", "#D9775A"], [70, 20, 10]),
    (["#FFE14D", "#111111", "#FF3D6E"], [70, 20, 10]),
    (["#8A8A8A", "#7A7A7A", "#9A9A9A"], [60, 20, 20]),
])
def test_ink_keeps_4_5_against_the_card_and_muted_keeps_3(colours, weights):
    css, v, info = look.render_css(measure(blocks_image(colours, weights=weights)))
    assert look.contrast_ratio(v["--ink"], v["--bg"]) >= look.INK_MIN
    assert look.contrast_ratio(v["--ink"], v["--card"]) >= look.INK_MIN
    assert look.contrast_ratio(v["--muted"], v["--bg"]) >= 3.0 - 0.02
    assert look.contrast_ratio(v["--muted"], v["--card"]) >= 3.0 - 0.02


def test_card_adjustment_is_explained_in_a_comment():
    # black background, mid grey ink: the ink clears 4.5 on the background but not on the usual lighter card (4.09)
    ref = measure(blocks_image(["#000000", "#5E5E5E", "#D9775A"], weights=[70, 20, 10]))
    css, v, info = look.render_css(ref)
    assert "--card adjusted from #131313 (ink contrast 4.09)" in css and "so the ink on it keeps 4.5" in css
    assert look.contrast_ratio(v["--ink"], v["--card"]) >= look.INK_MIN
