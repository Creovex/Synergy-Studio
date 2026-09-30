"""audio.py: scene timing, defaults by aspect, footage and film timing, seeded mix, ducking, effects."""
import json, subprocess, sys, pathlib
import numpy as np, soundfile as sf
import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
AUDIO_PY = ROOT / "skills" / "synergy-studio" / "scripts" / "audio.py"
SR = 24000


def make(tmp_path, cfg, durations=None, name="p", vo=None):
    proj = tmp_path / name; (proj / "audio" / "vo").mkdir(parents=True)
    (proj / "project.json").write_text(json.dumps(cfg))
    if durations is not None: (proj / "durations.json").write_text(json.dumps(durations))
    for sid, arr in (vo or {}).items(): sf.write(proj / "audio" / "vo" / f"{sid}.wav", arr, SR)
    return proj


def run_audio(proj, check=True):
    r = subprocess.run([sys.executable, str(AUDIO_PY), str(proj), "ffmpeg"], capture_output=True, text=True)
    if check: assert r.returncode == 0, r.stderr
    return r


def timing(proj):
    return json.loads((proj / "timing.json").read_text())


def scenes(n, **each):
    return [{"id": f"s{i + 1}", **each} for i in range(n)]


# ---------------------------------------------------------------- narrated arithmetic
def test_narrated_timing_with_every_pause_given(tmp_path):
    cfg = {"music": "none", "transition_whoosh": False, "lead": 1.0, "pre": 0.5, "post": 1.0, "tail": 2.0, "scenes": scenes(3)}
    proj = make(tmp_path, cfg, {"s1": 3.0, "s2": 2.0, "s3": 4.0})
    run_audio(proj)
    T = timing(proj)["T"]
    assert T["s1"] == {"start": 0, "vo": 1.0, "vo_end": 4.0, "end": 5.0, "dur": 5.0}          # lead, narration, post
    assert T["s2"] == {"start": 5.0, "vo": 5.5, "vo_end": 7.5, "end": 8.5, "dur": 3.5}        # pre, narration, post
    assert T["s3"] == {"start": 8.5, "vo": 9.0, "vo_end": 13.0, "end": 16.0, "dur": 7.5}      # last scene adds tail
    assert timing(proj)["TOTAL"] == 16.0
    assert (proj / "timing.js").read_text() == "window.TIMING = " + json.dumps(timing(proj)) + ";\n"


def test_per_scene_pre_post_and_hold_override(tmp_path):
    cfg = {"music": "none", "transition_whoosh": False, "lead": 1.0, "pre": 0.5, "post": 1.0, "tail": 2.0,
           "scenes": [{"id": "s1"}, {"id": "s2", "pre": 0.2, "post": 0.3}, {"id": "s3", "hold": 3.0}, {"id": "s4", "pre": 0.0, "post": 0.0}]}
    proj = make(tmp_path, cfg, {"s1": 1.0, "s2": 1.0, "s3": 0.0, "s4": 2.0})
    run_audio(proj)
    T = timing(proj)["T"]
    assert (T["s1"]["end"]) == 3.0                                           # lead 1 + 1 s narration + post 1
    assert (T["s2"]["vo"], T["s2"]["end"]) == (3.2, 4.5)                    # start 3.0 + pre 0.2; 4.2 + post 0.3
    assert (T["s3"]["vo"], T["s3"]["vo_end"], T["s3"]["end"]) == (5.0, 5.0, 9.0)   # silent scene: pre 0.5 + hold 3 + post 1
    assert (T["s4"]["vo"], T["s4"]["end"]) == (9.0, 13.0)                   # pre 0, 2 s narration, post 0, tail 2
    assert timing(proj)["TOTAL"] == 13.0


@pytest.mark.parametrize("aspect, expect", [
    ("9:16", (0.4, 0.3, 0.7, 2.0)), ("16:9", (0.9, 0.6, 1.2, 2.5)), ("1:1", (0.9, 0.6, 1.2, 2.5)),
    ("4:5", (0.9, 0.6, 1.2, 2.5)), (None, (0.9, 0.6, 1.2, 2.5)),
])
def test_omitted_pauses_use_the_aspect_defaults(tmp_path, aspect, expect):
    lead, pre, post, tail = expect
    cfg = {"music": "none", "scenes": scenes(2)}
    if aspect: cfg["aspect"] = aspect
    proj = make(tmp_path, cfg, {"s1": 2.0, "s2": 3.0})
    run_audio(proj)
    T = timing(proj)["T"]
    assert T["s1"]["vo"] == pytest.approx(lead)
    assert T["s1"]["end"] == pytest.approx(lead + 2.0 + post)
    assert T["s2"]["vo"] == pytest.approx(lead + 2.0 + post + pre)
    assert timing(proj)["TOTAL"] == pytest.approx(lead + 2.0 + post + pre + 3.0 + post + tail, abs=0.002)


