"""voice.py with a stand-in Kokoro (a module on PYTHONPATH that records what it is asked and returns a padded tone)."""
import json, os, subprocess, sys, pathlib
import numpy as np, soundfile as sf
import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
VOICE_PY = ROOT / "skills" / "synergy-studio" / "scripts" / "voice.py"
TEN = ["af_heart", "af_bella", "af_nova", "af_sky", "am_michael", "am_adam", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]
SR = 24000

STUB = '''
import json, os
import numpy as np

def _log(row):
    with open(os.environ["STUB_LOG"], "a") as f:
        f.write(json.dumps(row) + "\\n")

class Kokoro:
    def __init__(self, model, voices):
        _log({"load": model})
    def create(self, text, voice, speed, lang):
        _log({"text": text, "voice": voice, "speed": speed, "lang": lang})
        n = int(24000 * 0.3 * max(1, len(text.split())))
        tone = 0.3 * np.sin(2 * np.pi * 220 * np.arange(n) / 24000)
        pad = np.zeros(12000)                               # half a second of silence each side
        return np.concatenate([pad, tone, pad]).astype("float32"), 24000
'''


def make(tmp_path, cfg):
    stub = tmp_path / "stub"; stub.mkdir(exist_ok=True)
    (stub / "kokoro_onnx.py").write_text(STUB)
    proj = tmp_path / "proj"; proj.mkdir(exist_ok=True)
    (proj / "project.json").write_text(json.dumps(cfg))
    envf = tmp_path / "env.json"
    envf.write_text(json.dumps({"kokoro_model": "/nonexistent/model.onnx", "kokoro_voices": "/nonexistent/voices.bin"}))
    return proj, envf, stub


