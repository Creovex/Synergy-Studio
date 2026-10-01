"""instruments.py: the score played on real instruments. Timing to the sample, the same bytes every render, every preset
checked, never silence. Thresholds were fixed in BUILD_LOG.md (L12 plan) before the first run.

The fonts come from the tool home's soundfonts/ (setup installs them), or SYNERGY_STUDIO_SOUNDFONTS. Without a font these
tests fail: they are part of the gate."""
import io
import os
import pathlib
import sys

import numpy as np
import pytest
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "skills" / "synergy-studio" / "scripts"))
from score_file import ScoreError, compile_score  # noqa: E402
from instruments import SR, render, find_font, installed_fonts  # noqa: E402

HOME = pathlib.Path(os.environ.get("SYNERGY_STUDIO_HOME") or pathlib.Path.home() / "Library" / "Application Support" / "SynergyStudioLite")
FONTS = pathlib.Path(os.environ.get("SYNERGY_STUDIO_SOUNDFONTS") or HOME / "soundfonts")
TIMING = {"T": {"s1": {"start": 0, "vo": 0, "vo_end": 30, "end": 30}}, "EV": {}, "CUE": {}}
AUDIBLE = 10 ** (-60 / 20)                  # -60 dBFS
PERCUSSIVE = [("kick", None, 36), ("piano", 0, 60), ("orchestra hit", 55, 60), ("timpani", 47, 41), ("tr808 kick", "tr808", 36)]


def font_ids():
    _, fonts = installed_fonts(FONTS)
    assert fonts, f"no SoundFont in {FONTS}: run studio setup (these tests need one)"
    return sorted(fonts)


def font(fid):
    return find_font(FONTS, fid)[1]


def compiled(tracks, **over):
    s = {"tempo": {"bpm": 120}, "anchors": [{"bar": 1, "at": 0}], "reverb": "none", "tracks": tracks, **over}
    return compile_score(s, TIMING)


def one_sound(prog, key):
    """A single note at 2.000 s (bar 2, beat 1 at 120 BPM)."""
    name = pitch = None
    if prog is None or isinstance(prog, str):
        kit = prog or "standard"
        grid = {"bars": "2", next(k for k, v in __import__("score_file").DRUMS.items() if v == key): "x..............."}
        return compiled({"t": {"kit": kit, "humanize": 0, "grids": [grid]}})
    names = {36: "C2", 41: "F2", 60: "C4"}
    return compiled({"t": {"program": prog, "humanize": 0, "notes": [["2:1", names[key], "1/4"]]}})


def first_audible(x):
    loud = np.flatnonzero(np.abs(x).max(axis=1) > AUDIBLE)
    return int(loud[0]) if loud.size else None


# ---------------------------------------------------------------- test 1: timing
@pytest.mark.parametrize("label, prog, key", PERCUSSIVE)
def test_a_note_at_2_s_is_never_early_and_percussive_sounds_start_within_5_ms(label, prog, key):
    for fid in font_ids():
        x = render(one_sound(prog, key), font(fid), 4.0)
        first = first_audible(x)
        assert first is not None, f"{label} on {fid}: silent"
        delay_ms = (first - 2 * SR) / SR * 1000
        print(f"{fid} {label}: first sample above -60 dBFS {delay_ms:+.2f} ms after 2.000 s")
        assert first >= 2 * SR, f"{label} on {fid} starts {delay_ms:.2f} ms early"
        assert delay_ms <= 5.0, f"{label} on {fid} starts {delay_ms:.2f} ms late"


