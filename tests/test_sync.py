"""sync.py (where does the sound of a cue start?) and the bundled starter score (template/score.py)."""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys

import numpy as np
import pytest
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "synergy-studio"
SYNC = SKILL / "scripts" / "sync.py"
SCORE = SKILL / "template" / "score.py"
SR = 16000
FPS = 30

spec = importlib.util.spec_from_file_location("sync", SYNC)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def with_hits(times, seconds=8.0, bed=0.01, hit=0.5, seed=3):
    """A quiet noise bed with a short loud burst starting at each time."""
    rng = np.random.default_rng(seed)
    x = bed * rng.standard_normal(int(seconds * SR))
    for t in times:
        i, n = int(round(t * SR)), int(0.12 * SR)
        ts = np.arange(n) / SR
        x[i:i + n] += hit * np.exp(-ts * 30) * np.sin(2 * np.pi * 700 * ts)
    return x


def test_hit_on_the_cue_reads_as_no_offset():
    rows = sync.onsets(with_hits([3.5, 6.2]), SR, {"bang": 3.5, "boom": 6.2})
    assert [r["name"] for r in rows] == ["bang", "boom"]
    assert all(abs(r["d"]) <= 0.01 for r in rows), rows


@pytest.mark.parametrize("frames", [-3, -2, 2, 3, 4])
def test_a_hit_moved_by_frames_reads_as_that_many_frames(frames):
    rows = sync.onsets(with_hits([4.0 + frames / FPS]), SR, {"x": 4.0})
    assert rows[0]["d"] == pytest.approx(frames / FPS, abs=0.01)
    assert (abs(rows[0]["d"]) <= 1.5 / FPS) == (abs(frames) < 2)   # the checker passes up to 1.5 frames


def test_nearest_onset_wins_over_a_decoy_in_the_window():
    # a lead-in whoosh 0.12 s before the cue and the real hit 0.01 s after it: the hit counts
    rows = sync.onsets(with_hits([3.88, 4.01]), SR, {"x": 4.0})
    assert rows[0]["d"] == pytest.approx(0.01, abs=0.01)


def test_sharp_says_whether_a_sharp_onset_was_found():
    hit = sync.onsets(with_hits([4.0]), SR, {"x": 4.0})[0]
    assert hit["sharp"] is True
    steady = 0.2 * np.sin(2 * np.pi * 220 * np.arange(8 * SR) / SR)         # a bed that never starts anywhere near the cue
    row = sync.onsets(steady, SR, {"x": 4.0})[0]
    assert row["sharp"] is False and row["d"] == pytest.approx(-sync.WINDOW, abs=0.002)   # the window edge: a guess, not a measurement
    swell = np.sin(2 * np.pi * 220 * np.arange(8 * SR) / SR) * np.clip((np.arange(8 * SR) / SR - 3.0) / 3.0, 0, 1) ** 2
    assert sync.onsets(swell, SR, {"x": 4.0})[0]["sharp"] is False          # a slow swell is not an onset
    silent = np.zeros(8 * SR)
    assert sync.onsets(silent, SR, {"x": 4.0})[0] == {"name": "x", "t": 4.0, "onset": None, "d": None, "sharp": False}


def test_no_sound_in_the_window_gives_null():
    x = with_hits([1.0])
    x[int(2.5 * SR):] = 0
    rows = sync.onsets(x, SR, {"x": 5.0})
    assert rows[0]["onset"] is None and rows[0]["d"] is None


def test_a_hit_outside_plus_minus_0_15_s_is_not_found_as_a_hit():
    x = with_hits([4.4], bed=0.0)
    assert sync.onsets(x, SR, {"x": 4.0})[0]["d"] is None


