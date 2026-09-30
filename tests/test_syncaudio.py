"""syncaudio.py: the sound in an MP4 against the mix it was made from (lag, correlation, the last 2 s, silent stretches)."""
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys

import numpy as np
import pytest
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "synergy-studio" / "scripts" / "syncaudio.py"
SR = 24000
FPS = 30


def find_ffmpeg() -> str | None:
    home = pathlib.Path.home() / "Library" / "Application Support" / "SynergyStudioLite" / "bin" / "ffmpeg"
    return str(home) if home.exists() else shutil.which("ffmpeg")


FFMPEG = find_ffmpeg()
pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not found")

spec = importlib.util.spec_from_file_location("syncaudio", SCRIPT)
syncaudio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(syncaudio)


def speechlike(seconds: float, seed: int = 1) -> np.ndarray:
    """Noise whose loudness rises and falls in bursts with pauses, like speech over music."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    bursts = np.clip(np.sin(2 * np.pi * (0.7 + 0.3 * rng.random()) * t) + 0.6 * np.sin(2 * np.pi * 1.9 * t + rng.random() * 6), 0, None)
    return (0.3 * bursts * rng.standard_normal(n) + 0.01 * rng.standard_normal(n)).clip(-1, 1)


def wav(path: pathlib.Path, samples: np.ndarray) -> str:
    sf.write(path, samples, SR)
    return str(path)


def analyse(tmp_path: pathlib.Path, video: np.ndarray, mix: np.ndarray, fps: float = FPS) -> dict:
    return syncaudio.analyse(wav(tmp_path / "video.wav", video), wav(tmp_path / "mix.wav", mix), fps, FFMPEG)


def shifted(x: np.ndarray, seconds: float) -> np.ndarray:
    pad = int(seconds * SR)
    return np.concatenate([np.zeros(pad), x])[: x.size]


def test_identical_audio_passes_with_no_lag(tmp_path):
    mix = speechlike(12)
    r = analyse(tmp_path, mix, mix)
    assert r["lag_ms"] == 0 and r["correlation"] > 0.99 and r["pass"] and r["problems"] == []


def test_a_mix_longer_than_the_video_is_compared_over_the_video_only(tmp_path):
    mix = np.concatenate([speechlike(12), np.zeros(SR)])            # trailing second of silence, as audio/mix.wav has
    r = analyse(tmp_path, mix[: 12 * SR], mix)
    assert r["pass"] and r["lag_ms"] == 0


def test_a_level_change_is_not_a_failure(tmp_path):
    mix = speechlike(12)
    r = analyse(tmp_path, mix * 0.5, mix)
    assert r["pass"] and r["gain_db"] == pytest.approx(-6.0, abs=0.3)


def test_three_frames_late_fails_with_the_lag(tmp_path):
    mix = speechlike(12)
    r = analyse(tmp_path, shifted(mix, 0.1), mix)
    assert r["lag_ms"] == 100 and r["lag_frames"] == 3.0 and not r["pass"]
    assert any("late" in p and "one frame" in p for p in r["problems"])


def test_early_sound_gives_a_negative_lag(tmp_path):
    mix = speechlike(12)
    r = analyse(tmp_path, np.concatenate([mix[int(0.1 * SR):], np.zeros(int(0.1 * SR))]), mix)
    assert r["lag_ms"] == -100 and not r["pass"]


def test_a_lag_within_one_frame_passes(tmp_path):
    mix = speechlike(12)
    assert analyse(tmp_path, shifted(mix, 0.02), mix)["pass"]
    assert not analyse(tmp_path, shifted(mix, 0.02), mix, fps=120)["pass"]     # 20 ms is more than a frame at 120 fps


def test_unrelated_audio_fails_on_correlation(tmp_path):
    r = analyse(tmp_path, speechlike(12, seed=7), speechlike(12, seed=3))
    assert r["correlation"] < 0.9 and not r["pass"]


def test_a_cut_off_ending_fails_the_tail_and_lists_the_silence(tmp_path):
    mix = speechlike(12)
    video = mix.copy()
    video[-int(2 * SR):] = 0
    r = analyse(tmp_path, video, mix)
    assert not r["tail"]["pass"] and not r["pass"]
    assert r["silent"] and r["silent"][-1]["end"] >= 11.9
    assert any("last 2 s" in p for p in r["problems"])


def test_only_a_silent_stretch_of_half_a_second_or_more_is_flagged(tmp_path):
    mix = 0.05 * np.random.default_rng(5).standard_normal(12 * SR)   # steady sound everywhere
    short, long_ = mix.copy(), mix.copy()
    short[4 * SR:int(4.4 * SR)] = 0
    long_[4 * SR:int(4.7 * SR)] = 0
    assert analyse(tmp_path, short, mix)["silent"] == []
    found = analyse(tmp_path, long_, mix)["silent"]
    assert len(found) == 1 and found[0]["start"] == pytest.approx(4.0, abs=0.05) and found[0]["end"] == pytest.approx(4.7, abs=0.05)


def test_a_steady_tail_is_judged_by_level(tmp_path):
    body = speechlike(10)
    steady = 0.05 * np.random.default_rng(2).standard_normal(3 * SR)
    mix = np.concatenate([body, steady])
    assert analyse(tmp_path, mix, mix)["tail"]["pass"]
    quiet = mix.copy()
    quiet[-2 * SR:] *= 0.05                                         # 26 dB down: a faded or damaged ending
    assert not analyse(tmp_path, quiet, mix)["tail"]["pass"]


def test_a_video_without_audio_is_an_error(tmp_path):
    silent_video = tmp_path / "v.mp4"
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", str(silent_video)], check=True)
    mix = wav(tmp_path / "mix.wav", speechlike(2))
    r = subprocess.run([sys.executable, str(SCRIPT), str(silent_video), mix, "30", FFMPEG], capture_output=True, text=True)
    assert r.returncode == 1 and ("no audio" in r.stderr.lower() or "could not read" in r.stderr.lower())
    assert "Traceback" not in r.stderr


def test_a_late_audio_start_in_a_real_mp4_shows_as_lag(tmp_path):
    mix = speechlike(6)
    audio = wav(tmp_path / "a.wav", mix)
    late = tmp_path / "late.mp4"
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=6", "-itsoffset", "0.1", "-i", audio,
                    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-c:a", "aac", str(late)], check=True)
    r = subprocess.run([sys.executable, str(SCRIPT), str(late), audio, "30", FFMPEG], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert 60 <= out["lag_ms"] <= 130 and not out["pass"]


def test_the_command_line_prints_json_and_rejects_a_bad_fps(tmp_path):
    mix = wav(tmp_path / "mix.wav", speechlike(6))
    ok = subprocess.run([sys.executable, str(SCRIPT), mix, mix, "30", FFMPEG], capture_output=True, text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout)["pass"] is True
    bad = subprocess.run([sys.executable, str(SCRIPT), mix, mix, "zero", FFMPEG], capture_output=True, text=True)
    assert bad.returncode == 1 and "fps" in bad.stderr


def test_sound_that_stops_before_the_picture_fails_even_when_the_mix_is_short_of_the_tail(tmp_path):
    mix = np.concatenate([speechlike(12), np.zeros(SR)])
    video = mix[: 9 * SR]                                            # the MP4's sound is 9 s, its picture 12 s
    r = syncaudio.analyse(wav(tmp_path / "video.wav", video), wav(tmp_path / "mix.wav", mix), FPS, FFMPEG, 12.0)
    assert not r["pass"] and r["short_s"] == pytest.approx(3.0, abs=0.02)
    assert any("ends 3.00 s before the picture" in p for p in r["problems"])
    assert r["silent"] and not r["tail"]["pass"]


def test_a_sound_a_few_milliseconds_short_of_the_picture_is_not_a_failure(tmp_path):
    mix = np.concatenate([speechlike(12), np.zeros(SR)])
    r = syncaudio.analyse(wav(tmp_path / "video.wav", mix[: int(11.98 * SR)]), wav(tmp_path / "mix.wav", mix), FPS, FFMPEG, 12.0)
    assert r["pass"] and r["short_s"] < 0.05


def test_the_command_line_takes_the_video_duration_and_rejects_a_bad_one(tmp_path):
    mix = wav(tmp_path / "mix.wav", speechlike(6))
    ok = subprocess.run([sys.executable, str(SCRIPT), mix, mix, "30", FFMPEG, "6"], capture_output=True, text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout)["short_s"] == 0
    bad = subprocess.run([sys.executable, str(SCRIPT), mix, mix, "30", FFMPEG, "long"], capture_output=True, text=True)
    assert bad.returncode == 1 and "video_seconds" in bad.stderr and "Traceback" not in bad.stderr