def kick_offsets(block=None, fid=None):
    """A bar of sixteen kicks at 104 BPM: how many samples after its scheduled sample each one's attack lands, found by
    matching the first 10 ms of a lone kick (the tail of the kick before cannot confuse a match)."""
    fid = fid or font_ids()[0]
    tempo = {"bpm": 104}
    lone = compile_score({"tempo": tempo, "reverb": "none", "tracks": {"d": {"kit": "standard", "humanize": 0, "grids": [{"bars": "2", "kick": "x..............."}]}}}, TIMING)
    bar = compile_score({"tempo": tempo, "reverb": "none", "tracks": {"d": {"kit": "standard", "humanize": 0, "grids": [{"bars": "2", "kick": "xxxxxxxxxxxxxxxx"}]}}}, TIMING)
    spb = 60 / 104
    t0 = round(4 * spb * SR)
    tmpl = render(lone, font(fid), 6.0, block=block).mean(axis=1)[t0: t0 + SR // 100]
    x = render(bar, font(fid), 6.0, block=block).mean(axis=1)
    out = []
    for k in range(16):
        s = round((4 + k / 4) * spb * SR)
        lags = range(-600, 601)
        score = [np.dot(x[s + lag: s + lag + len(tmpl)], tmpl) for lag in lags]
        out.append(lags[int(np.argmax(score))])
    return out


def test_sixteen_kicks_have_the_same_offset_within_a_tenth_of_a_millisecond():
    for fid in font_ids():
        offs = kick_offsets(fid=fid)
        print(fid, "kick offsets in samples:", offs)
        assert (max(offs) - min(offs)) / SR * 1000 <= 0.1


def test_falsifier_a_renderer_stepping_in_512_sample_blocks_fails_both_timing_rules():
    offs = kick_offsets(block=512)
    print("512 block kick offsets in samples:", offs)
    assert (max(offs) - min(offs)) / SR * 1000 > 0.1
    x = render(one_sound(0, 60), font(font_ids()[0]), 4.0, block=512)
    delay_ms = (first_audible(x) - 2 * SR) / SR * 1000
    print(f"512 block piano: {delay_ms:+.2f} ms")
    assert delay_ms > 5.0


# ---------------------------------------------------------------- test 3: determinism
def wav_bytes(x, tmp=pathlib.Path(os.environ.get("TMPDIR", "/tmp")) / "ss-wav-bytes.wav"):
    """The bytes the tool writes for these samples (write_float_wav: no clock time in the file)."""
    from instruments import write_float_wav
    write_float_wav(tmp, x)
    return tmp.read_bytes()


def groove(seed):
    return compiled({"d": {"kit": "standard", "grids": [{"bars": "1-4", "kick": "x.....x.x.......", "chh": "xxxxxxxxxxxxxxxx", "clap": "....x.......x..."}]},
                     "k": {"program": 4, "rhythm": "..x...x...x...x.", "chords": [["1:1", "Am9", "4/1"]]}},
                    seed=seed, reverb="room")


def test_two_renders_are_byte_identical_and_another_seed_differs():
    f = font(font_ids()[0])
    xa, xb, xc = render(groove(1), f, 8.0), render(groove(1), f, 8.0), render(groove(2), f, 8.0)
    d = np.flatnonzero(np.abs(xa.astype(np.float64) - xb).max(axis=1) > 0)
    assert wav_bytes(xa) == wav_bytes(xb), (f"{f.name}: two renders differ in {d.size} samples from {d[0] / SR:.4f} s, "
                                            f"largest difference {np.abs(xa.astype(np.float64) - xb).max():.3e}")
    assert wav_bytes(xa) != wav_bytes(xc), "another seed gave the same bytes"


# ---------------------------------------------------------------- test 4: refused, never substituted, never silent
def test_a_preset_missing_from_the_font_is_refused():
    with pytest.raises(ScoreError) as e:
        render(compiled({"x": {"program": 0, "bank": 5, "notes": [["1:1", "C4", "1/4"]]}}), font(font_ids()[0]), 2.0)
    assert "program 0 (bank 5) is not in" in str(e.value) and "studio sounds" in str(e.value) and "nothing is substituted" in str(e.value)


def test_no_soundfont_is_an_error_that_names_the_fix(tmp_path):
    with pytest.raises(ScoreError) as e:
        find_font(tmp_path)
    assert "no SoundFont is installed" in str(e.value) and "studio setup --soundfont" in str(e.value)


def test_a_font_that_is_not_installed_is_refused_with_the_installed_ones():
    with pytest.raises(ScoreError) as e:
        find_font(FONTS, "no-such-font")
    assert "is not installed" in str(e.value) and font_ids()[0] in str(e.value)


# ---------------------------------------------------------------- mix controls
def level_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x.astype(np.float64) ** 2)))