def test_a_pause_given_in_the_project_wins_over_the_default(tmp_path):
    proj = make(tmp_path, {"aspect": "9:16", "music": "none", "post": 1.5, "scenes": scenes(1)}, {"s1": 2.0})
    run_audio(proj)
    assert timing(proj)["T"]["s1"]["end"] == pytest.approx(0.4 + 2.0 + 1.5 + 2.0)      # lead and tail from the 9:16 defaults


def test_missing_narration_asks_for_voice(tmp_path):
    proj = make(tmp_path, {"music": "none", "scenes": scenes(2)}, {"s1": 1.0})
    r = run_audio(proj, check=False)
    assert r.returncode != 0 and "no narration for s2" in r.stderr and "studio voice" in r.stderr


def test_timing_carries_platform_and_safe_area(tmp_path):
    proj = make(tmp_path, {"aspect": "9:16", "platform": "tiktok", "fps": 24, "music": "none", "scenes": scenes(1)}, {"s1": 1.0})
    run_audio(proj)
    t = timing(proj)
    assert (t["fps"], t["aspect"], t["platform"], t["safe"]) == (24, "9:16", "tiktok", [200, 400, 60, 180])
    assert set(t) == {"T", "EV", "TOTAL", "fps", "aspect", "platform", "safe"}


# ---------------------------------------------------------------- footage and film
def test_footage_timing_comes_from_the_scene_ranges(tmp_path):
    cfg = {"mode": "footage", "voice_track": False, "music": "none", "scenes": [{"id": "s1", "start": 0, "end": 4.5}, {"id": "s2", "start": 4.5, "end": 9.25}]}
    proj = make(tmp_path, cfg)
    run_audio(proj)
    T = timing(proj)
    assert T["T"]["s2"] == {"start": 4.5, "vo": 4.5, "vo_end": 9.25, "end": 9.25, "dur": 4.75}
    assert T["TOTAL"] == 9.25


def test_footage_mode_places_the_cut_voice_track(tmp_path):
    cfg = {"mode": "footage", "music": "none", "transition_whoosh": False, "scenes": [{"id": "s1", "start": 0, "end": 3}]}
    proj = make(tmp_path, cfg)
    sf.write(proj / "audio" / "voice.wav", (0.2 * np.sin(2 * np.pi * 300 * np.arange(SR * 2) / SR)).astype("float32"), SR)
    run_audio(proj)
    mix, sr = sf.read(proj / "audio" / "mix_raw.wav")
    assert sr == SR and abs(mix[: SR * 2, 0]).max() > 0.15 and abs(mix[int(2.2 * SR):, 0]).max() < 1e-3


def test_film_mode_has_no_voice_and_no_automatic_whoosh(tmp_path):
    cfg = {"mode": "film", "music": "none", "scenes": [{"id": "s1", "start": 0, "end": 3}, {"id": "s2", "start": 3, "end": 6}]}
    proj = make(tmp_path, cfg)
    run_audio(proj)                                            # no voice.wav needed
    mix, _ = sf.read(proj / "audio" / "mix_raw.wav")
    assert timing(proj)["TOTAL"] == 6.0 and abs(mix).max() == 0.0


def test_footage_scene_without_range_is_refused(tmp_path):
    proj = make(tmp_path, {"mode": "footage", "voice_track": False, "scenes": [{"id": "s1", "start": 0}]})
    r = run_audio(proj, check=False)
    assert r.returncode != 0 and "s1" in r.stderr


def test_unknown_mode_is_refused(tmp_path):
    proj = make(tmp_path, {"mode": "cinema", "scenes": scenes(1)}, {"s1": 1.0})
    r = run_audio(proj, check=False)
    assert r.returncode != 0 and "unknown" in r.stderr


# ---------------------------------------------------------------- the mix
def tone(seconds, amp=0.3, f=220):
    return (amp * np.sin(2 * np.pi * f * np.arange(int(seconds * SR)) / SR)).astype("float32")


def test_same_project_gives_a_byte_identical_raw_mix(tmp_path):
    cfg = {"music": "upbeat", "lead": 0.5, "events": {"s1": {"a": {"t": 0.5, "sfx": "pop"}, "b": {"t": 1.0, "sfx": "click"}}}, "scenes": scenes(2)}
    a = make(tmp_path, cfg, {"s1": 2.0, "s2": 2.0}, name="a", vo={"s1": tone(2), "s2": tone(2)})
    b = make(tmp_path, cfg, {"s1": 2.0, "s2": 2.0}, name="b", vo={"s1": tone(2), "s2": tone(2)})
    run_audio(a); run_audio(b)
    assert (a / "audio" / "mix_raw.wav").read_bytes() == (b / "audio" / "mix_raw.wav").read_bytes()
    assert (a / "timing.json").read_bytes() == (b / "timing.json").read_bytes()


