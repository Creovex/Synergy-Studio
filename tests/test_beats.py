"""beats.py on generated click tracks: the tempo must come out within 1 BPM, and never as half the tempo."""
import json, subprocess, sys, pathlib
import numpy as np, soundfile as sf
import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
BEATS_PY = ROOT / "skills" / "synergy-studio" / "scripts" / "beats.py"
SR = 22050


def click_track(path, bpm, seconds=20.0, offset=0.37, accent=True):
    """a kick-like thump on every beat (louder on every fourth), a hat between the beats"""
    x = np.zeros(int(seconds * SR), np.float32)
    per = 60.0 / bpm
    for b in range(int((seconds - offset) / per)):
        i = int((offset + b * per) * SR); L = int(0.09 * SR)
        ts = np.arange(L) / SR
        amp = 1.0 if (not accent or b % 4 == 0) else 0.7
        x[i:i + L] += (amp * np.exp(-ts * 40) * np.sin(2 * np.pi * (140 - 600 * ts) * ts)).astype(np.float32)[: len(x) - i]
        j = int((offset + (b + 0.5) * per) * SR); H = int(0.02 * SR)
        if j + H < len(x):
            x[j:j + H] += (0.15 * np.exp(-np.arange(H) / SR * 300) * np.sin(2 * np.pi * 5000 * np.arange(H) / SR)).astype(np.float32)
    sf.write(path, x, SR)


def run_beats(tmp_path, bpm, **kw):
    song = tmp_path / f"click{bpm}.wav"; click_track(song, bpm, **kw)
    r = subprocess.run([sys.executable, str(BEATS_PY), "ffmpeg", str(tmp_path), str(song), ""], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads((tmp_path / "beats.json").read_text())


@pytest.mark.parametrize("bpm", [96, 150])
def test_tempo_within_one_bpm(tmp_path, bpm):
    out = run_beats(tmp_path, bpm)
    assert abs(out["bpm"] - bpm) <= 1, out["bpm"]


def test_slow_track_is_not_read_as_half_tempo(tmp_path):
    out = run_beats(tmp_path, 96)
    assert abs(out["bpm"] - 48) > 10          # falsifier: 48 BPM would fit the 96 track too, but it is below the 70 to 180 range


def test_beat_times_follow_the_grid(tmp_path):
    out = run_beats(tmp_path, 96, accent=False)      # (with an accented pattern plus off beat hats the phase can lock half a beat late: tempo stays right)
    gaps = np.diff(out["beats"])
    assert np.allclose(gaps, 60 / 96, atol=0.02)
    assert out["beats"][0] < 60 / 96 + 0.01
    assert out["downbeats"] == out["beats"][out["beats"].index(out["downbeats"][0])::4]
    # a beat lands close to a real click (clicks are at 0.37 + n * 0.625 s)
    off = (out["beats"][3] - 0.37) % (60 / 96)
    assert min(off, 60 / 96 - off) < 0.05


def test_start_shifts_the_time_origin(tmp_path):
    song = tmp_path / "s.wav"; click_track(song, 120, seconds=20)
    r = subprocess.run([sys.executable, str(BEATS_PY), "ffmpeg", str(tmp_path), str(song), "5"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    out = json.loads((tmp_path / "beats.json").read_text())
    assert out["start"] == 5.0 and abs(out["bpm"] - 120) <= 1


def test_missing_song_is_a_plain_error(tmp_path):
    r = subprocess.run([sys.executable, str(BEATS_PY), "ffmpeg", str(tmp_path), str(tmp_path / "nope.wav"), ""], capture_output=True, text=True)
    assert r.returncode != 0 and "song not found" in r.stderr