def test_cli_prints_json_rows(tmp_path):
    wav = tmp_path / "m.wav"
    sf.write(wav, with_hits([3.5]), SR)
    r = subprocess.run([sys.executable, str(SYNC), str(wav), json.dumps({"bang": 3.5}), "30"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    row = json.loads(r.stdout)[0]
    assert row["name"] == "bang" and row["t"] == 3.5 and abs(row["d"]) <= 0.01


def test_cli_without_arguments_says_usage():
    r = subprocess.run([sys.executable, str(SYNC)], capture_output=True, text=True)
    assert r.returncode == 1 and "usage: python sync.py" in r.stderr


# ---- the bundled starter score
def project(tmp_path, cues):
    (tmp_path / "project.json").write_text(json.dumps({"name": "t", "mode": "film", "length": 8, "scenes": [{"id": "s1", "start": 0, "end": 8}], "cues": cues}))
    return tmp_path


def run_score(proj, out):
    return subprocess.run([sys.executable, str(SCORE), str(out), "--project", str(proj)], capture_output=True, text=True)


CUES = {"slam": 1.4, "bang": {"t": 3.5, "sync": True}, "boom": {"t": 6.2, "sync": True}}


def test_score_has_a_hit_on_every_cue_within_a_frame(tmp_path):
    out = tmp_path / "score.wav"
    r = run_score(project(tmp_path, CUES), out)
    assert r.returncode == 0, r.stderr
    x, sr = sf.read(out, dtype="float64")
    rows = sync.onsets(x.mean(1), sr, {"slam": 1.4, "bang": 3.5, "boom": 6.2})
    assert all(r["d"] is not None and abs(r["d"]) <= 1 / FPS for r in rows), rows


def test_score_is_deterministic(tmp_path):
    proj = project(tmp_path, CUES)
    digests = []
    for k in range(2):
        out = tmp_path / f"s{k}.wav"
        assert run_score(proj, out).returncode == 0
        digests.append(hashlib.sha256(out.read_bytes()).hexdigest())
    assert digests[0] == digests[1]


def test_score_changes_with_the_cues(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir(); b.mkdir()
    run_score(project(a, {"x": 2.0}), a / "s.wav")
    run_score(project(b, {"x": 2.5}), b / "s.wav")
    assert (a / "s.wav").read_bytes() != (b / "s.wav").read_bytes()


def test_score_run_the_owners_way_reads_the_project_above_its_folder(tmp_path):
    proj = project(tmp_path, CUES)
    (proj / "scripts").mkdir()
    (proj / "scripts" / "score.py").write_text(SCORE.read_text())
    out = tmp_path / "own.wav"
    r = subprocess.run([sys.executable, str(proj / "scripts" / "score.py"), str(out)], capture_output=True, text=True, cwd=tmp_path.parent)
    assert r.returncode == 0, r.stderr
    via_flag = tmp_path / "flag.wav"
    assert run_score(proj, via_flag).returncode == 0
    assert out.read_bytes() == via_flag.read_bytes()


def test_score_without_a_project_json_says_so(tmp_path):
    r = run_score(tmp_path, tmp_path / "s.wav")
    assert r.returncode != 0 and "has no project.json" in r.stderr


# ---- audio.py: the cue sheet becomes timing CUE and SYNC, and cue sfx join the effects
AUDIO = SKILL / "scripts" / "audio.py"


def run_audio(proj, cues):
    (proj / "project.json").write_text(json.dumps({"name": "t", "mode": "film", "music": "none", "length": 8,
                                                   "scenes": [{"id": "s1", "start": 0, "end": 8}], "cues": cues}))
    return subprocess.run([sys.executable, str(AUDIO), str(proj), "ffmpeg"], capture_output=True, text=True)


def test_audio_writes_cue_and_sync_into_timing(tmp_path):
    r = run_audio(tmp_path, {"slam": 1.4, "bang": {"t": 3.5, "sync": True, "sfx": "pop"}, "boom": {"t": 6.2, "sync": False}})
    assert r.returncode == 0, r.stderr
    t = json.loads((tmp_path / "timing.json").read_text())
    assert t["CUE"] == {"slam": 1.4, "bang": 3.5, "boom": 6.2}
    assert t["SYNC"] == ["bang"]
    assert '"CUE": {"slam": 1.4' in (tmp_path / "timing.js").read_text()


def test_audio_cue_sfx_is_in_the_mix_and_a_plain_cue_is_not(tmp_path):
    assert run_audio(tmp_path, {"plain": 2.0, "hit": {"t": 5.0, "sfx": "pop"}}).returncode == 0
    x, sr = sf.read(tmp_path / "audio" / "mix_raw.wav", dtype="float64")
    x = x.mean(1)
    rows = sync.onsets(x, sr, {"plain": 2.0, "hit": 5.0})
    assert rows[0]["onset"] is None
    assert abs(rows[1]["d"]) <= 0.01


def test_audio_without_cues_has_empty_cue_and_sync(tmp_path):
    assert run_audio(tmp_path, {}).returncode == 0
    t = json.loads((tmp_path / "timing.json").read_text())
    assert t["CUE"] == {} and t["SYNC"] == []


@pytest.mark.parametrize("cues,message", [
    ({"far": 99}, 'cue "far" at 99.0 s is outside the video'),
    ({"neg": -1}, 'cue "neg" at -1.0 s is outside the video'),
    ({"boom": {"t": 1, "sfx": "boom"}}, 'cue "boom": unknown sfx "boom". Use one of pop, click, whoosh'),
    ({"s": {"t": 1, "sync": "yes"}}, 'cue "s": "sync" must be true or false, not "yes"'),
    ({"flag": True}, 'cue "flag" needs a time in seconds'),
    ({"word": "soon"}, 'cue "word" needs a time in seconds'),
    ({"no_time": {"sync": True}}, 'cue "no_time" needs a time in seconds'),
    ([1, 2], '"cues" in project.json must be an object'),
])
def test_audio_refuses_a_bad_cue_with_its_name(tmp_path, cues, message):
    r = run_audio(tmp_path, cues)
    assert r.returncode != 0 and message in r.stderr


def test_audio_allows_a_cue_on_the_very_end_and_every_built_in_sfx(tmp_path):
    r = run_audio(tmp_path, {"end": 8, "a": {"t": 1, "sfx": "pop"}, "b": {"t": 2, "sfx": "click"}, "c": {"t": 3, "sfx": "whoosh"}, "d": {"t": 4, "sfx": ""}})
    assert r.returncode == 0, r.stderr
    assert json.loads((tmp_path / "timing.json").read_text())["CUE"]["end"] == 8.0