def test_gain_db_sets_the_track_level():
    f = font(font_ids()[0])
    loud = render(compiled({"p": {"program": 0, "humanize": 0, "notes": [["1:1", "C4", "1/1"]]}}), f, 2.0)
    soft = render(compiled({"p": {"program": 0, "humanize": 0, "gain_db": -6, "notes": [["1:1", "C4", "1/1"]]}}), f, 2.0)
    assert abs(level_db(soft) - level_db(loud) + 6) <= 0.3


def test_a_hits_gain_db_is_exact():
    f = font(font_ids()[0])
    peak = lambda g: np.abs(render(compile_score({"tempo": {"bpm": 104}, "reverb": "room", "hits": [{"at": 0.5, "sound": "impact", "gain_db": g}]}, TIMING), f, 2.5)).max()
    full = peak(0)
    for g in (-6, -12):
        assert abs(20 * np.log10(peak(g) / full) - g) <= 0.1


def test_a_bend_of_minus_12_with_range_12_ends_an_octave_lower():
    f = font(font_ids()[0])
    x = render(compiled({"f": {"program": 73, "humanize": 0, "bend_range": 12, "notes": [["1:1", "A4", "2/1"]],
                               "bends": [["1:3", -12, "1/4"]]}}), f, 4.0).mean(axis=1)

    def pitch(a, b):
        seg = x[int(a * SR): int(b * SR)] * np.hanning(int(b * SR) - int(a * SR))
        spec = np.abs(np.fft.rfft(seg, 1 << 18))
        return np.argmax(spec) * SR / (1 << 18)
    before, after = pitch(0.3, 0.9), pitch(1.8, 2.8)
    print(f"flute before {before:.1f} Hz, after the bend {after:.1f} Hz")
    assert abs(before / 440 - 1) < 0.03 and abs(after / before - 0.5) < 0.03


