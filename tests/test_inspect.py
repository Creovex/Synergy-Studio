"""inspect_video.py: the picture and the text timeline from a project's reports, without a render."""
import json
import pathlib
import subprocess
import sys

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "skills" / "synergy-studio" / "scripts" / "inspect_video.py"


def _project(tmp_path):
    p = tmp_path / "p"
    (p / "audio").mkdir(parents=True)
    (p / "project.json").write_text(json.dumps({"name": "p", "scenes": [{"id": "s1", "say": "Up at 2 a.m.?"}, {"id": "s2", "say": "Try Orbit."}]}))
    (p / "timing.json").write_text(json.dumps({"T": {"s1": {"start": 0, "vo": 0.3, "vo_end": 2.0, "end": 2.5}, "s2": {"start": 2.5, "vo": 2.7, "vo_end": 3.6, "end": 4.0}}, "CUE": {"slam": 3.0}, "SYNC": ["slam"], "TOTAL": 4.0}))
    lv = [-60.0] * 6 + [-20.0] * 30 + [-60.0] * 44
    (p / "audio" / "layers.json").write_text(json.dumps({"step": 0.05, "voice": lv, "music": [-30.0] * 80, "effects": [-60.0] * 60 + [-10.0] * 4 + [-60.0] * 16, "events": [{"at": 3.0, "name": "pop"}]}))
    (p / "audio" / "mix-report.json").write_text(json.dumps({"voice_db": -20.0, "music_under_db": 10.0, "music_ok": True, "effects": [{"at": 3.0, "name": "pop", "over_voice_db": 10.0, "ok": False}]}))
    (p / "audio" / "voice-report.json").write_text(json.dumps({"s1": {"text": "Up at 2 a.m.?", "spoken": "Up at 2 AM?", "changes": [], "warnings": [], "pauses": [{"at": 1.0, "length": 0.9}],
        "heard_words": [{"text": "Up", "start": 0.1, "end": 0.3}, {"text": "2A,", "start": 0.9, "end": 1.1}, {"text": "M.", "start": 1.2, "end": 1.4}],
        "problems": [{"expected": "am", "heard": "2A, M.", "at": 0.9, "broken": True}]}}))
    env = tmp_path / "env.json"
    env.write_text(json.dumps({"ffmpeg": "ffmpeg"}))
    return p, env


def test_inspect_draws_the_picture_and_prints_the_warnings_in_time(tmp_path):
    p, env = _project(tmp_path)
    r = subprocess.run([sys.executable, str(SCRIPT), str(env), str(p), "0", "4"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert (p / "stills" / "inspect.png").stat().st_size > 10000
    lines = r.stdout.splitlines()
    assert any("1.20 s  WARN s1: voice breaks up" in l for l in lines)
    assert any("1.30 s  WARN s1: pause of 0.9 s" in l for l in lines)
    assert any("3.00 s  WARN effect pop: +10.0 dB" in l for l in lines)
    assert any(l.strip().startswith("heard: Up[0.40] 2A,[1.20] M.[1.50]") for l in lines)
    assert any("3.00 s       cue slam [sync]" in l for l in lines)


def test_inspect_refuses_a_stretch_outside_the_video(tmp_path):
    p, env = _project(tmp_path)
    r = subprocess.run([sys.executable, str(SCRIPT), str(env), str(p), "5", "9"], capture_output=True, text=True)
    assert r.returncode != 0 and "at least 0.5 s inside the video" in r.stderr
