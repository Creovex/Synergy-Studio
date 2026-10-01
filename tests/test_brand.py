"""brand_coverage.py: the share of an image in the brand's hue, the verdict and the exit code."""
import os, pathlib, re, shutil, subprocess, sys
import numpy as np
import pytest
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "synergy-studio" / "scripts" / "brand_coverage.py"
BLUE = "#2A67B7"
TERRACOTTA = "#E07A5F"
CREAM = "#FDFAF4"
GREY = "#808080"


def ffmpeg_path():
    """ffmpeg from the tool home, else from PATH, else None (every test needs it, so they are skipped)"""
    home = pathlib.Path(os.environ.get("SYNERGY_STUDIO_HOME") or (pathlib.Path.home() / "Library" / "Application Support" / "SynergyStudioLite"))
    cand = home / "bin" / "ffmpeg"
    return str(cand) if cand.exists() else shutil.which("ffmpeg")


FFMPEG = ffmpeg_path()
pytestmark = pytest.mark.skipif(not FFMPEG, reason="ffmpeg is not available")


def rgb(hex_colour):
    h = hex_colour.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def stripes(tmp_path, name, blue_columns, other=TERRACOTTA, width=480, height=480, ext="png"):
    """an image `width` wide whose first `blue_columns` columns are the brand blue and the rest another colour"""
    img = np.zeros((height, width, 3), np.uint8)
    img[:, :] = rgb(other)
    img[:, :blue_columns] = rgb(BLUE)
    path = tmp_path / f"{name}.{ext}"
    Image.fromarray(img).save(path)
    return path


def solid(tmp_path, name, colour, size=(480, 480)):
    path = tmp_path / f"{name}.png"
    Image.new("RGB", size, colour).save(path)
    return path


def measure(image, *brands, extra=()):
    args = [sys.executable, str(SCRIPT), str(image), "--ffmpeg", FFMPEG, *extra]
    for b in brands:
        args += ["--brand", b]
    r = subprocess.run(args, capture_output=True, text=True)
    m = re.search(r"^VERDICT: (\w+)", r.stdout, re.M)
    return r.returncode, (m.group(1) if m else None), r.stdout, r.stderr


def share(stdout, brand=BLUE):
    m = re.search(rf"brand {brand} \(hue \d+°, ±\d+°\):\s+([\d.]+)%", stdout)
    assert m, stdout
    return float(m.group(1))


def test_an_image_in_blues_is_flooded_and_exits_2(tmp_path):
    code, verdict, out, _ = measure(solid(tmp_path, "blue", BLUE), BLUE)
    assert (code, verdict) == (2, "FLOODED")
    assert share(out) == pytest.approx(100.0)


def test_a_warm_image_with_a_small_blue_accent_is_accent_and_exits_0(tmp_path):
    code, verdict, out, _ = measure(stripes(tmp_path, "warm", 24), BLUE)   # 5% of the columns
    assert (code, verdict) == (0, "ACCENT")
    assert share(out) == pytest.approx(5.0, abs=0.1)
    assert "the brand colour is an accent" in out


def test_shades_of_the_same_hue_all_count(tmp_path):
    img = np.zeros((480, 480, 3), np.uint8)
    for i, c in enumerate(["#3A78C9", "#2A67B7", "#1F5098", "#2458A6"]):
        img[:, i * 120:(i + 1) * 120] = rgb(c)
    path = tmp_path / "shades.png"
    Image.fromarray(img).save(path)
    code, verdict, out, _ = measure(path, BLUE)
    assert (code, verdict) == (2, "FLOODED")
    assert share(out) == pytest.approx(100.0)


@pytest.mark.parametrize("columns,verdict,code", [
    (67, "ACCENT", 0),      # 13.96%
    (77, "HEAVY", 0),       # 16.04%
    (163, "HEAVY", 0),      # 33.96%
    (173, "FLOODED", 2),    # 36.04%
])
def test_the_thresholds_are_15_and_35_percent(tmp_path, columns, verdict, code):
    got_code, got_verdict, out, _ = measure(stripes(tmp_path, f"s{columns}", columns), BLUE)
    assert (got_code, got_verdict) == (code, verdict), out
    assert share(out) == pytest.approx(100 * columns / 480, abs=0.1)


def test_heavy_says_it_is_fine_for_an_end_card(tmp_path):
    _, verdict, out, _ = measure(stripes(tmp_path, "heavy", 120), BLUE)
    assert verdict == "HEAVY"
    assert "end card" in out


def test_a_grey_image_counts_as_neutral_and_is_accent(tmp_path):
    code, verdict, out, _ = measure(solid(tmp_path, "grey", GREY), BLUE)
    assert (code, verdict) == (0, "ACCENT")
    assert "neutral (little colour):" in out and "100.0%" in out
    assert share(out) == 0.0