def run_voice(tmp_path, cfg, only=""):
    proj, envf, stub = make(tmp_path, cfg)
    log = tmp_path / "stub.log"; log.write_text("")
    r = subprocess.run([sys.executable, str(VOICE_PY), str(envf), str(proj), only], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": str(stub), "STUB_LOG": str(log)})
    rows = [json.loads(x) for x in log.read_text().splitlines() if x]
    return r, proj, rows


def calls(rows):
    return [x for x in rows if "text" in x]


def test_writes_one_trimmed_wav_per_scene_and_durations(tmp_path):
    r, proj, rows = run_voice(tmp_path, {"voice": "af_heart", "scenes": [{"id": "s1", "say": "one two three"}, {"id": "s2", "say": "four five"}]})
    assert r.returncode == 0, r.stderr
    d = json.loads((proj / "durations.json").read_text())
    tone1 = 3 * 0.3
    # silence is cut to 600 samples before and 2400 after the tone: (600 + 2400) / 24000 = 0.125 s of padding
    assert d["s1"] == pytest.approx(tone1 + 0.125, abs=0.01)
    a, sr = sf.read(proj / "audio" / "vo" / "s1.wav")
    assert sr == SR and a.ndim == 1 and len(a) / sr == pytest.approx(d["s1"], abs=0.001)
    assert "total narration" in r.stdout


def test_reports_words_per_second_and_flags_rushed(tmp_path):
    r, _, _ = run_voice(tmp_path, {"scenes": [{"id": "s1", "say": "a b c d e f g h i j"}]})   # 0.3 s per word stub: 3.3 words/s
    assert "10 words" in r.stdout and "words/s" in r.stdout and "rushed" not in r.stdout
    r2, _, _ = run_voice(tmp_path, {"scenes": [{"id": "s1", "say": "a b c d e f g h i j"}], "speed": 1.0})
    assert r2.returncode == 0


def test_british_voice_speaks_en_gb_and_us_voice_en_us(tmp_path):
    r, _, rows = run_voice(tmp_path, {"voice": "bf_emma", "scenes": [{"id": "s1", "say": "hello there"}]})
    assert r.returncode == 0 and "language en-gb" in r.stdout
    assert calls(rows)[0]["lang"] == "en-gb" and calls(rows)[0]["voice"] == "bf_emma"
    r, _, rows = run_voice(tmp_path, {"voice": "am_adam", "scenes": [{"id": "s1", "say": "hello there"}]})
    assert "language en-us" in r.stdout and calls(rows)[0]["lang"] == "en-us"


def test_scene_voice_and_speed_override_the_project(tmp_path):
    cfg = {"voice": "af_heart", "speed": 0.95, "scenes": [{"id": "s1", "say": "plain"}, {"id": "s2", "say": "fancy", "voice": "bm_george", "speed": 1.1}]}
    r, _, rows = run_voice(tmp_path, cfg)
    c = calls(rows)
    assert (c[0]["voice"], c[0]["speed"], c[0]["lang"]) == ("af_heart", 0.95, "en-us")
    assert (c[1]["voice"], c[1]["speed"], c[1]["lang"]) == ("bm_george", 1.1, "en-gb")
    assert "[voice bm_george, en-gb]" in r.stdout


def test_lexicon_changes_the_spoken_text_only(tmp_path):
    cfg = {"lexicon": {"HAURA": "Hora", "Scent": "Sent"}, "scenes": [{"id": "s1", "say": "HAURA Scent is here. HAURAS stays."}]}
    r, proj, rows = run_voice(tmp_path, cfg)
    assert calls(rows)[0]["text"] == "Hora Sent is here. HAURAS stays."     # whole words only
    assert json.loads((proj / "project.json").read_text())["scenes"][0]["say"] == "HAURA Scent is here. HAURAS stays."


def test_silent_scene_is_zero_and_its_old_wav_removed(tmp_path):
    proj, envf, stub = make(tmp_path, {"scenes": [{"id": "s1", "say": ""}, {"id": "s2", "say": "words here"}]})
    (proj / "audio" / "vo").mkdir(parents=True); (proj / "audio" / "vo" / "s1.wav").write_bytes(b"old")
    log = tmp_path / "l.log"
    r = subprocess.run([sys.executable, str(VOICE_PY), str(envf), str(proj), ""], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": str(stub), "STUB_LOG": str(log)})
    assert r.returncode == 0, r.stderr
    assert json.loads((proj / "durations.json").read_text())["s1"] == 0.0 and not (proj / "audio" / "vo" / "s1.wav").exists()


def test_only_keeps_other_durations(tmp_path):
    cfg = {"scenes": [{"id": "s1", "say": "one"}, {"id": "s2", "say": "two words"}]}
    run_voice(tmp_path, cfg)
    before = json.loads((tmp_path / "proj" / "durations.json").read_text())
    cfg["scenes"][1]["say"] = "now it has four words"
    r, proj, rows = run_voice(tmp_path, cfg, only="s2")
    after = json.loads((proj / "durations.json").read_text())
    assert [c["text"] for c in calls(rows)] == ["now it has four words"]
    assert after["s1"] == before["s1"] and after["s2"] != before["s2"]


@pytest.mark.parametrize("cfg, where", [
    ({"voice": "nobody", "scenes": [{"id": "s1", "say": "hi"}]}, "project voice"),
    ({"voice": "af_heart", "scenes": [{"id": "s1", "say": "hi"}, {"id": "s2", "say": "hi", "voice": "am_bogus"}]}, "scene s2"),
    ({"voice": "bf_emmaa", "scenes": [{"id": "s1", "say": "hi"}]}, "project voice"),
])
def test_unknown_voice_is_refused_before_the_model_loads(tmp_path, cfg, where):
    r, proj, rows = run_voice(tmp_path, cfg)
    assert r.returncode == 1
    assert where in r.stderr and all(v in r.stderr for v in TEN)
    assert rows == []                                                 # Kokoro was never constructed
    assert not (proj / "durations.json").exists()


def test_all_ten_voices_are_accepted(tmp_path):
    for v in TEN:
        r, _, rows = run_voice(tmp_path, {"voice": v, "scenes": [{"id": "s1", "say": "ok"}]})
        assert r.returncode == 0, (v, r.stderr)
        assert calls(rows)[0]["lang"] == ("en-gb" if v[0] == "b" else "en-us")


# ---------------------------------------------------------------- plain messages for bad input
def test_invalid_json_names_the_file_and_position(tmp_path):
    proj, envf, stub = make(tmp_path, {})
    (proj / "project.json").write_text('{"voice": "af_heart",, "scenes": []}')
    r = subprocess.run([sys.executable, str(VOICE_PY), str(envf), str(proj), ""], capture_output=True, text=True)
    assert r.returncode == 1 and r.stderr.startswith("ERROR: ") and "project.json is not valid JSON" in r.stderr and "line 1 column" in r.stderr
    assert "Traceback" not in r.stderr and len(r.stderr.strip().splitlines()) == 1


@pytest.mark.parametrize("speed", [0.4, 2.5, "fast"])
def test_speed_outside_kokoro_range_is_refused(tmp_path, speed):
    r, _, rows = run_voice(tmp_path, {"speed": speed, "scenes": [{"id": "s1", "say": "hi"}]})
    assert r.returncode == 1 and "ERROR: speed" in r.stderr and "(project)" in r.stderr and "0.5 to 2.0" in r.stderr and "Traceback" not in r.stderr
    assert rows == []


def test_scene_speed_outside_range_names_the_scene(tmp_path):
    r, _, rows = run_voice(tmp_path, {"scenes": [{"id": "s1", "say": "hi"}, {"id": "s2", "say": "hi", "speed": 3}]})
    assert r.returncode == 1 and "(scene s2)" in r.stderr and rows == []


def test_speed_outside_natural_range_only_warns(tmp_path):
    r, _, rows = run_voice(tmp_path, {"speed": 0.6, "scenes": [{"id": "s1", "say": "hi", "speed": 1.5}]})
    assert r.returncode == 0 and r.stdout.count("WARNING: speed") == 2 and "(project)" in r.stdout and "(scene s1)" in r.stdout
    assert calls(rows)[0]["speed"] == 1.5
    r, _, _ = run_voice(tmp_path, {"speed": 0.9, "scenes": [{"id": "s1", "say": "hi"}]})
    assert "WARNING" not in r.stdout


@pytest.mark.parametrize("ids, word", [(["s1", "s1"], "used twice"), (["s1", "intro"], "'intro'"), (["s1", "S2"], "'S2'"), (["s1", "s"], "'s'")])
def test_scene_ids_must_match_and_be_unique(tmp_path, ids, word):
    r, _, rows = run_voice(tmp_path, {"scenes": [{"id": i, "say": "hi"} for i in ids]})
    assert r.returncode == 1 and r.stderr.startswith("ERROR: scene id") and word in r.stderr and rows == []