# ---------------------------------------------------------------- found by the code review (L12)
def test_notes_after_the_end_never_ring_into_the_start_of_the_next_pass():
    # a 4 s score at 120 BPM (bars 1 and 2), with and without chords written on into bars 3 to 8; the wet pass renders
    # before the dry (bass) pass on the same synth, so a leak would show in the first 10 ms
    def first_10ms(last_bar):
        c = compiled({"k": {"program": 48, "humanize": 0, "chords": [[f"{b}:1", "Am", "1/1"] for b in range(1, last_bar + 1)]},
                      "b": {"program": 33, "humanize": 0, "notes": [["1:3", "A1", "1/8"]]}}, reverb="room")
        return float(np.abs(render(c, font(font_ids()[0]), 4.0)[: SR // 100]).max())
    inside, past = first_10ms(2), first_10ms(8)
    print(f"first 10 ms peak: chords only inside the score {inside:.5f}, chords written past its end {past:.5f}")
    assert abs(past - inside) < 1e-6         # the review measured 0.0696 against 0.0003 before the fix


def test_two_notes_of_one_key_at_the_same_instant_do_not_stick():
    f = font(font_ids()[0])
    one = render(compiled({"s": {"program": 48, "humanize": 0, "notes": [["1:1", "C4", "1/2"]]}}), f, 6.0)
    two = render(compiled({"s": {"program": 48, "humanize": 0, "notes": [["1:1", ["C4", "C4"], "1/2"]]}}), f, 6.0)
    tail = lambda x: float(np.sqrt(np.mean(x[4 * SR: 5 * SR].astype(np.float64) ** 2)))
    print(f"rms 4 to 5 s: one note {tail(one):.6f}, the same note twice {tail(two):.6f}")
    assert tail(two) <= tail(one) + 1e-6     # the review measured 0.0116 against 0.0 before the fix


def test_a_glide_reaches_its_value_at_the_end_of_its_duration():
    from instruments import bend_events
    ev = bend_events([(1.0, 0, "bend_to", (-12.0, 0.1, 12.0))])
    first, last = min(ev), max(ev)
    assert first[0] == SR and first[4] == 8192                  # starts where the wheel is, at t
    assert last[0] == round(1.1 * SR) and last[4] == 1          # all the way down at t + 0.1 s
    cut = bend_events([(1.0, 0, "bend_to", (-12.0, 1.0, 12.0)), (1.5, 0, "bend_to", (0.0, 0.0, 12.0))])
    assert all(e[0] <= round(1.5 * SR) for e in cut) and max(cut)[4] == 8192   # the second glide cuts the first off


# ---------------------------------------------------------------- found by the verifier (L12)
def test_the_same_samples_written_a_second_apart_give_the_same_bytes(tmp_path):
    import time
    from instruments import write_float_wav
    x = render(groove(1), font(font_ids()[0]), 2.0)
    write_float_wav(tmp_path / "a.wav", x); time.sleep(1.1); write_float_wav(tmp_path / "b.wav", x)
    assert (tmp_path / "a.wav").read_bytes() == (tmp_path / "b.wav").read_bytes()
    back, sr = sf.read(tmp_path / "a.wav", dtype="float32")
    assert sr == SR and np.array_equal(back, x)                  # a plain float WAV every reader takes
    sf.write(tmp_path / "c.wav", x, SR, subtype="FLOAT"); time.sleep(1.1); sf.write(tmp_path / "d.wav", x, SR, subtype="FLOAT")
    assert (tmp_path / "c.wav").read_bytes() != (tmp_path / "d.wav").read_bytes()   # falsifier: libsndfile's PEAK chunk has the time


def test_a_bend_holds_only_until_the_next_note():
    f = font(font_ids()[0])
    x = render(compiled({"o": {"program": 79, "humanize": 0, "bend_range": 12, "notes": [["1:1", "C5", "1/2"], ["2:1", "C5", "1/2"]],
                               "bends": [["1:1", -12, "1/4"]]}}), f, 4.0).mean(axis=1)
    seg = x[int(2.1 * SR): int(2.6 * SR)] * np.hanning(int(0.5 * SR))
    hz = np.argmax(np.abs(np.fft.rfft(seg, 1 << 18))) * SR / (1 << 18)
    print(f"the note after the bend: {hz:.1f} Hz")
    assert abs(hz / 523.25 - 1) < 0.03                          # C5, not the octave below


def test_a_key_outside_an_instruments_samples_is_refused_not_silent():
    with pytest.raises(ScoreError) as e:
        render(compiled({"t": {"program": 58, "notes": [["1:1", "C8", "1/4"]]}}), font(font_ids()[0]), 2.0)
    assert "C8 (key 108) makes no sound" in str(e.value) and "tracks.t" in str(e.value)


def test_gain_db_can_raise_a_quiet_track_and_its_peak_is_reported():
    f, levels, up = font(font_ids()[0]), {}, {}
    render(compiled({"p": {"program": 0, "humanize": 0, "notes": [["1:1", "C4", "1/1"]]}}), f, 2.0, levels=levels)
    render(compiled({"p": {"program": 0, "humanize": 0, "gain_db": 12, "notes": [["1:1", "C4", "1/1"]]}}), f, 2.0, levels=up)
    assert abs(up["p"] - levels["p"] - 12) <= 0.15


def test_a_long_length_is_cut_to_the_video_and_a_narrated_project_without_voice_says_what_to_do(tmp_path):
    import json, subprocess
    from instruments import render_project
    proj = tmp_path / "p"; (proj / "src").mkdir(parents=True)
    (proj / "src" / "score.json").write_text(json.dumps({"length": 600, "tempo": {"bpm": 120}, "tracks": {"p": {"program": 0, "notes": [["1:1", "C4", "1/4"]]}}}))
    audio, report = render_project(proj, TIMING, 5.0, FONTS)
    assert report["length_s"] == 5.0 and len(audio) == round(7.0 * SR)          # 5 s of video and the 2 s tail, never 600 s
    (proj / "project.json").write_text(json.dumps({"mode": "narrated", "scenes": [{"id": "s1", "say": "Hello."}]}))
    script = pathlib.Path(__file__).resolve().parents[1] / "skills" / "synergy-studio" / "scripts" / "audio.py"
    r = subprocess.run([sys.executable, str(script), str(proj), "ffmpeg", str(FONTS), "--score-only"], capture_output=True, text=True)
    assert r.returncode != 0 and "Run studio voice" in r.stderr and "Traceback" not in r.stderr