def test_a_pale_tint_is_not_measured_as_a_hue(tmp_path):
    code, verdict, out, _ = measure(solid(tmp_path, "tint", "#E8EFF8"), "#E8EFF8")
    assert "not measured as a hue" in out
    assert (code, verdict) == (0, "ACCENT")


def test_the_worst_brand_colour_decides(tmp_path):
    # left half brand blue, right half terracotta: blue is 50%, terracotta is 50%; a third colour is at 0%
    path = stripes(tmp_path, "half", 240)
    code, verdict, out, _ = measure(path, BLUE, "#2E9E6B")
    assert (code, verdict) == (2, "FLOODED")
    assert share(out, "#2E9E6B") == 0.0
    code, verdict, out, _ = measure(path, "#2E9E6B")
    assert (code, verdict) == (0, "ACCENT")


def test_a_hue_outside_the_tolerance_is_not_counted_until_the_tolerance_grows(tmp_path):
    violet = solid(tmp_path, "violet", "#4B3FD0")     # hue about 245, 31 degrees from the blue's 214
    assert measure(violet, BLUE)[:2] == (0, "ACCENT")
    assert measure(violet, BLUE, extra=["--tol", "40"])[:2] == (2, "FLOODED")


def test_a_frame_with_fewer_than_three_hues_is_called_monotone(tmp_path):
    _, _, out, _ = measure(solid(tmp_path, "one", TERRACOTTA), BLUE)
    assert "fewer than 3" in out
    three = tmp_path / "three.png"
    img = np.zeros((480, 480, 3), np.uint8)
    for i, c in enumerate(["#E07A5F", "#F2C14E", "#8FC0A9"]):
        img[:, i * 160:(i + 1) * 160] = rgb(c)
    Image.fromarray(img).save(three)
    _, _, out, _ = measure(three, BLUE)
    assert "hues over 3% of the image: 3" in out and "fewer than 3" not in out


def test_a_jpeg_and_a_full_size_portrait_frame_are_read(tmp_path):
    big = tmp_path / "frame.jpg"
    Image.new("RGB", (1080, 1920), BLUE).save(big, quality=95)
    code, verdict, out, _ = measure(big, BLUE)
    assert (code, verdict) == (2, "FLOODED")
    assert "409920 pixels sampled" in out              # 480 x 854, scaled down before counting


def test_a_missing_or_broken_image_is_one_plain_line(tmp_path):
    for path in (tmp_path / "nope.png", tmp_path / "broken.png"):
        if path.name == "broken.png":
            path.write_bytes(b"not a picture")
        code, verdict, out, err = measure(path, BLUE)
        assert code == 1 and verdict is None
        assert err.strip() == f"{path} is not a picture ffmpeg can read"      # one line, no ffmpeg output
        assert "Error opening" not in err and "Traceback" not in err


def test_fully_transparent_pixels_count_for_nothing(tmp_path):
    img = np.zeros((480, 480, 4), np.uint8)
    img[:, :] = rgb(BLUE) + [0]                                 # blue colour data under alpha 0
    path = tmp_path / "ghost.png"
    Image.fromarray(img, "RGBA").save(path)
    code, verdict, out, _ = measure(path, BLUE)
    assert (code, verdict) == (0, "ACCENT")
    assert share(out) == 0.0
    assert "transparent (not counted): 100.0%" in out


def test_opaque_blue_still_counts_beside_transparent_pixels(tmp_path):
    img = np.zeros((480, 480, 4), np.uint8)
    img[:, :] = rgb(TERRACOTTA) + [255]
    img[:200] = rgb(BLUE) + [255]                               # 200 of 480 rows, opaque blue: 41.7%
    img[400:] = rgb(BLUE) + [0]                                 # the last 80 rows are transparent
    path = tmp_path / "mixed.png"
    Image.fromarray(img, "RGBA").save(path)
    code, verdict, out, _ = measure(path, BLUE)
    assert (code, verdict) == (2, "FLOODED")
    assert share(out) == pytest.approx(100 * 200 / 480, abs=0.1)
    assert "transparent (not counted):  16.7%" in out


def test_an_opaque_picture_has_no_transparent_line(tmp_path):
    _, _, out, _ = measure(solid(tmp_path, "plain", BLUE), BLUE)
    assert "transparent" not in out


def test_the_brand_colour_is_required():
    r = subprocess.run([sys.executable, str(SCRIPT), "x.png"], capture_output=True, text=True)
    assert r.returncode != 0 and "--brand" in r.stderr


def test_the_same_image_gives_the_same_words_twice(tmp_path):
    path = stripes(tmp_path, "twice", 100)
    first, second = measure(path, BLUE), measure(path, BLUE)
    assert first == second


def test_the_flooded_message_points_to_the_reference(tmp_path):
    _, _, out, _ = measure(solid(tmp_path, "blue", BLUE), BLUE)
    assert "references/brand-colours.md" in out