@pytest.mark.parametrize("mood", ["warm", "calm", "upbeat"])
def test_music_ducks_about_eight_db_under_the_voice(tmp_path, mood):
    cfg = {"music": mood, "transition_whoosh": False, "lead": 1.0, "tail": 1.0, "scenes": scenes(1)}
    with_voice = make(tmp_path, cfg, {"s1": 8.0}, name="with", vo={"s1": tone(8.0)})
    without = make(tmp_path, cfg, {"s1": 8.0}, name="without")          # same durations, no narration audio: music alone
    run_audio(with_voice); run_audio(without)
    a, _ = sf.read(with_voice / "audio" / "mix_raw.wav"); b, _ = sf.read(without / "audio" / "mix_raw.wav")
    lo, hi = int(4.0 * SR), int(8.0 * SR)                                # well inside the voice (1 to 9 s), after the music fade in
    music_under_voice = a[lo:hi, 0] - np.pad(tone(8.0), (SR, 0))[lo:hi]  # the mix minus the narration that was placed at 1 s
    rms = lambda x: float(np.sqrt(np.mean(np.square(x))))
    drop_db = 20 * np.log10(rms(b[lo:hi, 0]) / rms(music_under_voice))
    assert 6.0 <= drop_db <= 10.0, drop_db


def test_music_none_leaves_only_the_narration(tmp_path):
    proj = make(tmp_path, {"music": "none", "transition_whoosh": False, "lead": 1.0, "scenes": scenes(1)}, {"s1": 2.0}, vo={"s1": tone(2.0)})
    run_audio(proj)
    mix, _ = sf.read(proj / "audio" / "mix_raw.wav")
    assert abs(mix[: SR, 0]).max() == 0.0 and abs(mix[SR + 1000: 3 * SR - 1000, 0]).max() > 0.25


def test_event_effects_land_at_the_narration_start_plus_offset(tmp_path):
    cfg = {"music": "none", "transition_whoosh": False, "lead": 1.0, "scenes": scenes(1), "events": {"s1": {"hit": {"t": 2.0, "sfx": "click"}, "plain": 0.5}}}
    proj = make(tmp_path, cfg, {"s1": 4.0})
    run_audio(proj)
    mix, _ = sf.read(proj / "audio" / "mix_raw.wav")
    assert timing(proj)["EV"] == {"s1": {"hit": 2.0, "plain": 0.5}}
    loud = np.where(abs(mix[:, 0]) > 0.01)[0]
    assert loud.min() >= int(3.0 * SR) - 1 and loud.max() < int(3.05 * SR)      # click at 1.0 + 2.0 s, 30 ms long, nothing else


def test_transition_whoosh_is_on_by_default_and_can_be_switched_off(tmp_path):
    base = {"music": "none", "lead": 1.0, "scenes": scenes(2)}
    on = make(tmp_path, base, {"s1": 2.0, "s2": 2.0}, name="on"); off = make(tmp_path, {**base, "transition_whoosh": False}, {"s1": 2.0, "s2": 2.0}, name="off")
    run_audio(on); run_audio(off)
    assert abs(sf.read(on / "audio" / "mix_raw.wav")[0]).max() > 0.01 and abs(sf.read(off / "audio" / "mix_raw.wav")[0]).max() == 0.0


def test_length_warning_when_over_target(tmp_path):
    proj = make(tmp_path, {"music": "none", "length": 5, "scenes": scenes(1)}, {"s1": 6.0})
    assert "WARNING" in run_audio(proj).stdout


# ---------------------------------------------------------------- plain messages for bad input
def one_line_error(r, *needles):
    assert r.returncode == 1 and r.stderr.startswith("ERROR: ") and "Traceback" not in r.stderr, r.stderr
    assert len(r.stderr.strip().splitlines()) == 1
    for n in needles: assert n in r.stderr, r.stderr


def test_invalid_json_is_a_plain_message(tmp_path):
    proj = make(tmp_path, {}, {})
    (proj / "project.json").write_text('{"scenes": [}')
    one_line_error(run_audio(proj, check=False), "project.json is not valid JSON", "line 1 column")


def test_unknown_music_lists_the_choices(tmp_path):
    proj = make(tmp_path, {"music": "jazz", "scenes": scenes(1)}, {"s1": 1.0})
    one_line_error(run_audio(proj, check=False), '"jazz"', "warm", "calm", "upbeat", "none", "gain_db")


def test_footage_without_voice_wav_says_run_cut(tmp_path):
    proj = make(tmp_path, {"mode": "footage", "scenes": [{"id": "s1", "start": 0, "end": 2}]})
    one_line_error(run_audio(proj, check=False), "audio/voice.wav is missing", "cut", '"voice_track": false')


@pytest.mark.parametrize("ids, word", [(["s1", "s1"], "used twice"), (["s1", "intro"], "'intro'"), (["s1", "s02x"], "'s02x'")])
def test_audio_refuses_bad_scene_ids(tmp_path, ids, word):
    proj = make(tmp_path, {"music": "none", "scenes": [{"id": i} for i in ids]}, {i: 1.0 for i in ids})
    one_line_error(run_audio(proj, check=False), word)
